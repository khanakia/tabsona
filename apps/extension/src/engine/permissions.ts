// Which origins the extension may actually touch, read from the LIVE permission set.
//
// Deliberately not the manifest's `host_permissions`: almost every origin is granted
// at runtime through the UI, so the manifest would under-report and the capture
// listener would never fire for the sites a user actually added.

/**
 * TRAP, paid for once: with optional host permissions, registering a webRequest
 * listener for `<all_urls>` logs a single host-permission warning and then NEVER FIRES
 * AT ALL. Listeners must be scoped to exactly what was granted, which is also why
 * `boot()` re-runs on `chrome.permissions.onAdded`.
 */
export async function grantedOriginPatterns(): Promise<string[]> {
  const granted = await chrome.permissions.getAll();
  return [...(granted.origins ?? [])];
}

/** `https://sync.localhost` -> `https://sync.localhost/*`, the shape Chrome wants. */
export function originPattern(origin: string): string {
  return `${origin.replace(/\/$/, '')}/*`;
}

/** Whether a site is covered by the current grants, blanket grants included. */
export async function isOriginAllowed(origin: string): Promise<boolean> {
  const granted = await grantedOriginPatterns();
  const wanted = originPattern(origin);
  return granted.some((g) => g === wanted || g === '*://*/*' || g === '<all_urls>');
}
