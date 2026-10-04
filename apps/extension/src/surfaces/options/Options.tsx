// The options page: the full library. Thin by design — the same presenters as the
// popup, which is the real test of whether they are reusable rather than merely claimed
// to be.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus, Search, Upload } from 'lucide-react';
import { filterPersonas } from '@/core/personas';
import { client } from '@/app/client';
import { useLibrary } from '@/app/useLibrary';
import { PersonaRow } from '@/features/personas';
import { CoverageTable, SiteList } from '@/features/sites';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { FeedbackBanner } from '@/ui/FeedbackBanner';
import { confirmDeletePersona, confirmForgetLogin } from '@/ui/help';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { Separator } from '@/ui/volt/separator';
import { Switch } from '@/ui/volt/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/volt/tabs';
import { BADGE_CORNERS, type BadgeCorner, type OriginCoverage } from '@/domain/messages';
import type { PersonaId } from '@/domain/types';

export function Options() {
  const { state, feedback, setFeedback, refresh, run, confirm, confirmRequest, answerConfirm } = useLibrary();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [report, setReport] = useState<readonly OriginCoverage[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<PersonaId>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const personas = useMemo(
    () => filterPersonas(state?.personas ?? [], query),
    [state?.personas, query],
  );

  useEffect(() => {
    if (!state) return;
    setExpanded((prev) => (prev.size > 0 ? prev : new Set(state.personas.map((p) => p.id))));
  }, [state]);

  const toggle = useCallback((id: PersonaId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  if (!state) return <div className="p-6 text-xs text-muted-foreground">Loading…</div>;

  const sessionCount = state.personas.reduce((n, p) => n + p.sessions.length, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <header className="mb-4 flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">Tabsona</h1>
        <p className="text-xs text-muted-foreground">
          {state.personas.length} persona{state.personas.length === 1 ? '' : 's'} ·
          {' '}{sessionCount} saved login{sessionCount === 1 ? '' : 's'} ·
          {' '}{state.allowedOrigins.length} allowed site{state.allowedOrigins.length === 1 ? '' : 's'}
        </p>
      </header>

      {feedback && (
        <FeedbackBanner
          tone={feedback.tone}
          text={feedback.text}
          onDismiss={() => setFeedback(null)}
          className="mb-3 rounded-md border border-border"
        />
      )}

      <Tabs defaultValue="personas">
        <TabsList>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="coverage" onClick={() => void client.coverageReport().then(setReport)}>
            Coverage
          </TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="personas" className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search personas and sites"
                value={query}
                placeholder="Search personas and sites"
                onChange={(e) => setQuery(e.currentTarget.value)}
                className="pl-6"
              />
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                void run(async () => {
                  const err = await client.createPersona(newName);
                  setNewName('');
                  return err;
                });
              }}
            >
              <Input
                aria-label="New persona name"
                value={newName}
                placeholder="New persona"
                onChange={(e) => setNewName(e.currentTarget.value)}
                className="w-40"
              />
              <Button type="submit" size="default" disabled={!newName.trim()} onClick={() => undefined}>
                <Plus />
                Add
              </Button>
            </form>
          </div>

          <ul className="overflow-hidden rounded-md border border-border">
            {personas.length === 0
              ? (
                <li className="px-4 py-10 text-center">
                  <p className="text-xs font-medium">No personas yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create one, then save a login into it from the popup.
                  </p>
                </li>
              )
              : personas.map((p) => (
                <PersonaRow
                  key={p.id}
                  persona={p}
                  expanded={expanded.has(p.id)}
                  onToggle={toggle}
                  onOpenAll={(id) => void run(() => client.openPersona(id))}
                  onUpdate={(id, patch) => void run(() => client.updatePersona(id, patch))}
                  onDuplicate={(id) => void run(() => client.duplicatePersona(id), `Duplicated “${p.name}”, logins included.`)}
                  onDelete={(id) => void (async () => {
                    if (!(await confirm(confirmDeletePersona(p.name)))) return;
                    await run(() => client.deletePersona(id), `Deleted “${p.name}”.`);
                  })()}
                  onAddSite={(id, url) => void run(() => client.addSite(id, url))}
                  onOpenSession={(id, where) => void run(() => client.openSession(id, where))}
                  onRenameSession={(id, label) => void run(() => client.renameSession(id, label))}
                  onDeleteSession={(id) => void (async () => {
                    if (!(await confirm(confirmForgetLogin()))) return;
                    await run(() => client.deleteSession(id), 'Forgot that login.');
                  })()}
              onAnotherLogin={(site) => {
                void run(() => client.anotherLogin(site));
              }}
                />
              ))}
          </ul>
        </TabsContent>

        <TabsContent value="sites" className="mt-4 max-w-2xl space-y-4">
          <p className="text-xs text-muted-foreground">
            Nothing can be isolated until its site is allowed. Granting happens from the
            popup, because Chrome requires the request to come from a click and then shows
            its own confirmation — a step that cannot be automated and should not be hidden.
          </p>
          <SiteList
            allowedOrigins={state.allowedOrigins}
            onRevoke={(pattern) => void client.revokeOrigin(pattern).then(refresh)}
          />
          <Separator />
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Settings</h2>
            <Toggle
              label="Group a persona's tabs in Chrome"
              hint="Opened tabs join a native Chrome tab group named after the persona, so which tabs are which is visible in the tab strip."
              checked={state.settings.useTabGroups}
              onChange={(v) => void run(() => client.setSetting('useTabGroups', v))}
            />
            <Toggle
              label="Open a persona in a new window"
              hint="Keeps a persona's tabs away from what you are already working on."
              checked={state.settings.openPersonaInNewWindow}
              onChange={(v) => void run(() => client.setSetting('openPersonaInNewWindow', v))}
            />
            <Toggle
              label="Show the persona badge on pages"
              hint="A small badge on every persona tab says which persona it is and whether it is fully separate. Click it on a page to shrink it to a dot."
              checked={state.settings.showPageBadge}
              onChange={(v) => void run(() => client.setSetting('showPageBadge', v))}
            />
            {state.settings.showPageBadge && (
              <BadgeCornerPicker
                value={state.settings.badgePosition}
                onChange={(corner) => void run(() => client.setBadgePosition(corner))}
                onForgetDragged={() => void run(() => client.resetBadgePlacements(), 'Every badge is back in its corner.')}
              />
            )}
            <Toggle
              label="Mark page titles with the persona colour"
              hint="Puts the persona's coloured heart in front of each tab's title (💙 Dashboard), so the tab strip shows whose tab is whose."
              checked={state.settings.markPageTitles}
              onChange={(v) => void run(() => client.setSetting('markPageTitles', v))}
            />
          </div>
        </TabsContent>

        <TabsContent value="coverage" className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            What was actually measured per origin, not what was assumed. A layer is only
            reported as covered when something was observed to make it so.
          </p>
          <CoverageTable report={report} />
        </TabsContent>

        <TabsContent value="data" className="mt-4 max-w-2xl space-y-4">
          <div
            className="rounded-md border px-3 py-2 text-xs"
            style={{
              color: 'var(--state-empty)',
              borderColor: 'color-mix(in oklch, var(--state-empty) 35%, transparent)',
              background: 'color-mix(in oklch, var(--state-empty) 10%, transparent)',
            }}
          >
            An export contains <strong>live credentials</strong> — cookies and tokens that
            sign you in. Treat the file like a password file.
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => void client.exportData().then((json) => {
                if (json) client.downloadText(`tabsona-${new Date().toISOString().slice(0, 10)}.json`, json);
              })}
            >
              <Download />
              Export personas
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload />
              Import…
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (!file) return;
                void file.text().then((text) => run(() => client.importData(text)));
                e.currentTarget.value = '';
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Importing merges: nothing already here is deleted.
          </p>
        </TabsContent>
      </Tabs>

      <ConfirmDialog request={confirmRequest} onAnswer={answerConfirm} />
    </div>
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
      <Switch checked={props.checked} onCheckedChange={props.onChange} className="mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs font-medium">{props.label}</p>
        <p className="text-xs text-muted-foreground">{props.hint}</p>
      </div>
    </div>
  );
}

