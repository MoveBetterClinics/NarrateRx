// Phase 4 PR 5 — Engagement Digest email template builder.
//
// Renders a self-contained HTML email summarizing a workspace's last 7 days:
//   • Published content (top 5 by platform variety)
//   • Story Slate stats (generated / approved / skipped / failed)
//   • Triage queue at time-of-send (failed + low-confidence + stale)
//   • What's queued — complete packages awaiting approval
//
// Keep HTML inline-style only (some email clients strip <style>). Use a
// container max-width of 600px (standard email-safe width). No external
// images beyond the workspace logo (which the workspace already serves
// publicly).

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pluralize(n, singular, plural) {
  return `${n} ${n === 1 ? singular : (plural || singular + 's')}`
}

/**
 * @param {{
 *   workspace: {
 *     id: string, slug: string, display_name?: string, name?: string,
 *     primary_logo_url?: string, colors?: { primary?: string }
 *   },
 *   published:     Array<{ id, topic, platform, published_at, clinician_name? }>,
 *   slateStats:    { generated, approved, skipped, failed, complete_awaiting: number },
 *   triage:        { failed, lowConfidence, stale: number },
 *   queued:        Array<{ id, topic, similarity?, clinician_name?, created_at }>,
 *   weekStart:     string  // ISO start of the reporting week
 *   weekEnd:       string  // ISO end of the reporting week
 * }} input
 * @returns {{ subject: string, html: string, text: string }}
 */
