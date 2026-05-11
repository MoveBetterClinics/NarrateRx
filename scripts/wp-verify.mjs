#!/usr/bin/env node
// Verify a WordPress Application Password by hitting /wp/v2/users/me.
// Usage: node scripts/wp-verify.mjs <site-url> <username> "<app password>"
// Example: node scripts/wp-verify.mjs https://movebetterequine.com narraterx "abcd EFGH ijkl MNOP qrst UVWX"

const [, , siteArg, user, ...rest] = process.argv
const appPassword = rest.join(' ')

if (!siteArg || !user || !appPassword) {
  console.error('Usage: node scripts/wp-verify.mjs <site-url> <username> "<app password>"')
  process.exit(2)
}

function wpRoot(url) {
  const trimmed = url.replace(/\/+$/, '')
  const idx = trimmed.indexOf('/wp-json')
  if (idx >= 0) return trimmed.slice(0, idx + '/wp-json'.length)
  return `${trimmed}/wp-json`
}

const root = wpRoot(siteArg)
const cleaned = appPassword.replace(/\s+/g, '')
const auth = 'Basic ' + Buffer.from(`${user}:${cleaned}`, 'utf8').toString('base64')
const endpoint = `${root}/wp/v2/users/me?context=edit`

console.log(`GET ${endpoint}`)
console.log(`User: ${user}`)
console.log('')

let res
try {
  res = await fetch(endpoint, { headers: { Authorization: auth } })
} catch (e) {
  console.error(`Network error: ${e.message}`)
  process.exit(1)
}

const text = await res.text()
let data = null
try { data = JSON.parse(text) } catch {}

if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText}`)
  if (data?.code) console.error(`WP code: ${data.code}`)
  if (data?.message) console.error(`Message: ${data.message}`)
  if (!data) console.error(text.slice(0, 400))
  if (res.status === 401) console.error('\nHint: app password is wrong, revoked, or minted under a different user.')
  if (res.status === 403) console.error('\nHint: auth worked but user lacks permission. Use ?context=edit only with Editor+; otherwise drop ?context=edit.')
  if (res.status === 404) console.error('\nHint: /wp-json missing — REST API may be disabled by a security plugin.')
  process.exit(1)
}

const caps = data.capabilities || {}
const canPublish = caps.publish_posts === true
const canUpload = caps.upload_files === true

console.log(`HTTP ${res.status}  authenticated as:`)
console.log(`  id:       ${data.id}`)
console.log(`  username: ${data.username || data.slug}`)
console.log(`  name:     ${data.name}`)
console.log(`  email:    ${data.email || '(hidden)'}`)
console.log(`  roles:    ${(data.roles || []).join(', ') || '(none reported)'}`)
console.log('')
console.log('Capabilities (publish-relevant):')
console.log(`  publish_posts:  ${canPublish ? 'yes' : 'NO'}`)
console.log(`  upload_files:   ${canUpload ? 'yes' : 'NO'}`)
console.log(`  edit_posts:     ${caps.edit_posts === true ? 'yes' : 'no'}`)
console.log(`  manage_categories: ${caps.manage_categories === true ? 'yes' : 'no'}`)

if (!canPublish || !canUpload) {
  console.error('\nWarning: user is missing required capabilities for NarrateRx publishing.')
  process.exit(1)
}
console.log('\nOK — credentials work and have the capabilities NarrateRx needs.')