/** Human names for each corner, in the order offered. */
const CORNER_LABEL: Record<BadgeCorner, string> = {
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
  'top-left': 'Top left',
  'top-right': 'Top right',
};

/**
 * Where the in-page badge sits, as four buttons rather than a dropdown: four choices fit
 * on one line, and the current one is visible without opening anything.
 */
function BadgeCornerPicker(props: {
  readonly value: BadgeCorner;
  readonly onChange: (corner: BadgeCorner) => void;
  /** Drop every per-site dragged position, so all sites use this corner again. */
  readonly onForgetDragged: () => void;
}) {
  return (
    <div className="pl-12">
      <p className="mb-1 text-xs font-medium">Badge position</p>
      <div role="radiogroup" aria-label="Badge position" className="flex flex-wrap gap-1">
        {BADGE_CORNERS.map((corner) => (
          <Button
            key={corner}
            size="xs"
            role="radio"
            aria-checked={props.value === corner}
            variant={props.value === corner ? 'default' : 'outline'}
            onClick={() => props.onChange(corner)}
          >
            {CORNER_LABEL[corner]}
          </Button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick a corner your apps do not use for buttons. Dragging the badge on a page moves it for that site only; double-click it there to put it back.
      </p>
      <Button size="xs" variant="outline" className="mt-1.5" onClick={props.onForgetDragged}>
        Put every dragged badge back in this corner
      </Button>
    </div>
  );
}
