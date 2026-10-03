// The popup: the fast path. Thin by design — it supplies chrome and delegates every row
// to a presenter in features/.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Settings2, X } from 'lucide-react';
import { filterPersonas, flattenForKeyboard } from '@/core/personas';
import { client } from '@/app/client';
import { useLibrary } from '@/app/useLibrary';
import { PersonaRow } from '@/features/personas';
import { CurrentTabBar } from '@/features/capture';
import { Button } from '@/ui/volt/button';
import { Input } from '@/ui/volt/input';
import type { PersonaId } from '@/domain/types';

export function Popup() {
  const { state, feedback, setFeedback, refresh, run, runConfirmable } = useLibrary();
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<PersonaId>>(new Set());
  const [cursor, setCursor] = useState(0);
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
    void runConfirmable(
      (replace) => client.saveCurrentTab(personaId, mode, replace),
      (site) => `This persona already has a saved login for ${site}. Replace it?`,
    );
  }, [runConfirmable]);

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
          : <Button size="icon-sm" variant="outline" title="New persona" onClick={() => setAdding(true)}><Plus /></Button>}
        <Button size="icon-sm" variant="ghost" title="Open the full library" onClick={() => client.openOptions()}>
          <Settings2 />
        </Button>
      </header>

      {feedback && (
        <div className="flex items-start gap-1.5 border-b border-border bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <span className="flex-1">{feedback.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setFeedback(null)}>
            <X className="size-3" />
          </button>
        </div>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {personas.length === 0
          ? (
            <li className="px-4 py-8 text-center">
              <p className="text-xs font-medium">
                {state.personas.length === 0 ? 'No personas yet' : 'Nothing matches that search'}
              </p>
              {state.personas.length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  A persona is who you are across a set of apps. Create one, then save the
                  login you are on.
                </p>
              )}
            </li>
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
              onDuplicate={(id) => void run(() => client.duplicatePersona(id))}
              onDelete={(id) => void run(() => client.deletePersona(id))}
              onAddSite={(id) => {
                const url = state.tab.site;
                if (!url) {
                  setFeedback({ tone: 'warn', text: 'Open the site you want to add, then press +.' });
                  return;
                }
                void run(() => client.addSite(id, url));
                window.close();
              }}
              onOpenSession={(id, where) => {
                void run(() => client.openSession(id, where));
                if (where === 'new-tab') window.close();
              }}
              onRenameSession={(id, label) => void run(() => client.renameSession(id, label))}
              onDeleteSession={(id) => void run(() => client.deleteSession(id))}
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
        onAllowSite={(origin) => {
          // Straight from the click: Chrome rejects permissions.request without a user
          // gesture, so this must not be deferred behind an await.
          void client.grantOrigin(origin).then((ok) => {
            if (!ok) setFeedback({ tone: 'warn', text: 'Chrome declined access to that site.' });
            return refresh();
          });
        }}
        onAnotherLogin={(site) => { void run(() => client.anotherLogin(site)); window.close(); }}
        onAddToPersona={(personaId, site) => {
          void run(() => client.addSite(personaId, site));
          window.close();
        }}
        onUnbind={(tabId) => void run(() => client.unbindTab(tabId))}
        onSaveNow={(tabId) => void run(() => client.saveNow(tabId))}
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
    </div>
  );
}
