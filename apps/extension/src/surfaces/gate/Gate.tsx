// The gate page: where a persona tab lands when the gate stopped it on its way to a
// website Tabsona is not allowed on (core/gate.ts). Thin by design — it reads the tab id
// from its own url, asks the worker for the rest, and delegates every pixel to GatePanel.

import { useCallback, useEffect, useState } from 'react';
import { client } from '@/app/client';
import { GatePanel } from '@/features/gate';
import { GATE_TAB_PARAM } from '@/core/constants';
import type { GateInfo } from '@/domain/messages';

/** The stopped tab's id, from `?tab=`. Only an id travels in the url: the worker holds the
 *  record, so a crafted link cannot make this page navigate anywhere it did not stop. */
function tabIdFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get(GATE_TAB_PARAM);
  const id = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

export function Gate() {
  const tabId = tabIdFromUrl();
  const [info, setInfo] = useState<GateInfo | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setInfo(tabId === null ? null : await client.gateInfo(tabId));
  }, [tabId]);
  useEffect(() => { void load(); }, [load]);

  if (info === undefined) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (info === null || tabId === null) {
    return (
      <p className="mx-auto max-w-xl px-4 py-10 text-base">
        Nothing is waiting in this tab any more. Use the browser’s Back button to return.
      </p>
    );
  }

  const carryOn = async (granted: boolean, declined: string) => {
    if (!granted) { setError(declined); return; }
    const err = await client.gateContinue(tabId);
    if (err) { setError(err); await load(); }
  };

  return (
    <GatePanel
      info={info}
      error={error}
      // Straight from the click: Chrome rejects permissions.request without a gesture.
      onAllowAndContinue={(origins) => void client.grantOrigins(origins)
        .then((ok) => carryOn(ok, 'Chrome did not allow it, so this tab stayed here. Nothing was sent.'))}
      onAllowAllSites={() => void client.grantAllSites()
        .then((ok) => carryOn(ok, 'Chrome did not allow every website, so this tab stayed here. Nothing was sent.'))}
      onOpenNormally={() => void client.gateOpenNormally(tabId).then((err) => { if (err) setError(err); })}
    />
  );
}
