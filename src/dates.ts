export const toISODate = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const today = () => toISODate(new Date());

export const addDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export function formatDue(iso: string) {
  return fmt.format(parse(iso));
}

export function formatDueLong(iso: string) {
  return fmtLong.format(parse(iso));
}

/** Whole days from today to the given date; negative when past. */
export function daysUntil(iso: string) {
  const t = parse(today());
  return Math.round((parse(iso).getTime() - t.getTime()) / 86_400_000);
}

export function relativeDue(iso: string) {
  const d = daysUntil(iso);
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
