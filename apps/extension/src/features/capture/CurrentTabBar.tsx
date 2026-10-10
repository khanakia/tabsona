import { useState } from 'react';
import {
  ArrowLeft, ArrowRight, ChevronDown, Copy, Globe, KeyRound, LogIn, Plus, Save, ShieldAlert, ShieldCheck,
  ShieldQuestion, Unlink, UserPlus, UserRoundPlus,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/ui/volt/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/ui/volt/dropdown-menu';
import { ActionMenuItem, WithHelp } from '@/ui/HelpCard';
import { ACTION_HELP, SIGN_IN_LEAKED, SIGN_IN_NOT_SEPARATED, isolationHelp, type ActionHelp } from '@/ui/help';
import { shortSite } from '@/ui/format';
import { FullText } from '@/ui/FullText';
import type { TabStatus } from '@/domain/messages';
import type { PersonaId, PersonaView, SessionId } from '@/domain/types';

/**
 * The popup footer: what the current tab is, and what you can do with it.
 *
 * Every control carries a visible word, not just an icon, and every choice says what it
 * does to the user's normal browser login — the question a user reported every icon
 * left unanswered. Wording lives in `ui/help.ts`. Presentational: props in, events out.
 */
export interface CurrentTabBarProps {
  readonly tab: TabStatus;
  readonly personas: readonly PersonaView[];
  /** Import the login this tab is using. `move` takes it out of the browser; `copy`
   *  leaves the browser signed in too. The user picks; we do not decide for them. */
  readonly onSaveTo: (personaId: PersonaId, mode: 'move' | 'copy') => void;
  /** Put THIS tab into a persona with a BLANK session — nothing imported, the browser's
   *  own login untouched. The normal way to build a persona from a tab you are on. */
  readonly onUseTabIn: (personaId: PersonaId) => void;
  readonly onAllowSite: (origin: string) => void;
  readonly onUnbind: (tabId: number) => void;
  readonly onSaveNow: (tabId: number) => void;
  readonly onNewPersonaWithTab: () => void;
  readonly onAnotherLogin: (site: string) => void;
  /** Give an EXISTING persona a fresh, signed-out session for this site. The missing
   *  half of "in group 2 I want a new session for site1.com". */
  readonly onAddToPersona: (personaId: PersonaId, site: string) => void;
  /** Clear a leaked sign-in (TabStatus.leakedSignInSites) and sign in again, through the
   *  gate. Offered only on a tab whose session leaked. */
  readonly onStartOver: (sessionId: SessionId) => void;
}

export function CurrentTabBar(props: CurrentTabBarProps) {
  const t = props.tab;
  const [joining, setJoining] = useState(false);

  // A chrome:// or about: page can hold no login, so offering anything would be a lie.
  if (!t.isWebPage) {
    return (
      <Bar>
        <Row>
          <Globe className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Go to a website to add it to a persona.</span>
        </Row>
      </Bar>
    );
  }

  // Nothing can be separated until Chrome has granted the origin.
  if (!t.siteAllowed) {
    return (
      <Bar>
        <Row>
          <ShieldQuestion className="size-3.5 shrink-0 text-muted-foreground" />
          {/* The host gets the width; "not allowed here yet" is a hover card, and the button
              says only "Allow" with the full meaning in its tooltip and aria-label. */}
          <FullText
            line={<span className="min-w-0 flex-1 truncate" />}
            full={(
              <>
                <span className="block break-all font-semibold">{t.site}</span>
                <span className="block text-muted-foreground">Tabsona is not allowed on this website yet.</span>
              </>
            )}
          >
            <span className="font-medium">{shortSite(t.site ?? '')}</span>
            <span className="text-muted-foreground"> · not allowed</span>
          </FullText>
          <WithHelp
            help={ACTION_HELP.allowSite}
            trigger={(
              <Button
                size="xs"
                aria-label={`${ACTION_HELP.allowSite.label}: ${shortSite(t.site ?? '')}`}
                onClick={() => t.site && props.onAllowSite(t.site)}
              />
            )}
          >
            Allow
          </WithHelp>
        </Row>
      </Bar>
    );
  }

  // In a persona: say which one, whether it is really separate, and offer what fits.
  if (t.sessionId) {
    const leakingLayers = t.coverage.filter((c) => c.status === 'leaking').map((c) => c.layer);
    const status = isolationHelp({ isEmpty: t.isEmpty, leakingLayers, usesNormalLogin: t.usesNormalLogin });
    // A chosen share is neither the green "separate" nor a warning: the key and a neutral
    // colour say "your normal login, by your choice".
    const Shield = t.usesNormalLogin ? KeyRound : leakingLayers.length > 0 ? ShieldAlert : ShieldCheck;
    const color = t.usesNormalLogin
      ? 'var(--muted-foreground)'
      : t.isEmpty ? 'var(--state-empty)' : leakingLayers.length > 0 ? 'var(--state-expired)' : 'var(--state-signed-in)';
    return (
      <Bar>
        <Row>
          <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: t.color ?? 'var(--muted-foreground)' }} />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted-foreground">This tab: </span>
            <span className="font-medium">{t.personaName}</span>
            <span className="text-muted-foreground"> · {shortSite(t.site ?? '')}</span>
          </span>
          <WithHelp
            help={status}
            titled
            trigger={(
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-1 rounded text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ color }}
              />
            )}
          >
            <Shield className="size-3.5" />
            {status.label}
          </WithHelp>
        </Row>
        {/* One row per sign-in website Tabsona may not touch: the leak that made a fresh
            persona tab arrive signed in as the browser's user. Allowing it is the fix,
            so the button sits next to the warning rather than in the library. */}
        {t.unguardedSignInSites.map((origin) => (
          <Row key={origin}>
            <ShieldAlert className="size-3.5 shrink-0" style={{ color: 'var(--state-expired)' }} />
            {/* Wraps instead of truncating — it was cut to "not sep…" — and explains
                itself on hover or focus, because "not separated" alone said nothing. */}
            <WithHelp
              help={SIGN_IN_NOT_SEPARATED}
              titled
              trigger={<span tabIndex={0} className="min-w-0 flex-1 break-words" />}
            >
              <span className="text-muted-foreground">Signs in through </span>
              <span className="font-medium">{shortSite(origin)}</span>
              <span className="text-muted-foreground"> · not separated</span>
            </WithHelp>
            <WithHelp
              help={ACTION_HELP.allowSignInSite}
              trigger={<Button size="xs" onClick={() => props.onAllowSite(origin)} />}
            >
              {`${ACTION_HELP.allowSignInSite.label} ${shortSite(origin)}`}
            </WithHelp>
          </Row>
        ))}
        {/* A sign-in that already went through an unguarded website. Its login was NOT
            saved (engine/capture.ts); starting over is the way back, so it sits here. */}
        {t.leakedSignInSites.length > 0 && (
          <Row>
            <ShieldAlert className="size-3.5 shrink-0" style={{ color: 'var(--state-expired)' }} />
            <WithHelp
              help={SIGN_IN_LEAKED}
              titled
              trigger={<span tabIndex={0} className="min-w-0 flex-1 break-words" />}
            >
              <span className="font-medium">{SIGN_IN_LEAKED.label}</span>
              <span className="text-muted-foreground">
                {` (${t.leakedSignInSites.map(shortSite).join(', ')}) · login not saved`}
              </span>
            </WithHelp>
            <WithHelp
              help={ACTION_HELP.startOver}
              trigger={<Button size="xs" variant="destructive" onClick={() => t.sessionId && props.onStartOver(t.sessionId)} />}
            >
              {ACTION_HELP.startOver.label}
            </WithHelp>
          </Row>
        )}
        <Row>
          {/* Offered right here because "I want another account on this site" occurs to
              people while they are looking at the first one. */}
          <AnotherAccountMenu
            site={t.site ?? ''}
            personas={props.personas}
            onAddToPersona={props.onAddToPersona}
            onAnotherLogin={props.onAnotherLogin}
          />
          <span className="flex-1" />
          <WithHelp
            help={ACTION_HELP.saveNow}
            trigger={<Button size="xs" variant="ghost" onClick={() => t.tabId !== null && props.onSaveNow(t.tabId)} />}
          >
            <Save />
            {ACTION_HELP.saveNow.label}
          </WithHelp>
          <WithHelp
            help={ACTION_HELP.leavePersona}
            trigger={<Button size="xs" variant="ghost" onClick={() => t.tabId !== null && props.onUnbind(t.tabId)} />}
          >
            <Unlink />
            {ACTION_HELP.leavePersona.label}
          </WithHelp>
        </Row>
      </Bar>
    );
  }

  // The headline case: an ordinary tab, waiting to be put into a persona.
  return (
    <Bar>
      <Row>
        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">This tab: </span>
          <span className="font-medium">{shortSite(t.site ?? '')}</span>
          <span className="text-muted-foreground"> · your normal login, not in a persona</span>
        </span>
      </Row>
      {joining
        ? (
          <JoinPersonaPanel
            personas={props.personas}
            onUseTabIn={props.onUseTabIn}
            onSaveTo={props.onSaveTo}
            onNewPersonaWithTab={props.onNewPersonaWithTab}
            onClose={() => setJoining(false)}
          />
        )
        : (
          <Row>
            <WithHelp
              help={ACTION_HELP.addToPersona}
              trigger={<Button size="xs" onClick={() => setJoining(true)} />}
            >
              <UserRoundPlus />
              {ACTION_HELP.addToPersona.label}
            </WithHelp>
            <AnotherAccountMenu
              site={t.site ?? ''}
              personas={props.personas}
              onAddToPersona={props.onAddToPersona}
              onAnotherLogin={props.onAnotherLogin}
            />
          </Row>
        )}
    </Bar>
  );
}

