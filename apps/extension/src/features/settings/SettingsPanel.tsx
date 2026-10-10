import { useEffect, useState } from 'react';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { Switch } from '@/ui/volt/switch';
import { BadgePreview } from './BadgePreview';
import { AllSitesRow } from './AllSites';
import { NormalLogin } from './NormalLogin';
import { SettingsNav } from './SettingsNav';
import { HelpIcon } from '@/ui/SectionIntro';
import { EXPLAIN, type ActionHelp } from '@/ui/help';
import {
  BADGE_CORNERS, BADGE_HIDE_SECONDS_MAX, BADGE_HIDE_SECONDS_MIN, BADGE_STYLES, SETTINGS_GROUPS,
  type BadgeCorner, type BadgeStyle, type Settings, type SettingsGroup, type SettingsPatch,
} from '@/domain/messages';

/**
 * Every setting, grouped by what it affects: which websites Tabsona may work on, the badge
 * on pages, page titles, tabs.
 *
 * Its own tab in the library (reached from the popup's gear) because settings used to sit
 * at the bottom of "Sites", where nobody looked for them. Presentational: shows
 * `settings` and reports each change as a patch; the host validates and stores it.
 */
export interface SettingsPanelProps {
  readonly settings: Settings;
  readonly onChange: (patch: SettingsPatch) => void;
  /** Drop every per-site dragged badge position. */
  readonly onForgetDragged: () => void;
  /** Whose badge the live preview shows — the user's first persona when there is one. */
  readonly sample: { readonly name: string; readonly color: string };
  /** "Allow on all sites", read live from Chrome by the host. */
  readonly allSitesAllowed: boolean;
  /** Ask Chrome for every website. Must run straight from the click (user gesture). */
  readonly onAllowAllSites: () => void;
  readonly onRemoveAllSites: () => void;
  /** The "use my normal login" list, from AppState.passThroughHosts. */
  readonly passThroughHosts: readonly string[];
  readonly onAddPassThrough: (hosts: readonly string[]) => void;
  readonly onRemovePassThrough: (host: string) => void;
  /** Scroll to this card when it changes to a value (a deep link, `#settings/badge`). */
  readonly focusGroup?: SettingsGroup | null;
  /** A nav click: the host mirrors it into the URL hash. */
  readonly onGroupSelect?: (group: SettingsGroup) => void;
}

/** Which ⓘ help each card carries; its label is also the card's title and its nav entry. */
const GROUP_HELP: Readonly<Record<SettingsGroup, ActionHelp>> = {
  websites: EXPLAIN.settingsSites,
  'normal-login': EXPLAIN.settingsNormalLogin,
  badge: EXPLAIN.settingsBadge,
  titles: EXPLAIN.settingsTitles,
  tabs: EXPLAIN.settingsTabs,
};

/** One line under each card title; the full explanation stays behind the ⓘ. */
const GROUP_BLURB: Readonly<Record<SettingsGroup, string>> = {
  websites: 'Where Tabsona may work: every website with one Chrome prompt, or only the ones you allow.',
  'normal-login': 'Websites a persona tab reaches with your browser’s own login. Nothing is on the list until you add it.',
  badge: 'The label on every persona tab: where it sits, how it looks, when it hides.',
  titles: 'Show whose tab is whose in the tab strip.',
  tabs: 'How a persona’s tabs are arranged in Chrome.',
};

/** DOM id of a card, for scrolling to it and watching it. */
const cardId = (g: SettingsGroup): string => `settings-${g}`;

/**
 * A card counts as "current" while it crosses a band near the top of the viewport: the top
 * 10% is ignored (sticky chips), and the bottom 70% is ignored so the card that has
 * scrolled up to the reading line wins rather than the one just entering below.
 */
const SPY_ROOT_MARGIN = '-10% 0px -70% 0px';

/** How close to the page end counts as "at the bottom" (sub-pixel scroll rounding). */
const BOTTOM_SLACK_PX = 4;

