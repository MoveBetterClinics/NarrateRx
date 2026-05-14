import { withSentry } from '../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { waitUntil } from '@vercel/functions'
import { requireRole } from '../_lib/auth.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { workspaceById } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import {
  parseFilenameTokens,
  scoreRoleCandidates,
  inferImageAttributes,
} from '../_lib/brandKitClassifier.js'
import { extractBrandGuidelines } from '../_lib/brandGuidelinesExtractor.js'

// Brand-asset upload — same two-phase Vercel Blob pattern as /api/media/upload
// (handshake at body.type='blob.generate-client-token', server-side insert at
// body.type='blob.upload-completed'). Differences from media:
//
//   - Accept set includes SVG and PDF; no video.
//   - No HEIC handling (designers don't hand off HEIC; client uploader rejects).
//   - On completion runs the brand classifier (filename tokens + sharp-based
//     shape/background/color analysis) and inserts into brand_assets — not
//     media_assets. No AI tagging, no segmentation, no thumbnail backfill.
//
// Runs on Node — @vercel/blob and sharp both need Node built-ins.

export const config = { runtime: 'nodejs' }

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const HANDSHAKE_ALLOWED_ROLES = ['admin', 'editor']

const ALLOWED_MIME = [
  'image/svg+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]

// Per-file ceiling. Designer brand books occasionally run 20–30 MB, hence the
// 25 MB cap (vs 10 MB for the typical logo). Vercel Blob's plan-level limit is
// the real backstop; this just fails fast in the browser.
const MAX_BRAND_ASSET_BYTES = 25 * 1024 * 1024

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body

  // Resolve workspace scope only at handshake time. The completion webhook
  // (platform-to-server) re-hydrates the workspace via the id round-tripped
  // through tokenPayload — same pattern as media/upload.js.
  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    const auth = await requireRole(req, HANDSHAKE_ALLOWED_ROLES)
    if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    if (!(await enforceLimit(req, res, 'media'))) return
    scope = await workspaceScope(req)
  }

  try {
    const result = await handleUpload({
      body,
      request: req,

      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let meta = {}
        try { meta = clientPayload ? JSON.parse(clientPayload) : {} } catch { /* empty */ }
        return {
          allowedContentTypes: ALLOWED_MIME,
          maximumSizeInBytes: MAX_BRAND_ASSET_BYTES,
          tokenPayload: JSON.stringify({
            scopeColumn: scope.column,
            scopeId: scope.id,
            filename: meta.filename || pathname.split('/').pop(),
            uploadedBy: meta.uploadedBy || null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let meta = {}
        try { meta = tokenPayload ? JSON.parse(tokenPayload) : {} } catch { /* empty */ }

        const scopeColumn = meta.scopeColumn
        const scopeId     = meta.scopeId
        if (!scopeColumn || !scopeId) {
          console.error('brand-kit upload: tokenPayload missing scope; refusing to insert row')
          return
        }
        // Re-hydrate the workspace so cross-tenant writes are impossible from a
        // forged tokenPayload (workspaceById returns null for unknown ids).
        const workspace = await workspaceById(scopeId)
        if (!workspace) {
          console.error(`brand-kit upload: workspace ${scopeId} not found; refusing to insert row`)
          return
        }

        // Filename-token parse runs regardless of mime type. The image-only
        // attribute inference (sharp metadata + corner sampling) is gated on
        // image/*; PDFs and SVGs skip the inferImageAttributes branch entirely
        // (SVG is text/XML so sharp's pixel analysis isn't meaningful without
        // rasterizing — left as future work; until then SVGs get filename-only
        // classification).
        const filename = meta.filename || blob.pathname.split('/').pop()
        const filename_tokens = parseFilenameTokens(filename)

        let attrs = { width: null, height: null, has_alpha: null, shape: null, background: 'unknown', color_mode: 'unknown' }
        if (blob.contentType?.startsWith('image/') && blob.contentType !== 'image/svg+xml') {
          try {
            const buf = Buffer.from(await (await fetch(blob.url)).arrayBuffer())
            attrs = await inferImageAttributes(buf, blob.contentType)
          } catch (e) {
            console.error(`brand-kit classify: ${filename} attribute inference failed:`, e?.message)
          }
        }

        const assetForScoring = {
          ...attrs,
          filename_tokens,
          mime_type: blob.contentType,
        }
        const ai_classification = { role_candidates: scoreRoleCandidates(assetForScoring) }

        const row = {
          [scopeColumn]: scopeId,
          blob_url: blob.url,
          blob_pathname: blob.pathname,
          mime_type: blob.contentType,
          byte_size: blob.size || meta.fileSize || 0,
          original_filename: filename,
          width: attrs.width,
          height: attrs.height,
          has_alpha: attrs.has_alpha,
          shape: attrs.shape,
          background: attrs.background,
          color_mode: attrs.color_mode,
          filename_tokens,
          ai_classification,
          uploaded_by: meta.uploadedBy || null,
        }

        const ins = await sb('brand_assets', { method: 'POST', body: JSON.stringify(row) })
        if (!ins.ok) {
          // Blob is already uploaded — log loudly but don't throw, the platform
          // would retry the webhook and we'd end up with N stale blobs for one
          // failed row.
          console.error('brand_assets insert failed:', ins.status, await ins.text())
          waitUntil(Promise.resolve())
          return
        }

        const inserted = (await ins.json())?.[0]
        const topCandidate = ai_classification.role_candidates?.[0]
        const isBrandBook = topCandidate?.role === 'brand_book'

        // Auto-assign the highest-confidence role to brand_kit_roles when the
        // slot is empty. Never overwrites an existing manual assignment.
        const AUTO_ASSIGN_MIN_CONFIDENCE = 0.75
        if (inserted?.id && topCandidate && topCandidate.confidence >= AUTO_ASSIGN_MIN_CONFIDENCE) {
          const existingRes = await sb(
            `brand_kit_roles?workspace_id=eq.${encodeURIComponent(scopeId)}&role=eq.${encodeURIComponent(topCandidate.role)}&select=id&limit=1`
          )
          const existingRows = existingRes.ok ? await existingRes.json() : []
          if (existingRows.length === 0) {
            const assignRes = await sb(`brand_kit_roles?on_conflict=workspace_id,role`, {
              method: 'POST',
              headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({
                workspace_id: scopeId,
                role: topCandidate.role,
                asset_id: inserted.id,
                assigned_by: null,
                assigned_at: new Date().toISOString(),
              }),
            })
            if (!assignRes.ok) {
              console.error('brand-kit auto-assign failed:', assignRes.status, await assignRes.text())
            }
          }
        }

        // For brand book PDFs, extract guidelines asynchronously — text parsing
        // and an AI call can take 10–30s, so we hand it off to waitUntil so the
        // webhook returns 200 immediately and Vercel continues it in the background.
        if (isBrandBook && inserted?.id && blob.contentType === 'application/pdf') {
          waitUntil(
            extractBrandGuidelines(blob.url).then(async (guidelines) => {
              if (!guidelines) return
              // Store extracted text in ai_classification so it travels with the asset.
              const updatedClassification = { ...ai_classification, extracted_guidelines: guidelines }
              const upd = await sb(`brand_assets?id=eq.${inserted.id}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ ai_classification: updatedClassification }),
              })
              if (!upd.ok) {
                console.error('brand_assets guideline patch failed:', upd.status, await upd.text())
                return
              }
              // Sync to workspace so prompts can read brand_guidelines from the
              // workspace row without an extra brand-kit query.
              const ws = await sb(`workspaces?id=eq.${scopeId}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({ brand_guidelines: guidelines }),
              })
              if (!ws.ok) console.error('workspace brand_guidelines sync failed:', ws.status, await ws.text())
            }).catch((e) => console.error('brand guideline extraction failed:', e?.message))
          )
        } else {
          waitUntil(Promise.resolve())
        }
      },
    })

    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload handler failed' })
  }
}

export default withSentry(handler)
