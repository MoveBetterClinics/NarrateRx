import { useMemo } from 'react'
import { PLATFORM_META } from '@/lib/contentMeta'

// At-a-glance KPI footer that sits below the Stories view (any of cards /
// pipeline / calendar / themes). Mirrors the mockup's four-card row.
//
// Metrics are computed from the stories list the page already has —
// no extra network calls. Each metric falls back to a placeholder when
// the underlying data isn't available yet (new workspaces, pre-provenance
// pieces, etc.) so the row never renders as empty broken cards.

const DAY_MS = 24 * 60 * 60 * 1000
const VOICE_SAMPLE_LIMIT = 30

function withinDays(ts, days) {
  if (!ts) return false
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return false
  return t >= Date.now() - days * DAY_MS
}

export default function StoriesAtAGlance({ stories = [] }) {
  const metrics = useMemo(() => {
    // ── Voice match (30d avg) ─────────────────────────────────────────────
    // Average own-words % across pieces whose provenance summary was last
    // touched in the past 30 days (capped at 30 samples).
    const provenancePieces = []
    for (const s of stories) {
      for (const p of s.pieces || []) {
        const sum = p?.provenance?.summary
        const own = (sum?.verbatim_pct ?? 0) + (sum?.paraphrase_pct ?? 0)
        if (own > 0 && p.updated_at && withinDays(p.updated_at, 30)) {
          provenancePieces.push({ own, t: new Date(p.updated_at).getTime() })
        }
      }
    }
    provenancePieces.sort((a, b) => b.t - a.t)
    const voiceSample = provenancePieces.slice(0, VOICE_SAMPLE_LIMIT)
    const voiceMatch = voiceSample.length > 0
      ? Math.round(voiceSample.reduce((acc, p) => acc + p.own, 0) / voiceSample.length)
      : null

    // ── Verbatim flags resolved ───────────────────────────────────────────
    // Approximation while the schema doesn't yet track a "flag resolved"
    // bit explicitly: count stories that had pull-quote candidates AND
    // ended up published (story_stage === 'published') as a stand-in for
    // "the verbatim got promoted into a real piece." Falls back to total
    // pieces with provenance summary if no pull-quote interviews exist.
    let flagsResolved = 0
    let flagsTotal = 0
    for (const s of stories) {
      const hasFlag = !!s.verbatim_snippet
      if (hasFlag) {
        flagsTotal += 1
        if (s.story_stage === 'published') flagsResolved += 1
      }
    }

    // ── Avg time to publish ───────────────────────────────────────────────
    // For stories at the 'published' stage with both a created_at and a
    // last_activity_at, mean of (last_activity_at - created_at). Reported in
    // days, rounded to one decimal. Null when no published stories exist.
    const publishedAges = []
    for (const s of stories) {
      if (s.story_stage !== 'published') continue
      const start = s.created_at ? new Date(s.created_at).getTime() : NaN
      const end = s.last_activity_at ? new Date(s.last_activity_at).getTime() : NaN
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
      publishedAges.push((end - start) / DAY_MS)
    }
    const avgPublishDays = publishedAges.length > 0
      ? Math.round((publishedAges.reduce((a, b) => a + b, 0) / publishedAges.length) * 10) / 10
      : null

    // ── Top platform (30d) ────────────────────────────────────────────────
    // Most-frequent platform across pieces with status === 'published'
    // whose updated_at falls within the last 30 days. Falls back to most-
    // frequent overall when no recent publishes exist.
    const counts30 = new Map()
    const countsAll = new Map()
    for (const s of stories) {
      for (const p of s.pieces || []) {
        if (!p.platform) continue
        countsAll.set(p.platform, (countsAll.get(p.platform) || 0) + 1)
        if (p.status === 'published' && withinDays(p.updated_at, 30)) {
          counts30.set(p.platform, (counts30.get(p.platform) || 0) + 1)
        }
      }
    }
    const winning = counts30.size > 0 ? counts30 : countsAll
    let topPlatformKey = null
    let topPlatformCount = 0
    for (const [k, v] of winning.entries()) {
      if (v > topPlatformCount) {
        topPlatformKey = k
        topPlatformCount = v
      }
    }

    return { voiceMatch, flagsResolved, flagsTotal, avgPublishDays, topPlatformKey, topPlatformCount }
  }, [stories])

  // Hide the whole row until the workspace has at least one story — saves
  // the new-workspace experience from staring at four placeholder cards.
  if (stories.length === 0) return null

  const topPlatformLabel = metrics.topPlatformKey
    ? (PLATFORM_META[metrics.topPlatformKey]?.label || metrics.topPlatformKey)
    : null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
      <div className="rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Voice match · 30d avg</div>
        <div className="text-2xl font-extrabold tracking-tight mt-1 tabular-nums" style={{ color: metrics.voiceMatch == null ? undefined : '#059669' }}>
          {metrics.voiceMatch == null ? '—' : `${metrics.voiceMatch}%`}
        </div>
        {metrics.voiceMatch == null && (
          <div className="text-2xs text-muted-foreground mt-1">No provenance data yet</div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Verbatim flags resolved</div>
        <div className="text-2xl font-extrabold tracking-tight mt-1 tabular-nums">
          {metrics.flagsTotal === 0 ? '—' : (
            <>
              {metrics.flagsResolved}
              <span className="text-sm font-medium text-muted-foreground"> / {metrics.flagsTotal}</span>
            </>
          )}
        </div>
        {metrics.flagsTotal === 0 && (
          <div className="text-2xs text-muted-foreground mt-1">No verbatim flags yet</div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Avg time to publish</div>
        <div className="text-2xl font-extrabold tracking-tight mt-1 tabular-nums">
          {metrics.avgPublishDays == null ? '—' : (
            <>
              {metrics.avgPublishDays}
              <span className="text-sm font-medium text-muted-foreground">d</span>
            </>
          )}
        </div>
        {metrics.avgPublishDays == null && (
          <div className="text-2xs text-muted-foreground mt-1">No published stories yet</div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Top platform · 30d</div>
        <div className="text-2xl font-extrabold tracking-tight mt-1" style={{ color: topPlatformLabel ? '#7c3aed' : undefined }}>
          {topPlatformLabel || '—'}
        </div>
        {!topPlatformLabel && (
          <div className="text-2xs text-muted-foreground mt-1">No pieces yet</div>
        )}
      </div>
    </div>
  )
}
