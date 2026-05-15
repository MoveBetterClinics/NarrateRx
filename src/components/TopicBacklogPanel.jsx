import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, Plus, Play, Archive, Trash2, Loader2, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  useTopicBacklog,
  useCreateTopic,
  useUpdateTopic,
  useDeleteTopic,
  useSuggestTopics,
} from '@/lib/queries'
import { toast } from '@/lib/toast'

// Strategic topic backlog. Sits inside the Strategy page and gives the clinic
// a prioritized queue of "what to interview about next" — either AI-suggested
// based on paradigm + coverage gaps, or manually added.
export default function TopicBacklogPanel() {
  const [statusFilter, setStatusFilter] = useState('pending')
  const { data: topics = [], isLoading } = useTopicBacklog(statusFilter)
  const createMutation  = useCreateTopic()
  const updateMutation  = useUpdateTopic()
  const deleteMutation  = useDeleteTopic()
  const suggestMutation = useSuggestTopics()
  const navigate = useNavigate()

  const [newTopic, setNewTopic] = useState('')
  const [error, setError]       = useState('')

  async function handleAdd(e) {
    e?.preventDefault?.()
    const t = newTopic.trim()
    if (!t) return
    setError('')
    try {
      await createMutation.mutateAsync({ topic: t, priority: 70 })
      setNewTopic('')
    } catch (err) {
      setError(err.message || 'Could not add topic')
    }
  }

  async function handleSuggest() {
    setError('')
    try {
      await suggestMutation.mutateAsync(5)
    } catch (err) {
      setError(err.message || 'Could not generate suggestions')
    }
  }

  const onMutateError = (e) => toast.error(e.message || 'Action failed')

  function handleStart(topic) {
    updateMutation.mutate({ id: topic.id, patch: { status: 'in_progress' } }, { onError: onMutateError })
    navigate(`/interview/new?topic=${encodeURIComponent(topic.topic)}`)
  }

  function handleArchive(topic) {
    updateMutation.mutate({ id: topic.id, patch: { status: 'archived' } }, { onError: onMutateError })
  }

  function handleComplete(topic) {
    updateMutation.mutate({ id: topic.id, patch: { status: 'completed' } }, { onError: onMutateError })
  }

  function handleRestore(topic) {
    updateMutation.mutate({ id: topic.id, patch: { status: 'pending' } }, { onError: onMutateError })
  }

  function handleDelete(topic) {
    if (!confirm(`Delete "${topic.topic}" from the backlog?`)) return
    deleteMutation.mutate(topic.id, { onError: onMutateError })
  }

  const STATUS_TABS = [
    { id: 'pending',     label: 'Up next' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'completed',   label: 'Done' },
    { id: 'archived',    label: 'Archived' },
  ]

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-base">Topic Backlog</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Your queue of upcoming interview topics. AI suggestions are based on your clinical paradigm and what you have already covered.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={handleSuggest}
            disabled={suggestMutation.isPending}
          >
            {suggestMutation.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Thinking…</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Suggest 5</>
            )}
          </Button>
        </div>
      </div>

      {/* Add manual topic */}
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Add a topic manually (e.g., piriformis syndrome)"
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          className="text-sm"
        />
        <Button
          size="sm"
          type="submit"
          disabled={!newTopic.trim() || createMutation.isPending}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add
        </Button>
      </form>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      {/* Status tabs */}
      <div className="flex gap-1.5 border-b">
        {STATUS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setStatusFilter(t.id)}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              statusFilter === t.id
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
        </div>
      ) : topics.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          {statusFilter === 'pending'
            ? 'No pending topics. Click "Suggest 5" or add one manually above.'
            : `No topics in ${STATUS_TABS.find((t) => t.id === statusFilter)?.label.toLowerCase()}.`}
        </div>
      ) : (
        <div className="divide-y">
          {topics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              onStart={handleStart}
              onComplete={handleComplete}
              onArchive={handleArchive}
              onRestore={handleRestore}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopicRow({ topic, onStart, onComplete, onArchive, onRestore, onDelete }) {
  const isPending     = topic.status === 'pending'
  const isInProgress  = topic.status === 'in_progress'
  const isCompleted   = topic.status === 'completed'
  const isArchived    = topic.status === 'archived'
  const isAiSuggested = topic.source === 'ai_suggested'

  return (
    <div className={`py-3 flex items-start justify-between gap-3 ${isArchived || isCompleted ? 'opacity-70' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{topic.topic}</span>
          {isAiSuggested && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 font-normal text-muted-foreground gap-1">
              <Sparkles className="h-2.5 w-2.5" />
              AI
            </Badge>
          )}
          {isInProgress && (
            <Badge className="text-xs bg-amber-100 text-amber-700 border-0 px-1.5 py-0">In progress</Badge>
          )}
          {isCompleted && (
            <Badge className="text-xs bg-green-100 text-green-700 border-0 px-1.5 py-0 gap-1">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Done
            </Badge>
          )}
        </div>
        {topic.rationale && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{topic.rationale}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {(isPending || isInProgress) && (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onStart(topic)}>
            <Play className="h-3 w-3" />
            Start interview
            <ChevronRight className="h-3 w-3" />
          </Button>
        )}
        {isInProgress && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            title="Mark complete"
            onClick={() => onComplete(topic)}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </Button>
        )}
        {(isPending || isInProgress) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground"
            title="Archive"
            onClick={() => onArchive(topic)}
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>
        )}
        {(isArchived || isCompleted) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => onRestore(topic)}
          >
            Restore
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
          title="Delete"
          onClick={() => onDelete(topic)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
