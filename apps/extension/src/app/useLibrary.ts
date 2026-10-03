// The one wired hook: fetches state, runs mutations, reports errors. Shared by both
// surfaces so the popup and the options page can never drift in behaviour.

import { useCallback, useEffect, useState } from 'react';
import { client, type CallResult } from './client';
import type { AppState } from '@/domain/messages';

/** A message to show the user. `tone` is a closed set so a surface cannot invent a
 *  severity the styling does not handle. */
export interface Feedback {
  readonly tone: 'info' | 'warn' | 'error';
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

  const refresh = useCallback(async () => {
    setState(await client.getState());
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /** Every mutation goes through here, so an error is never swallowed. */
  const run = useCallback(async (fn: () => Promise<string | null>) => {
    const error = await fn();
    setFeedback(error ? { tone: 'error', text: error } : null);
    await refresh();
  }, [refresh]);

  /**
   * For calls that may need the user to confirm an overwrite. Modelled separately from
   * an error so a destructive replace is never one indistinguishable failure among many.
   */
  const runConfirmable = useCallback(async (
    fn: (replace: boolean) => Promise<CallResult>,
    describeReplace: (site: string) => string,
  ) => {
    const first = await fn(false);
    if (first.kind === 'confirm-replace') {
      // eslint-disable-next-line no-alert -- a destructive overwrite must be confirmed,
      // and a popup has no room for a modal that would be better here.
      if (!globalThis.confirm(describeReplace(first.site))) return;
      const second = await fn(true);
      setFeedback(second.kind === 'error' ? { tone: 'error', text: second.message } : null);
    } else {
      setFeedback(first.kind === 'error' ? { tone: 'error', text: first.message } : null);
    }
    await refresh();
  }, [refresh]);

  return { state, feedback, setFeedback, refresh, run, runConfirmable };
}
