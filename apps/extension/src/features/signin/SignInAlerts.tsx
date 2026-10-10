import { CircleHelp, ShieldAlert } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP, SIGN_IN_NOT_SEPARATED } from '@/ui/help';
import { shortSite } from '@/ui/format';
import { allSignInHosts } from '@/core/signin';
import type { SignInAlert } from '@/domain/messages';

/**
 * Sign-in websites that still use the browser's own login. Presentational: props in,
 * events out.
 *
 * WHY two pieces: a user looked straight past the one warning row in the current-tab bar
 * ("it is hard to notice") and asked for an alert that stays put plus a section of its
 * own. The banner is the alarm, pinned to the top of the popup until nothing is left to
 * allow; the section is the worklist, every app with every host its sign-in went through.
 *
 * Every host is written out in full and wraps rather than truncating: the old row cut
 * "not separated" to "not sep…" with no way to read the rest.
 *
 * Allowing here ONLY grants Chrome access. It never opens a tab or adds a site to a
 * persona — the user asked for exactly that difference from "Add site".
 */
export interface SignInAlertsProps {
  /** From AppState.signInAlerts: never-empty host lists, across every open persona tab. */
  readonly alerts: readonly SignInAlert[];
  /** Ask Chrome for these origins in one dialog. Must run straight from the click. */
  readonly onAllow: (origins: readonly string[]) => void;
}

/** The banner's props: the alerts, plus the one-prompt alternative to allowing host by host. */
export interface SignInAlertBannerProps extends SignInAlertsProps {
  /**
   * "Allow on all sites" offered beside "Allow all N": one prompt that also covers every
   * later hop of the chain, which "Allow all N" cannot, since each hop is seen only once
   * the one before it is allowed. Optional so a surface that has nowhere sensible to put
   * it simply leaves the line out.
   */
  readonly onAllowAllSites?: () => void;
}

/** The pinned alarm. Renders nothing when there is nothing to allow. */
export function SignInAlertBanner(props: SignInAlertBannerProps) {
  const hosts = allSignInHosts(props.alerts);
  if (hosts.length === 0) return null;
  const apps = props.alerts.map((a) => shortSite(a.site)).join(', ');
  return (
    <div role="alert" className="flex flex-wrap items-start gap-1.5 border-b border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
      <ShieldAlert className="mt-px size-3.5 shrink-0" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-semibold">Sign-in not separated</span>
        {` on ${apps}: it goes through ${hosts.length === 1 ? 'a website' : `${hosts.length} websites`} Tabsona is not allowed on, so a persona can come back signed in as you.`}
      </p>
      <HelpIcon />
      <WithHelp
        help={ACTION_HELP.allowAllSignInSites}
        trigger={<Button size="xs" variant="destructive" onClick={() => props.onAllow(hosts)} />}
      >
        {hosts.length === 1 ? ACTION_HELP.allowSignInSite.label : `${ACTION_HELP.allowAllSignInSites.label} ${hosts.length}`}
      </WithHelp>
      {props.onAllowAllSites && <AllSitesSuggestion onAllow={props.onAllowAllSites} />}
    </div>
  );
}

/** One line under the alarm: allow every website once, so no sign-in host is ever asked about again. */
function AllSitesSuggestion(props: { readonly onAllow: () => void }) {
  return (
    <p className="flex w-full items-center gap-1.5 pl-5 text-foreground">
      <span className="min-w-0 flex-1">Or allow every website once, so no sign-in website needs allowing again.</span>
      <WithHelp help={ACTION_HELP.allowAllSites} trigger={<Button size="xs" variant="outline" onClick={props.onAllow} />}>
        {ACTION_HELP.allowAllSites.label}
      </WithHelp>
    </p>
  );
}

/** The section's props: the alerts, plus whether it starts folded away. */
export interface SignInSitesSectionProps extends SignInAlertsProps {
  /**
   * Fold the list behind a "Show the N websites" summary. The popup sets it: the red
   * banner above already carries "Allow all", and an unfolded list of a long chain pushed
   * every persona out of the popup's fixed height. The library page leaves it open.
   */
  readonly collapsible?: boolean;
}

/** The worklist: one block per app, one row per host, each with its own Allow. */
export function SignInSitesSection(props: SignInSitesSectionProps) {
  if (props.alerts.length === 0) return null;
  const hostCount = allSignInHosts(props.alerts).length;
  const body = (
    <div className={props.collapsible ? 'mt-1 max-h-48 overflow-y-auto' : undefined}>
      {props.alerts.map((alert) => (
        <div key={alert.site} className="mb-1.5 last:mb-0">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 break-words text-muted-foreground">
              <span className="font-medium text-foreground">{shortSite(alert.site)}</span> signs in through
              {' '}these websites, which still use your normal login:
            </p>
            {alert.hosts.length > 1 && (
              <WithHelp
                help={ACTION_HELP.allowAllSignInSites}
                trigger={<Button size="xs" className="shrink-0" onClick={() => props.onAllow(alert.hosts)} />}
              >
                {`${ACTION_HELP.allowAllSignInSites.label} ${alert.hosts.length}`}
              </WithHelp>
            )}
          </div>
          {/* The host gets the row's free width and the button stays a fixed short "Allow":
              a button labelled with the host itself squeezed a long host into a one-letter
              column. Hosts wrap at dots and hyphens like words, never letter by letter. */}
          <ul className="mt-1 divide-y divide-border/60 rounded border border-border/60 bg-background/60">
            {alert.hosts.map((host) => (
              <li key={host} className="flex items-center gap-2 px-2 py-1">
                <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">{shortSite(host)}</span>
                <WithHelp
                  help={ACTION_HELP.allowSignInSite}
                  trigger={(
                    <Button
                      size="xs"
                      variant="outline"
                      className="shrink-0"
                      aria-label={`${ACTION_HELP.allowSignInSite.label} ${shortSite(host)}`}
                      onClick={() => props.onAllow([host])}
                    />
                  )}
                >
                  {ACTION_HELP.allowSignInSite.label}
                </WithHelp>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
  return (
    <section aria-label="Sign-in websites to allow" className="shrink-0 border-b border-border bg-destructive/5 px-2 py-1.5 text-xs">
      {props.collapsible
        ? (
          <details>
            <summary className="flex cursor-pointer items-center gap-1 font-semibold">
              {`Show the ${hostCount === 1 ? 'website' : `${hostCount} websites`} to allow`}
              <HelpIcon />
            </summary>
            {body}
          </details>
        )
        : (
          <>
            <h2 className="mb-1 flex items-center gap-1 font-semibold">
              Sign-in websites to allow
              <HelpIcon />
            </h2>
            {body}
          </>
        )}
    </section>
  );
}

/** "What does not separated mean?" — the full explanation, on hover or keyboard focus. */
function HelpIcon() {
  return (
    <WithHelp
      help={SIGN_IN_NOT_SEPARATED}
      titled
      trigger={<button type="button" aria-label={SIGN_IN_NOT_SEPARATED.label} className="shrink-0 text-muted-foreground" />}
    >
      <CircleHelp className="size-3.5" />
    </WithHelp>
  );
}
