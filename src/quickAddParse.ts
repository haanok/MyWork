import { addDays, toISODate } from './dates';
import type { Customer, Priority } from './types';

/**
 * Parses a quick-add line such as "acme: call Per about the contract fri !".
 *
 * - Text before the first colon picks the customer: its short name, or the
 *   start of its name. Without a colon, the open customer is used.
 * - Trailing words can set the due date: today, tomorrow, a weekday (next
 *   one, "mon" or "monday", also Norwegian "man", "fre"…), "+3" / "3d" for
 *   days from now, 2026-11-12, or 12.11 / 12/11 (day.month).
 * - A trailing "!" marks it high priority.
 */
export interface QuickAddParse {
  customer: Customer | null;
  /** Customer text that matched nothing, or several names. */
  customerProblem: string | null;
  title: string;
  due?: string;
  priority: Priority;
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, 'søn': 0, 'søndag': 0,
  mon: 1, monday: 1, man: 1, mandag: 1,
  tue: 2, tues: 2, tuesday: 2, tir: 2, tirsdag: 2,
  wed: 3, wednesday: 3, ons: 3, onsdag: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, tor: 4, torsdag: 4,
  fri: 5, friday: 5, fre: 5, fredag: 5,
  sat: 6, saturday: 6, 'lør': 6, 'lørdag': 6,
};

function nextWeekday(day: number, from = new Date()) {
  const diff = (day - from.getDay() + 7) % 7 || 7;
  return addDays(diff);
}

/** Returns an ISO date for a due-date word, or undefined if it is not one. */
export function parseDueWord(word: string, now = new Date()): string | undefined {
  const w = word.toLowerCase().replace(/[.,;]$/, '');
  if (w === 'today' || w === 'idag') return addDays(0);
  if (w === 'tomorrow' || w === 'tmr' || w === 'imorgen' || w === 'imorra') return addDays(1);
  if (w in WEEKDAYS) return nextWeekday(WEEKDAYS[w], now);
  const rel = /^\+(\d{1,3})d?$/.exec(w) ?? /^(\d{1,3})d$/.exec(w);
  if (rel) return addDays(Number(rel[1]));
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return Number.isNaN(Date.parse(w)) ? undefined : w;
  const dm = /^(\d{1,2})[./](\d{1,2})$/.exec(w);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
    let d = new Date(now.getFullYear(), month, day);
    if (d.getMonth() !== month) return undefined;
    // A date earlier this year means next year.
    if (toISODate(d) < toISODate(now)) d = new Date(now.getFullYear() + 1, month, day);
    return toISODate(d);
  }
  return undefined;
}

function findCustomer(text: string, customers: Customer[]): { customer: Customer | null; problem: string | null } {
  const q = text.trim().toLowerCase();
  if (!q) return { customer: null, problem: null };
  const live = customers.filter((c) => c.status !== 'archived');
  const pool = live.length ? live : customers;
  const short = customers.filter((c) => c.shortName?.toLowerCase() === q);
  if (short.length === 1) return { customer: short[0], problem: null };
  if (short.length > 1) {
    return { customer: null, problem: `Short name “${q}” is used by ${short.map((c) => c.name).join(', ')}. Give each a unique short name.` };
  }
  const exact = pool.filter((c) => c.name.toLowerCase() === q);
  if (exact.length === 1) return { customer: exact[0], problem: null };
  const starts = pool.filter((c) => c.name.toLowerCase().startsWith(q));
  const matches = starts.length ? starts : pool.filter((c) => c.name.toLowerCase().includes(q));
  if (matches.length === 1) return { customer: matches[0], problem: null };
  if (matches.length === 0) return { customer: null, problem: `No customer matches “${text.trim()}”.` };
  return {
    customer: null,
    problem: `“${text.trim()}” matches ${matches.slice(0, 3).map((c) => c.name).join(', ')}${matches.length > 3 ? '…' : ''}. Type more of the name.`,
  };
}

export function parseQuickAdd(input: string, customers: Customer[], current: Customer | null): QuickAddParse {
  const colon = input.indexOf(':');
  let customer = current;
  let customerProblem: string | null = null;
  let rest = input;
  if (colon > 0) {
    const found = findCustomer(input.slice(0, colon), customers);
    customer = found.customer;
    customerProblem = found.problem;
    rest = input.slice(colon + 1);
  }

  const words = rest.trim().split(/\s+/).filter(Boolean);
  let priority: Priority = 'normal';
  let due: string | undefined;
  // Read options from the end, so words like "friday" inside the title stay.
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (/^!+$/.test(last) && priority === 'normal') {
      priority = 'high';
      words.pop();
      continue;
    }
    const date = due ? undefined : parseDueWord(last);
    if (date) {
      due = date;
      words.pop();
      continue;
    }
    break;
  }
  return { customer, customerProblem, title: words.join(' '), due, priority };
}

/**
 * Customers matching a search, best first: exact short name, exact name,
 * short name or name starting with the text, then name containing it.
 */
export function rankCustomers(customers: Customer[], query: string): Customer[] {
  const q = query.trim().toLowerCase();
  if (!q) return customers;
  const score = (c: Customer) => {
    const name = c.name.toLowerCase();
    const short = c.shortName?.toLowerCase() ?? '';
    if (short === q) return 0;
    if (name === q) return 1;
    if (short.startsWith(q) || name.startsWith(q)) return 2;
    if (name.split(/[\s&-]+/).some((word) => word.startsWith(q))) return 3;
    if (name.includes(q)) return 4;
    return -1;
  };
  return customers
    .map((c) => ({ c, s: score(c) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s)
    .map(({ c }) => c);
}
