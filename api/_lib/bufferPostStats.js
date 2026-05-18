// Shared helper for fetching Buffer post statistics via the GraphQL API.
//
// The old v1 REST API (api.bufferapp.com/1/updates/:id.json?access_token=...)
// rejects Personal Access Tokens (PAT) with "OIDC tokens are not accepted for
// direct API access." All three analytics paths (buffer-analytics, engagement/
// refresh, cron/refresh-engagement) now go through here instead.

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
// post shape: { id, status, sentAt, statistics: { clicks, impressions,
//   reach, likes, comments, shares, mentions } }
// Returns { ok: false } silently when the post ID isn't found (old v1 IDs
// passed to the GraphQL API will 404 gracefully).
export async function fetchPostStats(token, postId) {
  const result = await gql(token, `
    query GetPostStats($id: String!) {
      post(id: $id) {
        id
        status
        sentAt
        statistics {
          clicks
          impressions
          reach
          likes
          comments
          shares
          mentions
        }
      }
    }
  `, { id: postId })

  if (!result.ok || result.errors?.length) {
    console.error('[bufferPostStats] GraphQL error', result.status, JSON.stringify(result.errors))
    return { ok: false, status: result.status, errors: result.errors }
  }
  return { ok: true, post: result.data?.post ?? null }
}
