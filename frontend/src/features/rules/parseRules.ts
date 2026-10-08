// OSM parking rule tags → structured rules (SPEC-parking-rules.md).
//
// Reads the opening-hours *subset* that Berlin's tags actually use: weekday
// ranges and lists, one or more time ranges per day (24:00 and overnight
// ranges allowed), ";"-separated rules where a later rule replaces earlier
// ones for the days it names, bare weekdays (all day) and "off". Anything
// else — public holidays, months, sunrise, "||" fallbacks — is reported as
// unknown and never turned into a time window.

export type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Monday = 0, as OSM orders weekdays

/** A stretch of one weekday, in minutes since local midnight (0 ≤ from < to ≤ 1440). */
export interface Window {
  day: Day;
  from: number;
  to: number;
}

/** "value @ (hours)": the value applies during these windows. */
export interface Conditional<T> {
  value: T;
  when: Window[];
}

export type Fee = 'yes' | 'no';
export type Restriction = 'no_parking' | 'no_stopping' | 'loading_only' | 'charging_only';
export type Access =
  | 'yes' | 'no' | 'private' | 'customers' | 'residents' | 'permit' | 'destination' | 'permissive';

export interface SpotRules {
  fee: Fee | null;
  feeWindows: Conditional<Fee>[];
  maxstayMin: number | null;
  maxstayWindows: Conditional<number>[];
  restriction: Restriction | null;
  restrictionWindows: Conditional<Restriction>[];
  access: Access | null;
  accessWindows: Conditional<Access>[];
  disc: boolean;
  zone: string | null;
  /** "key=value" for every rule tag we couldn't read. */
  unknown: string[];
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const ALL_DAYS: readonly Day[] = [0, 1, 2, 3, 4, 5, 6];
const FEES: readonly Fee[] = ['yes', 'no'];
const RESTRICTIONS: readonly Restriction[] = ['no_parking', 'no_stopping', 'loading_only', 'charging_only'];
const ACCESS: readonly Access[] = [
  'yes', 'no', 'private', 'customers', 'residents', 'permit', 'destination', 'permissive',
];

class Unreadable extends Error {}

function dayIndex(token: string): Day {
  const i = DAYS.indexOf(token as (typeof DAYS)[number]);
  if (i < 0) throw new Unreadable(token);
  return i as Day;
}

/** "Mo-Fr,Su" → [0,1,2,3,4,6]; ranges may wrap ("Sa-Mo"). */
function parseDays(spec: string): Day[] {
  const days: Day[] = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-');
    const start = dayIndex(a);
    if (b === undefined) {
      days.push(start);
      continue;
    }
    const end = dayIndex(b);
    for (let d: number = start; ; d = (d + 1) % 7) {
      days.push(d as Day);
      if (d === end) break;
    }
  }
  return days;
}

function minutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Unreadable(hhmm);
  const value = Number(m[1]) * 60 + Number(m[2]);
  if (Number(m[2]) > 59 || value > 1440) throw new Unreadable(hhmm);
  return value;
}

interface TimeRange {
  from: number;
  to: number;
  nextDay: boolean;
}

/** "00:00-09:00,20:00-24:00" → ranges; an overnight range is split at midnight. */
function parseTimes(spec: string): TimeRange[] {
  const out: TimeRange[] = [];
  for (const range of spec.split(',')) {
    const [a, b] = range.split('-');
    if (b === undefined) throw new Unreadable(range);
    const from = minutes(a);
    const to = minutes(b);
    if (from === to) throw new Unreadable(range);
    if (from < to) {
      out.push({ from, to, nextDay: false });
    } else {
      if (from < 1440) out.push({ from, to: 1440, nextDay: false });
      if (to > 0) out.push({ from: 0, to, nextDay: true });
    }
  }
  return out;
}

const DAYS_RE = /^(Mo|Tu|We|Th|Fr|Sa|Su)([-,](Mo|Tu|We|Th|Fr|Sa|Su))*$/;
const TIMES_RE = /^\d{1,2}:\d{2}-\d{1,2}:\d{2}(,\d{1,2}:\d{2}-\d{1,2}:\d{2})*$/;

