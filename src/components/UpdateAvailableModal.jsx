import { Sparkles } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export default function UpdateAvailableModal({ open, update, onReload, onDismiss }) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onDismiss?.() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {update?.title || 'A new version is available'}
          </DialogTitle>
          <DialogDescription>
            {update?.date ? `Released ${update.date}. ` : ''}
            Reload to get the latest version.
          </DialogDescription>
        </DialogHeader>

        {update?.changes?.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            {update.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>Later</Button>
          <Button onClick={onReload}>Reload now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
