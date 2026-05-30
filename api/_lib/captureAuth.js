// Shared auth helper for /api/capture/* endpoints.
// Authenticates a Bearer capture upload token (cct_ prefix) from the staff table.
// Returns { clinician, workspace } or null on any auth/expiry/gate failure.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  })
}

export async function authByCaptureToken(token) {
  if (!token || !token.startsWith('cct_')) return null

  const r = await sb(
    `staff?capture_upload_token=eq.${encodeURIComponent(token)}` +
      `&select=id,workspace_id,name,user_id,permission_tier,staff_type,capture_upload_token_expires_at`,
  )
  if (!r.ok) return null
  const rows = await r.json()
  const clinician = rows?.[0]
  if (!clinician) return null

  if (clinician.capture_upload_token_expires_at) {
    const exp = new Date(clinician.capture_upload_token_expires_at).getTime()
    if (Date.now() > exp) return null
  }

  const wr = await sb(
    `workspaces?id=eq.${clinician.workspace_id}&status=eq.active&select=id,slug,video_pipeline_enabled`,
  )
  if (!wr.ok) return null
  const wsRows = await wr.json()
  const workspace = wsRows?.[0]
  if (!workspace?.video_pipeline_enabled) return null

  return { clinician, workspace }
}