/** Opening-hours subset → windows. Throws Unreadable for anything outside it. */
export function parseHours(hours: string): Window[] {
  const byDay = new Map<Day, { from: number; to: number }[]>();

  // ";" starts a rule that replaces earlier ones for its days; a "," after a
  // time or "off" and before a weekday starts an *additional* rule
  // ("Mo-Fr 09:00-19:00, Sa 09:00-14:00"). A comma inside a weekday list
  // ("Mo,We") is neither.
  const rules: { text: string; additional: boolean }[] = [];
  for (const sequence of hours.split(';')) {
    sequence
      .replace(/(\d|off)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/g, '$1\u0000')
      .split('\u0000')
      .forEach((text, i) => rules.push({ text, additional: i > 0 }));
  }

  for (const { text, additional } of rules) {
    const rule = text.trim().replace(/\s*,\s*/g, ','); // "08:00-12:00, 14:00-18:00"
    if (!rule) continue;
    if (rule === '24/7') {
      for (const d of ALL_DAYS) byDay.set(d, [{ from: 0, to: 1440 }]);
      continue;
    }
    const parts = rule.split(/\s+/);
    let days: readonly Day[] = ALL_DAYS;
    let rest = parts;
    if (DAYS_RE.test(parts[0])) {
      days = parseDays(parts[0]);
      rest = parts.slice(1);
    }
    // A later rule replaces earlier ones for the days it names (unless additional).
    if (!additional) for (const d of days) byDay.set(d, []);
    if (rest.length === 0) {
      for (const d of days) byDay.set(d, [{ from: 0, to: 1440 }]); // bare weekday = all day
      continue;
    }
    if (rest.length === 1 && rest[0] === 'off') continue;
    if (rest.length !== 1 || !TIMES_RE.test(rest[0])) throw new Unreadable(rule);
    for (const t of parseTimes(rest[0])) {
      for (const d of days) {
        const day = (t.nextDay ? (d + 1) % 7 : d) as Day;
        const list = byDay.get(day) ?? [];
        list.push({ from: t.from, to: t.to });
        byDay.set(day, list);
      }
    }
  }

  const windows: Window[] = [];
  for (const d of ALL_DAYS) {
    for (const w of byDay.get(d) ?? []) windows.push({ day: d, from: w.from, to: w.to });
  }
  return windows;
}

/** Split "a @ (x; y); b @ (z)" at the semicolons outside parentheses. */
function splitConditions(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) throw new Unreadable(value);
    if (ch === ';' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (depth !== 0) throw new Unreadable(value);
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseConditional<T>(value: string, read: (v: string) => T): Conditional<T>[] {
  return splitConditions(value).map((condition) => {
    const at = condition.indexOf('@');
    if (at < 0) throw new Unreadable(condition);
    const hours = condition.slice(at + 1).trim().replace(/^\((.*)\)$/, '$1');
    return { value: read(condition.slice(0, at).trim()), when: parseHours(hours) };
  });
}

function oneOf<T extends string>(allowed: readonly T[]) {
  return (v: string): T => {
    if (!(allowed as readonly string[]).includes(v)) throw new Unreadable(v);
    return v as T;
  };
}

/** "3 hours", "2 h", "90 minutes", "90 min" → minutes. A bare number has no
 *  agreed unit, so it's unreadable rather than guessed. */
export function parseDuration(value: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(hours?|h|minutes?|mins?|days?)$/i.exec(value.trim());
  if (!m) throw new Unreadable(value);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const result = unit.startsWith('h') ? n * 60 : unit.startsWith('d') ? n * 1440 : n;
  if (!Number.isFinite(result) || result <= 0) throw new Unreadable(value);
  return Math.round(result);
}

const readFee = oneOf(FEES);
const readRestriction = oneOf(RESTRICTIONS);
const readAccess = oneOf(ACCESS);

/** Rule tags (as returned by spot_details' rule_tags) → structured rules. */
export function parseRules(tags: Readonly<Record<string, string>>): SpotRules {
  const rules: SpotRules = {
    fee: null,
    feeWindows: [],
    maxstayMin: null,
    maxstayWindows: [],
    restriction: null,
    restrictionWindows: [],
    access: null,
    accessWindows: [],
    disc: false,
    zone: null,
    unknown: [],
  };

  const attempt = (key: string, apply: (value: string) => void) => {
    const value = tags[key];
    if (value === undefined) return;
    try {
      apply(value.trim());
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      rules.unknown.push(`${key}=${value}`);
    }
  };

  attempt('fee', (v) => (rules.fee = readFee(v)));
  attempt('fee:conditional', (v) => (rules.feeWindows = parseConditional(v, readFee)));
  attempt('maxstay', (v) => {
    if (v !== 'no' && v !== 'unlimited') rules.maxstayMin = parseDuration(v);
  });
  attempt('maxstay:conditional', (v) => (rules.maxstayWindows = parseConditional(v, parseDuration)));
  attempt('restriction', (v) => {
    if (v !== 'none') rules.restriction = readRestriction(v);
  });
  attempt('restriction:conditional', (v) => (rules.restrictionWindows = parseConditional(v, readRestriction)));
  attempt('access', (v) => (rules.access = readAccess(v)));
  attempt('access:conditional', (v) => (rules.accessWindows = parseConditional(v, readAccess)));
  attempt('zone', (v) => {
    if (!v) throw new Unreadable(v);
    rules.zone = v;
  });
  rules.disc = tags['authentication:disc'] === 'yes' || tags['parking:disc'] === 'yes';
  return rules;
}
