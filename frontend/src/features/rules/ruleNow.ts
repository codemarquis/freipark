// What applies at a spot right now, and until when (SPEC-parking-rules.md).
//
// All wall-clock maths happens in Europe/Berlin via Intl, so the answer is
// the same whatever time zone the phone is in, and DST is handled by the
// platform's time-zone data. If Intl can't do that, the answer is
// "unknown" — never a guess.

import type { Access, Conditional, Day, Restriction, SpotRules, Window } from './parseRules';

export type RuleState =
  | 'restricted'   // no parking / no stopping / loading or charging only
  | 'not_public'   // access=no|private
  | 'customers'    // access=customers
  | 'residents'    // access=residents
  | 'permit'       // access=permit (any permit holder)
  | 'paid'
  | 'free'
  | 'unknown';

export interface RuleStatus {
  state: RuleState;
  /** Which restriction, when state is 'restricted'. */
  restriction: Restriction | null;
  /** When the current state ends, if that's within the next 7 days. */
  until: Date | null;
  /** The state after `until`. */
  next: RuleState | null;
  /** Maximum stay that applies now, in minutes. */
  maxstayMin: number | null;
  /** When that maximum stay stops applying, if it's time-limited. */
  maxstayUntil: Date | null;
  disc: boolean;
  zone: string | null;
  /** Some rule tags couldn't be read; the UI says so. */
  incomplete: boolean;
}

const TIME_ZONE = 'Europe/Berlin';
const LOOK_AHEAD_DAYS = 7;
const WEEKDAYS: Record<string, Day> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

interface LocalTime {
  year: number;
  month: number;
  date: number;
  day: Day;
  minute: number; // minutes since local midnight
}

let formatter: Intl.DateTimeFormat | null = null;

/** The Berlin wall-clock time of an instant. Throws if Intl can't. */
function berlinTime(instant: Date): LocalTime {
  formatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(instant)) parts[p.type] = p.value;
  const day = WEEKDAYS[parts.weekday];
  const hour = Number(parts.hour) % 24;
  if (day === undefined || Number.isNaN(hour)) throw new Error('Intl time zone unavailable');
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    date: Number(parts.day),
    day,
    minute: hour * 60 + Number(parts.minute),
  };
}

/** Berlin's offset from UTC at an instant, in ms. */
function offsetAt(instant: number): number {
  const t = berlinTime(new Date(instant));
  const wall = Date.UTC(t.year, t.month - 1, t.date) + t.minute * 60_000;
  return wall - Math.floor(instant / 60_000) * 60_000;
}

/** The instant of a Berlin wall-clock time (a second pass settles DST changes). */
function instantOf(year: number, month: number, date: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, date) + minute * 60_000;
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

const inside = (when: Window[], t: LocalTime) =>
  when.some((w) => w.day === t.day && t.minute >= w.from && t.minute < w.to);

/** The value in force: the last matching condition wins, else the base value. */
function valueAt<T>(base: T | null, conditionals: Conditional<T>[], t: LocalTime): T | null {
  let value = base;
  for (const c of conditionals) if (inside(c.when, t)) value = c.value;
  return value;
}

const ACCESS_STATE: Partial<Record<Access, RuleState>> = {
  no: 'not_public',
  private: 'not_public',
  customers: 'customers',
  residents: 'residents',
  permit: 'permit',
};

const hasUnknown = (rules: SpotRules, ...prefixes: string[]) =>
  rules.unknown.some((u) => prefixes.some((p) => u.startsWith(p)));

function stateAt(rules: SpotRules, t: LocalTime): { state: RuleState; restriction: Restriction | null } {
  const restriction = valueAt(rules.restriction, rules.restrictionWindows, t);
  if (restriction) return { state: 'restricted', restriction };
  // Something we couldn't read might restrict parking or change the fee.
  if (hasUnknown(rules, 'restriction', 'access', 'fee')) return { state: 'unknown', restriction: null };
  const access = valueAt(rules.access, rules.accessWindows, t);
  const byAccess = access ? ACCESS_STATE[access] : undefined;
  if (byAccess) return { state: byAccess, restriction: null };
  const fee = valueAt(rules.fee, rules.feeWindows, t);
  if (fee === 'yes') return { state: 'paid', restriction: null };
  if (fee === 'no' || rules.disc) return { state: 'free', restriction: null };
  return { state: 'unknown', restriction: null };
}

/** Every Berlin wall-clock instant in the next 7 days where a rule could change. */
function boundaries(rules: SpotRules, now: LocalTime): Date[] {
  const minutesByDay = new Map<Day, Set<number>>();
  const add = (w: Window) => {
    const set = minutesByDay.get(w.day) ?? new Set<number>([0]);
    set.add(w.from);
    if (w.to < 1440) set.add(w.to);
    minutesByDay.set(w.day, set);
  };
  const lists: Conditional<unknown>[][] = [
    rules.feeWindows, rules.restrictionWindows, rules.accessWindows, rules.maxstayWindows,
  ];
  for (const list of lists) for (const c of list) c.when.forEach(add);

  const out: Date[] = [];
  for (let k = 0; k <= LOOK_AHEAD_DAYS; k++) {
    const day = new Date(Date.UTC(now.year, now.month - 1, now.date + k));
    const weekday = ((now.day + k) % 7) as Day;
    const minutes = [...(minutesByDay.get(weekday) ?? new Set<number>([0]))].sort((a, b) => a - b);
    for (const m of minutes) {
      if (k === 0 && m <= now.minute) continue;
      out.push(instantOf(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), m));
    }
  }
  return out;
}

/** What applies at `now` (default: the current time) and what changes next. */
export function ruleNow(rules: SpotRules, now: Date = new Date()): RuleStatus {
  const status: RuleStatus = {
    state: 'unknown',
    restriction: null,
    until: null,
    next: null,
    maxstayMin: null,
    maxstayUntil: null,
    disc: rules.disc,
    zone: rules.zone,
    incomplete: rules.unknown.length > 0,
  };

  let local: LocalTime;
  try {
    local = berlinTime(now);
  } catch {
    return status;
  }

  const current = stateAt(rules, local);
  status.state = current.state;
  status.restriction = current.restriction;
  status.maxstayMin = hasUnknown(rules, 'maxstay') ? null : valueAt(rules.maxstayMin, rules.maxstayWindows, local);

  const wantUntil = current.state !== 'unknown';
  const wantMaxstayUntil = status.maxstayMin !== null && rules.maxstayWindows.length > 0;
  if (!wantUntil && !wantMaxstayUntil) return status;

  for (const instant of boundaries(rules, local)) {
    const t = berlinTime(instant);
    if (wantUntil && status.until === null) {
      const s = stateAt(rules, t);
      if (s.state !== current.state || s.restriction !== current.restriction) {
        status.until = instant;
        status.next = s.state;
      }
    }
    if (wantMaxstayUntil && status.maxstayUntil === null
      && valueAt(rules.maxstayMin, rules.maxstayWindows, t) !== status.maxstayMin) {
      status.maxstayUntil = instant;
    }
    if ((!wantUntil || status.until) && (!wantMaxstayUntil || status.maxstayUntil)) break;
  }
  return status;
}
