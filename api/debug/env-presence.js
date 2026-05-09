// Temporary diagnostic endpoint — verifies that sensitive env vars are
// actually populated at runtime on the new multi-tenant deployment.
// Returns boolean presence checks only; never returns values. Delete this
// file once Phase 1A diagnostic is complete.

export const config = { runtime: 'edge' }

export default function handler() {
  const present = (k) => {
    const v = process.env[k]
    return typeof v === 'string' && v.length > 0
  }
  const lengthOf = (k) => {
    const v = process.env[k]
    return typeof v === 'string' ? v.length : 0
  }

  const body = {
    SUPABASE_URL: { present: present('SUPABASE_URL'), length: lengthOf('SUPABASE_URL') },
    SUPABASE_SERVICE_KEY: { present: present('SUPABASE_SERVICE_KEY'), length: lengthOf('SUPABASE_SERVICE_KEY') },
    MULTITENANT_DATABASE_URL: { present: present('MULTITENANT_DATABASE_URL'), length: lengthOf('MULTITENANT_DATABASE_URL') },
    deployment: process.env.VERCEL_URL || null,
  }
  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
