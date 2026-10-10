// ISOLATED-world content script, at document_start in EVERY frame: carries the shim's
// cookie traffic to the worker, and tells the worker when a form is POSTed.
//
// The shim runs in the page's MAIN world, which has no chrome.runtime, and it can write a
// cookie before the badge script (document_idle, top frame only) even exists. So this is
// its own script: early enough that no write is posted into a void, and in every frame,
// because a sign-in provider's cookie check often runs in an iframe.

import { MSG_COOKIE_ACK, MSG_COOKIE_SETTLE, MSG_COOKIE_WRITE } from '@/core/constants';
import type { FormSubmitNotice } from '@/domain/messages';

/** A shim message validated down to the request it stands for, or null when it is not one. */
function requestFor(box: Record<string, unknown>):
  | { readonly id: number; readonly request: { readonly op: 'cookieWrite'; readonly url: string; readonly line: string } | { readonly op: 'cookieSettle' } | null }
  | null {
  const write = box[MSG_COOKIE_WRITE] as { id?: unknown; url?: unknown; line?: unknown } | undefined;
  const settle = box[MSG_COOKIE_SETTLE] as { id?: unknown } | undefined;
  if (write && typeof write.id === 'number') {
    const valid = typeof write.url === 'string' && typeof write.line === 'string';
    return { id: write.id, request: valid ? { op: 'cookieWrite', url: String(write.url), line: String(write.line) } : null };
  }
  if (settle && typeof settle.id === 'number') return { id: settle.id, request: { op: 'cookieSettle' } };
  return null;
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const box = typeof event.data === 'object' && event.data !== null ? (event.data as Record<string, unknown>) : null;
  const found = box ? requestFor(box) : null;
  if (!found) return;
  // The ack is sent whether or not the worker answered: the shim must never hold a page's
  // network on a worker that is gone. A refused write simply is not stored.
  const ack = () => window.postMessage({ [MSG_COOKIE_ACK]: { id: found.id } }, location.origin);
  if (!found.request) { ack(); return; }
  void chrome.runtime.sendMessage(found.request).then(ack, ack);
});

// A form POST the gate may have to stop. Here, not in the badge script, because a form can
// be submitted before the badge (document_idle) exists, and from a frame the badge skips. Capture phase, so a page handler that stops
// propagation cannot hide it; the submitter's own `formAction` / `formMethod` win over the
// form's, as they do for the browser. Programmatic `form.submit()` fires no event and is
// not seen (docs/limits.md): such a stop is resumed as a plain navigation.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const submitter = event instanceof SubmitEvent ? event.submitter : null;
  const button = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null;
  const notice: FormSubmitNotice = {
    op: 'formSubmit',
    origin: location.origin,
    // `hasAttribute`, not the IDL value: `button.formMethod` reports "get" for a button with
    // no `formmethod` attribute even when its form POSTs, which hid every POST.
    action: button?.hasAttribute('formaction') ? button.formAction : form.action,
    method: (button?.hasAttribute('formmethod') ? button.formMethod : form.method).toLowerCase(),
  };
  void chrome.runtime.sendMessage(notice).catch(() => undefined);
}, true);

