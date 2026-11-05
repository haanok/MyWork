import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { today, uid } from './dates';
import { DataConflictError } from './api';
import { mergeBoards } from './merge';
import { localStorageAdapter, type StorageAdapter } from './storage';
import { emptyData, type AppData, type Customer, type Priority, type Task } from './types';

type Action =
  | { type: 'replace'; data: AppData }
  | { type: 'addCustomer'; customer: Customer }
  | { type: 'updateCustomer'; id: string; patch: Partial<Customer> }
  | { type: 'removeCustomer'; id: string }
  | { type: 'addTask'; task: Task }
  | { type: 'updateTask'; id: string; patch: Partial<Task> }
  | { type: 'removeTask'; id: string };

function reducer(state: AppData, action: Action): AppData {
  const stamp = new Date().toISOString();
  switch (action.type) {
    case 'replace':
      return action.data;
    case 'addCustomer':
      return { ...state, customers: [...state.customers, action.customer] };
    case 'updateCustomer':
      return {
        ...state,
        customers: state.customers.map((c) =>
          c.id === action.id ? { ...c, ...action.patch, touchedAt: stamp } : c,
        ),
      };
    case 'removeCustomer':
      return {
        ...state,
        customers: state.customers.filter((c) => c.id !== action.id),
        tasks: state.tasks.filter((t) => t.customerId !== action.id),
        deletedTaskIds: [...new Set([...(state.deletedTaskIds ?? []), ...state.tasks.filter((task) => task.customerId === action.id).map((task) => task.id)])],
      };
    case 'addTask':
      return {
        ...state,
        tasks: [...state.tasks, action.task],
        customers: state.customers.map((c) =>
          c.id === action.task.customerId ? { ...c, touchedAt: stamp } : c,
        ),
      };
    case 'updateTask': {
      const target = state.tasks.find((t) => t.id === action.id);
      if (!target) return state;
      const next = { ...target, ...action.patch, updatedAt: stamp };
      if (action.patch.status) next.doneAt = action.patch.status === 'done' ? stamp : undefined;
      next.updatedAt = stamp;
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? next : t)),
        customers: state.customers.map((c) =>
          c.id === target.customerId ? { ...c, touchedAt: stamp } : c,
        ),
      };
    }
    case 'removeTask':
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.id !== action.id),
        deletedTaskIds: [...new Set([...(state.deletedTaskIds ?? []), action.id])],
      };
  }
}

export interface Undo {
  label: string;
  snapshot: AppData;
}

