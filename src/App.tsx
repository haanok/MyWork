import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerWorkspace } from './CustomerWorkspace';
import { AuroraSurface } from './AuroraSurface';
import { DriftSurface } from './DriftSurface';
import { today } from './dates';
import { fetchMcpInfo, type McpInfo } from './api';
import { IconArrowLeft, IconCalendar, IconCheck, IconDownload, IconBolt, IconMore, IconPlug, IconSearch, IconUpload, IconUserPlus } from './icons';
import { McpConnectDialog } from './McpConnect';
import { OrbMap } from './OrbMap';
import { TodayView } from './TodayView';
import { isMac, QUICK_ADD_KEYS, QuickAddDialog } from './QuickAdd';
import { rankCustomers } from './quickAddParse';
import { sampleData } from './sample';
import { localStorageAdapter, parseImport, serverStorageAdapter } from './storage';
import { useBoard } from './store';
import type { Customer, Task } from './types';

function useCompact() {
  const query = '(max-width: 760px)';
  const [compact, setCompact] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

const NEXT_STATUS = { open: 'doing', doing: 'done', done: 'open' } as const;
const HOME_THEMES = ['spacewave', 'drift', 'paper', 'vivicta', 'porcelain', 'porcelain-dark'] as const;
type HomeTheme = (typeof HOME_THEMES)[number];
const THEME_LABELS: Record<HomeTheme, string> = { spacewave: 'Spacewave', drift: 'Drift', paper: 'Paper', vivicta: 'Vivicta', porcelain: 'Porcelain', 'porcelain-dark': 'Porcelain Dark' };
type View = 'map' | 'today';

function savedHomeTheme(): HomeTheme {
  try {
    const saved = window.localStorage.getItem('mywork-home-theme');
    return HOME_THEMES.find((theme) => theme === saved) ?? 'spacewave';
  } catch {
    return 'spacewave';
  }
}

function routeFromHash(): { view: View; selectedId: string | null } {
  const match = /^#\/(map|today)(?:\/customer\/(.+))?$/.exec(window.location.hash);
  return {
    view: match?.[1] === 'today' ? 'today' : 'map',
    selectedId: match?.[2] ? decodeURIComponent(match[2]) : null,
  };
}

function hashFor(view: View, selectedId: string | null): string {
  return `#/${view}${selectedId ? `/customer/${encodeURIComponent(selectedId)}` : ''}`;
}

export default function App() {
  const adapter = import.meta.env.DEV ? localStorageAdapter : serverStorageAdapter;
  const sourceLabel = import.meta.env.DEV ? 'Local preview' : 'Server';
  const { data, ready, undo, loadFailed, storageError, actions, hasUnsavedChanges } = useBoard(adapter);
  const compact = useCompact();
  const [homeTheme, setHomeTheme] = useState<HomeTheme>(savedHomeTheme);
  const [initialRoute] = useState(routeFromHash);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoute.selectedId);
  const [view, setView] = useState<View>(initialRoute.view);
  const routeReady = useRef(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [showMcp, setShowMcp] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddInitialText, setQuickAddInitialText] = useState('');
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dataMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem('mywork-home-theme', homeTheme);
    } catch {
      // The selected theme still applies for this session when storage is unavailable.
    }
  }, [homeTheme]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      setMcpInfo({ enabled: true, url: 'https://mywork.example.com/mcp', clientId: 'example-client-id', issuer: 'https://id.example.com' });
      return;
    }
    let active = true;
    void fetchMcpInfo().then((info) => { if (active) setMcpInfo(info); });
    return () => { active = false; };
  }, []);

  const selected = data.customers.find((c) => c.id === selectedId) ?? null;

  // Keep the view and open customer in the URL so the browser back and forward buttons work.
  useEffect(() => {
    const onPopState = () => {
      const route = routeFromHash();
      setView(route.view);
      setSelectedId(route.selectedId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const hash = hashFor(view, selectedId);
    if (window.location.hash !== hash) {
      if (routeReady.current) window.history.pushState(null, '', hash);
      else window.history.replaceState(null, '', hash);
    }
    routeReady.current = true;
  }, [view, selectedId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (!selectedId && view === 'map')) return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (document.querySelector('dialog[open]')) return;
      if (selectedId) setSelectedId(null);
      else setView('map');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId, view]);

  // ⌘K / Ctrl+K opens quick add and ⌘F / Ctrl+F jumps to the customer
  // search, from anywhere, also while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        if (document.querySelector('dialog[open]')) return;
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (key !== 'k' || data.customers.length === 0) return;
      e.preventDefault();
      setQuickAddInitialText('');
      setShowQuickAdd(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [data.customers.length]);

  // Warn before leaving while a change is not yet saved, for example when the server could not be reached.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // Close the import/export menu on an outside click or Escape.
  useEffect(() => {
    if (!dataMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!dataMenuRef.current?.contains(e.target as Node)) setDataMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDataMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [dataMenuOpen]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (storageError) setNotice(storageError);
  }, [storageError]);

  const visible = useMemo(
    () => data.customers.filter((c) => showArchived || c.status !== 'archived' || c.id === selectedId),
    [data.customers, showArchived, selectedId],
  );

  const tally = useMemo(() => {
    const live = new Set(data.customers.filter((c) => c.status !== 'archived').map((c) => c.id));
    const t0 = today();
    let open = 0;
    let overdue = 0;
    let dueToday = 0;
    for (const t of data.tasks) {
      if (t.status === 'done' || !live.has(t.customerId)) continue;
      open += 1;
      if (t.due && t.due < t0) overdue += 1;
      else if (t.due === t0) dueToday += 1;
    }
    return { customers: live.size, open, overdue, dueToday };
  }, [data]);

  // In a customer's workspace the search narrows the customer list.
  const listed = useMemo(() => {
    if (!query.trim()) return visible;
    const ranked = rankCustomers(visible, query);
    return selected && !ranked.includes(selected) ? [selected, ...ranked] : ranked;
  }, [visible, query, selected]);

  const openBestMatch = () => {
    const best = rankCustomers(visible, query)[0];
    if (!best) return;
    setSelectedId(best.id);
    setQuery('');
    searchRef.current?.blur();
  };

  const archivedCount = data.customers.filter((c) => c.status === 'archived').length;

  const addCustomer = () => {
    const id = actions.addCustomer();
    setSelectedId(id);
    setJustAdded(id);
  };

  const advanceTask = (t: Task) => actions.updateTask(t.id, { status: NEXT_STATUS[t.status] });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customer-board-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      actions.importData(parseImport(await file.text()));
      setSelectedId(null);
    } catch {
      setNotice('Import failed: choose a JSON file exported from this board.');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  if (!ready) return null;

  if (loadFailed) {
    return (
      <div className="app">
        <main className="vault-setup">
          <div className="vault-setup-content">
            <h2>Could not load your customer data</h2>
            <p>{storageError ?? 'Check your connection and sign-in, then retry.'}</p>
            <button type="button" className="crm-primary" onClick={() => window.location.reload()}>Retry</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app" data-home-theme={homeTheme}>
      <header className={`deck${selected ? ' deck-record' : ''}`}>
        {selected && (
          <button type="button" className="back-key" onClick={() => setSelectedId(null)}>
            <IconArrowLeft width={17} height={17} />
            {view === 'today' ? 'Today' : 'Map'}
          </button>
        )}
        <h1 className="wordmark">
          <button
            type="button"
            className="wordmark-home"
            aria-label="Go to home page"
            onClick={() => {
              setView('map');
              setSelectedId(null);
            }}
          >
            MyWork
          </button>
        </h1>

        {!selected && <p className="tally" role="status">
          <span className="tally-item">
            <b className="num">{tally.open}</b> open
          </span>
          <span className="tally-item">
            <b className="num">{tally.customers}</b> customers
          </span>
        </p>}

        <div className="deck-tools">
          <label className="search">
            <IconSearch width={16} height={16} />
            <span className="visually-hidden">Find a customer</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="Find customer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  openBestMatch();
                } else if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                }
              }}
              title={`Name or short name. Enter opens the best match. (${isMac ? '⌘F' : 'Ctrl+F'})`}
            />
          </label>
          {!selected && (
            <button
              type="button"
              className="key today-key"
              aria-pressed={view === 'today'}
              onClick={() => setView((v) => (v === 'today' ? 'map' : 'today'))}
              title="Overdue and due-today tasks across all customers"
            >
              <IconCalendar width={15} height={15} />
              Today
              {tally.overdue + tally.dueToday > 0 && (
                <span className={`num today-key-count${tally.overdue > 0 ? ' is-alert' : ''}`}>{tally.overdue + tally.dueToday}</span>
              )}
            </button>
          )}
          {!selected && view === 'map' && archivedCount > 0 && (
            <button
              type="button"
              className="key"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              Archived <span className="num">{archivedCount}</span>
            </button>
          )}
          {data.customers.length > 0 && (
            <button
              type="button"
              className="key quick-add-key"
              onClick={() => { setQuickAddInitialText(''); setShowQuickAdd(true); }}
              title={`Quick add a task for any customer (${QUICK_ADD_KEYS})`}
            >
              <IconBolt width={15} height={15} />
              <span className="key-label">Quick add</span>
            </button>
          )}
          {!selected && (
            <button type="button" className="key primary" onClick={addCustomer} title="Add customer">
              <IconUserPlus width={16} height={16} />
              <span className="key-label">Add customer</span>
            </button>
          )}
          <div className="data-menu" ref={dataMenuRef}>
            <button
              type="button"
              className="icon-key data-menu-key"
              aria-label="More: theme, import and export"
              title="Theme, import / export"
              aria-haspopup="menu"
              aria-expanded={dataMenuOpen}
              onClick={() => setDataMenuOpen((open) => !open)}
            >
              <IconMore />
            </button>
            {dataMenuOpen && (
              <div className="data-menu-list" role="menu" aria-label="More">
                <div role="group" aria-labelledby="theme-menu-label" className="data-menu-group">
                  <p id="theme-menu-label" className="data-menu-heading">Theme</p>
                  {HOME_THEMES.map((theme) => (
                    <button
                      key={theme}
                      type="button"
                      role="menuitemradio"
                      aria-checked={homeTheme === theme}
                      onClick={() => setHomeTheme(theme)}
                    >
                      <span className={`theme-swatch theme-swatch-${theme}`} aria-hidden="true" />
                      {THEME_LABELS[theme]}
                      {homeTheme === theme && <IconCheck className="data-menu-check" width={15} height={15} />}
                    </button>
                  ))}
                </div>
                <div className="data-menu-divider" role="separator" />
                {mcpInfo?.enabled && (
                  <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); setShowMcp(true); }}>
                    <IconPlug width={16} height={16} />
                    Connect AI assistant…
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); exportJson(); }}>
                  <IconDownload width={16} height={16} />
                  Export JSON
                </button>
                <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); fileRef.current?.click(); }}>
                  <IconUpload width={16} height={16} />
                  Import JSON…
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => void importJson(e.target.files?.[0])}
            />
          </div>
        </div>
      </header>

      <main
        className={`stage${selected ? ' has-workspace' : ''}`}
        data-home-theme={!selected && view === 'map' ? homeTheme : undefined}
      >
        {homeTheme === 'drift' && <DriftSurface water={!selected && view === 'map'} />}
        {homeTheme === 'vivicta' && <AuroraSurface active={!selected && view === 'map'} />}
        {homeTheme === 'porcelain' && <AuroraSurface active={!selected && view === 'map'} variant="porcelain-light" />}
        {homeTheme === 'porcelain-dark' && <AuroraSurface active={!selected && view === 'map'} variant="porcelain-dark" />}
        {selected ? (
          <CustomerWorkspace
            key={selected.id}
            customer={selected}
            customers={listed}
            tasks={data.tasks}
            autoFocusName={justAdded === selected.id}
            sourceLabel={sourceLabel}
            onSelectCustomer={setSelectedId}
            onAddCustomer={addCustomer}
            onUpdateCustomer={(patch) => actions.updateCustomer(selected.id, patch)}
            onArchiveCustomer={() => {
              actions.updateCustomer(selected.id, { status: 'archived' });
              setSelectedId(null);
            }}
            onDeleteCustomer={() => {
              const taskCount = data.tasks.filter((t) => t.customerId === selected.id).length;
              const taskLabel = taskCount === 1 ? 'task' : 'tasks';
              if (!window.confirm(`Delete ${selected.name} and ${taskCount} ${taskLabel}? You can undo this right after.`)) return;
              actions.removeCustomer(selected.id);
              setSelectedId(null);
            }}
            onAddTask={(title, description, priority, due) => actions.addTask(selected.id, title, description, priority, due)}
            onUpdateTask={actions.updateTask}
            onRemoveTask={actions.removeTask}
          />
        ) : view === 'today' ? (
          <TodayView
            customers={data.customers}
            tasks={data.tasks}
            onOpenCustomer={setSelectedId}
            onUpdateTask={actions.updateTask}
            onRemoveTask={actions.removeTask}
          />
        ) : (
          <OrbMap
            customers={visible}
            tasks={data.tasks}
            selectedId={null}
            query={query}
            compact={compact}
            isEmpty={data.customers.length === 0}
            onSelect={setSelectedId}
            onAdvanceTask={advanceTask}
            onAddCustomer={addCustomer}
            onQuickAddCustomer={(customer: Customer) => {
              setQuickAddInitialText(`${customer.shortName || customer.name}: `);
              setShowQuickAdd(true);
            }}
            onLoadSample={() => actions.replace(sampleData())}
          />
        )}
      </main>

      {(undo || notice) && (
        <div className="toast" role="status">
          <span>{notice ?? undo?.label}</span>
          {undo && !notice ? (
            <button type="button" className="text-key" onClick={actions.undo}>
              Undo
            </button>
          ) : (
            <button type="button" className="text-key" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      {showQuickAdd && (
        <QuickAddDialog
          customers={data.customers}
          current={selected}
          initialText={quickAddInitialText}
          onClose={() => { setShowQuickAdd(false); setQuickAddInitialText(''); }}
          onAdd={(customerId, title, priority, due) => {
            actions.addTask(customerId, title, '', priority, due);
            const name = data.customers.find((c) => c.id === customerId)?.name ?? 'customer';
            setNotice(`Task added to ${name}.`);
          }}
        />
      )}

      {showMcp && mcpInfo?.enabled && <McpConnectDialog info={mcpInfo} onClose={() => setShowMcp(false)} />}

    </div>
  );
}