/** The three ways a plain tab can join a persona, in the order they are offered. */
type JoinMode = 'fresh' | 'move' | 'copy';

const JOIN_MODES: readonly {
  readonly mode: JoinMode;
  readonly help: ActionHelp;
  readonly Icon: LucideIcon;
  /** The second question, once this way is chosen. */
  readonly question: string;
}[] = [
  // Signed out FIRST: the normal way to build a persona, and the only choice that leaves
  // the browser's own login — and every plain tab using it — completely alone.
  { mode: 'fresh', help: ACTION_HELP.useTabSignedOut, Icon: LogIn, question: 'Use this tab in which persona?' },
  { mode: 'move', help: ACTION_HELP.moveLogin, Icon: ArrowRight, question: 'Move your login into which persona?' },
  { mode: 'copy', help: ACTION_HELP.copyLogin, Icon: Copy, question: 'Copy your login into which persona?' },
];

/**
 * Putting a plain tab into a persona, as two plain questions: how, then which persona.
 *
 * Inline in the footer rather than a dropdown. The dropdown had to list every persona
 * three times with an explanation above each group, which made it taller than a small
 * popup and pushed the difference between "move" and "copy" off screen. Asking "how"
 * first means the consequence is read before any persona name is clickable, and the
 * panel grows the popup instead of floating over it.
 */
