// The one wired hook: fetches state, runs mutations, reports errors. Shared by both
// surfaces so the popup and the options page can never drift in behaviour.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfirmRequest } from '@/ui/help';
import { client, type CallResult } from './client';
import type { AppState } from '@/domain/messages';

/** A message to show the user. `tone` is a closed set so a surface cannot invent a
 *  severity the styling does not handle. */
export interface Feedback {
  readonly tone: 'info' | 'success' | 'warn' | 'error';
  readonly text: string;
}

/**
 * The one wired hook: fetches state, runs mutations, surfaces errors.
 *
 * Shared by the popup and the options page so the two can never drift in behaviour —
 * which is also the justification for the feature/presenter split around it.
 */
export function useLibrary() {
  const [state, setState] = useState<AppState | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // The question on screen, if any. The resolver lives in a ref, not in state: it is a
  // continuation, never rendered, and React must not re-render or stale-close over it.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const pendingAnswer = useRef<((confirmed: boolean) => void) | null>(null);

  /** Ask before something that cannot be undone. Resolves when the user answers; a
   *  second question while one is open answers the first "no" rather than losing it. */
  const confirm = useCallback((request: ConfirmRequest): Promise<boolean> => {
    pendingAnswer.current?.(false);
    setConfirmRequest(request);
    return new Promise<boolean>((resolve) => { pendingAnswer.current = resolve; });
  }, []);

  /** The surface's `ConfirmDialog` reports the answer here, exactly once per question. */
  const answerConfirm = useCallback((confirmed: boolean) => {
    const resolve = pendingAnswer.current;
    pendingAnswer.current = null;
    setConfirmRequest(null);
    resolve?.(confirmed);
  }, []);

  const refresh = useCallback(async () => {
    setState(await client.getState());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Every mutation goes through here, so an error is never swallowed. `success` is
   *  said back when the action worked and its result is not otherwise visible — a
   *  silent "Save now" or "Leave persona" left people unsure anything had happened. */
  const run = useCallback(async (fn: () => Promise<string | null>, success?: string) => {
    const error = await fn();
    setFeedback(error ? { tone: 'error', text: error } : success ? { tone: 'success', text: success } : null);
    await refresh();
  }, [refresh]);

  /**
   * For calls that may need the user to confirm an overwrite. Modelled separately from
   * an error so a destructive replace is never one indistinguishable failure among many.
   */
  const runConfirmable = useCallback(async (
    fn: (replace: boolean) => Promise<CallResult>,
    describeReplace: (site: string) => ConfirmRequest,
    success?: string,
  ) => {
    const done = (r: CallResult): Feedback | null => (r.kind === 'error'
      ? { tone: 'error', text: r.message }
      : success ? { tone: 'success', text: success } : null);
    const first = await fn(false);
    if (first.kind === 'confirm-replace') {
      if (!(await confirm(describeReplace(first.site)))) return;
      setFeedback(done(await fn(true)));
    } else {
      setFeedback(done(first));
    }
    await refresh();
  }, [refresh, confirm]);

  return { state, feedback, setFeedback, refresh, run, runConfirmable, confirm, confirmRequest, answerConfirm };
}
