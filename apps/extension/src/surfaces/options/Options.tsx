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
import { SettingsPanel } from '@/features/settings';
import { isOptionsSection, sectionFromHash } from '@/core/settings';
import { PERSONA_PALETTE } from '@/core/constants';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { FeedbackBanner } from '@/ui/FeedbackBanner';
import { EXPLAIN, confirmDeletePersona, confirmForgetLogin } from '@/ui/help';
import { SectionIntro } from '@/ui/SectionIntro';
import { AboutLinks } from '@/ui/AboutLinks';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/volt/tabs';
import type { OptionsSection, OriginCoverage } from '@/domain/messages';
import type { PersonaId } from '@/domain/types';

export function Options() {
  const { state, feedback, setFeedback, refresh, run, confirm, confirmRequest, answerConfirm } = useLibrary();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [report, setReport] = useState<readonly OriginCoverage[]>([]);
  const [expanded, setExpanded] = useState<ReadonlySet<PersonaId>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  // The section follows the URL hash, so the popup's gear can open this page straight on
  // Settings (`#settings`) — including when the page is already open in a tab.
  const [section, setSection] = useState<OptionsSection>(() => sectionFromHash(location.hash));
  useEffect(() => {
    const follow = () => setSection(sectionFromHash(location.hash));
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);
  const showSection = (next: OptionsSection) => {
    setSection(next);
    history.replaceState(null, '', `#${next}`);
    if (next === 'coverage') void client.coverageReport().then(setReport);
  };

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

      <Tabs value={section} onValueChange={(v) => { if (isOptionsSection(v)) showSection(v); }}>
        <TabsList>
          <TabsTrigger value="personas">Personas</TabsTrigger>
          <TabsTrigger value="sites">Sites</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="coverage">
            Coverage
          </TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="personas" className="mt-4 space-y-3">
          <SectionIntro help={EXPLAIN.personas} />
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
          <SectionIntro help={EXPLAIN.sites} />
          <SiteList
            allowedOrigins={state.allowedOrigins}
            onRevoke={(pattern) => void client.revokeOrigin(pattern).then(refresh)}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4 max-w-2xl">
          <SettingsPanel
            settings={state.settings}
            onChange={(patch) => void run(() => client.updateSettings(patch))}
            onForgetDragged={() => void run(() => client.resetBadgePlacements(), 'Every badge is back in its corner.')}
            sample={state.personas[0] ?? { name: 'Your persona', color: PERSONA_PALETTE[0].hex }}
          />
        </TabsContent>

        <TabsContent value="coverage" className="mt-4 space-y-3">
          <SectionIntro help={EXPLAIN.coverage} />
          <CoverageTable report={report} />
        </TabsContent>

        <TabsContent value="data" className="mt-4 max-w-2xl space-y-4">
          <SectionIntro help={EXPLAIN.data} />
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

      <footer className="mt-8 border-t border-border pt-3">
        <AboutLinks />
      </footer>

      <ConfirmDialog request={confirmRequest} onAnswer={answerConfirm} />
    </div>
  );
}
