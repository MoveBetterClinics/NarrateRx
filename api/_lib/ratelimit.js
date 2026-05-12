// Per-bucket rate limiters backed by Upstash Redis.
//
// Buckets (req/min):
//   ai      — 10   (expensive: Anthropic via AI Gateway)
//   media   — 30   (expensive: ffmpeg + AI tagging)
//   generic — 60   (default for anything we want lightly capped)
//
// Identity resolution:
//   1. Clerk JWT in the Authorization header → key on `u:<userId>`
//   2. Fallback to `ip:<first x-forwarded-for>` for unauthenticated traffic
//
// Fails open when UPSTASH_REDIS_REST_URL / _TOKEN are missing, so this PR can
// merge before the Upstash integration is provisioned in the Vercel Marketplace.
// Once those env vars land, the limiters activate with no code change.

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { verifyToken } from '@clerk/backend'

let _redis
function getRedis() {
  if (_redis !== undefined) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) { _redis = null; return null }
  _redis = new Redis({ url, token })
  return _redis
}

const BUCKETS = {
  ai:      { max: 10, windowSec: 60 },
  media:   { max: 30, windowSec: 60 },
  generic: { max: 60, windowSec: 60 },
}

const _limiters = {}
function getLimiter(bucket) {
  if (_limiters[bucket] !== undefined) return _limiters[bucket]
  const cfg = BUCKETS[bucket] || BUCKETS.generic
  const redis = getRedis()
  if (!redis) { _limiters[bucket] = null; return null }
  _limiters[bucket] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.max, `${cfg.windowSec} s`),
    prefix: `narraterx:rl:${bucket}`,
    analytics: false,
  })
  return _limiters[bucket]
}

function readHeader(req, name) {
  const h = req?.headers
  if (!h) return null
  if (typeof h.get === 'function') return h.get(name)
  return h[name] || h[name.toLowerCase()] || null
}

async function resolveIdentity(req) {
  const header = readHeader(req, 'authorization') || readHeader(req, 'Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null
  if (token && process.env.CLERK_SECRET_KEY) {
    try {
      const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
      if (payload?.sub) return `u:${payload.sub}`
    } catch {
      // fall through to IP
    }
  }
  const xff = readHeader(req, 'x-forwarded-for') || ''
  const ip = xff.split(',')[0].trim() || 'unknown'
  return `ip:${ip}`
}

// Core check. Returns { allowed: true } if under limit OR if Upstash isn't
// configured (fail-open). Returns { allowed: false, retryAfter, limit } on hit.
export async function checkLimit(req, bucket = 'generic') {
  const limiter = getLimiter(bucket)
  if (!limiter) return { allowed: true, skipped: true }
  const id = await resolveIdentity(req)
  const { success, limit, remaining, reset } = await limiter.limit(`${bucket}:${id}`)
  if (success) return { allowed: true, limit, remaining, reset }
  const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
  return { allowed: false, retryAfter, limit, remaining: 0, reset }
}

// Node-runtime (req, res) helper. Returns true if allowed; on 429 writes the
// response (with Retry-After) and returns false — caller should just `return`.
export async function enforceLimit(req, res, bucket = 'generic') {
  const r = await checkLimit(req, bucket)
  if (r.allowed) return true
  res.setHeader('Retry-After', String(r.retryAfter))
  res.setHeader('X-RateLimit-Limit', String(r.limit))
  res.setHeader('X-RateLimit-Remaining', '0')
  res.status(429).json({
    error: 'rate_limited',
    message: "You're going faster than the limit — try again in a few seconds.",
    retryAfter: r.retryAfter,
  })
  return false
}

// Edge-runtime helper. Returns a 429 Response on hit, or null when allowed.
export async function enforceLimitEdge(req, bucket = 'generic') {
  const r = await checkLimit(req, bucket)
  if (r.allowed) return null
  return new Response(
    JSON.stringify({
      error: 'rate_limited',
      message: "You're going faster than the limit — try again in a few seconds.",
      retryAfter: r.retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(r.retryAfter),
        'X-RateLimit-Limit': String(r.limit),
        'X-RateLimit-Remaining': '0',
      },
    },
  )
}