export function buildDigest({ workspace, published, slateStats, triage, queued, weekStart, weekEnd }) {
  const wsName = workspace.display_name || workspace.name || 'your workspace'
  const accent = (workspace.colors?.primary) || '#e36525'
  const ribbonGradient = `linear-gradient(135deg, ${accent}, ${shade(accent, -22)})`
  const subject = `${wsName} — last week's content + this week's queue`
  const baseUrl = `https://${workspace.slug}.narraterx.ai`
  const slateUrl = `${baseUrl}/slate`

  const publishedCount = published.length
  const queuedCount    = queued.length
  const triageTotal    = triage.failed + triage.lowConfidence + triage.stale

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f1;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f1;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e5e0;">

        <!-- Header ribbon -->
        <tr><td style="background:${ribbonGradient};color:#ffffff;padding:22px 24px;">
          <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.85;">Weekly producer digest</div>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:800;letter-spacing:-0.01em;">${escapeHtml(wsName)}</h1>
          <div style="font-size:13px;opacity:.85;margin-top:6px;">${fmtDate(weekStart)} – ${fmtDate(weekEnd)}</div>
        </td></tr>

        <!-- Stat row -->
        <tr><td style="padding:18px 24px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              ${statCell({ n: publishedCount, label: 'Published', color: '#059669' })}
              ${statCell({ n: slateStats.approved, label: 'Approved', color: '#0284c7' })}
              ${statCell({ n: queuedCount, label: 'Queued', color: '#d97706' })}
              ${statCell({ n: triageTotal, label: 'Need attention', color: triageTotal > 0 ? '#dc2626' : '#71717a' })}
            </tr>
          </table>
        </td></tr>

        ${section('Published last week', publishedSection(published, baseUrl))}
        ${section('Ready for your review', queuedSection(queued, slateUrl, queuedCount))}
        ${triageTotal > 0 ? section('Triage queue', triageSection(triage, slateUrl)) : ''}
        ${section('Slate this week', slateRecap(slateStats))}

        <!-- CTA -->
        <tr><td style="padding:18px 24px 28px;text-align:center;">
          <a href="${escapeHtml(slateUrl)}"
             style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px;font-size:14px;">
            Open Slate →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:14px 24px 18px;border-top:1px solid #e7e5e0;font-size:11px;color:#71717a;line-height:1.5;">
          You're receiving this because your workspace admin enabled the weekly producer digest.
          To turn it off, ask the admin to disable it in workspace settings.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`

  // Plain-text fallback — Resend recommends both for deliverability.
  const text = [
    `${wsName} — ${fmtDate(weekStart)}-${fmtDate(weekEnd)}`,
    ``,
    `Published last week: ${publishedCount}`,
    `Approved from Slate: ${slateStats.approved}`,
    `Queued for review: ${queuedCount}`,
    `Need attention (triage): ${triageTotal}`,
    ``,
    `Open Slate: ${slateUrl}`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Section helpers ─────────────────────────────────────────────────────────

function section(title, inner) {
  if (!inner) return ''
  return `
    <tr><td style="padding:14px 24px 4px;">
      <h2 style="margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#52525b;">${escapeHtml(title)}</h2>
      ${inner}
    </td></tr>`
}

function statCell({ n, label, color }) {
  return `
    <td style="width:25%;text-align:center;padding:8px 4px;">
      <div style="font-size:24px;font-weight:800;color:${color};line-height:1;">${n}</div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-top:4px;">${escapeHtml(label)}</div>
    </td>`
}

function publishedSection(items, _baseUrl) {
  if (items.length === 0) {
    return `<div style="font-size:13px;color:#71717a;font-style:italic;">Nothing published last week — let's change that this week.</div>`
  }
  const rows = items.slice(0, 6).map((it) => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #f0eee9;">
      <div style="font-size:14px;font-weight:600;line-height:1.4;">${escapeHtml(it.topic || '(untitled)')}</div>
      <div style="font-size:11px;color:#71717a;margin-top:2px;">
        ${escapeHtml(it.platform || '')}${it.clinician_name ? ` · ${escapeHtml(it.clinician_name)}` : ''}${it.published_at ? ` · ${fmtDate(it.published_at)}` : ''}
      </div>
    </td></tr>`).join('')
  const more = items.length > 6
    ? `<div style="font-size:12px;color:#71717a;margin-top:6px;">+ ${items.length - 6} more</div>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>${more}`
}

function queuedSection(items, slateUrl, totalCount) {
  if (items.length === 0) {
    return `<div style="font-size:13px;color:#71717a;font-style:italic;">No packages waiting. Generate today's slate when you're ready.</div>`
  }
  const rows = items.slice(0, 5).map((it) => `
    <tr><td style="padding:6px 0;border-bottom:1px solid #f0eee9;">
      <div style="font-size:14px;font-weight:600;line-height:1.4;">${escapeHtml(it.topic || '(untitled)')}</div>
      <div style="font-size:11px;color:#71717a;margin-top:2px;">
        ${it.clinician_name ? escapeHtml(it.clinician_name) : 'No clinician'}${typeof it.similarity === 'number' ? ` · ${Math.round(it.similarity * 100)}% confidence` : ''}
      </div>
    </td></tr>`).join('')
  const more = totalCount > 5
    ? `<div style="font-size:12px;color:#71717a;margin-top:6px;">+ ${totalCount - 5} more in <a href="${escapeHtml(slateUrl)}" style="color:#52525b;">Slate</a></div>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>${more}`
}

function triageSection(triage, slateUrl) {
  const lines = []
  if (triage.failed > 0)        lines.push(`${pluralize(triage.failed, 'render')} failed`)
  if (triage.lowConfidence > 0) lines.push(`${pluralize(triage.lowConfidence, 'low-confidence package')}`)
  if (triage.stale > 0)         lines.push(`${pluralize(triage.stale, 'stale package')}`)
  return `
    <div style="background:#fef7f0;border:1px solid #f5d9b3;border-radius:8px;padding:11px 14px;font-size:13px;color:#92400e;">
      ${lines.join(' · ')} — <a href="${escapeHtml(slateUrl)}?view=triage" style="color:#7c2d12;font-weight:600;">open triage</a>
    </div>`
}

function slateRecap(stats) {
  return `<div style="font-size:13px;color:#52525b;line-height:1.6;">
    Generated ${stats.generated}, approved ${stats.approved}, skipped ${stats.skipped}${stats.failed > 0 ? `, ${stats.failed} render failures` : ''}.
  </div>`
}

// Tint helper — shifts an #rrggbb by `lightnessDelta` percent (-100..100).
// Keeps the brand color visible at the gradient edge without importing a
// full color library.
function shade(hex, lightnessDelta) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return hex
  const num = parseInt(m[1], 16)
  let r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff
  const adj = Math.round((lightnessDelta / 100) * 255)
  r = Math.max(0, Math.min(255, r + adj))
  g = Math.max(0, Math.min(255, g + adj))
  b = Math.max(0, Math.min(255, b + adj))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}
