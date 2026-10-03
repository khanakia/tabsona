import {
  ArrowRight, Copy, Globe, LogOut, Plus, Save, ShieldAlert, ShieldCheck, ShieldQuestion, UserPlus,
} from 'lucide-react';
import { Button } from '@/ui/volt/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/ui/volt/dropdown-menu';
import { shortSite } from '@/ui/format';
import type { TabStatus } from '@/domain/messages';
import type { PersonaId, PersonaView } from '@/domain/types';

/**
 * The popup footer: what the current tab is, and the one action that fits it.
 *
 * This is where "I'm signed in on site1.com — save it" lives, the interaction v1 had no
 * path for. Presentational: props in, events out.
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
}

export function CurrentTabBar(props: CurrentTabBarProps) {
  const t = props.tab;

  // A chrome:// or about: page can hold no login, so offering anything would be a lie.
  if (!t.isWebPage) {
    return (
      <Bar>
        <Globe className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">Open a website to save or use a persona here.</span>
      </Bar>
    );
  }

  // Nothing can be isolated until Chrome has granted the origin.
  if (!t.siteAllowed) {
    return (
      <Bar>
        <ShieldQuestion className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{shortSite(t.site ?? '')}</span>
          <span className="text-muted-foreground"> is not allowed yet</span>
        </span>
        <Button size="xs" onClick={() => t.site && props.onAllowSite(t.site)}>Allow this site</Button>
      </Bar>
    );
  }

  // Already isolated: say which persona, how well, and offer only what fits.
  if (t.sessionId) {
    const leaking = t.coverage.some((c) => c.status === 'leaking');
    const Shield = leaking ? ShieldAlert : ShieldCheck;
    return (
      <Bar>
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: t.color ?? 'var(--muted-foreground)' }} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{t.personaName}</span>
          <span className="text-muted-foreground"> · {shortSite(t.site ?? '')}</span>
        </span>
        <span
          title={t.coverage.map((c) => `${c.layer}: ${c.detail}`).join('\n')}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium"
          style={{ color: t.isEmpty ? 'var(--state-empty)' : leaking ? 'var(--state-expired)' : 'var(--state-signed-in)' }}
        >
          <Shield className="size-3.5" />
          {t.isEmpty ? 'sign in to save' : t.summary}
        </span>
        {/* Offered right here because "I want another account on this site" occurs to
            people while they are looking at the first one. */}
        <SignInAsSomeoneElse
          site={t.site ?? ''}
          personas={props.personas}
          onAddToPersona={props.onAddToPersona}
          onAnotherLogin={props.onAnotherLogin}
          trigger={<Button size="icon-sm" variant="ghost" aria-label="Sign in as someone else here" onClick={() => undefined} />}
        />
        <Button size="icon-sm" variant="ghost" title="Save this tab's current state now" onClick={() => t.tabId !== null && props.onSaveNow(t.tabId)}>
          <Save />
        </Button>
        <Button size="icon-sm" variant="ghost" title="Return this tab to your normal browser login" onClick={() => t.tabId !== null && props.onUnbind(t.tabId)}>
          <LogOut />
        </Button>
      </Bar>
    );
  }

  // The headline case: an ordinary tab you are signed into, waiting to be filed.
  return (
    <Bar>
      <Globe className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{shortSite(t.site ?? '')}</span>
        <span className="text-muted-foreground"> · not isolated</span>
      </span>
      <SignInAsSomeoneElse
        site={t.site ?? ''}
        personas={props.personas}
        onAddToPersona={props.onAddToPersona}
        onAnotherLogin={props.onAnotherLogin}
        trigger={<Button size="icon-sm" variant="ghost" aria-label="Sign in as someone else here" onClick={() => undefined} />}
      />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="xs" onClick={() => undefined} />}>
          <Save />
          Use this tab
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-[20rem]">
          {/* Blank session FIRST: it is the normal way to build a persona, and the only
              option that leaves the browser's own login — and every other plain tab
              using it — completely alone. */}
          <DropdownMenuLabel>Sign in fresh, in…</DropdownMenuLabel>
          {props.personas.map((p) => (
            <DropdownMenuItem key={`fresh-${p.id}`} onClick={() => props.onUseTabIn(p.id)}>
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
              {p.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => props.onNewPersonaWithTab()}>
            <Plus />
            New persona from this login
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Move the login I am using into…</DropdownMenuLabel>
          {props.personas.map((p) => (
            <DropdownMenuItem key={`move-${p.id}`} onClick={() => props.onSaveTo(p.id, 'move')}>
              <ArrowRight />
              {p.name}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Copy it into… (stay signed in here too)</DropdownMenuLabel>
          {props.personas.map((p) => (
            <DropdownMenuItem key={`copy-${p.id}`} onClick={() => props.onSaveTo(p.id, 'copy')}>
              <Copy />
              {p.name}
            </DropdownMenuItem>
          ))}
          <p className="px-2 py-1 text-[10px] leading-snug text-muted-foreground">
            A copy shares one server session — signing out in either place ends both.
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </Bar>
  );
}

/**
 * "Sign in as someone else here" — offered against EVERY persona that does not already
 * hold this site, plus a brand-new one.
 *
 * Without this the only path was: create a persona, navigate a tab to the right site,
 * hover its row and press a hidden `+`. The capability existed; the path did not.
 *
 * Personas that already hold the site are omitted rather than shown disabled: the model
 * is one login per site per persona, so there is nothing for them to do here.
 */
function SignInAsSomeoneElse(props: {
  readonly site: string;
  readonly personas: readonly PersonaView[];
  readonly onAddToPersona: (personaId: PersonaId, site: string) => void;
  readonly onAnotherLogin: (site: string) => void;
  readonly trigger: React.ReactElement;
}) {
  const available = props.personas.filter((p) => !p.sessions.some((s) => s.site === props.site));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={props.trigger}>
        <UserPlus />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Sign in as someone else here</DropdownMenuLabel>
        {available.map((p) => (
          <DropdownMenuItem key={p.id} onClick={() => props.onAddToPersona(p.id, props.site)}>
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            {p.name}
          </DropdownMenuItem>
        ))}
        {available.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => props.onAnotherLogin(props.site)}>
          <UserPlus />
          In a new persona
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Bar(props: { readonly children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-t border-border bg-muted/50 px-2 py-1.5 text-xs">
      {props.children}
    </div>
  );
}
