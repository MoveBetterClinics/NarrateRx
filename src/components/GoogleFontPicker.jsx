import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Curated popular Google Fonts. Grouped roughly by category so the search
// list reads coherently when unfiltered. Names match the Google Fonts CSS
// family names exactly (case + spaces preserved).
const GOOGLE_FONTS = [
  // Sans-serif workhorses
  { family: 'Inter', category: 'sans' },
  { family: 'Roboto', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Lato', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Nunito', category: 'sans' },
  { family: 'Nunito Sans', category: 'sans' },
  { family: 'Source Sans 3', category: 'sans' },
  { family: 'Work Sans', category: 'sans' },
  { family: 'Raleway', category: 'sans' },
  { family: 'DM Sans', category: 'sans' },
  { family: 'Manrope', category: 'sans' },
  { family: 'Plus Jakarta Sans', category: 'sans' },
  { family: 'Karla', category: 'sans' },
  { family: 'Mulish', category: 'sans' },
  { family: 'Rubik', category: 'sans' },
  { family: 'Outfit', category: 'sans' },
  { family: 'Figtree', category: 'sans' },
  { family: 'Public Sans', category: 'sans' },
  { family: 'IBM Plex Sans', category: 'sans' },
  // Serif
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Source Serif 4', category: 'serif' },
  { family: 'Cormorant Garamond', category: 'serif' },
  { family: 'EB Garamond', category: 'serif' },
  { family: 'Crimson Pro', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'Bitter', category: 'serif' },
  { family: 'Spectral', category: 'serif' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Fraunces', category: 'serif' },
  { family: 'IBM Plex Serif', category: 'serif' },
  // Display / brand
  { family: 'Oswald', category: 'display' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Archivo Black', category: 'display' },
  { family: 'Abril Fatface', category: 'display' },
  // Mono
  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Fira Code', category: 'mono' },
  { family: 'IBM Plex Mono', category: 'mono' },
  { family: 'Space Mono', category: 'mono' },
]

const FAMILY_SET = new Set(GOOGLE_FONTS.map((f) => f.family))

// Loads every font in the picker via a single Google Fonts CSS link so each
// option can render in its own face. Idempotent — once injected, the link
// stays for the document lifetime.
let fontsLinkInjected = false
function ensureFontsLoaded() {
  if (fontsLinkInjected || typeof document === 'undefined') return
  fontsLinkInjected = true
  const families = GOOGLE_FONTS
    .map((f) => `family=${encodeURIComponent(f.family).replace(/%20/g, '+')}:wght@400;600`)
    .join('&')
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
  document.head.appendChild(link)
}

// Loads a single arbitrary family on demand — used when the saved value
// isn't in the curated list but is still a real Google Font (or a custom
// family the user typed). We try Google Fonts; if the family doesn't exist
// there, the browser silently falls back, which is the desired behavior.
const loadedExtras = new Set()
function ensureExtraFontLoaded(family) {
  if (!family || FAMILY_SET.has(family) || loadedExtras.has(family) || typeof document === 'undefined') return
  loadedExtras.add(family)
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600&display=swap`
  document.head.appendChild(link)
}

export function GoogleFontPicker({ value, onChange, sampleText, className }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customMode, setCustomMode] = useState(false)
  const [customDraft, setCustomDraft] = useState('')
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const customInputRef = useRef(null)

  useEffect(() => { ensureFontsLoaded() }, [])
  useEffect(() => { ensureExtraFontLoaded(value) }, [value])
  useEffect(() => { if (customMode) setTimeout(() => customInputRef.current?.focus(), 0) }, [customMode])

  function commitCustom() {
    const v = customDraft.trim()
    if (!v) return
    ensureExtraFontLoaded(v)
    onChange(v)
    setCustomMode(false)
    setCustomDraft('')
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
    else { setQuery(''); setCustomMode(false); setCustomDraft('') }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return GOOGLE_FONTS
    return GOOGLE_FONTS.filter((f) => f.family.toLowerCase().includes(q))
  }, [query])

  const display = value || 'Select a font…'
  const sample = sampleText || 'The quick brown fox'

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          className={cn('truncate', !value && 'text-muted-foreground')}
          style={value ? { fontFamily: `"${value}", sans-serif` } : undefined}
        >
          {display}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[260px] rounded-md border bg-background shadow-lg">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Search className="h-3.5 w-3.5 opacity-60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Google Fonts…"
              className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
            {value && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false) }}
                className="text-muted-foreground hover:text-foreground"
                title="Clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                No fonts match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((f) => {
                const selected = f.family === value
                return (
                  <button
                    type="button"
                    key={f.family}
                    onClick={() => { onChange(f.family); setOpen(false) }}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-accent/40',
                      selected && 'bg-accent/30',
                    )}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-2xs text-muted-foreground">{f.family}</span>
                      <span
                        className="truncate text-sm"
                        style={{ fontFamily: `"${f.family}", ${f.category === 'serif' ? 'serif' : f.category === 'mono' ? 'monospace' : 'sans-serif'}` }}
                      >
                        {sample}
                      </span>
                    </span>
                    {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                )
              })
            )}
          </div>
          {customMode ? (
            <div className="border-t bg-muted/30 px-2 py-1.5">
              <div className="mb-1 text-2xs text-muted-foreground">
                Type any Google Fonts family name. <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="underline">Browse fonts.google.com</a>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  ref={customInputRef}
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
                    if (e.key === 'Escape') { e.preventDefault(); setCustomMode(false); setCustomDraft('') }
                  }}
                  placeholder="e.g. Inter Tight"
                  className="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary/60"
                />
                <button
                  type="button"
                  onClick={commitCustom}
                  disabled={!customDraft.trim()}
                  className="h-7 rounded bg-primary px-2 text-2xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Use
                </button>
                <button
                  type="button"
                  onClick={() => { setCustomMode(false); setCustomDraft('') }}
                  className="h-7 rounded px-2 text-2xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
              {customDraft.trim() && (
                <div
                  className="mt-1.5 truncate text-sm"
                  style={{ fontFamily: `"${customDraft.trim()}", sans-serif` }}
                >
                  {sample}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomMode(true)}
              className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-2xs text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            >
              <Plus className="h-3 w-3" />
              Use a custom Google Fonts family…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default GoogleFontPicker
