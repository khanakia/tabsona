import { Globe } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import { WithHelp } from '@/ui/HelpCard';
import { HelpIcon } from '@/ui/SectionIntro';
import { ACTION_HELP, EXPLAIN } from '@/ui/help';

/**
 * "Allow on all sites": ONE Chrome prompt instead of one per website.
 *
 * WHY it exists: an app that signs in through other hosts (a WorkOS chain went through
 * four) needs every one of them allowed before a persona is separated end to end, and
 * allowing them one by one meant a prompt per host, discovered one hop at a time. The
 * manifest is unchanged: the all-sites pattern was always an OPTIONAL host permission, so nothing is
 * granted until the user clicks here and confirms Chrome's own prompt.
 *
 * Presentational: props in, events out. The host calls `chrome.permissions.request`
 * straight from `onAllow`, because Chrome rejects a request without a user gesture.
 */
export interface AllSitesProps {
  /** Live from Chrome (`permissions.contains`), never from a stored flag. */
  readonly allowed: boolean;
  readonly onAllow: () => void;
}

/**
 * The first-run question on the library page. Shown by the host only while every website
 * is not yet allowed and the user has not answered "I'll choose sites myself".
 */
export function AllSitesWelcome(props: AllSitesProps & {
  /** "I'll choose sites myself": stored as a setting so the question is not asked again. */
  readonly onDecline: () => void;
}) {
  if (props.allowed) return null;
  return (
    // Highlighted on purpose: it is the one choice that decides whether sign-in chains work
    // at all, and a muted card was easy to scroll past.
    <section
      aria-label={EXPLAIN.welcome.label}
      className="mb-4 rounded-lg border-2 border-blue-600 bg-blue-100 px-5 py-4 shadow-md ring-4 ring-blue-500/20 dark:border-blue-400 dark:bg-blue-900/50"
    >
      <h2 className="flex items-center gap-2 text-xl font-semibold">
        <Globe className="size-6 text-blue-600 dark:text-blue-400" />
        {EXPLAIN.welcome.label}
        <HelpIcon help={EXPLAIN.welcome} />
      </h2>
      <p className="mt-2 text-base text-foreground/85">{EXPLAIN.welcome.what}</p>
      <p className="mt-1.5 text-base text-muted-foreground">{EXPLAIN.welcome.touches}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <WithHelp help={ACTION_HELP.allowAllSites} trigger={<Button size="lg" className="h-11 px-5 text-base" onClick={props.onAllow} />}>
          {ACTION_HELP.allowAllSites.label}
        </WithHelp>
        <WithHelp help={ACTION_HELP.chooseSitesMyself} trigger={<Button size="lg" variant="outline" className="h-11 px-5 text-base" onClick={props.onDecline} />}>
          {ACTION_HELP.chooseSitesMyself.label}
        </WithHelp>
      </div>
    </section>
  );
}

/** The permanent Settings row: what is in force now, with Allow or Remove. */
export function AllSitesRow(props: AllSitesProps & { readonly onRemove: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{ACTION_HELP.allowAllSites.label}</p>
        <p className="text-xs text-muted-foreground">
          {props.allowed
            ? 'On: every website. A persona tab starts signed out on any website it visits, so no sign-in website needs allowing.'
            : 'Off: Tabsona works only on websites you allowed one by one.'}
        </p>
      </div>
      {props.allowed
        ? (
          <WithHelp help={ACTION_HELP.removeAllSites} trigger={<Button size="xs" variant="outline" onClick={props.onRemove} />}>
            {ACTION_HELP.removeAllSites.label}
          </WithHelp>
        )
        : (
          <WithHelp help={ACTION_HELP.allowAllSites} trigger={<Button size="xs" onClick={props.onAllow} />}>
            {ACTION_HELP.allowAllSites.label}
          </WithHelp>
        )}
    </div>
  );
}
