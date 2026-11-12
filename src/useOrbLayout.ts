import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface LayoutSpec {
  id: string;
  kind: 'customer' | 'task';
  /** Collision radius, including the label strip below the lamp. */
  r: number;
  /** Task slot index around the focused customer. */
  slot?: number;
  slots?: number;
}

interface SimNode extends SimulationNodeDatum, LayoutSpec {
  x: number;
  y: number;
  pinned?: boolean;
}

export type Positions = Map<string, { x: number; y: number }>;

/** Cord leaves the focused lamp this far below centre and needs this half-height of clear space. */
export const CORD_DROP = 24;
const CORD_HALF = 50;
const POSITION_STORAGE_KEY = 'mywork-map-positions-v1';

type SavedPositions = Record<string, { x: number; y: number }>;

function readSavedPositions(): SavedPositions {
  try {
    const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, value]) => {
        if (!id || !value || typeof value !== 'object') return false;
        const point = value as { x?: unknown; y?: unknown };
        return typeof point.x === 'number'
          && Number.isFinite(point.x)
          && point.x >= 0
          && point.x <= 1
          && typeof point.y === 'number'
          && Number.isFinite(point.y)
          && point.y >= 0
          && point.y <= 1;
      }),
    ) as SavedPositions;
  } catch {
    return {};
  }
}

function saveCustomerPositions(nodes: Map<string, SimNode>, width: number, height: number) {
  if (width < 10 || height < 10) return;
  const saved = readSavedPositions();
  nodes.forEach((node) => {
    if (node.kind === 'customer') {
      saved[node.id] = {
        x: Math.max(0, Math.min(1, node.x / width)),
        y: Math.max(0, Math.min(1, node.y / height)),
      };
    }
  });
  try {
    window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // The map stays usable when browser storage is unavailable or full.
  }
}

interface Options {
  width: number;
  height: number;
  focusId: string | null;
  ringR: number;
  centerBubbles: boolean;
}

