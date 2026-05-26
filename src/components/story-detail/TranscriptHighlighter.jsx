import { useState, useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Instagram, MapPin, Quote } from 'lucide-react'
import { queryKeys } from '@/lib/queries'
import { createContentItems } from '@/lib/publish'
import { toast } from '@/lib/toast'

/**
 * TranscriptHighlighter — wraps transcript content and intercepts text
 * selections to offer instant route-to-format actions.
 *
 * When the user selects text inside the wrapped region a small floating
 * popover appears near the selection with three buttons:
 *   → Social post  (platform: instagram, status: draft)
 *   → GBP post     (platform: gbp,       status: draft)
 *   → Verbatim     (platform: instagram,  [QUOTE] prefix, status: draft)
 *
 * On action: POSTs to /api/db/content, invalidates contentItems + stories
 * caches so the AssetsPane refreshes, then shows a brief "Added ✓" chip.
 */
export default function TranscriptHighlighter({ story, children }) {
  const qc = useQueryClient()
  const containerRef = useRef(null)

  // Popover state
  const [popover, setPopover] = useState(null) // { x, y, text } | null
  // Per-button confirmation: key is action label
  const [confirmed, setConfirmed] = useState(null)

  // Dismiss on outside mousedown or Escape
  const dismiss = useCallback(() => {
    setPopover(null)
    setConfirmed(null)
  }, [])

  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        dismiss()
      }
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [dismiss])

  function handleMouseUp() {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed) {
      dismiss()
      return
    }
    const text = sel.toString().trim()
    if (!text || text.length < 3) {
      dismiss()
      return
    }

    // Check the selection is inside our container
    if (!sel.rangeCount) return
    const range = sel.getRangeAt(0)
    const container = containerRef.current
    if (!container) return
    if (!container.contains(range.commonAncestorContainer)) {
      dismiss()
      return
    }

    const rect = range.getBoundingClientRect()
    // Position above the selection centre, clamped to viewport
    const x = Math.min(
      Math.max(rect.left + rect.width / 2, 80),
      window.innerWidth - 80,
    )
    const y = rect.top + window.scrollY - 8 // 8px gap above selection

    setPopover({ x, y, text })
    setConfirmed(null)
  }

  async function createItem(platform, content, actionKey) {
    if (!story) return
    try {
      await createContentItems({
        interviewId:   story.id,
        clinicianId:   story.clinician_id,
        clinicianName: story.clinician_name,
        topic:         story.topic,
        platform,
        content,
        status: 'draft',
      })
      // Refresh caches so AssetsPane picks up the new piece
      qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
      qc.invalidateQueries({ queryKey: queryKeys.stories.all })

      setConfirmed(actionKey)
      setTimeout(() => {
        setPopover(null)
        setConfirmed(null)
      }, 1500)
    } catch (err) {
      toast.error('Failed to create content piece', { description: err.message })
    }
  }

  function handleSocial() {
    if (!popover) return
    createItem('instagram', popover.text, 'social')
  }

  function handleGBP() {
    if (!popover) return
    createItem('gbp', popover.text, 'gbp')
  }

  function handleVerbatim() {
    if (!popover) return
    // 'quote' is not a valid platform; prefix with [QUOTE] and use instagram
    createItem('instagram', `[QUOTE] “${popover.text}”`, 'verbatim')
  }

  const actions = [
    {
      key: 'social',
      label: '→ Social post',
      icon: Instagram,
      onClick: handleSocial,
      color: 'text-pink-600 hover:bg-pink-50',
    },
    {
      key: 'gbp',
      label: '→ GBP post',
      icon: MapPin,
      onClick: handleGBP,
      color: 'text-green-700 hover:bg-green-50',
    },
    {
      key: 'verbatim',
      label: '→ Verbatim quote',
      icon: Quote,
      onClick: handleVerbatim,
      color: 'text-slate-600 hover:bg-slate-50',
    },
  ]

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp}>
      {children}

      {popover && (
        <div
          role="dialog"
          aria-label="Route selection to format"
          style={{
            position: 'fixed',
            left: popover.x,
            top: popover.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999,
          }}
          // Prevent the popover's own mousedown from triggering the outside-click
          // handler that would immediately dismiss it.
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-1 rounded-lg border bg-white shadow-lg px-1.5 py-1 text-xs">
            {confirmed ? (
              <span className="px-2 py-0.5 text-green-700 font-medium">Added ✓</span>
            ) : (
              actions.map(({ key, label, icon: Icon, onClick, color }) => (
                <button
                  key={key}
                  onClick={onClick}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors ${color}`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span>{label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
