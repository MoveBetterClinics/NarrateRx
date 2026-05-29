import { useMemo } from 'react'

// HomeStats — 4-card metric row that sits between the hero ribbon and the
// task-bucket list on the Home dashboard. Pulls everything from the same
// useStories() data the rest of the page already has, so adding this row
// doesn't introduce a second network round-trip.
//
// Card semantics:
//   This week    — interviews captured (story rows) in the last 7 days
//   Drafts       — stories awaiting attention (drafting OR review stage),
//                  plus a pill breakdown of piece-level status counts.
//                  The "Drafts" card is the only one styled as the warm-tint
//                  card-hi surface — this is the "do this now" KPI.
//   Published    — stories whose story_stage === 'published' with last
//                  activity in the last 30 days. Delta = vs the prior 30d.
//   Voice match  — mean of (verbatim_pct + paraphrase_pct) across the most
//                  recent N=20 pieces with provenance summary. Rendered on
//                  the dark ink card with the signature gradient applied to
//                  the number itself (matches the mockup's "flex" KPI).

const DAY_MS = 24 * 60 * 60 * 1000
const VOICE_SAMPLE_LIMIT = 20

function withinDays(ts, days) {
  if (!ts) return false
  const t = new Date(ts).getTime()
  if (!Number.isFinite(t)) return false
  const cutoff = Date.now() - days * DAY_MS
  return t >= cutoff
}

function inWindow(ts, lo, hi) {
  if (!ts) return false
  const t = new Date(ts).getTime()
  return Number.isFinite(t) && t >= lo && t < hi
}

function computeVoiceMatch(stories) {
  // Sample the N most-recent pieces that carry provenance.summary
  // (verbatim_pct + paraphrase_pct combine to "own words %"). Average them.
  const pieces = []
  for (const s of stories) {
    for (const p of s.pieces || []) {
      const sum = p?.provenance?.summary
      const own = (sum?.verbatim_pct ?? 0) + (sum?.paraphrase_pct ?? 0)
      if (own > 0 && p.updated_at) pieces.push({ own, t: new Date(p.updated_at).getTime() })
    }
  }
  if (pieces.length === 0) return null
  pieces.sort((a, b) => b.t - a.t)
  const sample = pieces.slice(0, VOICE_SAMPLE_LIMIT)
  const avg = sample.reduce((acc, p) => acc + p.own, 0) / sample.length
  return Math.round(avg)
}