const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useOrbLayout(specs: LayoutSpec[], { width, height, focusId, ringR, centerBubbles }: Options) {
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef(new Map<string, SimNode>());
  const sizeRef = useRef({ width: 0, height: 0 });
  const [positions, setPositions] = useState<Positions>(new Map());

  const key = useMemo(
    () => specs.map((s) => `${s.id}:${s.kind}:${Math.round(s.r)}:${s.slot ?? ''}/${s.slots ?? ''}`).join('|'),
    [specs],
  );

  useEffect(() => {
    if (width < 10 || height < 10) return;
    const cx = width / 2;
    const cy = height / 2;
    const known = nodesRef.current;
    const previousSize = sizeRef.current;
    const savedPositions = readSavedPositions();
    const focusNode = focusId ? known.get(focusId) : undefined;

    if (previousSize.width > 0 && previousSize.height > 0) {
      const scaleX = width / previousSize.width;
      const scaleY = height / previousSize.height;
      known.forEach((node) => {
        node.x *= scaleX;
        node.y *= scaleY;
        if (node.fx != null) node.fx *= scaleX;
        if (node.fy != null) node.fy *= scaleY;
        node.vx = 0;
        node.vy = 0;
      });
    }
    sizeRef.current = { width, height };

    const next = new Map<string, SimNode>();
    for (const spec of specs) {
      const prev = known.get(spec.id);
      if (prev) {
        Object.assign(prev, spec);
        if (spec.kind === 'customer') {
          prev.pinned = !centerBubbles;
          prev.fx = centerBubbles ? null : prev.x;
          prev.fy = centerBubbles ? null : prev.y;
        }
        next.set(spec.id, prev);
      } else {
        const fromFocus = spec.kind === 'task' && focusNode;
        const saved = spec.kind === 'customer' ? savedPositions[spec.id] : undefined;
        const x = saved ? saved.x * width : fromFocus ? focusNode.x : cx + (Math.random() - 0.5) * 160;
        const y = saved ? saved.y * height : fromFocus ? focusNode.y : cy + (Math.random() - 0.5) * 160;
        const pinned = Boolean(saved) && !centerBubbles;
        next.set(spec.id, {
          ...spec,
          x,
          y,
          fx: pinned ? x : undefined,
          fy: pinned ? y : undefined,
          pinned,
        });
      }
    }
    nodesRef.current = next;
    const nodes = [...next.values()];

    const slotPos = (n: SimNode) => {
      const angle = (((n.slot ?? 0) + 0.5) / Math.max(1, n.slots ?? 1)) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * ringR, y: cy + Math.sin(angle) * ringR };
    };

    const target = (n: SimNode, axis: 'x' | 'y') => {
      if (n.kind === 'task') return slotPos(n)[axis];
      return axis === 'x' ? cx : cy;
    };

    const strength = (n: SimNode) => {
      if (n.kind === 'task') return 0.16;
      if (n.pinned) return 0;
      if (focusId) return n.id === focusId ? 0.3 : 0.012;
      return 0.022;
    };

    const push = () => {
      if (!focusId) return;
      for (const n of nodes) {
        if (n.kind !== 'customer' || n.id === focusId) continue;
        const dx = n.x - cx;
        const dy = n.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        const min = ringR + n.r + 64;
        if (d < min) {
          n.vx = (n.vx ?? 0) + (dx / d) * (min - d) * 0.09;
          n.vy = (n.vy ?? 0) + (dy / d) * (min - d) * 0.09;
        }
        // Keep the cord's path to the sheet free of other lamps.
        if (dx > 0) {
          const dyBand = n.y - (cy + CORD_DROP);
          const half = CORD_HALF + n.r * 0.6;
          if (Math.abs(dyBand) < half) {
            n.vy = (n.vy ?? 0) + Math.sign(dyBand || 1) * (half - Math.abs(dyBand)) * 0.12;
          }
        }
      }
    };

    const bounds = () => {
      for (const n of nodes) {
        const padX = Math.min(Math.max(n.r + 6, 76), width / 2 - 1);
        const padTop = Math.min(n.r - 14, height / 2 - 1);
        const padBottom = Math.min(n.r + 6, height / 2 - 1);
        n.x = Math.max(padX, Math.min(width - padX, n.x));
        n.y = Math.max(padTop, Math.min(height - padBottom, n.y));
        if (n.pinned) {
          n.fx = n.x;
          n.fy = n.y;
        }
      }
    };

    let saveTimer = 0;
    const savePositions = () => {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
      saveCustomerPositions(nodesRef.current, width, height);
    };
    const scheduleSave = () => {
      if (saveTimer) return;
      saveTimer = window.setTimeout(savePositions, 300);
    };

    const snapshot = () => {
      const map: Positions = new Map();
      for (const n of nodes) map.set(n.id, { x: n.x, y: n.y });
      setPositions(map);
      scheduleSave();
    };

    simRef.current?.stop();
    const sim = forceSimulation<SimNode>(nodes)
      .velocityDecay(0.34)
      .alphaDecay(0.028)
      .force('x', forceX<SimNode>((n) => target(n, 'x')).strength(strength))
      .force('y', forceY<SimNode>((n) => target(n, 'y')).strength((n) => strength(n) * 1.25))
      .force('charge', forceManyBody<SimNode>().strength((n) => (n.kind === 'customer' ? -110 : -6)).distanceMax(420))
      .force('collide', forceCollide<SimNode>((n) => n.r + 10).strength(0.9).iterations(2))
      .force('push', push)
      .force('bounds', bounds);
    simRef.current = sim;
    sim.on('tick', snapshot);
    snapshot();

    if (reduceMotion()) {
      sim.stop();
      sim.alpha(1);
      for (let i = 0; i < 320; i += 1) sim.tick();
      snapshot();
    } else {
      sim.alpha(0.9).restart();
    }
    return () => {
      sim.stop();
      savePositions();
    };
    // `key` stands in for specs so identical specs do not restart the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, width, height, focusId, ringR, centerBubbles]);

  const dragStart = useCallback((id: string) => {
    const n = nodesRef.current.get(id);
    if (!n) return;
    n.fx = n.x;
    n.fy = n.y;
    n.pinned = true;
    simRef.current?.alphaTarget(0.25).restart();
  }, []);

  const dragMove = useCallback((id: string, x: number, y: number) => {
    const n = nodesRef.current.get(id);
    if (!n) return;
    n.x = x;
    n.y = y;
    n.fx = x;
    n.fy = y;
  }, []);

  const dragEnd = useCallback((id: string) => {
    const n = nodesRef.current.get(id);
    if (n) {
      n.pinned = !centerBubbles;
      n.fx = centerBubbles ? null : n.x;
      n.fy = centerBubbles ? null : n.y;
      n.vx = 0;
      n.vy = 0;
    }
    simRef.current?.alphaTarget(0);
    if (centerBubbles) simRef.current?.alpha(0.35).restart();
    saveCustomerPositions(nodesRef.current, sizeRef.current.width, sizeRef.current.height);
  }, [centerBubbles]);

  return { positions, dragStart, dragMove, dragEnd };
}
