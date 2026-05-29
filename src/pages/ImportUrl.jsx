import { useState, useCallback, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Link as LinkIcon, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { toast } from '@/lib/toast'
import { apiFetch } from '@/lib/api'
import { useWorkspace } from '@/lib/WorkspaceContext'

/**
 * ImportUrl — paste a URL, we fetch + extract the text, then route to
 * CaptureReview for editing + generation.
 *
 * Route: /new/import
 */
export default function ImportUrl() {
  useDocumentTitle('Import writing')
  const navigate = useNavigate()
  const workspace = useWorkspace()

  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) return

    setError('')
    setLoading(true)

    try {
      const { staffId, interviewId } = await apiFetch('/api/import-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      if (!interviewId) throw new Error('Import succeeded but no interview ID returned.')

      toast.success('Content fetched — review and edit before generating.')
      navigate(`/capture/${staffId}/${interviewId}/review`)
    } catch (err) {
      setError(err?.message || 'Import failed — please try again.')
      setLoading(false)
    }
  }, [url, navigate])

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/new">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import writing</h1>
          <p className="text-sm text-muted-foreground">
            Paste a URL — we&apos;ll pull the text and turn it into fresh content.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="import-url" className="text-sm font-medium">
                Page URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={inputRef}
                    id="import-url"
                    type="url"
                    placeholder="https://www.movebetter.co/your-blog-post/"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={loading}
                    className="pl-9"
                    autoFocus
                  />
                </div>
                <Button type="submit" disabled={!url.trim() || loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Import'}
                </Button>
              </div>
            </div>

            {loading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                Fetching and extracting text — takes a few seconds&hellip;
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
                {error}
              </div>
            )}
          </form>

          <div className="border-t pt-4 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Works with</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• {workspace?.display_name ? `Your existing ${workspace.display_name} blog posts` : 'Your existing blog posts'}</li>
              <li>• Any public article or page you&apos;ve written</li>
              <li>• Guest posts or syndicated pieces you own</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