export function useBoard(adapter: StorageAdapter = localStorageAdapter) {
  const [data, dispatch] = useReducer(reducer, undefined, emptyData);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const dataRef = useRef(data);
  const persistedSnapshot = useRef<string | null>(null);
  const flushSave = useRef<(() => void) | null>(null);
  dataRef.current = data;

  useEffect(() => {
    let live = true;
    adapter.load().then((loaded) => {
      if (!live) return;
      persistedSnapshot.current = JSON.stringify(loaded);
      dispatch({ type: 'replace', data: loaded });
      setStorageError(null);
      setLoadFailed(false);
      setReady(true);
    }).catch((error: unknown) => {
      if (!live) return;
      setStorageError(error instanceof Error ? error.message : 'Could not read the data source.');
      setLoadFailed(true);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [adapter]);

  useEffect(() => {
    if (!ready || loadFailed) return;
    const snapshot = JSON.stringify(data);
    if (snapshot === persistedSnapshot.current) return;
    const run = () => {
      if (flushSave.current === flush) flushSave.current = null;
      void adapter.save(data).then(() => {
        persistedSnapshot.current = snapshot;
        setStorageError(null);
      }).catch((error: unknown) => {
        if (error instanceof DataConflictError) {
          // Someone else (another tab, or Claude via MCP) saved first. Merge
          // our unsaved edits into their version; marking their version as
          // persisted makes the save effect store the merged result.
          const base = persistedSnapshot.current ? JSON.parse(persistedSnapshot.current) as AppData : emptyData();
          void adapter.load().then((loaded) => {
            const { data: merged, overlaps } = mergeBoards(base, dataRef.current, loaded);
            persistedSnapshot.current = JSON.stringify(loaded);
            dispatch({ type: 'replace', data: merged });
            if (overlaps.length > 0) {
              setStorageError(`Changes made elsewhere were merged in. Where both changed the same field (${overlaps.slice(0, 3).join(', ')}${overlaps.length > 3 ? ', …' : ''}), your version was kept.`);
            }
          }).catch((loadError: unknown) => {
            setStorageError(loadError instanceof Error ? loadError.message : 'Could not reload changed data.');
          });
          return;
        }
        setStorageError(error instanceof Error ? error.message : 'Could not save changes.');
      });
    };
    const t = window.setTimeout(run, 200);
    const flush = () => {
      window.clearTimeout(t);
      run();
    };
    flushSave.current = flush;
    return () => {
      window.clearTimeout(t);
      if (flushSave.current === flush) flushSave.current = null;
    };
  }, [adapter, data, loadFailed, ready]);

  // Save right away, instead of after the short delay, when the tab is
  // hidden or closed, so a quick edit followed by closing is not lost.
  useEffect(() => {
    const flushNow = () => {
      if (document.visibilityState === 'hidden') flushSave.current?.();
    };
    const onPageHide = () => flushSave.current?.();
    document.addEventListener('visibilitychange', flushNow);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', flushNow);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  const hasUnsavedChanges = useCallback(
    () => ready && !loadFailed && JSON.stringify(dataRef.current) !== persistedSnapshot.current,
    [loadFailed, ready],
  );

  // Pick up changes made elsewhere when the tab becomes visible again, but
  // only while this tab has nothing unsaved.
  useEffect(() => {
    const { refresh: fetchLatest } = adapter;
    if (!fetchLatest || !ready || loadFailed) return;
    let inFlight = false;
    const isClean = () => JSON.stringify(dataRef.current) === persistedSnapshot.current;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || inFlight || !isClean()) return;
      inFlight = true;
      fetchLatest.call(adapter).then(({ data: loaded, commit }) => {
        const snapshot = JSON.stringify(loaded);
        // Unchanged, or the user started editing meanwhile: keep the old
        // ETag so a save still detects the remote change.
        if (snapshot === persistedSnapshot.current || !isClean()) return;
        commit();
        persistedSnapshot.current = snapshot;
        dispatch({ type: 'replace', data: loaded });
      }).catch(() => {
        // Ignore: the next save or focus will surface real problems.
      }).finally(() => {
        inFlight = false;
      });
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [adapter, loadFailed, ready]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);

  const withUndo = useCallback((label: string) => {
    setUndo({ label, snapshot: dataRef.current });
  }, []);

  const actions = useMemo(
    () => ({
      replace: (next: AppData, alreadyPersisted = false) => {
        setStorageError(null);
        setLoadFailed(false);
        if (alreadyPersisted) persistedSnapshot.current = JSON.stringify(next);
        dispatch({ type: 'replace', data: next });
      },
      importData: (next: AppData) => {
        withUndo('Board replaced by import');
        dispatch({ type: 'replace', data: next });
      },
      addCustomer: (name = 'New customer') => {
        const now = new Date().toISOString();
        const customer: Customer = {
          id: uid(),
          name,
          status: 'active',
          notes: '',
          contacts: [],
          createdAt: now,
          touchedAt: now,
        };
        dispatch({ type: 'addCustomer', customer });
        return customer.id;
      },
      updateCustomer: (id: string, patch: Partial<Customer>) =>
        dispatch({ type: 'updateCustomer', id, patch }),
      removeCustomer: (id: string) => {
        const name = dataRef.current.customers.find((c) => c.id === id)?.name ?? 'Customer';
        withUndo(`${name} removed`);
        dispatch({ type: 'removeCustomer', id });
      },
      addTask: (customerId: string, title: string, description: string, priority: Priority, due?: string) => {
        const id = uid();
        const now = new Date().toISOString();
        dispatch({
          type: 'addTask',
          task: {
            id,
            customerId,
            title,
            description: description || undefined,
            status: 'open',
            priority,
            due: due || undefined,
            createdAt: now,
            updatedAt: now,
          },
        });
        return id;
      },
      updateTask: (id: string, patch: Partial<Task>) => dispatch({ type: 'updateTask', id, patch }),
      removeTask: (id: string) => {
        withUndo('Task removed');
        dispatch({ type: 'removeTask', id });
      },
      undo: () => {
        if (!undo) return;
        dispatch({ type: 'replace', data: undo.snapshot });
        setUndo(null);
      },
      dismissUndo: () => setUndo(null),
    }),
    [undo, withUndo],
  );

  return { data, ready, undo, loadFailed, storageError, actions, hasUnsavedChanges };
}

export type Lamp = 'overdue' | 'open' | 'clear';

export interface Summary {
  open: number;
  overdue: number;
  lamp: Lamp;
}

export function summarize(customerId: string, tasks: Task[]): Summary {
  const t0 = today();
  let open = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (t.customerId !== customerId || t.status === 'done') continue;
    open += 1;
    if (t.due && t.due < t0) overdue += 1;
  }
  return { open, overdue, lamp: overdue > 0 ? 'overdue' : open > 0 ? 'open' : 'clear' };
}
