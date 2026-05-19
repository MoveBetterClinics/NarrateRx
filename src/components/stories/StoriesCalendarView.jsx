import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import { PLATFORM_META } from '@/lib/contentMeta'
import { isOptimalSlot, isOptimalDay } from '@/lib/scheduleHeuristics'
import { useWorkspace } from '@/lib/WorkspaceContext'

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(date) { return date.toISOString().slice(0, 10) }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function daysInMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() }
function startOfWeek(date) {
  const d = new Date(date)
  const dow = d.getDay()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - dow)
  return d
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

/**
 * StoriesCalendarView — calendar grid driven by stories prop.
 *
 * Extracts all pieces that have a scheduled_at and lays them on the
 * month / week grid. Read-only — reschedule lives on the full ContentCalendar
 * page (accessible via the legacy /calendar redirect).
 */
export default function StoriesCalendarView({ stories, isLoading }) {
  const [today]       = useState(new Date())
  const [view, setView]          = useState('month')
  const [current, setCurrent]    = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [weekAnchor, setWeekAnchor] = useState(startOfWeek(today))

  // Flatten all scheduled pieces across stories, annotated with topic + story id
  const scheduledPieces = useMemo(() => {
    if (!Array.isArray(stories)) return []
    return stories.flatMap((story) =>
      (story.pieces ?? [])
        .filter((p) => p.scheduled_at)
        .map((p) => ({
          ...p,
          topic: story.topic,
          storyId: story.id,
        })),
    )
  }, [stories])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center bg-muted rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setView('month')}
            className={`px-2 py-1 text-xs rounded ${view === 'month' ? 'bg-background shadow' : 'text-muted-foreground'}`}
          >
            Month
          </button>
          <button
            type="button"
            onClick={() => setView('week')}
            className={`px-2 py-1 text-xs rounded ${view === 'week' ? 'bg-background shadow' : 'text-muted-foreground'}`}
          >
            Week
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Tinted cells = high-engagement windows</p>
      </div>

      {view === 'month' ? (
        <MonthView
          current={current}
          today={today}
          items={scheduledPieces}
          onPrev={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          onNext={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}
        />
      ) : (
        <WeekView
          anchor={weekAnchor}
          today={today}
          items={scheduledPieces}
          onPrev={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() - 7))}
          onNext={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 7))}
        />
      )}

      {scheduledPieces.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Nothing scheduled yet"
          description="Schedule content from a story to see it appear here."
          size="sm"
        />
      )}
    </div>
  )
}

function MonthView({ current, today, items, onPrev, onNext }) {
  const workspace = useWorkspace()
  const prefsOverride = workspace?.schedule_prefs
  const byDate = useMemo(() => {
    const map = {}
    items.forEach((item) => {
      const date = item.scheduled_at?.slice(0, 10)
      if (!date) return
      if (!map[date]) map[date] = []
      map[date].push(item)
    })
    return map
  }, [items])

  const firstDow  = startOfMonth(current).getDay()
  const totalDays = daysInMonth(current)
  const cells     = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <Button variant="ghost" size="icon" onClick={onPrev}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="font-semibold">{MONTH_NAMES[current.getMonth()]} {current.getFullYear()}</h2>
        <Button variant="ghost" size="icon" onClick={onNext}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-7 border-b">
        {DAY_NAMES.map((d, i) => (
          <div key={d} className={`py-2 text-center text-xs font-medium ${isOptimalDay(i, prefsOverride) ? 'text-success' : 'text-muted-foreground'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="min-h-[100px] border-b border-r bg-muted/20" />
          const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayItems = byDate[dateStr] || []
          const dow = new Date(current.getFullYear(), current.getMonth(), day).getDay()
          const isToday = dateStr === isoDate(today)
          const optimal = isOptimalDay(dow, prefsOverride)
          return (
            <div
              key={day}
              className={`min-h-[100px] border-b p-1.5 ${i % 7 !== 6 ? 'border-r' : ''} ${optimal ? 'bg-success/5' : ''}`}
            >
              <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{day}</div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((item) => <EventChip key={item.id} item={item} />)}
                {dayItems.length > 3 && (
                  <p className="text-3xs text-muted-foreground pl-1">+{dayItems.length - 3} more</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ anchor, today, items, onPrev, onNext }) {
  const workspace = useWorkspace()
  const prefsOverride = workspace?.schedule_prefs
  const HOURS = Array.from({ length: 15 }, (_, i) => 7 + i)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor)
    d.setDate(anchor.getDate() + i)
    return d
  })
  const byDayHour = useMemo(() => {
    const map = {}
    items.forEach((item) => {
      if (!item.scheduled_at) return
      const t = new Date(item.scheduled_at)
      const key = `${isoDate(t)}|${t.getHours()}`
      if (!map[key]) map[key] = []
      map[key].push(item)
    })
    return map
  }, [items])

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
        <Button variant="ghost" size="icon" onClick={onPrev}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="font-semibold">
          Week of {days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </h2>
        <Button variant="ghost" size="icon" onClick={onNext}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
        <div />
        {days.map((d) => (
          <div key={d.toISOString()} className={`py-2 text-center text-xs ${isoDate(d) === isoDate(today) ? 'font-bold text-primary' : 'text-muted-foreground'}`}>
            {DAY_NAMES[d.getDay()]} <span className="font-medium">{d.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[60px_repeat(7,1fr)]">
        {HOURS.map((h) => (
          <Fragment key={h}>
            <div className="border-b border-r text-3xs text-muted-foreground py-2 px-2">{h}:00</div>
            {days.map((d, di) => {
              const optimal = isOptimalSlot(d.getDay(), h, prefsOverride)
              const slotItems = byDayHour[`${isoDate(d)}|${h}`] || []
              return (
                <div
                  key={`${h}-${di}`}
                  className={`min-h-[44px] border-b p-0.5 ${di < 6 ? 'border-r' : ''} ${optimal ? 'bg-success/10' : ''}`}
                >
                  <div className="space-y-0.5">
                    {slotItems.map((item) => <EventChip key={item.id} item={item} />)}
                  </div>
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function EventChip({ item }) {
  const pm = PLATFORM_META[item.platform]
  return (
    <Link
      to={`/stories/${item.storyId}`}
      title={`${pm?.label || item.platform} · ${item.topic}`}
      className={`block text-3xs px-1.5 py-0.5 rounded truncate ${pm?.bg || 'bg-muted'} ${pm?.color || ''} hover:opacity-80 transition-opacity`}
    >
      {pm?.label || item.platform} · {item.topic}
    </Link>
  )
}
