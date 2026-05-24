// POST /api/voice-clone/revoke
//
// Revokes a clinician's voice clone:
//   1. DELETE the voice at ElevenLabs (idempotent — 404 is fine)
//   2. NULL eleven_voice_id on the clinician row
//   3. Set voice_clone_revoked_at = now() (audit trail)
//
// Keeps voice_clone_sample_url + voice_clone_consent_at intact so a clinician
// who later re-consents can re-clone from the same sample without re-recording.
//
// Body: { clinicianId: string }
// Response: { ok: true }

export const config = { runtime: 'nodejs', maxDuration: 60 }

import { requireRole } from '../_lib/auth.js'
import { workspaceContext } from '../_lib/workspaceContext.js'
import { enforceLimit } from '../_lib/ratelimit.js'
import { deleteVoice } from '../_lib/elevenLabsVoiceClone.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'media'))) return

  const { clinicianId } = req.body || {}
  if (!clinicianId) return res.status(400).json({ error: 'clinicianId required' })

  const lookupRes = await sb(
    `clinicians?id=eq.${encodeURIComponent(clinicianId)}` +
    `&workspace_id=eq.${ws.id}` +
    `&select=id,eleven_voice_id&limit=1`
  )
  if (!lookupRes.ok) return res.status(502).json({ error: 'Could not look up clinician' })
  const [clinician] = await lookupRes.json()
  if (!clinician) return res.status(404).json({ error: 'Clinician not found in this workspace' })

  if (clinician.eleven_voice_id) {
    try {
      await deleteVoice(clinician.eleven_voice_id)
    } catch (e) {
      console.warn(`[voice-clone] delete upstream failed for clinician=${clinicianId}: ${e?.message}`)
      // Continue to null out locally — keeping a dangling voice_id on our
      // side is worse than leaking an upstream voice that the user can
      // manually delete in the ElevenLabs dashboard.
    }
  }

  const patchRes = await sb(
    `clinicians?id=eq.${encodeURIComponent(clinicianId)}&workspace_id=eq.${ws.id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        eleven_voice_id:        null,
        voice_clone_revoked_at: new Date().toISOString(),
      }),
    },
  )
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => '')
    console.error(`[voice-clone] revoke PATCH ${patchRes.status}: ${body.slice(0, 300)}`)
    return res.status(502).json({ error: 'Revoke succeeded upstream but did not save — please refresh.' })
  }

  return res.status(200).json({ ok: true })
}