/** Human names for each corner. */
const CORNER_LABEL: Record<BadgeCorner, string> = {
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
  'top-left': 'Top left',
  'top-right': 'Top right',
};

/** Human names for each badge style. */
const STYLE_LABEL: Record<BadgeStyle, string> = {
  label: 'Name',
  dot: 'Dot only',
};

export function SettingsPanel(props: SettingsPanelProps) {
  const s = props.settings;
  const [active, setActive] = useState<SettingsGroup>(props.focusGroup ?? SETTINGS_GROUPS[0] ?? 'websites');
  const { focusGroup } = props;

  // Scroll spy: highlight the card nearest the top while the page scrolls. Without
  // IntersectionObserver (old browsers, jsdom) the highlight just follows clicks.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const visible = new Set<SettingsGroup>();
    const pageEnded = () => window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - BOTTOM_SLACK_PX;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const group = SETTINGS_GROUPS.find((g) => cardId(g) === e.target.id);
        if (group === undefined) continue;
        if (e.isIntersecting) visible.add(group); else visible.delete(group);
      }
      const first = SETTINGS_GROUPS.find((g) => visible.has(g));
      if (first !== undefined && !pageEnded()) setActive(first);
    }, { rootMargin: SPY_ROOT_MARGIN });
    for (const g of SETTINGS_GROUPS) {
      const el = document.getElementById(cardId(g));
      if (el) observer.observe(el);
    }
    // The last cards can never scroll up to the reading line when the page ends first, so
    // reaching the bottom of the page selects the last card.
    const atBottom = () => {
      const last = SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1];
      if (last !== undefined && pageEnded()) setActive(last);
    };
    window.addEventListener('scroll', atBottom, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', atBottom);
    };
  }, []);

  const scrollTo = (group: SettingsGroup) => {
    setActive(group);
    const el = document.getElementById(cardId(group));
    // jsdom (and very old engines) have no scrollIntoView; the highlight still moves.
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // A deep link (or a hash change while the page is open) scrolls to its card.
  useEffect(() => {
    if (focusGroup) scrollTo(focusGroup);
  }, [focusGroup]);

  const select = (group: SettingsGroup) => {
    scrollTo(group);
    props.onGroupSelect?.(group);
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
      <SettingsNav
        items={SETTINGS_GROUPS.map((id) => ({ id, label: GROUP_HELP[id].label }))}
        active={active}
        onSelect={select}
      />
      <div className="min-w-0 max-w-2xl flex-1 space-y-4">
      <Section group="websites">
        <AllSitesRow allowed={props.allSitesAllowed} onAllow={props.onAllowAllSites} onRemove={props.onRemoveAllSites} />
      </Section>

      <Section group="normal-login">
        <NormalLogin hosts={props.passThroughHosts} onAdd={props.onAddPassThrough} onRemove={props.onRemovePassThrough} />
      </Section>

      <Section group="badge">
        <BadgePreview settings={s} sample={props.sample} />
        <Toggle
          label="Show the badge"
          hint="Turn off to rely on page-title colours and the toolbar icon instead."
          checked={s.showPageBadge}
          onChange={(v) => props.onChange({ showPageBadge: v })}
        />
        {s.showPageBadge && (
          <div className="space-y-4 pl-12">
            <Choice
              label="Show it as"
              hint="How it starts on each page. Clicking the badge on a page still switches between the two."
              options={BADGE_STYLES}
              value={s.badgeStyle}
              name={(v) => STYLE_LABEL[v]}
              onPick={(v) => props.onChange({ badgeStyle: v })}
            />
            <div className="space-y-1.5">
              <Choice
                label="Corner"
                hint="Pick one your apps do not use for buttons. Dragging the badge on a page moves it for that site only; double-click it there to put it back."
                options={BADGE_CORNERS}
                value={s.badgePosition}
                name={(v) => CORNER_LABEL[v]}
                onPick={(v) => props.onChange({ badgePosition: v })}
              />
              <Button size="xs" variant="outline" onClick={props.onForgetDragged}>
                Put every dragged badge back in its corner
              </Button>
            </div>
            <div className="space-y-1.5">
              <Toggle
                label="Hide it after a few seconds"
                hint="It shows when a page loads, long enough to read whose tab it is, then gets out of the way. It stays while the pointer is on it."
                checked={s.autoHideBadge}
                onChange={(v) => props.onChange({ autoHideBadge: v })}
              />
              {s.autoHideBadge && (
                <SecondsField value={s.badgeHideSeconds} onCommit={(n) => props.onChange({ badgeHideSeconds: n })} />
              )}
            </div>
          </div>
        )}
      </Section>

      <Section group="titles">
        <Toggle
          label="Mark page titles with the persona colour"
          hint="Puts the persona's coloured heart in front of each tab's title (💙 Dashboard), so the tab strip shows whose tab is whose."
          checked={s.markPageTitles}
          onChange={(v) => props.onChange({ markPageTitles: v })}
        />
      </Section>

      <Section group="tabs">
        <Toggle
          label="Open tabs in a tab group"
          hint="On: every tab a persona opens (Open all, one site, another login, using this tab) joins one Chrome tab group per persona, named and coloured after it. Off: tabs open individually, ungrouped."
          checked={s.useTabGroups}
          onChange={(v) => props.onChange({ useTabGroups: v })}
        />
        <Toggle
          label="Open a persona in a new window"
          hint="Keeps a persona's tabs away from what you are already working on."
          checked={s.openPersonaInNewWindow}
          onChange={(v) => props.onChange({ openPersonaInNewWindow: v })}
        />
      </Section>
      </div>
    </div>
  );
}

