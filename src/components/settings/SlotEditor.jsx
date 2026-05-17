// Pre-interview slot editor — workspaces curate the audience and story-
// type options clinicians see at interview start. Up to 6 catalog picks
// plus 2 custom slots per list. Edits flow through onChange as the
// canonical { key, label, emoji, description, is_custom } shape the
// /api/workspace/me PATCH expects.

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  MAX_CATALOG_SLOTS,
  MAX_CUSTOM_SLOTS,
} from '@/lib/interviewOptionsCatalog'

export function SlotEditor({ label, description, catalog, value, onChange }) {
  const slots = Array.isArray(value) ? value : []
  const selectedCatalogKeys = new Set(
    slots.filter((s) => !s.is_custom).map((s) => s.key),
  )
  const customSlots = slots.filter((s) => s.is_custom)
  const catalogCount = selectedCatalogKeys.size

  // Pending row — filled before being committed via "Add" button
  const [pending, setPending] = useState(null)

  function toggleCatalogItem(item) {
    if (selectedCatalogKeys.has(item.key)) {
      onChange(slots.filter((s) => !(!s.is_custom && s.key === item.key)))
      return
    }
    if (catalogCount >= MAX_CATALOG_SLOTS) return
    onChange([...slots, { ...item, is_custom: false }])
  }

  function openPendingRow() {
    if (customSlots.length >= MAX_CUSTOM_SLOTS) return
    setPending({ emoji: '⭐', label: '', description: '' })
  }

  function commitPending() {
    if (!pending || !pending.label.trim()) return
    const key = `custom_${Date.now().toString(36)}`
    onChange([
      ...slots,
      { key, label: pending.label.trim(), emoji: pending.emoji || '⭐', description: pending.description.trim(), is_custom: true },
    ])
    setPending(null)
  }

  function updateCustomSlot(key, patch) {
    onChange(slots.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function removeCustomSlot(key) {
    onChange(slots.filter((s) => s.key !== key))
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>

      {/* Catalog grid */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            From catalog
          </Label>
          <span className="text-xs text-muted-foreground">
            {catalogCount} / {MAX_CATALOG_SLOTS} selected
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {catalog.map((item) => {
            const selected = selectedCatalogKeys.has(item.key)
            const disabled = !selected && catalogCount >= MAX_CATALOG_SLOTS
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleCatalogItem(item)}
                disabled={disabled}
                className={`flex items-start gap-2 rounded-lg border p-2.5 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : disabled
                    ? 'border-input opacity-40 cursor-not-allowed'
                    : 'border-input hover:border-primary/40 hover:bg-accent/30'
                }`}
              >
                <span className="text-base shrink-0 mt-0.5">{item.emoji}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-tight">{item.label}</p>
                  <p className="text-2xs text-muted-foreground mt-0.5 leading-tight">
                    {item.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Custom slots */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Custom slots
          </Label>
          <span className="text-xs text-muted-foreground">
            {customSlots.length} / {MAX_CUSTOM_SLOTS}
          </span>
        </div>
        {customSlots.length === 0 && !pending && (
          <p className="text-xs text-muted-foreground italic">
            No custom slots. Add one if the catalog doesn&rsquo;t cover what you need.
          </p>
        )}
        {customSlots.map((slot) => (
          <div
            key={slot.key}
            className="flex items-start gap-2 rounded-lg border border-input bg-muted/30 p-2.5"
          >
            <Input
              value={slot.emoji}
              onChange={(e) => updateCustomSlot(slot.key, { emoji: e.target.value.slice(0, 4) })}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={slot.label}
                onChange={(e) => updateCustomSlot(slot.key, { label: e.target.value })}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
              />
              <Input
                value={slot.description}
                onChange={(e) => updateCustomSlot(slot.key, { description: e.target.value })}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCustomSlot(slot.key)}
              className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove custom slot"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {/* Pending (uncommitted) row */}
        {pending && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2.5">
            <Input
              value={pending.emoji}
              onChange={(e) => setPending(p => ({ ...p, emoji: e.target.value.slice(0, 4) }))}
              className="w-12 text-center text-base h-8 shrink-0"
              maxLength={4}
              aria-label="Emoji"
            />
            <div className="flex-1 min-w-0 space-y-1">
              <Input
                value={pending.label}
                onChange={(e) => setPending(p => ({ ...p, label: e.target.value }))}
                placeholder="Label (e.g. Equine owners)"
                maxLength={60}
                className="h-8 text-xs font-semibold"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
              <Input
                value={pending.description}
                onChange={(e) => setPending(p => ({ ...p, description: e.target.value }))}
                placeholder="Short description (shown beneath the label)"
                maxLength={120}
                className="h-8 text-2xs text-muted-foreground"
                onKeyDown={(e) => { if (e.key === 'Enter') commitPending(); if (e.key === 'Escape') setPending(null) }}
              />
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                onClick={commitPending}
                disabled={!pending.label.trim()}
                className="h-8 text-xs px-2"
              >
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPending(null)}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {!pending && customSlots.length < MAX_CUSTOM_SLOTS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openPendingRow}
            className="text-xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add custom slot
          </Button>
        )}
      </div>
    </div>
  )
}
