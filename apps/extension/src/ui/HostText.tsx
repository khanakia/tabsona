import { cn } from '@/lib/utils';

/**
 * How many trailing labels of a host stay visible when the line is cut: the registrable
 * domain ("franchisepartner.com", "authkit.app"). It is what tells two sites apart, while
 * the leading labels ("staging-app.", "independent-tea-80-staging.") are the part that
 * can go.
 */
export const HOST_TAIL_LABELS = 2;

/** Longest tail kept whole; beyond this the tail would eat the line it is meant to save. */
export const HOST_TAIL_MAX_CHARS = 24;

/**
 * Split a host into the head that may be cut and the tail that never is.
 *
 * Invariant: `head + tail === text`, always. A host with too few labels ("localhost:3000"),
 * or whose tail would exceed HOST_TAIL_MAX_CHARS, returns an empty tail and is cut
 * from the end like any other text.
 */
export function splitHostTail(text: string): { readonly head: string; readonly tail: string } {
  // Only the host part is split; a path ("/app") after it stays in the tail untouched.
  const hostEnd = text.search(/[/:?#]/);
  const host = hostEnd === -1 ? text : text.slice(0, hostEnd);
  const rest = hostEnd === -1 ? '' : text.slice(hostEnd);
  const labels = host.split('.');
  if (labels.length <= HOST_TAIL_LABELS) return { head: text, tail: '' };
  const tailHost = labels.slice(-HOST_TAIL_LABELS).join('.');
  const tail = tailHost + rest;
  if (tail.length > HOST_TAIL_MAX_CHARS) return { head: text, tail: '' };
  return { head: text.slice(0, text.length - tail.length), tail };
}

/**
 * A host that is cut in the MIDDLE ("staging-app.fran…partner.com") instead of at the end.
 *
 * Why: at the end, a long staging host loses exactly the part that identifies the site.
 * Presentational and measurement-free: two flex children, the head truncating and the
 * tail refusing to shrink. The accessible name is the whole text, so the split never
 * leaks into a screen reader or a text query: the whole text sits in an sr-only span and
 * the split halves are aria-hidden.
 */
export function HostText(props: { readonly text: string; readonly className?: string }) {
  const { head, tail } = splitHostTail(props.text);
  // Nothing to protect at the end: one plain truncating run, with no duplicate text.
  if (!tail) return <span className={cn('block min-w-0 truncate', props.className)}>{props.text}</span>;
  return (
    <span className={cn('flex min-w-0 max-w-full', props.className)}>
      <span className="sr-only">{props.text}</span>
      <span aria-hidden className="min-w-0 truncate">{head}</span>
      <span aria-hidden className="shrink-0">{tail}</span>
    </span>
  );
}
