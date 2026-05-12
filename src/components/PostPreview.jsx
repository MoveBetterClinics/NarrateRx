import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Repeat2, Globe, MapPin, ChevronLeft, ChevronRight, Play } from 'lucide-react'
import emailTemplateHtml from '../email-template.html?raw'
import { workspace } from '@/lib/workspace'

// Brand identity used in mock previews — sourced from src/lib/workspace.js
const MB_HANDLE   = workspace.social.instagram
const MB_NAME     = workspace.name
const MB_LOCATION = workspace.location
const MB_INITIALS = workspace.socialAvatarInitials
const MB_BLURB    = workspace.linkPreviewBlurb
const MB_HOSTNAME = workspace.websiteHostname
const MB_INDUSTRY = workspace.linkedInIndustry
const MB_BOOKING  = workspace.prompt.bookingUrl

// Highlight hashtags and @mentions in social copy
function SocialText({ text }) {
  if (!text) return null
  const parts = text.split(/(\s+)/)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('#') || part.startsWith('@')) {
          return <span key={i} className="text-blue-500">{part}</span>
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// Resolve the best displayable URL for a media item. After the Drive
// phase-out, every media item ships a direct Vercel Blob URL; the
// historical /api/drive/media fallback (now removed) is no longer needed.
function mediaSrc(m) {
  if (!m) return null
  return m.url || m.thumbnailUrl || null
}

// ── Carousel — shared by Instagram and Facebook ───────────────────────────────
function MediaCarousel({ mediaUrls, aspectClass = 'aspect-square' }) {
  const [idx, setIdx] = React.useState(0)
  const total = mediaUrls.length

  if (total === 0) {
    return (
      <div className={`bg-gradient-to-br from-orange-100 to-orange-50 ${aspectClass} flex flex-col items-center justify-center gap-2`}>
        <img src={workspace.logo.main} alt={workspace.name} className="h-16 w-auto opacity-30" />
        <p className="text-xs text-muted-foreground">Add media in the editor</p>
      </div>
    )
  }

  const m   = mediaUrls[idx]
  const src = mediaSrc(m)

  return (
    <div className={`relative ${aspectClass} overflow-hidden bg-black select-none`}>
      {/* Slide */}
      {m.type === 'video' ? (
        <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2">
          {src ? (
            <img src={src} alt={m.name} className="w-full h-full object-cover opacity-70" onError={(e) => { e.target.style.display = 'none' }} />
          ) : null}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-1" />
            </div>
          </div>
          <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-white/60 px-4 line-clamp-1">{m.name}</p>
        </div>
      ) : src ? (
        <img src={src} alt={m.name} className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{m.name}</p>
        </div>
      )}

      {/* Prev / Next arrows */}
      {total > 1 && (
        <>
          {idx > 0 && (
            <button
              onClick={() => setIdx(idx - 1)}
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {idx < total - 1 && (
            <button
              onClick={() => setIdx(idx + 1)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          {/* Slide counter */}
          <div className="absolute top-2 right-2 bg-black/50 text-white text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            {idx + 1} / {total}
          </div>

          {/* Dot indicators */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
            {mediaUrls.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`rounded-full transition-all ${i === idx ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Instagram ────────────────────────────────────────────────────────────────
function InstagramPreview({ content, mediaUrls = [] }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 4).join('\n')
  const hasMore = lines.length > 4

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
          {MB_INITIALS}
        </div>
        <div>
          <p className="text-xs font-semibold">{MB_HANDLE}</p>
          <p className="text-[10px] text-muted-foreground">{MB_LOCATION}</p>
        </div>
        <button className="ml-auto text-xs font-semibold text-blue-500">Follow</button>
      </div>

      {/* Carousel */}
      <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-square" />

      {/* Actions */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-4">
        <Heart className="h-6 w-6" />
        <MessageCircle className="h-6 w-6" />
        <Send className="h-6 w-6" />
        <Bookmark className="h-6 w-6 ml-auto" />
      </div>

      {/* Caption */}
      <div className="px-4 pb-4">
        <p className="text-xs font-semibold mb-1">{MB_HANDLE}</p>
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">more</button>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Facebook ─────────────────────────────────────────────────────────────────
function FacebookPreview({ content, mediaUrls = [] }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 5).join('\n')
  const hasMore = lines.length > 5

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="px-4 pt-4 pb-3">
        {/* Author */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Globe className="h-3 w-3" /> Public · Just now
            </div>
          </div>
        </div>

        {/* Content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-blue-500 ml-1 text-sm">See more</button>
          )}
        </p>
      </div>

      {/* Media carousel */}
      {mediaUrls.length > 0 && (
        <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-video" />
      )}

      {/* Link preview */}
      <div className="border-t bg-slate-50 px-4 py-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{MB_HOSTNAME}</p>
        <p className="text-xs font-semibold mt-0.5">{MB_NAME} · {MB_LOCATION}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{MB_BLURB}</p>
      </div>

      {/* Reactions bar */}
      <div className="px-4 py-2 border-t flex items-center gap-4 text-xs text-muted-foreground">
        <button className="flex items-center gap-1.5 hover:text-blue-500"><ThumbsUp className="h-4 w-4" /> Like</button>
        <button className="flex items-center gap-1.5 hover:text-blue-500"><MessageCircle className="h-4 w-4" /> Comment</button>
        <button className="flex items-center gap-1.5 hover:text-blue-500"><Repeat2 className="h-4 w-4" /> Share</button>
      </div>
    </div>
  )
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────
function LinkedInPreview({ content }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 5).join('\n')
  const hasMore = lines.length > 5

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-12 w-12 rounded-sm bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <p className="text-[11px] text-muted-foreground">{MB_INDUSTRY} · {MB_LOCATION}</p>
            <p className="text-[10px] text-muted-foreground">Just now · 🌐</p>
          </div>
          <button className="ml-auto text-xs font-semibold text-blue-600 border border-blue-600 rounded-full px-3 py-1">+ Follow</button>
        </div>

        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">…more</button>
          )}
        </p>
      </div>

      <div className="px-4 py-2 border-t flex items-center gap-4 text-xs text-muted-foreground">
        <button className="flex items-center gap-1.5 hover:text-blue-500"><ThumbsUp className="h-4 w-4" /> Like</button>
        <button className="flex items-center gap-1.5 hover:text-blue-500"><MessageCircle className="h-4 w-4" /> Comment</button>
        <button className="flex items-center gap-1.5 hover:text-blue-500"><Repeat2 className="h-4 w-4" /> Repost</button>
        <button className="flex items-center gap-1.5 hover:text-blue-500"><Send className="h-4 w-4" /> Send</button>
      </div>
    </div>
  )
}

// ── Google Business Profile ───────────────────────────────────────────────────
function GBPPreview({ content }) {
  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="bg-slate-50 px-4 py-3 border-b flex items-center gap-2">
        <MapPin className="h-4 w-4 text-red-500 shrink-0" />
        <p className="text-xs font-semibold">{MB_NAME} · Google Business Profile</p>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <p className="text-[10px] text-muted-foreground">{MB_LOCATION}</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-800">{content}</p>
      </div>
      <div className="px-4 py-3 border-t bg-slate-50">
        <button className="text-xs text-blue-600 font-medium">Book appointment →</button>
      </div>
    </div>
  )
}

// ── Blog (rendered Markdown) ──────────────────────────────────────────────────
function BlogPreview({ content }) {
  return (
    <div className="max-w-2xl mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-8 py-8 prose prose-sm max-w-none
        prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:mb-4
        prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3
        prose-p:leading-relaxed prose-p:text-slate-700
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-slate-900
        prose-li:text-slate-700">
        <ReactMarkdown>{content || ''}</ReactMarkdown>
      </div>
    </div>
  )
}

// ── Instagram Ads — Meta Ads Manager creative ────────────────────────────────
function parseInstagramAdFields(content) {
  if (!content) return {}
  const labels = ['PRIMARY TEXT', 'HEADLINE', 'DESCRIPTION', 'CTA BUTTON', 'DESTINATION URL', 'CREATIVE NOTES']
  const fields = {}
  let current = null
  let buf = []

  const flush = () => {
    if (!current || current === 'CREATIVE NOTES') return
    let val = buf.join('\n').trim()
    if (val.startsWith('[') && val.endsWith(']')) val = val.slice(1, -1).trim()
    if (val) fields[current] = val
  }

  for (const line of content.split('\n')) {
    const hit = labels.find((l) => line.startsWith(`${l}:`))
    if (hit) {
      flush()
      current = hit
      buf = []
    } else if (current) {
      buf.push(line)
    }
  }
  flush()
  return fields
}

const IG_AD_FIELDS = [
  { key: 'PRIMARY TEXT',    label: 'Primary Text',    hint: 'Main caption above the creative' },
  { key: 'HEADLINE',        label: 'Headline',        hint: 'Bold text under the creative' },
  { key: 'DESCRIPTION',     label: 'Description',     hint: 'Optional supporting line' },
  { key: 'CTA BUTTON',      label: 'CTA Button',      hint: 'Pick from Meta’s preset options' },
  { key: 'DESTINATION URL', label: 'Destination URL', hint: 'Where the ad sends clicks' },
]

function InstagramAdsPreview({ content, mediaUrls = [] }) {
  const f = parseInstagramAdFields(content)
  const hasFields = Object.keys(f).length > 0
  const [showFull, setShowFull] = React.useState(false)

  if (!hasFields) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3">
          <span className="text-amber-500 text-lg shrink-0">⚠</span>
          <div>
            <p className="text-sm font-medium text-amber-800">Regenerate to use the structured Instagram Ads format</p>
            <p className="text-xs text-amber-700 mt-0.5">
              This ad copy was created before the labeled-field format. Click <strong>Regenerate</strong> to get
              Primary Text, Headline, Description, CTA Button, and Destination URL as separate one-click-copy fields.
            </p>
          </div>
        </div>
        <PlainPreview content={content} />
      </div>
    )
  }

  const primary = f['PRIMARY TEXT'] || ''
  const lines = primary.split('\n')
  const previewText = lines.slice(0, 2).join('\n').slice(0, 125)
  const hasMore = primary.length > previewText.length

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Mock feed ad */}
      <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-orange-400 to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            {MB_INITIALS}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{MB_HANDLE}</p>
            <p className="text-[10px] text-muted-foreground">Sponsored · {MB_LOCATION}</p>
          </div>
        </div>

        <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-square" />

        <div className="px-4 pt-3 pb-1 flex items-center gap-4">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
          <Bookmark className="h-6 w-6 ml-auto" />
        </div>

        {/* CTA bar — Meta renders this directly under reactions for ads */}
        <div className="border-t px-4 py-2.5 flex items-center justify-between bg-slate-50">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold leading-tight truncate">{f['HEADLINE'] || '—'}</p>
            {f['DESCRIPTION'] && (
              <p className="text-[10px] text-muted-foreground leading-tight truncate">{f['DESCRIPTION']}</p>
            )}
          </div>
          <button className="ml-3 shrink-0 text-[11px] font-semibold bg-slate-900 text-white px-3 py-1.5 rounded">
            {f['CTA BUTTON'] || 'Learn More'}
          </button>
        </div>

        {/* Primary text */}
        <div className="px-4 pb-4 pt-2">
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            <span className="font-semibold">{MB_HANDLE}</span>{' '}
            <SocialText text={showFull ? primary : previewText} />
            {!showFull && hasMore && (
              <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">… more</button>
            )}
          </p>
        </div>
      </div>

      {/* Per-field copy cards — paste into Meta Ads Manager */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Paste into Meta Ads Manager
        </p>
        {IG_AD_FIELDS.map(({ key, label, hint }) => {
          const value = f[key]
          if (!value) return null
          const charCount = value.length
          return (
            <div key={key} className="border rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  <span className="ml-2 text-[10px] text-muted-foreground">{hint}</span>
                  <span className="ml-2 text-[10px] font-mono text-slate-500">{charCount} chars</span>
                </div>
                <CopyButton value={value} />
              </div>
              <p className="px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Plain formatted (ads, landing page, video scripts) ───────────────────────
function PlainPreview({ content }) {
  return (
    <div className="max-w-2xl mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-6">
        <pre className="text-sm leading-relaxed font-sans whitespace-pre-wrap text-slate-800">{content}</pre>
      </div>
    </div>
  )
}

// ── Email — parse sections + visual mock matching the TDC master template ────
function parseEmailSections(content) {
  if (!content) return {}
  const result = {}
  const regex  = /^---([A-Z][A-Z 0-9]+)---$/gm
  const matches = []
  let m
  while ((m = regex.exec(content)) !== null) {
    matches.push({ key: m[1].trim(), start: m.index + m[0].length })
  }
  matches.forEach((match, i) => {
    const end   = i < matches.length - 1 ? matches[i + 1].start - matches[i + 1].key.length - 7 : content.length
    result[match.key] = content.slice(match.start, end).trim()
  })
  return result
}

function CopyButton({ value }) {
  const [copied, setCopied] = React.useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className={`shrink-0 text-[11px] px-2 py-1 rounded border transition-colors ${
        copied ? 'border-green-500 text-green-600 bg-green-50' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
      }`}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

const EMAIL_FIELDS = [
  { key: 'SUBJECT LINE',    tag: null,                    label: 'Subject Line',      hint: 'Set in TrustDrivenCare send settings' },
  { key: 'PREVIEW TEXT',   tag: '{{preview_text}}',      label: 'Preview Text',      hint: 'Inbox snippet — 50–90 chars' },
  { key: 'HEADLINE',       tag: '{{headline}}',           label: 'Headline',          hint: 'Large bold heading at top of email' },
  { key: 'PULL QUOTE',     tag: '{{pull_quote}}',         label: 'Pull Quote',        hint: 'Styled callout block — most compelling line' },
  { key: 'BODY PARAGRAPH 1', tag: '{{body_paragraph_1}}', label: 'Body Paragraph 1', hint: 'Opening hook' },
  { key: 'BODY PARAGRAPH 2', tag: '{{body_paragraph_2}}', label: 'Body Paragraph 2', hint: `${workspace.name} perspective` },
  { key: 'BODY PARAGRAPH 3', tag: '{{body_paragraph_3}}', label: 'Body Paragraph 3', hint: 'Patient story + bridge to action' },
  { key: 'CTA TEXT',       tag: '{{cta_text}}',           label: 'CTA Button Text',   hint: 'Button label only' },
  { key: 'CTA URL',        tag: '{{cta_url}}',            label: 'CTA URL',           hint: 'Button destination URL' },
  { key: 'PS',             tag: '{{ps_text}}',            label: 'P.S.',              hint: 'Optional postscript line' },
]

function escapeForHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fillTemplate(html, s, heroSrc) {
  const year = new Date().getFullYear()
  return html
    .replace(/\{\{preview_text\}\}/g,    escapeForHtml(s['PREVIEW TEXT'] || ''))
    .replace(/\{\{headline\}\}/g,         escapeForHtml(s['HEADLINE'] || ''))
    .replace(/\{\{pull_quote\}\}/g,       escapeForHtml(s['PULL QUOTE'] || ''))
    .replace(/\{\{body_paragraph_1\}\}/g, escapeForHtml(s['BODY PARAGRAPH 1'] || ''))
    .replace(/\{\{body_paragraph_2\}\}/g, escapeForHtml(s['BODY PARAGRAPH 2'] || ''))
    .replace(/\{\{body_paragraph_3\}\}/g, escapeForHtml(s['BODY PARAGRAPH 3'] || ''))
    .replace(/\{\{cta_text\}\}/g,         escapeForHtml(s['CTA TEXT'] || 'Book Now'))
    .replace(/\{\{cta_url\}\}/g,          escapeForHtml(s['CTA URL'] || MB_BOOKING))
    .replace(/\{\{ps_text\}\}/g,          escapeForHtml(s['PS'] || ''))
    .replace(/\{\{hero_image_url\}\}/g,   heroSrc || 'https://assets.cdn.filesafe.space/55VqA3IoxvCxZyjszdj7/media/698ce4a13fdd0e24c8bf6754.svg')
    .replace(/\{\{year\}\}/g,             String(year))
    .replace(/\{\{unsubscribe_url\}\}/g,  '#')
    .replace(/\{\{webview_url\}\}/g,      '#')
}

function EmailPreview({ content, mediaUrls = [] }) {
  const s = parseEmailSections(content)
  const hasSections = Object.keys(s).length > 0
  const heroMedia = mediaUrls.find((m) => m.type === 'image' || m.kind === 'image')
  const heroSrc   = heroMedia ? (heroMedia.url || heroMedia.thumbnailUrl || null) : null

  // Old-format email: show a notice + raw content instead of the broken shell
  if (!hasSections) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex gap-3">
          <span className="text-amber-500 text-lg shrink-0">⚠</span>
          <div>
            <p className="text-sm font-medium text-amber-800">This email needs to be regenerated</p>
            <p className="text-xs text-amber-700 mt-0.5">
              It was created before the structured template format. Switch to <strong>Edit</strong>, delete the content,
              and re-run <em>Generate Content</em> from the interview to get the new section layout with one-click copy into TrustDrivenCare.
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b bg-slate-50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current content (raw)</p>
          </div>
          <pre className="px-5 py-4 text-xs leading-relaxed font-sans whitespace-pre-wrap text-slate-700">{content}</pre>
        </div>
      </div>
    )
  }

  const filledHtml = fillTemplate(emailTemplateHtml, s, heroSrc)

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Email subject / preview chrome bar */}
      <div className="rounded-t-lg overflow-hidden border border-slate-200 bg-slate-800">
        <div className="px-4 py-2">
          <p className="text-[11px] text-slate-400"><span className="text-slate-300 font-medium">Subject: </span>{s['SUBJECT LINE'] || '—'}</p>
          <p className="text-[10px] text-slate-500 truncate">{s['PREVIEW TEXT'] || 'Preview text will appear here…'}</p>
        </div>
      </div>

      {/* Iframe rendering actual TDC template */}
      <iframe
        srcDoc={filledHtml}
        title="Email Preview"
        style={{ width: '100%', height: 960, border: '1px solid #e2e8f0', borderRadius: 8, display: 'block' }}
        sandbox=""
      />

      {/* Section copy cards */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {workspace.newsletterCopyHeader}
        </p>
        {EMAIL_FIELDS.map(({ key, tag, label, hint }) => {
          const value = s[key]
          if (!value) return null
          return (
            <div key={key} className="border rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  {tag && <span className="ml-2 text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">{tag}</span>}
                  <span className="ml-2 text-[10px] text-muted-foreground">{hint}</span>
                </div>
                <CopyButton value={value} />
              </div>
              <p className="px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PostPreview({ platform, content, mediaUrls = [] }) {
  if (!content?.trim()) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No content to preview yet.
      </div>
    )
  }

  switch (platform) {
    case 'instagram':   return <InstagramPreview content={content} mediaUrls={mediaUrls} />
    case 'facebook':    return <FacebookPreview  content={content} mediaUrls={mediaUrls} />
    case 'linkedin':    return <LinkedInPreview  content={content} />
    case 'gbp':         return <GBPPreview       content={content} />
    case 'blog':        return <BlogPreview      content={content} />
    case 'email':       return <EmailPreview     content={content} mediaUrls={mediaUrls} />
    case 'instagram_ads': return <InstagramAdsPreview content={content} mediaUrls={mediaUrls} />
    default:            return <PlainPreview     content={content} />
  }
}
