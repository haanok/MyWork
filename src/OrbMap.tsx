import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { today } from './dates';
import { IconCheck, IconPlus } from './icons';
import { summarize } from './store';
import { rankCustomers } from './quickAddParse';
import type { Customer, Task } from './types';
import { CORD_DROP, useOrbLayout, type LayoutSpec } from './useOrbLayout';

interface Props {
  customers: Customer[];
  tasks: Task[];
  selectedId: string | null;
  query: string;
  compact: boolean;
  isEmpty: boolean;
  centerBubbles: boolean;
  onSelect: (id: string | null) => void;
  onAdvanceTask: (task: Task) => void;
  onAddCustomer: () => void;
  onQuickAddCustomer: (customer: Customer) => void;
  onLoadSample?: () => void;
}

const customerLampR = (open: number) => 30 + Math.min(open, 10) * 3;
const taskLampR = (t: Task) => (t.priority === 'high' ? 21 : 16);

export function OrbMap({
  customers,
  tasks,
  selectedId,
  query,
  compact,
  isEmpty,
  centerBubbles,
  onSelect,
  onAdvanceTask,
  onAddCustomer,
  onQuickAddCustomer,
  onLoadSample,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const measure = () => setSize({ width: Math.round(el.clientWidth), height: Math.round(el.clientHeight) });
    measure();
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sorted = useMemo(() => {
    const all = [...customers].sort((a, b) => a.name.localeCompare(b.name));
    // The map strip above the bottom sheet is too short for the whole board.
    return compact && selectedId ? all.filter((c) => c.id === selectedId) : all;
  }, [customers, compact, selectedId]);

  const summaries = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarize>>();
    for (const c of customers) map.set(c.id, summarize(c.id, tasks));
    return map;
  }, [customers, tasks]);

  const focusTasks = useMemo(() => {
    if (!selectedId || compact) return [];
    const rank = { doing: 0, open: 1, done: 2 } as const;
    return tasks
      .filter((t) => t.customerId === selectedId && t.status !== 'done')
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.due ?? '9').localeCompare(b.due ?? '9'));
  }, [tasks, selectedId, compact]);

  const ringR = Math.max(
    90,
    Math.min(Math.max(150, focusTasks.length * 14), Math.min(size.width, size.height) / 2 - 62),
  );

  const specs = useMemo<LayoutSpec[]>(() => {
    const list: LayoutSpec[] = sorted.map((c) => ({
      id: c.id,
      kind: 'customer',
      r: customerLampR(summaries.get(c.id)?.open ?? 0) + 22,
    }));
    focusTasks.forEach((t, i) =>
      list.push({ id: `task:${t.id}`, kind: 'task', r: taskLampR(t) + 24, slot: i, slots: focusTasks.length }),
    );
    return list;
  }, [sorted, summaries, focusTasks]);

  const layout = useOrbLayout(specs, {
    width: size.width,
    height: size.height,
    focusId: selectedId,
    ringR,
    centerBubbles,
  });

  const fallbackPositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    if (size.width < 10 || size.height < 10 || sorted.length === 0) return positions;
    const columns = Math.max(1, Math.min(sorted.length, Math.floor(size.width / 170)));
    const rows = Math.ceil(sorted.length / columns);
    sorted.forEach((customer, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      positions.set(customer.id, {
        x: ((column + 0.5) / columns) * size.width,
        y: ((row + 0.5) / rows) * size.height,
      });
    });
    return positions;
  }, [sorted, size]);
  const positions = layout.positions.size > 0 ? layout.positions : fallbackPositions;

  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    const pos = positions.get(id);
    if (!pos) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      layout.dragStart(d.id);
    }
    layout.dragMove(d.id, d.ox + dx, d.oy + dy);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      suppressClick.current = true;
      layout.dragEnd(d.id);
      window.setTimeout(() => (suppressClick.current = false), 0);
    }
  };

  const q = query.trim().toLowerCase();
  const matching = useMemo(() => new Set(rankCustomers(customers, query).map((c) => c.id)), [customers, query]);
  const t0 = today();
  const focusPos = selectedId ? positions.get(selectedId) : undefined;
  const showCord = focusPos && !compact && size.width > 0;

  return (
    <div className="map" ref={mapRef}>
      {showCord && (
        <svg className="cord" width={size.width} height={size.height} aria-hidden="true">
          <g key={selectedId}>
            <path pathLength={1} className="cord-edge" d={cordPath(focusPos, size)} />
            <path pathLength={1} className="cord-core" d={cordPath(focusPos, size)} />
            <circle className="cord-plug" cx={size.width - 6} cy={size.height / 2 + CORD_DROP} r={6} />
          </g>
        </svg>
      )}

      {sorted.map((c) => {
        const s = summaries.get(c.id)!;
        const pos = positions.get(c.id);
        const lr = customerLampR(s.open);
        const dim = q !== '' && !matching.has(c.id);
        const selected = c.id === selectedId;
        const muted = selectedId !== null && !selected;
        const style: CSSProperties = {
          ['--d' as string]: `${lr * 2}px`,
          transform: pos ? `translate3d(${pos.x - lr}px, ${pos.y - lr}px, 0)` : undefined,
          visibility: pos ? 'visible' : 'hidden',
        };
        const aria = `${c.name}, ${s.open} open ${s.open === 1 ? 'task' : 'tasks'}${s.overdue ? `, ${s.overdue} overdue` : ''}${c.status !== 'active' ? `, ${c.status}` : ''}`;
        return (
          <div
            key={c.id}
            className={`orb lamp-${s.lamp} has-add-task${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}${muted ? ' is-muted' : ''}${c.status === 'archived' ? ' is-archived' : ''}`}
            style={style}
          >
            <button
              type="button"
              className="lamp"
              aria-label={aria}
              aria-pressed={selected}
              onPointerDown={(e) => onPointerDown(e, c.id)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onClick={() => {
                if (suppressClick.current) return;
                onSelect(selected ? null : c.id);
              }}
            >
              {s.lamp === 'clear' ? <IconCheck width={lr * 0.7} height={lr * 0.7} strokeWidth={2.4} /> : <span className="lamp-count">{s.open}</span>}
            </button>
            <button
              type="button"
              className="orb-add-task"
              aria-label={`Add task for ${c.name}`}
              title={`Add task for ${c.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onQuickAddCustomer(c); }}
            >
              <IconPlus width={15} height={15} />
            </button>
            <span className="strip" aria-hidden="true">
              <span className="strip-name">{c.name}</span>
              {c.status !== 'active' && <span className="strip-tag">{c.status}</span>}
            </span>
          </div>
        );
      })}

      {focusTasks.map((t) => {
        const pos = layout.positions.get(`task:${t.id}`);
        const lr = taskLampR(t);
        const overdue = !!t.due && t.due < t0;
        const style: CSSProperties = {
          ['--d' as string]: `${lr * 2}px`,
          transform: pos ? `translate3d(${pos.x - lr}px, ${pos.y - lr}px, 0)` : undefined,
          visibility: pos ? 'visible' : 'hidden',
        };
        return (
          <div
            key={t.id}
            className={`orb task ${overdue ? 'lamp-overdue' : t.status === 'doing' ? 'lamp-doing' : 'lamp-open'}${t.priority === 'high' ? ' is-high' : ''}`}
            style={style}
          >
            <button
              type="button"
              className="lamp"
              aria-label={`${t.title}, ${t.status}${overdue ? ', overdue' : ''}. Advance status`}
              onClick={() => onAdvanceTask(t)}
            />
            <span className="strip" aria-hidden="true">
              <span className="strip-name">{t.title}</span>
            </span>
          </div>
        );
      })}

      {isEmpty && (
        <div className="empty-socket">
          <button type="button" className="socket" onClick={onAddCustomer}>
            <IconPlus width={30} height={30} />
            <span>Add your first customer</span>
          </button>
          {onLoadSample && (
            <button type="button" className="text-key" onClick={onLoadSample}>
              or load sample customers
            </button>
          )}
        </div>
      )}

      <ul className="legend" aria-label="Lamp key">
        <li><span className="pip lamp-overdue" />Overdue</li>
        <li><span className="pip lamp-open" />Open tasks</li>
        <li><span className="pip lamp-clear" />Clear</li>
      </ul>
    </div>
  );
}

function cordPath(from: { x: number; y: number }, size: { width: number; height: number }) {
  const x1 = size.width - 6;
  const y1 = size.height / 2 + CORD_DROP;
  const sag = 30;
  const c1x = from.x + (x1 - from.x) * 0.3;
  const c2x = from.x + (x1 - from.x) * 0.7;
  return `M ${from.x} ${from.y} C ${c1x} ${from.y + sag}, ${c2x} ${y1 + sag}, ${x1} ${y1}`;
}
