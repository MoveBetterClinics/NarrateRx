// POST /api/interviews/audio
//
// Two-phase Vercel Blob client-upload for interview audio recordings.
// Used exclusively for ElevenLabs voice clone training — stores the
// clinician's raw mic audio from a completed interview session.
//
// Phase 1 — browser sends { type:'blob.generate-client-token', payload:{ pathname, clientPayload } }
//   → validates auth + interview ownership, issues upload token
//   → clientPayload carries { interviewId } so phase 2 can PATCH the row
//
// Phase 2 — Vercel Blob platform calls back with { type:'blob.upload-completed' }
//   → PATCHes interviews.audio_recording_url with the final blob URL
//
// Accepts: audio/webm, audio/mp4, audio/ogg, audio/mpeg
// Pathname pattern: interviews/audio/<interviewId>.<ext>

export const config = { runtime: 'nodejs' }

import { handleUpload } from '@vercel/blob/client'
import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
      ...init.headers,
    },
  })
}

const ALLOWED_AUDIO_MIME = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
]

export default async function handler(req, res) {
  try {
    const jsonResponse = await handleUpload({
      body:    req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Validate that the requester owns the interview before minting a token.
        const ws = await workspaceContext(req)
        if (!ws) throw new Error('Workspace not resolved')

        const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
        if (!auth.ok) throw new Error('Unauthorized')

        const payload = JSON.parse(clientPayload || '{}')
        const interviewId = payload.interviewId
        if (!interviewId) throw new Error('interviewId required in clientPayload')

        // Confirm the interview belongs to this workspace + this user.
        const ivRes = await sb(
          `interviews?id=eq.${interviewId}&workspace_id=eq.${ws.id}&select=id,owner_id&limit=1`
        )
        if (!ivRes.ok) throw new Error('Interview lookup failed')
        const [iv] = await ivRes.json()
        if (!iv) throw new Error('Interview not found')
        if (iv.owner_id !== auth.userId) throw new Error('Interview not owned by requester')

        return {
          allowedContentTypes: ALLOWED_AUDIO_MIME,
          tokenPayload:        JSON.stringify({ interviewId, workspaceId: ws.id }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Blob is now stored. Patch the interview row with the URL.
        const { interviewId, workspaceId } = JSON.parse(tokenPayload || '{}')
        if (!interviewId) {
          console.error('[interviews/audio] missing interviewId in tokenPayload')
          return
        }
        if (!workspaceId) {
          console.error('[interviews/audio] missing workspaceId in tokenPayload')
          return
        }
        // workspace_id filter IS the authorization check (no RLS) — keep the
        // completion write tenant-scoped, matching the token-mint validation.
        const r = await sb(`interviews?id=eq.${interviewId}&workspace_id=eq.${workspaceId}`, {
          method: 'PATCH',
          body:   JSON.stringify({ audio_recording_url: blob.url }),
        })
        if (!r.ok) {
          const body = await r.text().catch(() => '')
          console.error(`[interviews/audio] PATCH failed ${r.status}: ${body.slice(0, 200)}`)
        } else {
          console.info(`[interviews/audio] saved audio for interview ${interviewId}: ${blob.url}`)
        }
      },
    })
    return res.status(200).json(jsonResponse)
  } catch (e) {
    console.error('[interviews/audio] handleUpload threw:', e?.message)
    return res.status(400).json({ error: e?.message ?? 'Upload error' })
  }
}
