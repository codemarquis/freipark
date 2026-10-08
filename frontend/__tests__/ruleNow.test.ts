import { parseRules } from '../src/features/rules/parseRules';
import { ruleNow } from '../src/features/rules/ruleNow';

// The most frequent real Berlin rule: paid Mo-Fr 09-20, Sa 09-18, free otherwise.
const BERLIN = parseRules({
  fee: 'yes',
  'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)',
  zone: '23',
});

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('ruleNow — a paid Berlin street (2026-10-08 is a Thursday, CEST = UTC+2)', () => {
  it.each([
    // [Berlin wall time, instant, state, until (UTC), next]
    ['Thu 08:59', '2026-10-08T06:59:00Z', 'free', '2026-10-08T07:00:00.000Z', 'paid'],
    ['Thu 09:00', '2026-10-08T07:00:00Z', 'paid', '2026-10-08T18:00:00.000Z', 'free'],
    ['Thu 19:59', '2026-10-08T17:59:00Z', 'paid', '2026-10-08T18:00:00.000Z', 'free'],
    ['Thu 20:00, free across midnight', '2026-10-08T18:00:00Z', 'free', '2026-10-09T07:00:00.000Z', 'paid'],
    ['Thu 23:59', '2026-10-08T21:59:00Z', 'free', '2026-10-09T07:00:00.000Z', 'paid'],
    ['Sat 17:59', '2026-10-10T15:59:00Z', 'paid', '2026-10-10T16:00:00.000Z', 'free'],
    ['Sat 18:00, free through Sunday', '2026-10-10T16:00:00Z', 'free', '2026-10-12T07:00:00.000Z', 'paid'],
    ['Sun noon', '2026-10-11T10:00:00Z', 'free', '2026-10-12T07:00:00.000Z', 'paid'],
  ])('%s', (_label, instant, state, until, next) => {
    const s = ruleNow(BERLIN, at(instant));
    expect(s.state).toBe(state);
    expect(iso(s.until)).toBe(until);
    expect(s.next).toBe(next);
    expect(s.zone).toBe('23');
    expect(s.incomplete).toBe(false);
  });
});

describe('ruleNow — daylight saving time', () => {
  it('autumn: free from Sat 24 Oct 18:00 CEST until Mon 26 Oct 09:00 CET', () => {
    const s = ruleNow(BERLIN, at('2026-10-24T16:00:00Z'));
    expect(s.state).toBe('free');
    expect(iso(s.until)).toBe('2026-10-26T08:00:00.000Z'); // CET = UTC+1
  });

  it('spring: free from Sat 28 Mar 18:00 CET until Mon 30 Mar 09:00 CEST', () => {
    const s = ruleNow(BERLIN, at('2026-03-28T17:00:00Z'));
    expect(s.state).toBe('free');
    expect(iso(s.until)).toBe('2026-03-30T07:00:00.000Z'); // CEST = UTC+2
  });

  it('on the changeover Sunday itself, weekdays are still right', () => {
    expect(ruleNow(BERLIN, at('2026-10-25T11:00:00Z')).state).toBe('free'); // Sun 12:00 CET
    expect(ruleNow(BERLIN, at('2026-10-26T08:30:00Z')).state).toBe('paid'); // Mon 09:30 CET
  });
});

describe('ruleNow — precedence', () => {
  it('a restriction beats the fee, then hands back to it', () => {
    const rules = parseRules({ fee: 'yes', 'restriction:conditional': 'no_parking @ (Mo-Fr 07:00-17:00)' });
    const s = ruleNow(rules, at('2026-10-08T08:00:00Z')); // Thu 10:00
    expect(s).toMatchObject({ state: 'restricted', restriction: 'no_parking', next: 'paid' });
    expect(iso(s.until)).toBe('2026-10-08T15:00:00.000Z'); // 17:00 CEST
  });

  it('residents-only access beats the fee', () => {
    const s = ruleNow(parseRules({ fee: 'yes', access: 'residents' }), at('2026-10-08T08:00:00Z'));
    expect(s.state).toBe('residents');
    expect(s.until).toBeNull();
  });

  it.each([
    ['no', 'not_public'],
    ['private', 'not_public'],
    ['customers', 'customers'],
    ['permit', 'residents'],
  ])('access=%s → %s', (access, state) => {
    expect(ruleNow(parseRules({ access }), at('2026-10-08T08:00:00Z')).state).toBe(state);
  });

  it('a permanently free street has no "until"', () => {
    const s = ruleNow(parseRules({ fee: 'no' }), at('2026-10-08T08:00:00Z'));
    expect(s.state).toBe('free');
    expect(s.until).toBeNull();
  });
});

describe('ruleNow — never guesses', () => {
  it('no rule tags → unknown', () => {
    const s = ruleNow(parseRules({}), at('2026-10-08T08:00:00Z'));
    expect(s).toMatchObject({ state: 'unknown', until: null, next: null, incomplete: false });
  });

  it('an unreadable fee rule makes the state unknown, not "paid"', () => {
    const rules = parseRules({ fee: 'yes', 'fee:conditional': 'no @ (Mo-Fr 00:00-09:00; PH)' });
    expect(ruleNow(rules, at('2026-10-08T08:00:00Z'))).toMatchObject({ state: 'unknown', incomplete: true });
  });

  it('an unreadable restriction makes the state unknown, not "free"', () => {
    const s = ruleNow(parseRules({ fee: 'no', restriction: 'yes' }), at('2026-10-08T08:00:00Z'));
    expect(s).toMatchObject({ state: 'unknown', incomplete: true });
  });

  it('a readable restriction still shows when other tags are unreadable', () => {
    const s = ruleNow(parseRules({ restriction: 'no_stopping', fee: 'maybe' }), at('2026-10-08T08:00:00Z'));
    expect(s).toMatchObject({ state: 'restricted', restriction: 'no_stopping', incomplete: true });
  });

  it('returns unknown when Intl has no time-zone support', () => {
    jest.isolateModules(() => {
      const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
        throw new RangeError('no time zones');
      });
      const fresh = jest.requireActual<typeof import('../src/features/rules/ruleNow')>('../src/features/rules/ruleNow');
      expect(fresh.ruleNow(BERLIN, at('2026-10-08T08:00:00Z')).state).toBe('unknown');
      spy.mockRestore();
    });
  });
});

describe('ruleNow — max stay and disc', () => {
  const DISC = parseRules({
    'authentication:disc': 'yes',
    'maxstay:conditional': '2 hours @ (Mo-Fr 09:00-19:00, Sa 09:00-14:00)',
  });

  it('disc parking is free, with the time limit and when it ends', () => {
    const s = ruleNow(DISC, at('2026-10-08T08:00:00Z')); // Thu 10:00
    expect(s).toMatchObject({ state: 'free', disc: true, maxstayMin: 120 });
    expect(iso(s.maxstayUntil)).toBe('2026-10-08T17:00:00.000Z'); // 19:00 CEST
  });

  it('no limit outside the hours', () => {
    const s = ruleNow(DISC, at('2026-10-08T18:00:00Z')); // Thu 20:00
    expect(s.maxstayMin).toBeNull();
    expect(s.maxstayUntil).toBeNull();
  });

  it('a permanent limit has no end', () => {
    const s = ruleNow(parseRules({ fee: 'no', maxstay: '3 hours' }), at('2026-10-08T08:00:00Z'));
    expect(s).toMatchObject({ maxstayMin: 180, maxstayUntil: null });
  });
});
