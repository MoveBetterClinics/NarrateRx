// Apply a workspace_locations row over the workspace umbrella so prompts that
// read workspace.location / location_keyword / location_hashtag / region pick
// up the per-post values without touching prompts.js. Returns the workspace
// unchanged when no location is selected ("all locations" — keep umbrella).

export function applyLocationOverlay(workspace, location) {
  if (!workspace || !location) return workspace
  const city = (location.city || '').trim()
  const region = (location.region || '').trim()
  return {
    ...workspace,
    location: city && region ? `${city}, ${region}` : (city || region || workspace.location),
    location_keyword: location.location_keyword || workspace.location_keyword,
    location_hashtag: location.location_hashtag || workspace.location_hashtag,
    region: region || workspace.region,
  }
}
