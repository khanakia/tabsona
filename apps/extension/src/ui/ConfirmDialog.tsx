import { Button } from '@/ui/volt/button';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/ui/volt/dialog';
import type { ConfirmRequest } from './help';

/**
 * The confirmation for anything that cannot be undone, in place of `window.confirm`.
 *
 * Presentational: shows `request` while it is non-null and reports the answer once.
 * Closing by Escape, the X or a click outside counts as "no" — the safe answer when the
 * user did not actually choose.
 */
export function ConfirmDialog(props: {
  readonly request: ConfirmRequest | null;
  readonly onAnswer: (confirmed: boolean) => void;
}) {
  const r = props.request;
  return (
    <Dialog open={r !== null} onOpenChange={(open) => { if (!open) props.onAnswer(false); }}>
      {r && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{r.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <DialogDescription>{r.body}</DialogDescription>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => props.onAnswer(false)}>Cancel</Button>
            <Button variant={r.destructive ? 'destructive' : 'default'} onClick={() => props.onAnswer(true)}>
              {r.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
