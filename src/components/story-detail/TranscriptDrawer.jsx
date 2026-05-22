import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
} from '@/components/ui/Drawer'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import TranscriptHighlighter from './TranscriptHighlighter'

/**
 * TranscriptDrawer — slide-over transcript panel used in Edit mode.
 *
 * Opens from the left so it doesn't cover the piece being edited on the
 * right. Reuses TranscriptHighlighter so the "select text → route to a
 * content format" affordance keeps working inside the drawer — the
 * highlighter's popover renders in a portal above the drawer surface.
 *
 * The search input filters messages client-side (substring, case-insensitive)
 * — fine for transcript lengths in our range (< a few hundred turns).
 */
export default function TranscriptDrawer({ story, open, onOpenChange }) {
  const [query, setQuery] = useState('')

  // Read both arrays inside the useMemo so the linter doesn't flag the
  // every-render-new-array problem (Array.isArray(...) ? ... : []).
  const cleanedRef = story?.cleaned_messages
  const originalRef = story?.messages
  const display = useMemo(() => {
    const cleaned = Array.isArray(cleanedRef) ? cleanedRef : []
    const original = Array.isArray(originalRef) ? originalRef : []
    return (cleaned.length > 0 ? cleaned : original)
      .filter((m) => !String(m.content || '').includes('INTERVIEW_COMPLETE'))
  }, [cleanedRef, originalRef])
  const hasCleaned = Array.isArray(cleanedRef) && cleanedRef.length > 0

  const q = query.trim().toLowerCase()
  const filtered = q
    ? display.filter((m) => String(m.content || '').toLowerCase().includes(q))
    : display

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerPortal>
        <DrawerOverlay />
        {/* We render the DialogPrimitive.Content directly (rather than via
            DrawerContent) so we can override the default close-button slot —
            we want the close button next to the search field, not floating
            in a corner. */}
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex h-full w-full max-w-md flex-col border-r bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
        >
          <DialogPrimitive.Title className="sr-only">Transcript</DialogPrimitive.Title>

          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">Transcript</p>
              {hasCleaned && (
                <p className="text-xs text-muted-foreground mt-0.5">Showing cleaned version</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5 italic">
                Select any text to route it to a content format
              </p>
            </div>
            <DialogPrimitive.Close
              className="shrink-0 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 p-1"
              aria-label="Close transcript"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Search */}
          <div className="border-b px-5 py-3">
            <label className="relative block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcript…"
                className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </label>
            {q && (
              <p className="text-xs text-muted-foreground mt-1.5">
                {filtered.length} of {display.length} {display.length === 1 ? 'turn' : 'turns'}
              </p>
            )}
          </div>

          {/* Body — wrapped in TranscriptHighlighter so the route-to-format
              popover triggers on text selection inside the drawer, just like
              in the expanded pane. */}
          <div className="flex-1 min-h-0">
            <TranscriptHighlighter story={story}>
              <ScrollArea className="h-full">
                <div className="p-4 space-y-3">
                  {filtered.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {q ? 'No matches.' : 'No transcript available.'}
                    </p>
                  ) : (
                    filtered.map((m, i) => (
                      <div key={i} className="text-xs leading-relaxed">
                        <span className={`font-medium ${m.role === 'user' ? 'text-primary' : 'text-muted-foreground'}`}>
                          {m.role === 'user' ? 'Clinician: ' : 'Interviewer: '}
                        </span>
                        <span className="text-foreground/90">{m.content}</span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TranscriptHighlighter>
          </div>
        </DialogPrimitive.Content>
      </DrawerPortal>
    </Drawer>
  )
}
