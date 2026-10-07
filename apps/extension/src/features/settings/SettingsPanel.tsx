import { useEffect, useState } from 'react';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { Switch } from '@/ui/volt/switch';
import { BadgePreview } from './BadgePreview';
import { SectionIntro } from '@/ui/SectionIntro';
import { EXPLAIN, type ActionHelp } from '@/ui/help';
import {
  BADGE_CORNERS, BADGE_HIDE_SECONDS_MAX, BADGE_HIDE_SECONDS_MIN, BADGE_STYLES,
  type BadgeCorner, type BadgeStyle, type Settings, type SettingsPatch,
} from '@/domain/messages';

/**
 * Every setting, grouped by what it affects: the badge on pages, page titles, tabs.
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
}

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
  return (
    <div className="space-y-6">
      <Section help={EXPLAIN.settingsBadge}>
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

      <Section help={EXPLAIN.settingsTitles}>
        <Toggle
          label="Mark page titles with the persona colour"
          hint="Puts the persona's coloured heart in front of each tab's title (💙 Dashboard), so the tab strip shows whose tab is whose."
          checked={s.markPageTitles}
          onChange={(v) => props.onChange({ markPageTitles: v })}
        />
      </Section>

      <Section help={EXPLAIN.settingsTabs}>
        <Toggle
          label="Group a persona's tabs in Chrome"
          hint="Opened tabs join a native Chrome tab group named after the persona, in the persona's colour."
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
  );
}

function Section(props: { readonly help: ActionHelp; readonly children: React.ReactNode }) {
  return (
    <section aria-label={props.help.label} className="space-y-3">
      <SectionIntro help={props.help} />
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