/** One settings card: title with its ⓘ, a one-line description, then the controls. */
function Section(props: { readonly group: SettingsGroup; readonly children: React.ReactNode }) {
  const help = GROUP_HELP[props.group];
  return (
    <section
      id={cardId(props.group)}
      aria-label={help.label}
      className="scroll-mt-14 space-y-3 rounded-lg border border-border bg-card p-4 sm:scroll-mt-4"
    >
      <header>
        <h2 className="flex items-center gap-1 text-[13px] font-semibold">
          {help.label}
          <HelpIcon help={help} />
        </h2>
        <p className="text-xs text-muted-foreground">{GROUP_BLURB[props.group]}</p>
      </header>
      {props.children}
    </section>
  );
}

function Toggle(props: {
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch aria-label={props.label} checked={props.checked} onCheckedChange={props.onChange} className="mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{props.label}</p>
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      </div>
    </div>
  );
}

/** A small set of choices as buttons on one line — the current one visible without opening anything. */
function Choice<T extends string>(props: {
  readonly label: string;
  readonly hint: string;
  readonly options: readonly T[];
  readonly value: T;
  readonly name: (v: T) => string;
  readonly onPick: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium">{props.label}</p>
      <div role="radiogroup" aria-label={props.label} className="flex flex-wrap gap-1">
        {props.options.map((o) => (
          <Button
            key={o}
            size="xs"
            role="radio"
            aria-checked={props.value === o}
            variant={props.value === o ? 'default' : 'outline'}
            onClick={() => props.onPick(o)}
          >
            {props.name(o)}
          </Button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
    </div>
  );
}

/**
 * Seconds before the badge hides. Edited locally and committed on Enter or blur, so typing
 * "15" does not store "1" on the way. Out-of-range input is clamped by the worker.
 */
function SecondsField(props: { readonly value: number; readonly onCommit: (seconds: number) => void }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => { setDraft(String(props.value)); }, [props.value]);
  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== props.value) props.onCommit(n);
    else setDraft(String(props.value));
  };
  return (
    <label className="flex items-center gap-2 pl-12 text-xs">
      <span>Hide after</span>
      <Input
        type="number"
        inputMode="numeric"
        min={BADGE_HIDE_SECONDS_MIN}
        max={BADGE_HIDE_SECONDS_MAX}
        aria-label="Seconds before the badge hides"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        className="w-16 tabular-nums"
      />
      <span>seconds</span>
    </label>
  );
}
