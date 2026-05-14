import { useState, useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, CalendarDays, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import { useContentItems } from '@/lib/queries'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { PLATFORM_META } from '@/lib/contentMeta'
import {
  PLATFORM_SCHEDULE_PREFS, MIN_GAP_MS,
  suggestScheduleTime, isOptimalSlot, isOptimalDay,
} from '@/lib/scheduleHeuristics'
import { updateContentItem } from '@/lib/publish'
import { toast } from '@/lib/toast'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queries'

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

export default function ContentCalendar() {
  useDocumentTitle('Calendar')
  const [today]                  = useState(new Date())
  const [view, setView]          = useState('month') // 'month' | 'week'
  const [current, setCurrent]    = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [weekAnchor, setWeekAnchor] = useState(startOfWeek(today))
  const qc = useQueryClient()

  // Two parallel queries: scheduled items for the visible range and the
  // approved-but-unscheduled queue (drives the suggest-time list).
  const from = view === 'month' ? isoDate(startOfMonth(current)) : isoDate(weekAnchor)
  const to = view === 'month'
    ? isoDate(new Date(current.getFullYear(), current.getMonth() + 1, 0))
    : isoDate(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 6))

  const { data: scheduledItems = [], isLoading: loadingScheduled } = useContentItems({ from, to })
  const { data: approved = [], isLoading: loadingApproved } = useContentItems({ status: 'approved' })
  const loading = loadingScheduled || loadingApproved

  const unscheduled = approved.filter((i) => !i.scheduled_at)
  const mediaNeeded = approved.filter((i) =>
    ['instagram', 'facebook', 'gbp'].includes(i.platform) &&
    (!i.media_urls || i.media_urls.length === 0),
  )

  function refresh() {
    qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
  }

  // Drop handler. Refuses drops within MIN_GAP_MS of an already-scheduled
  // item — mirrors the conflict guard used by suggestScheduleTime so the
  // editor can't accidentally cluster two posts inside the 2-hour window.
  async function reschedule(item, newDate) {
    const target = newDate.getTime()
    const conflict = scheduledItems.some((i) => {
      if (i.id === item.id || !i.scheduled_at) return false
      return Math.abs(new Date(i.scheduled_at).getTime() - target) < MIN_GAP_MS
    })
    if (conflict) {
      toast.error('Too close to another post', { description: 'Posts need at least 2 hours between them.' })
      return
    }
    try {
      await updateContentItem(item.id, { scheduledAt: newDate.toISOString(), status: 'scheduled' })
      refresh()
      toast.success(`Rescheduled to ${newDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' })}`)
    } catch (e) {
      toast.error('Reschedule failed', { description: e.message })
    }
  }

  async function applySuggestion(item) {
    const t = suggestScheduleTime(item.platform, scheduledItems)
    if (!t) return toast.error('No open slot in the next 60 days for this platform.')
    await reschedule(item, t)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Calendar</h1>
          <p className="text-muted-foreground text-sm mt-1">Drag posts to reschedule. Tinted cells mark high-engagement windows.</p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="outline" size="sm" asChild>
            <Link to="/hub"><CalendarDays className="h-4 w-4 mr-1.5" />Back to Hub</Link>
          </Button>
        </div>
      </div>

      {/* Approved but unscheduled — suggest-a-slot inbox. */}
      {unscheduled.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-2">
          <p className="text-sm font-medium text-blue-900">{unscheduled.length} approved post{unscheduled.length === 1 ? '' : 's'} ready to schedule</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {unscheduled.map((item) => {
              const pm = PLATFORM_META[item.platform] || PLATFORM_META.blog
              const Icon = pm.icon
              return (
                <div key={item.id} className="flex items-center gap-2 bg-background rounded-md border p-2">
                  <div className={`p-1 rounded ${pm.bg}`}><Icon className={`h-3.5 w-3.5 ${pm.color}`} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{item.topic}</p>
                    <p className="text-[10px] text-muted-foreground">{pm.label}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => applySuggestion(item)}>
                    <Sparkles className="h-3 w-3 mr-1" />Suggest time
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {mediaNeeded.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">Media needed before these posts can go live</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {mediaNeeded.map((item) => {
              const pm = PLATFORM_META[item.platform]
              const Icon = pm?.icon
              return (
                <Link key={item.id} to={`/review/${item.id}`} className="flex items-center gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2 hover:border-amber-400 transition-colors">
                  {Icon && <Icon className={`h-4 w-4 ${pm.color} shrink-0`} />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{item.topic}</p>
                    <p className="text-xs text-muted-foreground">{pm?.label}</p>
                  </div>
                  <span className="text-xs text-amber-600 ml-auto shrink-0">Add media →</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === 'month' ? (
        <MonthView
          current={current}
          today={today}
          items={scheduledItems}
          onPrev={() => setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          onNext={() => setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          onDrop={reschedule}
        />
      ) : (
        <WeekView
          anchor={weekAnchor}
          today={today}
          items={scheduledItems}
          onPrev={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() - 7))}
          onNext={() => setWeekAnchor(new Date(weekAnchor.getFullYear(), weekAnchor.getMonth(), weekAnchor.getDate() + 7))}
          onDrop={reschedule}
        />
      )}

      {!loading && scheduledItems.length === 0 && unscheduled.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title={view === 'month' ? 'Nothing scheduled this month' : 'Nothing scheduled this week'}
          description="Schedule posts from the Content Hub to see them land here."
          action={<Button asChild size="sm" variant="outline"><Link to="/hub">Open Content Hub</Link></Button>}
          size="sm"
        />
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Heatmap tints:</span>
        <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">High-engagement window</span>
        {Object.entries(PLATFORM_META).map(([k, v]) => {
          const Icon = v.icon
          return (
            <div key={k} className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${v.bg} ${v.color}`}>
              <Icon className="h-3 w-3" />{v.label}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MonthView({ current, today, items, onPrev, onNext, onDrop }) {
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
          <div key={d} className={`py-2 text-center text-xs font-medium ${isOptimalDay(i) ? 'text-emerald-700' : 'text-muted-foreground'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} className="min-h-[100px] border-b border-r bg-muted/20" />
          const dateObj = new Date(current.getFullYear(), current.getMonth(), day)
          const dow = dateObj.getDay()
          const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayItems = byDate[dateStr] || []
          const isToday = dateStr === isoDate(today)
          const optimal = isOptimalDay(dow)
          return (
            <DayCell
              key={day}
              borderRight={i % 7 !== 6}
              optimal={optimal}
              isToday={isToday}
              day={day}
              dayItems={dayItems}
              onDrop={(item) => {
                // Default the dropped time to the first optimal hour for that
                // platform on that date — or 9am as a generic fallback.
                const prefs = PLATFORM_SCHEDULE_PREFS[item.platform]
                const hour = prefs?.hours?.[0] ?? 9
                const target = new Date(dateObj)
                target.setHours(hour, 0, 0, 0)
                onDrop(item, target)
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

function DayCell({ borderRight, optimal, isToday, day, dayItems, onDrop }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        try {
          const payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}')
          if (payload?.id) onDrop(payload)
        } catch { /* ignore malformed payload */ }
      }}
      className={`min-h-[100px] border-b p-1.5 transition-colors ${borderRight ? 'border-r' : ''} ${optimal ? 'bg-emerald-50/30' : ''} ${over ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}
    >
      <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{day}</div>
      <div className="space-y-0.5">
        {dayItems.slice(0, 3).map((item) => <EventChip key={item.id} item={item} />)}
        {dayItems.length > 3 && (
          <p className="text-[10px] text-muted-foreground pl-1">+{dayItems.length - 3} more</p>
        )}
      </div>
    </div>
  )
}

function WeekView({ anchor, today, items, onPrev, onNext, onDrop }) {
  // Hour rows 7am–9pm — outside that range posts are extremely rare and the
  // grid stays scannable. Optimal-hour tint comes from isOptimalSlot.
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
            <div className="border-b border-r text-[10px] text-muted-foreground py-2 px-2">{h}:00</div>
            {days.map((d, di) => {
              const optimal = isOptimalSlot(d.getDay(), h)
              const slotItems = byDayHour[`${isoDate(d)}|${h}`] || []
              return (
                <WeekCell
                  key={`${h}-${di}`}
                  borderRight={di < 6}
                  optimal={optimal}
                  items={slotItems}
                  onDrop={(item) => {
                    const target = new Date(d)
                    target.setHours(h, 0, 0, 0)
                    onDrop(item, target)
                  }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function WeekCell({ borderRight, optimal, items, onDrop }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!over) setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        try {
          const payload = JSON.parse(e.dataTransfer.getData('application/json') || '{}')
          if (payload?.id) onDrop(payload)
        } catch { /* ignore */ }
      }}
      className={`min-h-[44px] border-b p-0.5 ${borderRight ? 'border-r' : ''} ${optimal ? 'bg-emerald-50/40' : ''} ${over ? 'ring-2 ring-primary/40 bg-primary/5' : ''}`}
    >
      <div className="space-y-0.5">
        {items.map((item) => <EventChip key={item.id} item={item} />)}
      </div>
    </div>
  )
}

function EventChip({ item }) {
  const pm = PLATFORM_META[item.platform]
  return (
    <Link
      to={`/review/${item.id}`}
      draggable
      onDragStart={(e) => {
        // Carry just enough to re-apply the move on drop. We don't need the
        // full row here — id + platform is enough to recompute the conflict
        // gate and pick a default hour.
        e.dataTransfer.setData('application/json', JSON.stringify({
          id: item.id,
          platform: item.platform,
          scheduled_at: item.scheduled_at,
        }))
      }}
      title={`${pm?.label || ''} · ${item.topic}`}
      className={`block text-[10px] px-1.5 py-0.5 rounded truncate cursor-grab active:cursor-grabbing ${pm?.bg || 'bg-muted'} ${pm?.color || ''} hover:opacity-80 transition-opacity`}
    >
      {pm?.label} · {item.topic}
    </Link>
  )
}

