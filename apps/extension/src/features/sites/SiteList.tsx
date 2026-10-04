import { ACTION_HELP } from '@/ui/help';
import { Trash2 } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { shortSite } from '@/ui/format';

/**
 * Which origins may be isolated. Presentational: props in, events out.
 *
 * Lives on the options page in full; the popup only offers the one-click grant, because
 * a popup should act rather than teach.
 */
export interface SiteListProps {
  readonly allowedOrigins: readonly string[];
  readonly onRevoke: (pattern: string) => void;
}

export function SiteList(props: SiteListProps) {
  if (props.allowedOrigins.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No websites allowed yet. Tabsona can only keep logins separate on websites you allow —
        go to one and press <span className="font-medium text-foreground">{ACTION_HELP.allowSite.label}</span> in
        the popup.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {props.allowedOrigins.map((pattern) => (
        <li key={pattern} className="flex items-center gap-2 px-2 py-(--row-padding-y)">
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortSite(pattern)}</span>
          <Button size="icon-sm" variant="ghost" title={`Stop isolating ${pattern}`} onClick={() => props.onRevoke(pattern)}>
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}
