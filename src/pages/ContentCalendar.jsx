import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, AlertCircle, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import { fetchContentItems } from '@/lib/publish'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { PLATFORM_META } from './ContentHub'

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}
function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function ContentCalendar() {
  useDocumentTitle('Calendar')
  const [today]                = useState(new Date())
  const [current, setCurrent]  = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [items, setItems]      = useState([])
  const [loading, setLoading]  = useState(true)
  const [mediaNeeded, setMediaNeeded] = useState([])

  useEffect(() => {
    const from = isoDate(startOfMonth(current))
    const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0)
    const to = isoDate(lastDay)

    setLoading(true)
    // Fetch scheduled/approved items in this month range + all approved without media
    Promise.all([
      fetchContentItems({ from, to }),
      fetchContentItems({ status: 'approved' }),
    ]).then(([scheduled, approved]) => {
      setItems(scheduled)
      setMediaNeeded(approved.filter((i) =>
        ['instagram', 'facebook', 'gbp'].includes(i.platform) &&
        (!i.media_urls || i.media_urls.length === 0)
      ))
    }).catch(() => {})
     .finally(() => setLoading(false))
  }, [current])

  function prevMonth() { setCurrent(new Date(current.getFullYear(), current.getMonth() - 1, 1)) }
  function nextMonth() { setCurrent(new Date(current.getFullYear(), current.getMonth() + 1, 1)) }

  // Build calendar grid
  const firstDow  = startOfMonth(current).getDay() // 0=Sun
  const totalDays = daysInMonth(current)
  const cells     = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)

  // Map items by date
  const byDate = {}
  items.forEach((item) => {
    const date = item.scheduled_at?.slice(0, 10)
    if (!date) return
    if (!byDate[date]) byDate[date] = []
    byDate[date].push(item)
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Content Calendar</h1>
          <p className="text-muted-foreground text-sm mt-1">Scheduled posts and media deadlines.</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/hub"><CalendarDays className="h-4 w-4 mr-1.5" />Back to Hub</Link>
        </Button>
      </div>

      {/* Media needed panel */}
      {mediaNeeded.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">Media needed before these posts can go live</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {mediaNeeded.map((item) => {
              const pm = PLATFORM_META[item.platform]
              const Icon = pm?.icon
              return (
                <Link
                  key={item.id}
                  to={`/review/${item.id}`}
                  className="flex items-center gap-3 bg-white rounded-lg border border-amber-200 px-3 py-2.5 hover:border-amber-400 transition-colors"
                >
                  {Icon && <Icon className={`h-4 w-4 ${pm.color} shrink-0`} />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{item.topic}</p>
                    <p className="text-xs text-muted-foreground">{pm?.label} · {item.clinician_name}</p>
                  </div>
                  <span className="text-xs text-amber-600 ml-auto shrink-0">Add media →</span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Calendar */}
      <div className="rounded-xl border bg-card overflow-hidden">
        {/* Month nav */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/30">
          <Button variant="ghost" size="icon" onClick={prevMonth}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="font-semibold">{MONTH_NAMES[current.getMonth()]} {current.getFullYear()}</h2>
          <Button variant="ghost" size="icon" onClick={nextMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>

        {/* Day names */}
        <div className="grid grid-cols-7 border-b">
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-muted-foreground">{d}</div>
          ))}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} className="min-h-[100px] border-b border-r bg-muted/20" />
              const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const dayItems = byDate[dateStr] || []
              const isToday  = dateStr === isoDate(today)
              return (
                <div key={day} className={`min-h-[100px] border-b border-r p-1.5 ${i % 7 === 6 ? 'border-r-0' : ''}`}>
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}>{day}</div>
                  <div className="space-y-0.5">
                    {dayItems.slice(0, 3).map((item) => {
                      const pm = PLATFORM_META[item.platform]
                      return (
                        <Link
                          key={item.id}
                          to={`/review/${item.id}`}
                          className={`block text-[10px] px-1.5 py-0.5 rounded truncate ${pm?.bg || 'bg-muted'} ${pm?.color || ''} hover:opacity-80 transition-opacity`}
                        >
                          {pm?.label} · {item.topic}
                        </Link>
                      )
                    })}
                    {dayItems.length > 3 && (
                      <p className="text-[10px] text-muted-foreground pl-1">+{dayItems.length - 3} more</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Nothing scheduled this month — coach toward scheduling instead of
          leaving the user staring at an empty grid. */}
      {!loading && items.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="Nothing scheduled for this month"
          description="Schedule posts from the Content Hub to see them land here. Approved posts that need media show up in the queue above when they exist."
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/hub">Open Content Hub</Link>
            </Button>
          }
          size="sm"
        />
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
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
