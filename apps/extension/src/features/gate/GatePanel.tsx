import { ExternalLink, Globe, ShieldQuestion } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP } from '@/ui/help';
import { shortSite } from '@/ui/format';
import type { GateInfo } from '@/domain/messages';

/**
 * The question a persona tab asks in place when it was about to visit a website Tabsona
 * is not allowed on. Presentational: props in, events out.
 *
 * WHY it exists, in the user's words: "lets fix the borken or irititaitng flow". Before
 * the gate, a persona's sign-in passed through the provider with the browser's own login,
 * came back as the browser's user, was SAVED that way, and only then did an alert ask to
 * allow one host at a time. Now the tab stops first and asks here, in big readable words,
 * with the three ways out: allow and carry on, allow every website, or go there as
 * yourself in a normal tab.
 */
export interface GatePanelProps {
  readonly info: GateInfo;
  /** A message from the last attempt (Chrome declined, the tab moved on). */
  readonly error?: string | null;
  /** Ask Chrome for these origins, then continue. Must run straight from the click. */
  readonly onAllowAndContinue: (origins: readonly string[]) => void;
  /** Ask Chrome for every website once, then continue. Same click rule. */
  readonly onAllowAllSites: () => void;
  readonly onOpenNormally: () => void;
}

/** The headline and the one-sentence explanation, by why the tab was stopped. Exported
 *  so the wording is pinned by a test rather than re-read from the markup. */
export function gateWording(info: GateInfo): { readonly title: string; readonly body: string } {
  const host = shortSite(info.host);
  const site = shortSite(info.site);
  const others = info.hostsToAllow.filter((h) => h !== info.host);
  const consequence = `otherwise you’d arrive signed in as your normal browser login.`;
  // A form POST cannot be resent, so the way forward is different and says so first.
  const resend = info.viaForm
    ? ` This was a form being sent, which Tabsona can’t resend: after allowing it you’re taken back to the page, and you press the button again.`
    : '';
  if (info.reason === 'own-site') {
    return {
      title: `Tabsona is not allowed on ${host} yet`,
      body: `Allow Tabsona on ${host} so “${info.personaName}” gets its own login there — ${consequence}${resend}`,
    };
  }
  if (info.reason === 'sign-in') {
    const chain = others.length === 0
      ? `${site} signs you in through ${host}.`
      : `${site} signs you in through ${others.length + 1} websites: ${[info.host, ...others].map(shortSite).join(', ')}.`;
    return {
      title: `${site} signs you in through ${host}`,
      body: `${chain} Allow Tabsona on ${others.length === 0 ? host : 'them'} so “${info.personaName}” gets its own login there — ${consequence}${resend}`,
    };
  }
  return {
    title: `This tab is about to visit ${host}`,
    body: `Tabsona is not allowed on ${host}. Allow it so “${info.personaName}” gets its own login there — ${consequence} ${info.viaForm ? resend : 'Or open it in a normal tab, as yourself.'}`,
  };
}

export function GatePanel(props: GatePanelProps) {
  const { info } = props;
  const wording = gateWording(info);
  const count = info.hostsToAllow.length;
  const allowLabel = count > 1
    ? `Allow all ${count} and continue`
    : count === 1 ? ACTION_HELP.allowAndContinue.label : 'Continue';
  const goBackLabel = info.viaForm ? (count > 1 ? `Allow all ${count} and go back` : 'Allow and go back') : null;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 py-10 text-foreground">
      <p className="flex items-center gap-2 text-sm">
        <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: info.color }} />
        <span className="text-muted-foreground">Persona tab:</span>
        <span className="font-semibold">{info.personaName}</span>
        <span className="text-muted-foreground">· {shortSite(info.site)}</span>
      </p>

      <h1 className="flex items-start gap-2 text-2xl font-semibold leading-tight">
        <ShieldQuestion className="mt-1 size-6 shrink-0" style={{ color: 'var(--state-expired)' }} />
        <span className="min-w-0 break-words">{wording.title}</span>
      </h1>
      <p className="text-base leading-relaxed">{wording.body}</p>

      <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
        {info.url}
      </p>

      {props.error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {props.error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <WithHelp
          help={ACTION_HELP.allowAndContinue}
          trigger={<Button size="lg" onClick={() => props.onAllowAndContinue(info.hostsToAllow)} />}
        >
          {goBackLabel ?? allowLabel}
        </WithHelp>
        {/* A POST cannot be repeated as a plain visit, so the escape hatch would lie. */}
        {!info.viaForm && (
          <WithHelp
            help={ACTION_HELP.openNormally}
            trigger={<Button size="lg" variant="outline" onClick={props.onOpenNormally} />}
          >
            <ExternalLink />
            {ACTION_HELP.openNormally.label}
          </WithHelp>
        )}
        <WithHelp
          help={ACTION_HELP.allowAllSites}
          trigger={<Button size="lg" variant="ghost" onClick={props.onAllowAllSites} />}
        >
          <Globe />
          {ACTION_HELP.allowAllSites.label}
        </WithHelp>
      </div>

      <p className="text-sm text-muted-foreground">
        Nothing was sent to {shortSite(info.host)}: Tabsona stopped this tab before it left.
      </p>
    </main>
  );
}
