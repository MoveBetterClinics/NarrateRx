import { withSentry } from '../_lib/sentry.js'
import { handleUpload } from '@vercel/blob/client'
import { requireRole } from '../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../_lib/roles.js'
import { workspaceScope } from '../_lib/workspaceScope.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { recordUploadedAsset } from '../_lib/recordUploadedAsset.js'

// Two-phase upload via @vercel/blob/client:
//   Phase 1 — body.type='blob.generate-client-token' (browser handshake):
//             check Clerk role here; an unauthenticated request must not be
//             able to mint a Blob upload token.
//   Phase 2 — body.type='blob.upload-completed' (Blob platform webhook):
//             the request originates from Vercel Blob, not the browser, so
//             there is no user Bearer token to verify. handleUpload() itself
//             cryptographically verifies the payload via the issued token.
// Explicit Node runtime so the Edge whole-graph bundler doesn't follow
// the ratelimit.js → @clerk/backend → node:crypto chain into middleware.
export const config = { runtime: 'nodejs' }

const HANDSHAKE_ALLOWED_ROLES = ALL_KNOWN_ROLES

// HEIC/HEIF are accepted here AND transcoded client-side by the browser
// uploader (src/lib/mediaLib.js → maybeTranscodeHeic via heic2any). The
// server-side image pipeline (api/_lib/imagePipeline.js) is the safety net.
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v',
]

const PURPOSES = new Set(['interview', 'broll', 'photo', 'brand'])

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body

  let scope = null
  if (body?.type === 'blob.generate-client-token') {
    scope = await workspaceScope(req)
    const auth = await requireRole(req, HANDSHAKE_ALLOWED_ROLES, { orgId: scope.workspace.clerk_org_id })
    if (!auth.ok) {
      return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
    }
    if (!(await enforceLimit(req, res, 'media'))) return
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
          maximumSizeInBytes: 500 * 1024 * 1024,
          tokenPayload: JSON.stringify({
            scopeColumn: scope.column,
            scopeId: scope.id,
            filename: meta.filename || pathname.split('/').pop(),
            createdBy: meta.createdBy || null,
            patientPseudonym: meta.patientPseudonym || null,
            condition: meta.condition || null,
            capturedAt: meta.capturedAt || null,
            notes: meta.notes || null,
            assetPurpose: PURPOSES.has(meta.assetPurpose) ? meta.assetPurpose : null,
            speakerRole: meta.speakerRole || null,
            parentId: meta.parentId || null,
            contentPieceId: meta.contentPieceId || null,
            collectionId: typeof meta.collectionId === 'string' && meta.collectionId
              ? meta.collectionId
              : null,
            clinicianId: typeof meta.clinicianId === 'string' && meta.clinicianId
              ? meta.clinicianId
              : null,
          }),
        }
      },

      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let parsed = {}
        try { parsed = tokenPayload ? JSON.parse(tokenPayload) : {} } catch { /* empty */ }
        await recordUploadedAsset({ blob, tokenPayload: parsed })
      },
    })

    return res.status(200).json(result)
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Upload handler failed' })
  }
}

export default withSentry(handler)
