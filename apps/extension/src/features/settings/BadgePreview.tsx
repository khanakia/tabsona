import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import {
  BADGE_DOT_SIZE_PX, BADGE_EDGE_OFFSET_PX, BADGE_FONT, BADGE_PADDING, SEVERITY_RING, badgeLabel, cornerEdges,
} from '@/core/badgeLook';
import type { Settings } from '@/domain/messages';

/** How long the preview's badge takes to fade when it auto-hides — matches the page badge. */
const PREVIEW_FADE_MS = 300;

/**
 * The badge in action, on a mock page, using the same look as the real one
 * (core/badgeLook.ts) and the current settings: corner, name or dot, auto-hide.
 *
 * Why: settings like "corner" and "hide after 5 seconds" are hard to judge from words;
 * seeing the badge sit in the corner and fade is the explanation. Click the preview badge
 * to shrink or grow it, exactly as on a page. Presentational: props in, nothing out.
 */
export function BadgePreview(props: {
  readonly settings: Pick<Settings, 'showPageBadge' | 'badgeStyle' | 'badgePosition' | 'autoHideBadge' | 'badgeHideSeconds'>;
  /** Whose badge to show — the user's own persona when there is one. */
  readonly sample: { readonly name: string; readonly color: string };
}) {
  const s = props.settings;
  const [collapsed, setCollapsed] = useState(s.badgeStyle === 'dot');
  const [hidden, setHidden] = useState(false);
  const [run, setRun] = useState(0);

  // A style change restarts the preview from that style, like a fresh page load would.
  useEffect(() => { setCollapsed(s.badgeStyle === 'dot'); }, [s.badgeStyle]);

  // Auto-hide plays out for real: visible for the chosen seconds, then gone. Each change
  // to the setting, or a Replay, starts it over.
  useEffect(() => {
    setHidden(false);
    if (!s.autoHideBadge) return undefined;
    const t = setTimeout(() => setHidden(true), s.badgeHideSeconds * 1000);
    return () => clearTimeout(t);
  }, [s.autoHideBadge, s.badgeHideSeconds, run]);

  const { vertical, horizontal } = cornerEdges(s.badgePosition);
  const ring = SEVERITY_RING.covered;

  return (
    <figure aria-label="Badge preview" className="space-y-1.5">
      <div className="relative h-36 w-full max-w-sm overflow-hidden rounded-md border border-border bg-background shadow-sm">
        {/* A mock page: a header bar and a few content lines, so the corner reads as a page. */}
        <div className="flex h-5 items-center gap-1 border-b border-border bg-muted/60 px-2">
          {[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-muted-foreground/30" />)}
          <span className="ml-2 h-2 w-24 rounded bg-muted-foreground/15" />
        </div>
        <div className="space-y-1.5 p-3">
          {['w-3/4', 'w-1/2', 'w-2/3', 'w-1/3'].map((w) => <div key={w} className={`h-2 rounded bg-muted-foreground/10 ${w}`} />)}
        </div>

        {s.showPageBadge && (
          <button
            type="button"
            aria-label={collapsed ? 'Preview badge, shrunk to a dot — click to show the name' : 'Preview badge — click to shrink it to a dot'}
            onClick={() => setCollapsed((c) => !c)}
            className="absolute flex items-center justify-center whitespace-nowrap text-white"
            style={{
              [vertical]: BADGE_EDGE_OFFSET_PX,
              [horizontal]: BADGE_EDGE_OFFSET_PX,
              background: props.sample.color,
              boxShadow: `0 1px 4px rgba(0,0,0,.35), 0 0 0 2px ${ring}`,
              font: BADGE_FONT,
              opacity: hidden ? 0 : 1,
              transition: `opacity ${PREVIEW_FADE_MS}ms`,
              ...(collapsed
                ? { width: BADGE_DOT_SIZE_PX, height: BADGE_DOT_SIZE_PX, borderRadius: '50%', padding: 0 }
                : { padding: BADGE_PADDING, borderRadius: 999 }),
            }}
          >
            {collapsed ? '' : badgeLabel({ name: props.sample.name })}
          </button>
        )}
        {!s.showPageBadge && (
          <p className="absolute inset-x-0 bottom-2 text-center text-[11px] text-muted-foreground">The badge is off.</p>
        )}
      </div>
      <figcaption className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>Live preview. Click the badge to shrink it, as on a page.</span>
        {s.showPageBadge && s.autoHideBadge && (
          <Button size="xs" variant="outline" onClick={() => setRun((n) => n + 1)}>
            <RotateCcw />
            Replay hide
          </Button>
        )}
      </figcaption>
    </figure>
  );
}
