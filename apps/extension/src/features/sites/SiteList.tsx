import { useState } from 'react';
import { ACTION_HELP } from '@/ui/help';
import { Trash2 } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { WithHelp } from '@/ui/HelpCard';
import { shortSite } from '@/ui/format';
import { siteOf } from '@/core/personas';
import { coversAllSites, listedGrants } from '@/core/hostAccess';

/** How the every-website grant reads in the list, instead of Chrome's raw all-sites pattern. */
const ALL_WEBSITES_LABEL = 'All websites';

/**
 * Which origins may be isolated. Presentational: props in, events out.
 *
 * Lives on the options page in full; the popup only offers the one-click grant, because
 * a popup should act rather than teach.
 */
export interface SiteListProps {
  readonly allowedOrigins: readonly string[];
  readonly onRevoke: (pattern: string) => void;
  /** Grant an origin WITHOUT opening it or adding it to a persona — for a sign-in
   *  website a persona's site redirects through. Called straight from the submit, since
   *  Chrome needs the user gesture. */
  readonly onAllow: (origin: string) => void;
}

export function SiteList(props: SiteListProps) {
  return (
    <div className="space-y-2">
      <AllowSiteForm onAllow={props.onAllow} />
      <AllowedOrigins allowedOrigins={props.allowedOrigins} onRevoke={props.onRevoke} />
    </div>
  );
}

/**
 * "Allow a website" on its own, separate from "Add site". The user's words: "allowing a
 * website should be different from Add Site — that adds it as a tab; I want to allow these
 * sites, not add them to a tab". Accepts a full URL or a bare host; a bare host means https.
 */
function AllowSiteForm(props: { readonly onAllow: (origin: string) => void }) {
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const origin = trimmed ? siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) : null;
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!origin) return;
        props.onAllow(origin);
        setValue('');
      }}
    >
      <Input
        aria-label={ACTION_HELP.allowSiteOnly.label}
        value={value}
        placeholder="auth.example.com or https://auth.example.com"
        onChange={(e) => setValue(e.currentTarget.value)}
        className="flex-1 font-mono"
      />
      <WithHelp help={ACTION_HELP.allowSiteOnly} trigger={<Button size="xs" type="submit" disabled={!origin} />}>
        {ACTION_HELP.allowSiteOnly.label}
      </WithHelp>
    </form>
  );
}

function AllowedOrigins(props: { readonly allowedOrigins: readonly string[]; readonly onRevoke: (pattern: string) => void }) {
  if (props.allowedOrigins.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No websites allowed yet. Tabsona can only keep logins separate on websites you allow —
        go to one and press <span className="font-medium text-foreground">{ACTION_HELP.allowSite.label}</span> in
        the popup, or type it above.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {listedGrants(props.allowedOrigins).map((pattern) => (
        <li key={pattern} className="flex items-center gap-2 px-2 py-(--row-padding-y)">
          {coversAllSites([pattern])
            ? <span className="min-w-0 flex-1 truncate text-xs font-medium">{ALL_WEBSITES_LABEL}</span>
            : <span className="min-w-0 flex-1 truncate font-mono text-xs">{shortSite(pattern)}</span>}
          <Button size="icon-sm" variant="ghost" title={`Stop isolating ${coversAllSites([pattern]) ? ALL_WEBSITES_LABEL.toLowerCase() : pattern}`} onClick={() => props.onRevoke(pattern)}>
            <Trash2 />
          </Button>
        </li>
      ))}
    </ul>
  );
}
