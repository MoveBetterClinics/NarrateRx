// Shared helper for fetching Buffer post statistics via the GraphQL API.
//
// The old v1 REST API (api.bufferapp.com/1/updates/:id.json?access_token=...)
// rejects Personal Access Tokens (PAT) with "OIDC tokens are not accepted for
// direct API access." All three analytics paths (buffer-analytics, engagement/
// refresh, cron/refresh-engagement) now go through here instead.
//
// Schema notes (2026-05-17):
//   - Query.post requires `input: PostInput!` (not `id: String!`). Buffer's
//     schema validator rejects the bare id argument with
//     "Field 'post' argument 'input' of type 'PostInput!' is required".
//   - The Post type does NOT expose a `statistics` field — the assumed name
//     in PR #609 was wrong, and Buffer's schema validator reports it. The
//     correct field name needs introspection with a real token; until then
//     this helper returns `statistics: {}` so the caller's `?? {}` fallback
//     keeps the analytics UI rendering (with zeroed metrics) instead of 502.
//
// TODO(buffer-analytics): introspect Buffer's schema to find the actual
// metrics field name on Post (likely `metrics`, `analytics`, or `insights`)
// and re-enable per-post stats. Verify with:
//   curl -X POST https://api.buffer.com/graphql \
//     -H "Authorization: Bearer $BUFFER_TOKEN" \
//     -H "Content-Type: application/json" \
//     -d '{"query":"{__type(name:\"Post\"){fields{name type{name kind ofType{name}}}}}"}'

const BUFFER_GQL = 'https://api.buffer.com/graphql'

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

// Returns { ok, post } or { ok: false, status, errors }.
// post shape: { id, status, sentAt, statistics: {} } — statistics is an empty
// placeholder until the correct Buffer schema field is wired (see TODO above).
// Returns { ok: false } silently when the post ID isn't found.
export async function fetchPostStats(token, postId) {
  const result = await gql(token, `
    query GetPostStats($input: PostInput!) {
      post(input: $input) {
        id
        status
        sentAt
      }
    }
  `, { input: { id: postId } })

  if (!result.ok || result.errors?.length) {
    console.error('[bufferPostStats] GraphQL error', result.status, JSON.stringify(result.errors))
    return { ok: false, status: result.status, errors: result.errors }
  }
  const post = result.data?.post
  // Attach empty statistics so callers' `?? {}` paths still see the shape
  // they expect and the UI degrades to zeroed metrics rather than 502.
  return { ok: true, post: post ? { ...post, statistics: {} } : null }
}
