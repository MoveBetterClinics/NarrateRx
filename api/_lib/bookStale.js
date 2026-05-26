// Mark a workspace's book as stale.
//
// Called fire-and-forget from any ingest path that adds new source material
// to a workspace (interview completion, future blog/draft ingest). The
// auto-regen cron picks up rows where stale_at IS NOT NULL on its next run.
//
// Idempotent: setting stale_at to "now" repeatedly is fine — the cron only
// cares that it's non-null. We upsert the row so we don't have to know
// whether workspace_books has a row for this workspace yet (lazy creation).
//
// Never throws — callers treat this as best-effort. A failed stale-flag
// degrades to "the book just won't auto-regen this round", which the user
// can recover from with a manual Regenerate click in PR 4.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export async function markBookStale({ workspaceId }) {
  if (!workspaceId) return
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/workspace_books?on_conflict=workspace_id`, {
      method: 'POST',
      headers: {
        apikey:        SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:        'return=minimal,resolution=merge-duplicates',
      },
      body: JSON.stringify({
        workspace_id: workspaceId,
        stale_at:     new Date().toISOString(),
      }),
    })
    if (!r.ok) {
      const body = await r.text().catch(() => '')
      console.error(`[bookStale] supabase ${r.status}: ${body.slice(0, 300)}`)
    }
  } catch (e) {
    console.error(`[bookStale] threw: ${e?.message}`)
  }
}
