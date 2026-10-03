// Pure helpers for the Chrome Web Store client (`cws.mjs`).
//
// Why they live apart from the CLI: `cws.mjs` talks to Google and to the
// filesystem, so it cannot be unit-tested without a network. The decisions it
// makes — how `.env` is read and rewritten, which keys are missing, what an
// expired token looks like, when an upload is finished — are the parts that
// silently corrupt credentials or hang a release when wrong, and every one of
// them is a plain function of its inputs. They are tested in `lib-cws.test.mjs`.

/**
 * Upload states the Store reports for a package.
 *
 * `IN_PROGRESS` means poll again; every other value is final. `NOT_FOUND` is
 * final too — and, confusingly, is what the v1.1 API reports for an item whose
 * package was accepted earlier, because it describes the last upload JOB, not
 * whether a package exists. Never read it as "the item has no package".
 */
export const UPLOAD_IN_PROGRESS = 'IN_PROGRESS';
export const UPLOAD_SUCCESS = 'SUCCESS';
export const UPLOAD_DONE_STATES = new Set([UPLOAD_SUCCESS, 'FAILURE', 'NOT_FOUND']);

/** Google's error code for an expired or revoked refresh token. */
export const INVALID_GRANT = 'invalid_grant';

/**
 * Parse `KEY=value` lines from a `.env` text.
 *
 * Comments and blank lines are ignored; one layer of matching surrounding
 * quotes is stripped; everything else is kept verbatim, because OAuth secrets
 * legally contain `-`, `_`, `.` and `/` and must round-trip exactly.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const raw = m[2] ?? '';
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0];
    out[m[1] ?? ''] = quoted ? raw.slice(1, -1) : raw;
  }
  return out;
}

/**
 * Return `text` with `key` set to `value`, preserving every other line.
 *
 * Invariant: replaces the FIRST assignment of `key` in place, or appends one
 * line ending in a newline. It never touches other keys or comments — this runs
 * against the file holding the live Store credentials, and a writer that
 * reflowed it could drop the client secret while saving the refresh token.
 *
 * @param {string} text
 * @param {string} key
 * @param {string} value
 */
export function upsertEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=.*$`, 'm');
  if (pattern.test(text)) return text.replace(pattern, () => line);
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return `${base}${line}\n`;
}

/**
 * Names of the required keys that are absent or empty in `env`.
 *
 * @param {Record<string, string>} env
 * @param {readonly string[]} keys
 */
export function missingKeys(env, keys) {
  return keys.filter((k) => !env[k]);
}

/**
 * Turn a failed token-endpoint response into an actionable message.
 *
 * `invalid_grant` almost always means the refresh token expired — a Google
 * consent screen left in "Testing" mode issues tokens that die after seven days
 * — so the message names the one command that fixes it.
 *
 * @param {{ error?: string }} data parsed token-endpoint JSON
 * @param {number} status HTTP status
 */
export function tokenRefreshError(data, status) {
  const code = data.error ?? String(status);
  const hint = data.error === INVALID_GRANT
    ? ' — the refresh token expired or was revoked; run `task cws:auth`'
    : '';
  return `token refresh failed: ${code}${hint}`;
}

/**
 * Poll an upload until the Store reports a final state, and require success.
 *
 * Dependencies are injected so the loop is testable without a network or real
 * time: `getItem` fetches the item's current state, `sleep` waits between polls.
 *
 * @param {{ uploadState?: string, itemError?: unknown }} first the state returned by the upload call
 * @param {{ getItem: () => Promise<{ uploadState?: string, itemError?: unknown }>,
 *           sleep: (ms: number) => Promise<void>, intervalMs: number, maxPolls: number }} deps
 */
export async function settleUpload(first, { getItem, sleep, intervalMs, maxPolls }) {
  let item = first;
  for (let i = 0; !UPLOAD_DONE_STATES.has(item.uploadState ?? '') && i < maxPolls; i++) {
    await sleep(intervalMs);
    item = await getItem();
  }
  if (item.uploadState !== UPLOAD_SUCCESS) {
    throw new Error(`upload ${item.uploadState ?? 'unknown'}: ${JSON.stringify(item.itemError ?? item)}`);
  }
  return item;
}
