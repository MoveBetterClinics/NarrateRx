import { useState, useEffect } from 'react'
import { X, Trash2, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { updateMediaAsset, deleteMediaAsset } from '@/lib/mediaLib'

const STATUSES = ['raw', 'tagged', 'rendered', 'approved', 'archived']

// Detail/edit drawer for a single media asset.
// `asset` is the row, `onClose` dismisses, `onChange` is called after save/delete.
export default function MediaDetail({ asset, onClose, onChange }) {
  const [tags, setTags]         = useState(asset.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes]       = useState(asset.notes || '')
  const [patient, setPatient]   = useState(asset.patient_pseudonym || '')
  const [condition, setCondition] = useState(asset.condition || '')
  const [status, setStatus]     = useState(asset.status || 'raw')
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState('')

  // Sync local state if a different asset is loaded into the same drawer.
  useEffect(() => {
    setTags(asset.tags || [])
    setNotes(asset.notes || '')
    setPatient(asset.patient_pseudonym || '')
    setCondition(asset.condition || '')
    setStatus(asset.status || 'raw')
    setTagInput('')
    setError('')
  }, [asset.id])

  function addTag() {
    const t = tagInput.trim().toLowerCase()
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags([...tags, t])
    setTagInput('')
  }
  function removeTag(t) { setTags(tags.filter((x) => x !== t)) }

  async function save() {
    setSaving(true); setError('')
    try {
      await updateMediaAsset(asset.id, {
        tags, notes, patientPseudonym: patient, condition, status,
      })
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${asset.filename}"? This removes the file from storage and cannot be undone.`)) return
    setDeleting(true); setError('')
    try {
      await deleteMediaAsset(asset.id)
      onChange?.()
      onClose?.()
    } catch (e) {
      setError(e.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <h2 className="font-semibold text-sm truncate pr-2">{asset.filename}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Player / preview */}
          <div className="bg-black flex items-center justify-center" style={{ minHeight: 240 }}>
            {asset.kind === 'video' ? (
              <video src={asset.blob_url} controls className="max-h-[60vh] max-w-full" />
            ) : (
              <img src={asset.blob_url} alt={asset.filename} className="max-h-[60vh] max-w-full" />
            )}
          </div>

          <div className="p-5 space-y-4">
            {/* Status */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Status</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                      status === s ? 'bg-primary text-white border-primary' : 'bg-muted text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((t) => (
                  <Badge key={t} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeTag(t)}>
                    {t} <X className="h-3 w-3" />
                  </Badge>
                ))}
                {asset.ai_tags?.length > 0 && (
                  <span className="text-[10px] text-muted-foreground self-center">
                    AI suggested: {asset.ai_tags.join(', ')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                  placeholder="Add tag (e.g. shoulder, post-op)"
                  className="h-8 text-sm"
                />
                <Button size="sm" variant="outline" onClick={addTag} disabled={!tagInput.trim()}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Patient + condition */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Patient pseudonym</label>
                <Input value={patient} onChange={(e) => setPatient(e.target.value)} placeholder="e.g. R-23, Bella" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Condition</label>
                <Input value={condition} onChange={(e) => setCondition(e.target.value)} placeholder="e.g. low back, stifle" className="h-8 text-sm" />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Notes</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything else worth remembering about this clip…" className="text-sm" />
            </div>

            {/* Metadata */}
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>Uploaded {new Date(asset.created_at).toLocaleString()}</div>
              {asset.size_bytes && <div>{(asset.size_bytes / (1024 * 1024)).toFixed(1)} MB · {asset.mime_type}</div>}
              {asset.transcription && (
                <details className="mt-2">
                  <summary className="cursor-pointer hover:text-foreground">View transcription</summary>
                  <p className="mt-1 text-foreground whitespace-pre-wrap">{asset.transcription}</p>
                </details>
              )}
            </div>

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <Button variant="ghost" size="sm" onClick={handleDelete} disabled={deleting} className="text-destructive hover:text-destructive">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
            Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