export default function HomeStats({ stories = [] }) {
  const metrics = useMemo(() => {
    // This week — stories created or last-activity-updated in the last 7 days
    const thisWeek = stories.filter((s) => withinDays(s.last_activity_at || s.created_at, 7)).length

    // Drafts — story_stage is "drafting" or "review" (review is "ready to review")
    const draftStories = stories.filter((s) => s.story_stage === 'drafting' || s.story_stage === 'review')
    const drafts = draftStories.length

    // Breakdown — sum piece-level status across draft-stage stories so the
    // little pill row under the number ("X blog · X email · X social") feels
    // grounded rather than decorative.
    const breakdown = { blog: 0, email: 0, social: 0, other: 0 }
    for (const s of draftStories) {
      for (const p of s.pieces || []) {
        if (p.status === 'published' || p.status === 'scheduled') continue
        const plat = String(p.platform || '').toLowerCase()
        if (plat === 'blog' || plat === 'wordpress' || plat === 'landing_page') breakdown.blog += 1
        else if (plat === 'email') breakdown.email += 1
        else if (plat === 'instagram' || plat === 'facebook' || plat === 'linkedin' || plat === 'twitter' || plat === 'tiktok' || plat === 'youtube' || plat === 'pinterest' || plat === 'gbp') breakdown.social += 1
        else breakdown.other += 1
      }
    }

    // Published — story_stage === 'published' with last_activity within
    // the relevant window. Delta is published this 30d window vs prior 30d.
    const now = Date.now()
    const win30 = now - 30 * DAY_MS
    const win60 = now - 60 * DAY_MS
    const publishedThis = stories.filter((s) => s.story_stage === 'published' && inWindow(s.last_activity_at, win30, now)).length
    const publishedPrev = stories.filter((s) => s.story_stage === 'published' && inWindow(s.last_activity_at, win60, win30)).length
    const publishedDelta = publishedThis - publishedPrev

    // Voice match — averaged own-words % across the most-recent provenance
    // summaries. Falls back to null when no provenance exists yet, in which
    // case the card renders a placeholder.
    const voiceMatch = computeVoiceMatch(stories)

    return { thisWeek, drafts, breakdown, publishedThis, publishedDelta, voiceMatch }
  }, [stories])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* This week */}
      <div className="rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between">
          <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">This week</div>
          {metrics.thisWeek > 0 ? (
            <span className="text-2xs font-bold text-slate-400">↗ {metrics.thisWeek}</span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight mt-2 tabular-nums">{metrics.thisWeek}</div>
        <div className="text-sm text-muted-foreground">interviews captured</div>
      </div>

      {/* Drafts — neutral stat. The warm "do this now" treatment lives on
          DraftsReadyRow (piece-level cards below), so this card stays a
          plain stat to avoid two warm-tinted surfaces competing for the
          same action. The primary-colored number + "action" badge still
          carry the signal. */}
      <div className="rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between">
          <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Drafts</div>
          {metrics.drafts > 0 ? (
            <span className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-2xs font-bold px-2 py-0.5">action</span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight mt-2 text-primary tabular-nums">{metrics.drafts}</div>
        <div className="text-sm text-muted-foreground">awaiting your review</div>
        {metrics.drafts > 0 && (metrics.breakdown.blog + metrics.breakdown.email + metrics.breakdown.social + metrics.breakdown.other > 0) ? (
          <div className="mt-3 flex flex-wrap gap-1">
            {metrics.breakdown.blog > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full text-2xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-700">{metrics.breakdown.blog} blog</span>
            )}
            {metrics.breakdown.email > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full text-2xs font-semibold px-2 py-0.5 bg-amber-50 text-amber-700">{metrics.breakdown.email} email</span>
            )}
            {metrics.breakdown.social > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full text-2xs font-semibold px-2 py-0.5 bg-violet-50 text-violet-700">{metrics.breakdown.social} social</span>
            )}
          </div>
        ) : null}
      </div>

      {/* Published */}
      <div className="rounded-2xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <div className="flex items-center justify-between">
          <div className="text-2xs font-bold uppercase tracking-widest text-muted-foreground">Published</div>
          {metrics.publishedDelta !== 0 ? (
            <span className={`text-2xs font-bold ${metrics.publishedDelta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {metrics.publishedDelta > 0 ? '↗' : '↘'} {metrics.publishedDelta > 0 ? '+' : ''}{metrics.publishedDelta}
            </span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight mt-2 tabular-nums">{metrics.publishedThis}</div>
        <div className="text-sm text-muted-foreground">last 30 days</div>
      </div>

      {/* Voice match — dark "flex" card with grad-text number */}
      <div
        className="rounded-2xl border p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
        style={{ background: 'hsl(var(--foreground))', borderColor: 'hsl(var(--foreground))', color: '#fff' }}
      >
        <div className="flex items-center justify-between">
          <div className="text-2xs font-bold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.65)' }}>Voice match</div>
          {typeof metrics.voiceMatch === 'number' ? (
            <span
              className="inline-flex items-center justify-center rounded-full text-2xs font-bold px-2 py-0.5"
              style={{ background: 'rgba(5,150,105,0.2)', color: '#6ee7b7' }}
            >
              {metrics.voiceMatch >= 60 ? 'strong' : metrics.voiceMatch >= 35 ? 'fair' : 'low'}
            </span>
          ) : null}
        </div>
        <div className="text-4xl font-extrabold tracking-tight mt-2 nx-grad-text tabular-nums">
          {typeof metrics.voiceMatch === 'number' ? `${metrics.voiceMatch}%` : '—'}
        </div>
        <div className="text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
          {typeof metrics.voiceMatch === 'number' ? 'across your last 20 pieces' : 'Run an interview to start tracking'}
        </div>
      </div>
    </div>
  )
}
