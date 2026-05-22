import { useEffect, useRef, useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Button } from '@/components/ui/button'

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

function normalize(hex) {
  if (!hex) return '#000000'
  const v = hex.trim()
  return v.startsWith('#') ? v : `#${v}`
}

export function ColorPickerPopover({ value, onChange, swatchClassName = 'h-8 w-12', ariaLabel = 'Pick color' }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(normalize(value))
  const [hexInput, setHexInput] = useState(normalize(value))
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) {
      setDraft(normalize(value))
      setHexInput(normalize(value))
    }
  }, [value, open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function commit() {
    onChange(draft.toUpperCase())
    setOpen(false)
  }

  function cancel() {
    setDraft(normalize(value))
    setHexInput(normalize(value))
    setOpen(false)
  }

  function onHexInputChange(e) {
    const v = e.target.value
    setHexInput(v)
    if (HEX_RE.test(v)) setDraft(normalize(v))
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`${swatchClassName} rounded border cursor-pointer block`}
        style={{ background: normalize(value) }}
      />
      {open && (
        <div className="absolute z-50 mt-1 left-0 rounded-lg border bg-popover shadow-lg p-3 w-[232px]">
          <HexColorPicker color={draft} onChange={(c) => { setDraft(c); setHexInput(c) }} style={{ width: '100%', height: 160 }} />
          <div className="mt-2 flex items-center gap-2">
            <div className="h-7 w-9 rounded border shrink-0" style={{ background: draft }} />
            <input
              value={hexInput}
              onChange={onHexInputChange}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
              className="flex h-7 w-full rounded-md border bg-background px-2 text-xs font-mono"
              placeholder="#000000"
              spellCheck={false}
            />
          </div>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-2xs" onClick={cancel}>Cancel</Button>
            <Button size="sm" className="h-7 text-2xs" onClick={commit}>Done</Button>
          </div>
        </div>
      )}
    </div>
  )
}