function JoinPersonaPanel(props: {
  readonly personas: readonly PersonaView[];
  readonly onUseTabIn: (personaId: PersonaId) => void;
  readonly onSaveTo: (personaId: PersonaId, mode: 'move' | 'copy') => void;
  readonly onNewPersonaWithTab: () => void;
  readonly onClose: () => void;
}) {
  const [mode, setMode] = useState<JoinMode | null>(null);
  const chosen = JOIN_MODES.find((m) => m.mode === mode);

  const pick = (personaId: PersonaId) => {
    if (mode === 'fresh') props.onUseTabIn(personaId);
    else if (mode === 'move' || mode === 'copy') props.onSaveTo(personaId, mode);
    props.onClose();
  };

  return (
    <section aria-label={ACTION_HELP.addToPersona.label} className="space-y-1.5 rounded-md border border-border bg-background p-2">
      <div className="flex items-center gap-1.5">
        {chosen && (
          <button
            type="button"
            aria-label="Back"
            onClick={() => setMode(null)}
            className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-3.5" />
          </button>
        )}
        <p className="flex-1 font-medium">
          {chosen ? chosen.question : 'How should this tab join a persona?'}
        </p>
        <Button size="xs" variant="ghost" onClick={props.onClose}>Cancel</Button>
      </div>

      {!chosen && JOIN_MODES.map(({ mode: m, help, Icon }) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          className="flex w-full items-start gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 space-y-0.5">
            <span className="block font-medium">{help.label}</span>
            <span className="block text-[11px] leading-snug text-muted-foreground">{help.what} {help.touches}</span>
            {help.gotcha && <span className="block text-[11px] leading-snug text-(--caution)">{help.gotcha}</span>}
          </span>
        </button>
      ))}

      {chosen && (
        <div className="space-y-1">
          {props.personas.length === 0 && (
            <p className="text-muted-foreground">You have no personas yet. Press + at the top to make one.</p>
          )}
          {props.personas.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <PersonaDot color={p.color} />
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {p.sessions.length} website{p.sessions.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
          {mode === 'move' && (
            <button
              type="button"
              onClick={() => { props.onNewPersonaWithTab(); props.onClose(); }}
              className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block font-medium">{ACTION_HELP.newPersonaFromLogin.label}</span>
                <span className="block text-[11px] leading-snug text-muted-foreground">{ACTION_HELP.newPersonaFromLogin.what}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * "Another account" — a fresh, signed-out tab for this site, in an existing persona that
 * does not hold it yet, or in a brand-new one.
 *
 * Personas that already hold the site are omitted rather than shown disabled: the model
 * is one login per site per persona, so there is nothing for them to do here.
 */
function AnotherAccountMenu(props: {
  readonly site: string;
  readonly personas: readonly PersonaView[];
  readonly onAddToPersona: (personaId: PersonaId, site: string) => void;
  readonly onAnotherLogin: (site: string) => void;
}) {
  const available = props.personas.filter((p) => !p.sessions.some((s) => s.site === props.site));
  return (
    <DropdownMenu>
      <WithHelp
        help={ACTION_HELP.anotherAccountHere}
        trigger={<DropdownMenuTrigger render={<Button size="xs" variant="outline" onClick={() => undefined} />} />}
      >
        <UserPlus />
        {ACTION_HELP.anotherAccountHere.label}
        <ChevronDown />
      </WithHelp>
      <DropdownMenuContent align="start" className="w-[20rem] max-w-[calc(100vw-1rem)]">
        <DropdownMenuLabel>{ACTION_HELP.anotherAccountHere.what}</DropdownMenuLabel>
        {available.map((p) => (
          <ActionMenuItem
            key={p.id}
            compact
            help={ACTION_HELP.addSiteToPersona}
            icon={<PersonaDot color={p.color} />}
            label={`${ACTION_HELP.addSiteToPersona.label} ${p.name}`}
            onClick={() => props.onAddToPersona(p.id, props.site)}
          />
        ))}
        {available.length > 0 && <DropdownMenuSeparator />}
        <ActionMenuItem
          help={ACTION_HELP.anotherAccountNewPersona}
          icon={<Plus />}
          onClick={() => props.onAnotherLogin(props.site)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PersonaDot({ color }: { readonly color: string }) {
  return <span className="size-2.5 rounded-[3px]" style={{ background: color }} />;
}

function Bar(props: { readonly children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-border bg-muted/50 px-2 py-1.5 text-xs">
      {props.children}
    </div>
  );
}

function Row(props: { readonly children: React.ReactNode }) {
  return <div className="flex min-w-0 items-center gap-1.5">{props.children}</div>;
}
