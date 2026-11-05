import { useEffect, useMemo, useRef, useState } from 'react';
import { CustomerWorkspace } from './CustomerWorkspace';
import { today } from './dates';
import { fetchMcpInfo, type McpInfo } from './api';
import { IconArrowLeft, IconDownload, IconFolderOpen, IconPlug, IconPlus, IconSearch, IconTransfer, IconUpload } from './icons';
import { McpConnectDialog } from './McpConnect';
import { OrbMap } from './OrbMap';
import { isMac, QUICK_ADD_KEYS, QuickAddDialog } from './QuickAdd';
import { rankCustomers } from './quickAddParse';
import { prepareMarkdownImport, type MarkdownImportPreview } from './obsidianImport';
import { sampleData } from './sample';
import { localStorageAdapter, obsidianStorageAdapter, parseImport, serverStorageAdapter } from './storage';
import { useBoard } from './store';
import type { Task } from './types';

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

export default function App() {
  const desktop = Boolean(window.customerBoard);
  const adapter = desktop ? obsidianStorageAdapter : import.meta.env.DEV ? localStorageAdapter : serverStorageAdapter;
  const sourceLabel = desktop ? 'Obsidian vault' : import.meta.env.DEV ? 'Local preview' : 'Server';
  const { data, ready, undo, loadFailed, storageError, actions, hasUnsavedChanges } = useBoard(adapter);
  const compact = useCompact();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [vaultRoot, setVaultRoot] = useState<string | null | undefined>(() => desktop ? undefined : null);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const importDialogRef = useRef<HTMLDialogElement>(null);
  const [pendingMarkdownImport, setPendingMarkdownImport] = useState<MarkdownImportPreview | null>(null);
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null);
  const [showMcp, setShowMcp] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dataMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (desktop) return;
    if (import.meta.env.DEV) {
      setMcpInfo({ enabled: true, url: 'https://mywork.example.com/mcp', clientId: 'example-client-id', issuer: 'https://id.example.com' });
      return;
    }
    let active = true;
    void fetchMcpInfo().then((info) => { if (active) setMcpInfo(info); });
    return () => { active = false; };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void obsidianStorageAdapter.getCustomerRoot().then((root) => {
      if (active) setVaultRoot(root);
    }).catch((error: unknown) => {
      if (active) setNotice(error instanceof Error ? error.message : 'Could not read the selected folder.');
      if (active) setVaultRoot(null);
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    return obsidianStorageAdapter.onVaultChanged(() => {
      void obsidianStorageAdapter.load().then((next) => actions.replace(next, true)).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : 'Could not reload the Obsidian folder.');
      });
    });
  }, [desktop, actions]);

  const selected = data.customers.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !selectedId) return;
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedId]);

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
      setShowQuickAdd(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [data.customers.length]);

  // In the browser, warn before leaving while a change is not yet saved (for
  // example when the server could not be reached). The desktop app writes to
  // the vault right away and would only block closing the window.
  useEffect(() => {
    if (desktop) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [desktop, hasUnsavedChanges]);

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

  useEffect(() => {
    const dialog = importDialogRef.current;
    if (pendingMarkdownImport && dialog && !dialog.open) dialog.showModal();
  }, [pendingMarkdownImport]);

  const visible = useMemo(
    () => data.customers.filter((c) => showArchived || c.status !== 'archived' || c.id === selectedId),
    [data.customers, showArchived, selectedId],
  );

  const tally = useMemo(() => {
    const live = new Set(data.customers.filter((c) => c.status !== 'archived').map((c) => c.id));
    const t0 = today();
    let open = 0;
    let overdue = 0;
    for (const t of data.tasks) {
      if (t.status === 'done' || !live.has(t.customerId)) continue;
      open += 1;
      if (t.due && t.due < t0) overdue += 1;
    }
    return { customers: live.size, open, overdue };
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

  const connectVault = async () => {
    try {
      const root = await obsidianStorageAdapter.chooseCustomerRoot();
      if (!root) return;
      setVaultRoot(root);
      actions.replace(await obsidianStorageAdapter.load(), true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not connect to that folder.');
    }
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

  const chooseMarkdownFolder = () => {
    const input = markdownFileRef.current;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.click();
  };

  const importMarkdownFiles = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      setPendingMarkdownImport(await prepareMarkdownImport(files, data));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not read the selected Obsidian folder.');
    }
  };

  const confirmMarkdownImport = () => {
    if (!pendingMarkdownImport) return;
    const { data: imported, addedCustomers, updatedCustomers, addedTasks, updatedTasks } = pendingMarkdownImport;
    actions.importData(imported);
    closeMarkdownImport();
    setNotice(`Imported ${addedCustomers} new customers, updated ${updatedCustomers}, added ${addedTasks} tasks, and updated ${updatedTasks}. Existing unmatched records were kept.`);
  };

  const closeMarkdownImport = () => {
    if (importDialogRef.current?.open) importDialogRef.current.close();
    setPendingMarkdownImport(null);
  };

  if (!ready || (desktop && vaultRoot === undefined)) return null;

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

  if (desktop && !vaultRoot) {
    return (
      <div className="app">
        <header className="deck">
          <h1 className="wordmark">MyWork</h1>
        </header>
        <main className="vault-setup">
          <div className="vault-setup-content">
            <h2>Connect your customer folder</h2>
            <p>Choose the folder whose immediate subfolders are customers. Markdown notes inside each customer folder become tasks.</p>
            <button type="button" className="crm-primary" onClick={() => void connectVault()}>Choose folder</button>
            {storageError && <p className="vault-error" role="alert">{storageError}</p>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className={`deck${selected ? ' deck-record' : ''}`}>
        {selected && (
          <button type="button" className="back-key" onClick={() => setSelectedId(null)}>
            <IconArrowLeft width={17} height={17} />
            Map
          </button>
        )}
        <h1 className="wordmark">MyWork</h1>

        {!selected && <p className="tally" role="status">
          <span className="tally-item">
            <span className="pip lamp-overdue" />
            <b className="num">{tally.overdue}</b> overdue
          </span>
          <span className="tally-item">
            <span className="pip lamp-open" />
            <b className="num">{tally.open}</b> open
          </span>
          <span className="tally-item">
            <b className="num">{tally.customers}</b> customers
          </span>
        </p>}

        <div className="deck-tools">
          {desktop && (
            <button type="button" className="key vault-key" onClick={() => void connectVault()} title={vaultRoot ?? 'Choose a customer folder'}>
              Obsidian · {vaultRoot?.split('/').filter(Boolean).at(-1) ?? 'Choose folder'}
            </button>
          )}
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
              title="Name or short name. Enter opens the best match."
            />
            {!query && <kbd className="search-kbd" aria-hidden="true">{isMac ? '⌘F' : 'Ctrl+F'}</kbd>}
          </label>
          {!selected && archivedCount > 0 && (
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
              onClick={() => setShowQuickAdd(true)}
              title={`Quick add a task for any customer (${QUICK_ADD_KEYS})`}
            >
              <IconPlus width={15} height={15} />
              Quick add <kbd>{QUICK_ADD_KEYS}</kbd>
            </button>
          )}
          {mcpInfo?.enabled && (
            <button type="button" className="icon-key" onClick={() => setShowMcp(true)} aria-label="Connect an AI assistant (MCP)" title="Connect via MCP">
              <IconPlug />
            </button>
          )}
          {desktop ? (
            <button type="button" className="icon-key" onClick={exportJson} aria-label="Export board as JSON" title="Export JSON">
              <IconDownload />
            </button>
          ) : (
            <div className="data-menu" ref={dataMenuRef}>
              <button
                type="button"
                className="icon-key data-menu-key"
                aria-label="Import or export"
                title="Import / export"
                aria-haspopup="menu"
                aria-expanded={dataMenuOpen}
                onClick={() => setDataMenuOpen((open) => !open)}
              >
                <IconTransfer />
              </button>
              {dataMenuOpen && (
                <div className="data-menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); exportJson(); }}>
                    <IconDownload width={16} height={16} />
                    Export JSON
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); fileRef.current?.click(); }}>
                    <IconUpload width={16} height={16} />
                    Import JSON…
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setDataMenuOpen(false); chooseMarkdownFolder(); }}>
                    <IconFolderOpen width={16} height={16} />
                    Import Obsidian folder…
                  </button>
                </div>
              )}
              <input
                ref={markdownFileRef}
                type="file"
                accept=".md,text/markdown"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  void importMarkdownFiles(files);
                }}
              />
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => void importJson(e.target.files?.[0])}
              />
            </div>
          )}
          {!selected && (
            <button type="button" className="key primary" onClick={addCustomer}>
              <IconPlus width={16} height={16} />
              Add customer
            </button>
          )}
        </div>
      </header>

      <main className={`stage${selected ? ' has-workspace' : ''}`}>
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
            onAddTask={(title, description, priority, due) => actions.addTask(selected.id, title, description, priority, due)}
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
            onLoadSample={desktop ? undefined : () => actions.replace(sampleData())}
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
          onClose={() => setShowQuickAdd(false)}
          onAdd={(customerId, title, priority, due) => {
            actions.addTask(customerId, title, '', priority, due);
            const name = data.customers.find((c) => c.id === customerId)?.name ?? 'customer';
            setNotice(`Task added to ${name}.`);
          }}
        />
      )}

      {showMcp && mcpInfo?.enabled && <McpConnectDialog info={mcpInfo} onClose={() => setShowMcp(false)} />}

      <dialog
        ref={importDialogRef}
        className="import-dialog"
        aria-labelledby="import-dialog-title"
        onCancel={closeMarkdownImport}
        onClose={() => setPendingMarkdownImport(null)}
      >
        {pendingMarkdownImport && (
          <>
            <h2 id="import-dialog-title">Import Obsidian notes?</h2>
            <p>
              {pendingMarkdownImport.addedCustomers + pendingMarkdownImport.updatedCustomers}{' '}
              {pendingMarkdownImport.addedCustomers + pendingMarkdownImport.updatedCustomers === 1 ? 'customer' : 'customers'} and{' '}
              {pendingMarkdownImport.addedTasks + pendingMarkdownImport.updatedTasks}{' '}
              {pendingMarkdownImport.addedTasks + pendingMarkdownImport.updatedTasks === 1 ? 'task note' : 'task notes'} found.
            </p>
            <ul className="import-summary">
              <li>{pendingMarkdownImport.addedCustomers} new {pendingMarkdownImport.addedCustomers === 1 ? 'customer' : 'customers'}</li>
              <li>{pendingMarkdownImport.updatedCustomers} matching {pendingMarkdownImport.updatedCustomers === 1 ? 'customer' : 'customers'} updated</li>
              <li>{pendingMarkdownImport.addedTasks} new {pendingMarkdownImport.addedTasks === 1 ? 'task' : 'tasks'}</li>
              <li>{pendingMarkdownImport.updatedTasks} matching {pendingMarkdownImport.updatedTasks === 1 ? 'task' : 'tasks'} updated</li>
            </ul>
            <p className="import-preservation">
              Matching notes update by stable ID. Existing records absent from this folder are retained; nothing is deleted.
            </p>
            <div className="import-actions">
              <button type="button" className="crm-secondary" onClick={closeMarkdownImport}>Cancel</button>
              <button type="button" className="crm-primary" onClick={confirmMarkdownImport}>Merge into board</button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
