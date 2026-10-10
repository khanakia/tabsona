// The popup: the fast path. Thin by design — it supplies chrome and delegates every row
// to a presenter in features/.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, LibraryBig, Plus, Search, Settings2 } from 'lucide-react';
import { filterPersonas, flattenForKeyboard } from '@/core/personas';
import { client } from '@/app/client';
import { useLibrary } from '@/app/useLibrary';
import { PersonaRow } from '@/features/personas';
import { CurrentTabBar } from '@/features/capture';
import { SignInAlertBanner, SignInSitesSection } from '@/features/signin';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import { IconAction } from '@/ui/IconAction';
import { FeedbackBanner } from '@/ui/FeedbackBanner';
import { HowItWorks } from '@/ui/HowItWorks';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { ACTION_HELP, confirmDeletePersona, confirmForgetLogin, confirmReplaceLogin } from '@/ui/help';
import type { PersonaId } from '@/domain/types';

export function Popup() {
  const {
    state, feedback, setFeedback, refresh, run, runConfirmable, confirm, confirmRequest, answerConfirm,
  } = useLibrary();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<PersonaId>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const personas = useMemo(
    () => filterPersonas(state?.personas ?? [], query),
    [state?.personas, query],
  );

  // A collapsed empty persona looks like a dead end, so everything starts open.
  useEffect(() => {
    if (!state) return;
    setExpanded((prev) => (prev.size > 0 ? prev : new Set(state.personas.map((p) => p.id))));
  }, [state]);

  const rows = useMemo(() => flattenForKeyboard(personas, expanded), [personas, expanded]);
  const selected = rows[Math.min(cursor, rows.length - 1)];

  const toggle = useCallback((id: PersonaId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const saveTo = useCallback((personaId: PersonaId, mode: 'move' | 'copy') => {
    const name = state?.personas.find((p) => p.id === personaId)?.name ?? 'the persona';
    void runConfirmable(
      (replace) => client.saveCurrentTab(personaId, mode, replace),
      (site) => confirmReplaceLogin(name, site),
      mode === 'move'
        ? `Moved your login into “${name}”. This tab is now part of it.`
        : `Copied your login into “${name}”. You are still signed in normally too.`,
    );
  }, [runConfirmable, state?.personas]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === 'INPUT';
      if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (typing) { (document.activeElement as HTMLElement).blur(); return; }
        if (query) { setQuery(''); return; }
        window.close();
        return;
      }
      if (typing) return;

      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (!selected) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && selected.kind === 'persona') toggle(selected.id);
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selected.kind === 'session') {
          const here = e.metaKey || e.ctrlKey;
          void run(() => client.openSession(selected.id, here ? 'this-tab' : 'new-tab'));
          if (!here) window.close();
        } else if (e.metaKey || e.ctrlKey) {
          void run(() => client.openPersona(selected.id));
          window.close();
        } else {
          toggle(selected.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, selected, query, run, toggle]);

  if (!state) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>;

  // Straight from the click: Chrome rejects permissions.request without a user gesture,
  // so the request must not be deferred behind an await. Grants only — no tab opens.
  const allowOrigins = (origins: readonly string[]) => {
    void client.grantOrigins(origins).then((ok) => {
      if (!ok) setFeedback({ tone: 'warn', text: 'Chrome declined access to that site.' });
      return refresh();
    });
  };

  const allowAllSites = () => {
    void client.grantAllSites().then((ok) => {
      if (!ok) setFeedback({ tone: 'warn', text: 'Chrome did not allow every website. Nothing changed.' });
      return refresh();
    });
  };

  const createPersona = () => {
    if (!newName.trim()) return;
    void run(async () => {
      const err = await client.createPersona(newName);
      setNewName('');
      setAdding(false);
      return err;
    });
  };

  return (
    <div className="flex max-h-[600px] flex-col">
      <header className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            aria-label="Search personas and sites"
            value={query}
            placeholder="Search personas and sites"
            onChange={(e) => setQuery(e.currentTarget.value)}
            className="pl-6"
          />
        </div>
        {adding
          ? (
            <Input
              autoFocus
              aria-label="New persona name"
              value={newName}
              placeholder="Persona name"
              onChange={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createPersona();
                if (e.key === 'Escape') { setAdding(false); setNewName(''); }
              }}
              onBlur={() => { if (!newName.trim()) setAdding(false); }}
              className="w-36"
            />
          )
          : (
            <IconAction label={ACTION_HELP.newPersona.label} help={ACTION_HELP.newPersona} variant="outline" onClick={() => setAdding(true)}>
              <Plus />
            </IconAction>
          )}
        <IconAction label={ACTION_HELP.howItWorks.label} help={ACTION_HELP.howItWorks} onClick={() => setShowGuide((v) => !v)}>
          <CircleHelp />
        </IconAction>
        <IconAction label={ACTION_HELP.openLibrary.label} help={ACTION_HELP.openLibrary} onClick={() => void client.openOptions('personas')}>
          <LibraryBig />
        </IconAction>
        <IconAction label={ACTION_HELP.openSettings.label} help={ACTION_HELP.openSettings} onClick={() => void client.openOptions('settings')}>
          <Settings2 />
        </IconAction>
      </header>

      {/* Pinned above everything, and not dismissible: it goes away only when the
          sign-in websites are allowed. A user missed the single row that used to be the
          only place this was said. */}
      <SignInAlertBanner alerts={state.signInAlerts} onAllow={allowOrigins} onAllowAllSites={allowAllSites} />

      {feedback && (
        <FeedbackBanner
          tone={feedback.tone}
          text={feedback.text}
          onDismiss={() => setFeedback(null)}
          className="border-b border-border"
        />
      )}

      {/* The guide shows itself until the first persona exists, then only on request. */}
      {(showGuide || state.personas.length === 0) && (
        <section aria-label="How Tabsona works" className="border-b border-border bg-muted/30">
          <HowItWorks />
        </section>
      )}

      <SignInSitesSection alerts={state.signInAlerts} onAllow={allowOrigins} collapsible />

      {/* A floor under the persona list: the banners above are shrink-0, and without it a
          long warning squeezed the list to nothing ("where all the profiles go"). */}
      <ul className="min-h-40 flex-1 overflow-y-auto">
        {personas.length === 0
          ? (
            state.personas.length === 0
              ? null
              : (
                <li className="px-4 py-8 text-center text-xs font-medium">
                  Nothing matches that search
                </li>
              )
          )
          : personas.map((p) => (
            <PersonaRow
              key={p.id}
              persona={p}
              expanded={expanded.has(p.id)}
              selectedId={selected?.id ?? null}
              onToggle={toggle}
              onOpenAll={(id) => { void run(() => client.openPersona(id)); window.close(); }}
              onUpdate={(id, patch) => void run(() => client.updatePersona(id, patch))}
              onDuplicate={(id) => void run(() => client.duplicatePersona(id), `Duplicated “${p.name}”, logins included.`)}
              onDelete={(id) => void (async () => {
                if (!(await confirm(confirmDeletePersona(p.name)))) return;
                await run(() => client.deletePersona(id), `Deleted “${p.name}”.`);
              })()}
              currentSite={state.tab.site}
              onAddSite={(id, url) => {
                void run(() => client.addSite(id, url));
                window.close();
              }}
              onOpenSession={(id, where) => {
                void run(() => client.openSession(id, where));
                if (where === 'new-tab') window.close();
              }}
              onRenameSession={(id, label) => void run(() => client.renameSession(id, label))}
              onDeleteSession={(id) => void (async () => {
                if (!(await confirm(confirmForgetLogin()))) return;
                await run(() => client.deleteSession(id), 'Forgot that login.');
              })()}
              onAnotherLogin={(site) => {
                void run(() => client.anotherLogin(site));
                window.close();
              }}
            />
          ))}
      </ul>

      <CurrentTabBar
        tab={state.tab}
        personas={state.personas}
        onSaveTo={saveTo}
        onUseTabIn={(personaId) => { void run(() => client.useTabIn(personaId)); window.close(); }}
        onAllowSite={(origin) => allowOrigins([origin])}
        onAnotherLogin={(site) => { void run(() => client.anotherLogin(site)); window.close(); }}
        onAddToPersona={(personaId, site) => {
          void run(() => client.addSite(personaId, site));
          window.close();
        }}
        onUnbind={(tabId) => void run(() => client.unbindTab(tabId), 'This tab is back on your normal browser login. The persona kept its login.')}
        onSaveNow={(tabId) => void run(() => client.saveNow(tabId), 'Saved.')}
        onStartOver={(sessionId) => {
          void run(() => client.startOver(sessionId), 'Signed out. Sign in again in the persona tab; Tabsona asks before any website it is not allowed on.');
        }}
        onNewPersonaWithTab={() => {
          void (async () => {
            const site = state.tab.site;
            if (!site) return;
            const err = await client.createPersona(new URL(site).hostname);
            if (err) { setFeedback({ tone: 'error', text: err }); return; }
            const next = await client.getState();
            const created = next?.personas[0];
            if (created) saveTo(created.id, 'move');
            await refresh();
          })();
        }}
      />

      <ConfirmDialog request={confirmRequest} onAnswer={answerConfirm} />
    </div>
  );
}
