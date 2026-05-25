import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mic2, Loader2, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'

const APPOINTMENT_TYPES = [
  { value: 'new patient', label: 'New patient' },
  { value: 'follow-up', label: 'Follow-up visit' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'custom', label: 'Custom…' },
]

/**
 * PreVisitMessage — generate a short personalised voice message in the
 * clinician's cloned voice to send to patients before their appointment.
 *
 * Route: /pre-visit
 */
export default function PreVisitMessage() {
  useDocumentTitle('Pre-visit message')

  const [patientName, setPatientName] = useState('')
  const [appointmentTypeKey, setAppointmentTypeKey] = useState('new patient')
  const [customType, setCustomType] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState(null) // { url, script }
  const [copied, setCopied] = useState(false)

  const appointmentType =
    appointmentTypeKey === 'custom' ? customType.trim() : appointmentTypeKey

  const { mutate: generate, isPending } = useAppMutation({
    mutationFn: () =>
      apiFetch('/api/voice/pre-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: patientName.trim() || undefined,
          appointmentType,
          note: note.trim() || undefined,
        }),
      }),
    errorMessage: 'Message generation failed',
    onSuccess: (data) => {
      setResult(data)
      toast.success('Voice message ready')
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!appointmentType) return
    setResult(null)
    generate()
  }

  function handleCopyLink() {
    if (!result?.url) return
    navigator.clipboard.writeText(result.url).then(() => {
      setCopied(true)
      toast.success('Link copied')
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Mic2 className="h-5 w-5 text-primary" />
            Pre-visit message
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate a short voice message in your cloned voice to send patients before their appointment.
          </p>
        </div>
      </div>

      {/* Form */}
      <Card>
        <CardContent className="p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Patient name */}
            <div className="space-y-1.5">
              <Label htmlFor="patient-name">
                Patient first name <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="patient-name"
                type="text"
                placeholder="e.g. Sarah"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                disabled={isPending}
                autoFocus
              />
            </div>

            {/* Appointment type */}
            <div className="space-y-1.5">
              <Label htmlFor="appointment-type">Appointment type</Label>
              <div className="flex flex-wrap gap-2">
                {APPOINTMENT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setAppointmentTypeKey(t.value)}
                    disabled={isPending}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      appointmentTypeKey === t.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-foreground/40'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {appointmentTypeKey === 'custom' && (
                <Input
                  id="appointment-type"
                  type="text"
                  placeholder="e.g. sports injury assessment"
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  disabled={isPending}
                  className="mt-2"
                  autoFocus
                />
              )}
            </div>

            {/* Special note */}
            <div className="space-y-1.5">
              <Label htmlFor="special-note">
                Special note <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="special-note"
                placeholder="e.g. remind them to bring orthotics"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={isPending}
                rows={2}
                className="resize-none"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={isPending || !appointmentType}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating&hellip;
                </>
              ) : (
                <>
                  <Mic2 className="h-4 w-4 mr-2" />
                  Generate message
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Result */}
      {result && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Generated message</h2>

            {/* Script */}
            <p className="text-sm text-foreground/90 leading-relaxed italic">
              &ldquo;{result.script}&rdquo;
            </p>

            {/* Audio player */}
            <audio controls src={result.url} className="w-full h-10 mt-1" />

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyLink}
                className="flex-1"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1.5 text-green-600" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1.5" />
                    Copy link
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setResult(null)
                  setPatientName('')
                  setNote('')
                  setAppointmentTypeKey('new patient')
                  setCustomType('')
                }}
                className="flex-1"
              >
                New message
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
