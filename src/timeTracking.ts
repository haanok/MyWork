import { useCallback, useEffect, useRef, useState } from 'react';

/** One continuous stretch of time with a customer open. `end` is the last time it was seen running. */
export interface TimeSegment {
  customerId: string;
  start: number;
  end: number;
}

export interface TrackerState {
  paused: boolean;
  /** True while the last segment is still running. */
  running: boolean;
  segments: TimeSegment[];
}

const STATE_KEY = 'mywork-time-tracking';
export const TIME_TRACKING_ENABLED_KEY = 'mywork-time-tracking-enabled';
/** How often a running segment is checkpointed, so a closed tab loses at most this much. */
const HEARTBEAT_MS = 15_000;
/** A running segment not seen for this long (tab closed, computer asleep) is closed where it was last seen. */
const STALE_MS = 2 * 60_000;

const emptyState = (): TrackerState => ({ paused: false, running: false, segments: [] });

function loadState(): TrackerState {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<TrackerState>;
    const segments = Array.isArray(parsed.segments)
      ? parsed.segments.filter((s): s is TimeSegment =>
          !!s && typeof s.customerId === 'string' && typeof s.start === 'number' && typeof s.end === 'number')
      : [];
    const last = segments[segments.length - 1];
    const running = !!parsed.running && !!last && Date.now() - last.end < STALE_MS;
    return { paused: !!parsed.paused, running, segments };
  } catch {
    return emptyState();
  }
}

export function savedTimeTrackingEnabled(): boolean {
  try {
    return window.localStorage.getItem(TIME_TRACKING_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Closes the running segment at `now`, if any. */
function stop(state: TrackerState, now: number): TrackerState {
  if (!state.running) return state;
  const segments = state.segments.slice();
  const last = segments[segments.length - 1];
  segments[segments.length - 1] = { ...last, end: now };
  return { ...state, running: false, segments };
}

/**
 * Tracks how long each customer is open. Time runs while the feature is enabled,
 * tracking is not paused and a customer is selected.
 */
export function useTimeTracker(enabled: boolean, customerId: string | null) {
  const [state, setState] = useState<TrackerState>(loadState);
  const previousCustomer = useRef(customerId);

  // Opening a different customer resumes a paused tracker. Leaving and reopening the same one does not.
  useEffect(() => {
    if (!customerId || customerId === previousCustomer.current) return;
    previousCustomer.current = customerId;
    if (enabled && customerId) setState((current) => (current.paused ? { ...current, paused: false } : current));
  }, [customerId, enabled]);

  const target = enabled && !state.paused ? customerId : null;

  // Start, stop or switch the running segment whenever the tracked customer changes.
  useEffect(() => {
    setState((current) => {
      const now = Date.now();
      const last = current.segments[current.segments.length - 1];
      if (current.running && last?.customerId === target) return current;
      const stopped = stop(current, now);
      if (!target) return stopped;
      return { ...stopped, running: true, segments: [...stopped.segments, { customerId: target, start: now, end: now }] };
    });
  }, [target]);

  // Checkpoint the running segment periodically and when the page is hidden or closed.
  useEffect(() => {
    if (!state.running) return;
    const beat = () => setState((current) => {
      if (!current.running) return current;
      const segments = current.segments.slice();
      const last = segments[segments.length - 1];
      const now = Date.now();
      // Woken from sleep or a long-suspended tab: close the old segment where it was last seen.
      if (now - last.end > STALE_MS) {
        return { ...current, segments: [...segments, { customerId: last.customerId, start: now, end: now }] };
      }
      segments[segments.length - 1] = { ...last, end: now };
      return { ...current, segments };
    });
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    window.addEventListener('pagehide', beat);
    document.addEventListener('visibilitychange', beat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', beat);
      document.removeEventListener('visibilitychange', beat);
    };
  }, [state.running]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {
      // Tracking still works for this session when storage is unavailable.
    }
  }, [state]);

  const pause = useCallback(() => setState((current) => ({ ...stop(current, Date.now()), paused: true })), []);
  const resume = useCallback(() => setState((current) => ({ ...current, paused: false })), []);
  const clear = useCallback(() => setState((current) => ({ ...stop(current, Date.now()), segments: [] })), []);

  return { state, pause, resume, clear };
}

/** Duration of a segment, counting a running one up to `now`. */
export function segmentMs(state: TrackerState, index: number, now: number): number {
  const segment = state.segments[index];
  const running = state.running && index === state.segments.length - 1;
  return Math.max(0, (running ? now : segment.end) - segment.start);
}

export function totalsByCustomer(state: TrackerState, now: number): Map<string, number> {
  const totals = new Map<string, number>();
  state.segments.forEach((segment, index) => {
    totals.set(segment.customerId, (totals.get(segment.customerId) ?? 0) + segmentMs(state, index, now));
  });
  return totals;
}

/** 1:05:09 */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 1 h 05 min, 12 min, < 1 min */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '< 1 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** Decimal hours rounded to the quarter hour, handy for timesheets. */
export function formatHours(ms: number): string {
  return (Math.round((ms / 3_600_000) * 4) / 4).toFixed(2);
}

/** Re-renders every `interval` ms while `active`. */
export function useNow(active: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [active, interval]);
  return now;
}
