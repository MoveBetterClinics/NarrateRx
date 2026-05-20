// Shared layout primitives used by WorkspaceSettings and all sub-pages.
// These are intentionally thin — no state, no side effects.

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export function Section({ title, description, children, className = '' }) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

export function Field({ label, value, onChange, placeholder, hint, type = 'text', autoComplete }) {
  return (
    <div className="space-y-1 max-w-xl">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="text-sm"
      />
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function Textarea2({ label, value, onChange, rows = 4, hint, mono = false }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        className={`text-sm resize-y ${mono ? 'font-mono' : 'font-sans'}`}
      />
      {hint && <p className="text-2xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

// Shared save-bar used by all sub-pages. On mobile it sticks to the
// bottom of the viewport (with safe-area padding) so the user can save
// from anywhere on a long form without scrolling to the bottom. On md+
// it's an inline block that appears after the form content.
export function SaveBar({ saving, saved, error, isDirty, onSave, onDiscard }) {
  if (!isDirty && !saved && !error) return null
  return (
    <div
      className="sticky bottom-0 z-20 md:static -mx-6 md:mx-0 px-4 py-3 mt-6 flex items-center justify-between gap-4 border md:rounded-lg border-x-0 md:border-x border-border bg-background/95 md:bg-muted/40 backdrop-blur md:backdrop-blur-none supports-[backdrop-filter]:bg-background/85"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <p className="text-xs text-muted-foreground">
        {saved
          ? 'Saved.'
          : error
            ? error
            : 'You have unsaved changes.'}
      </p>
      <div className="flex items-center gap-2 shrink-0">
        {isDirty && (
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="text-xs text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-md hover:bg-muted transition-colors"
          >
            Discard
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !isDirty}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md font-medium disabled:opacity-60 hover:bg-primary/90 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
