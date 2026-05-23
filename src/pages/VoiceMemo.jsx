import { Link } from 'react-router-dom'
import { ArrowLeft, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * VoiceMemo — quick-capture recorder. Phase 1 stub; task #3 fills in the
 * MediaRecorder logic, upload, transcription, and the trigger that creates
 * an interviews row with capture_mode='voice_memo'.
 *
 * Stubbed so the /new picker can already route here without 404ing while
 * the rest of the lane is built out.
 */
export default function VoiceMemo() {
  useDocumentTitle('Voice memo')

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/new">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Voice memo</h1>
          <p className="text-sm text-muted-foreground">
            Hit record, say what happened, save.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6 flex flex-col items-center text-center gap-4">
          <div className="h-16 w-16 rounded-full bg-muted text-muted-foreground flex items-center justify-center">
            <Mic className="h-7 w-7" />
          </div>
          <div>
            <div className="font-medium">Recorder coming online</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              The recorder controls and upload pipeline land in the next
              commit on this branch. The picker route is wired so this URL
              is stable.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/new">← Pick a different mode</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
