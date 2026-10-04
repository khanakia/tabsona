// ISOLATED-world content script: draws the in-page session chip and relays the
// shim's self-report to the background.
//
// In the isolated world on purpose — it needs chrome.runtime, and page code must not
// be able to find or remove the chip that tells the user what is isolated.

import { shimFactsFrom } from '@/core/coverage';
import type { ShimReadyNotice } from '@/domain/messages';

const CHIP_ID = '__tabsona_chip__';

/** Severity drives the colour, because "isolated" and "leaking" must not look alike. */
const SEVERITY_BACKGROUND = {
  covered: 'rgba(16,185,129,.92)',
  unknown: 'rgba(245,158,11,.92)',
  leaking: 'rgba(239,68,68,.95)',
  'not-applicable': 'rgba(82,82,91,.92)',
} as const satisfies Record<string, string>;

type Severity = keyof typeof SEVERITY_BACKGROUND;

interface BadgeMessage {
  readonly kind: 'badge:render' | 'badge:clear';
  readonly name?: string;
  readonly color?: string;
  readonly severity?: Severity;
  readonly summary?: string;
  readonly isEmpty?: boolean;
}

function clear(): void {
  document.getElementById(CHIP_ID)?.remove();
}

function render(msg: BadgeMessage): void {
  clear();
  if (!document.documentElement) return;

  const leaking = msg.severity === 'leaking';
  const el = document.createElement('div');
  el.id = CHIP_ID;
  // The session name is the identity; the rest is the honesty. A chip that only says
  // "admin" lets the user assume isolation it may not have — and, on a session with no
  // login saved yet, lets them read "signed out" as a broken button rather than the
  // intended first step.
  el.textContent = msg.isEmpty
    ? `${msg.name} · sign in to save`
    : leaking
      ? `${msg.name} · ${msg.summary}`
      : String(msg.name ?? '');
  el.title = msg.isEmpty
    ? `Tabsona — "${msg.name}" has no login saved yet. Sign in once and it will be remembered.`
    : `Tabsona — ${msg.summary ?? ''}`;
  Object.assign(el.style, {
    position: 'fixed', top: '8px', right: '8px', zIndex: '2147483647',
    background: msg.color ?? SEVERITY_BACKGROUND[msg.severity ?? 'unknown'],
    color: '#fff',
    font: '600 11px/1.5 ui-sans-serif,system-ui,sans-serif',
    padding: '2px 8px', borderRadius: '999px',
    boxShadow: `0 1px 4px rgba(0,0,0,.35), 0 0 0 2px ${SEVERITY_BACKGROUND[msg.severity ?? 'unknown']}`,
    pointerEvents: 'none', userSelect: 'none', letterSpacing: '.01em',
  } satisfies Partial<CSSStyleDeclaration>);
  document.documentElement.appendChild(el);
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as BadgeMessage;
  if (msg?.kind === 'badge:render') render(msg);
  else if (msg?.kind === 'badge:clear') clear();
});

// Relay the shim's report. The shim runs in the MAIN world and has no chrome.*, so
// postMessage is the only channel between them.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data: unknown = event.data;
  const ready = typeof data === 'object' && data !== null ? (data as { __tabsonaReady?: unknown }).__tabsonaReady : undefined;
  const origin = typeof ready === 'object' && ready !== null ? (ready as { origin?: unknown }).origin : undefined;
  if (typeof origin !== 'string') return;
  // A one-way notification, NOT part of the request/response surface: the worker
  // handles it in a separate listener and sends nothing back. Typed on its own so it
  // does not have to be squeezed into the Request union it has no business in.
  const notice: ShimReadyNotice = { op: 'shimReady', origin, ...shimFactsFrom(ready) };
  void chrome.runtime.sendMessage(notice).catch(() => undefined);
});
