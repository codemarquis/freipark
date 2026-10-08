import { parseDuration, parseHours, parseRules } from '../src/features/rules/parseRules';
import type { Day, Window } from '../src/features/rules/parseRules';

const MO_FR: Day[] = [0, 1, 2, 3, 4];
const MO_SA: Day[] = [0, 1, 2, 3, 4, 5];

const t = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** Windows for these days, each with the given "HH:MM-HH:MM" ranges. */
function windows(days: Day[], ...ranges: string[]): Window[] {
  return days.flatMap((day) =>
    ranges.map((r) => {
      const [from, to] = r.split('-');
      return { day, from: t(from), to: t(to) };
    }),
  );
}
const byDay = (ws: Window[]) => [...ws].sort((a, b) => a.day - b.day || a.from - b.from);

describe('parseRules — the 12 most frequent Berlin values, verbatim', () => {
  // Measured 2026-10-08 on the Berlin extract (SPEC-parking-rules.md).
  it('1. no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)', () => {
    const r = parseRules({
      fee: 'yes',
      'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)',
    });
    expect(r.fee).toBe('yes');
    expect(r.unknown).toEqual([]);
    expect(r.feeWindows).toEqual([
      {
        value: 'no',
        when: byDay([
          ...windows(MO_FR, '00:00-09:00', '20:00-24:00'),
          ...windows([5], '00:00-09:00', '18:00-24:00'),
          ...windows([6], '00:00-24:00'),
        ]),
      },
    ]);
  });

  it('2. no @ (Mo-Sa 00:00-09:00,22:00-24:00; Su)', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (Mo-Sa 00:00-09:00,22:00-24:00; Su)' });
    expect(r.feeWindows[0].when).toEqual(
      byDay([...windows(MO_SA, '00:00-09:00', '22:00-24:00'), ...windows([6], '00:00-24:00')]),
    );
  });

  it('3. no @ (Mo-Sa 00:00-09:00; Su)', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (Mo-Sa 00:00-09:00; Su)' });
    expect(r.feeWindows[0].when).toEqual(byDay([...windows(MO_SA, '00:00-09:00'), ...windows([6], '00:00-24:00')]));
  });

  it('4. no @ (Mo-Fr 00:00-09:00,22:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)', () => {
    const r = parseRules({
      'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,22:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)',
    });
    expect(r.feeWindows[0].when).toEqual(
      byDay([
        ...windows(MO_FR, '00:00-09:00', '22:00-24:00'),
        ...windows([5], '00:00-09:00', '18:00-24:00'),
        ...windows([6], '00:00-24:00'),
      ]),
    );
  });

  it('5. no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa-Su)', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa-Su)' });
    expect(r.feeWindows[0].when).toEqual(
      byDay([...windows(MO_FR, '00:00-09:00', '20:00-24:00'), ...windows([5, 6], '00:00-24:00')]),
    );
  });

  it('6. a bare "yes" on a :conditional key is unreadable, not a rule', () => {
    const r = parseRules({ 'fee:conditional': 'yes' });
    expect(r.feeWindows).toEqual([]);
    expect(r.unknown).toEqual(['fee:conditional=yes']);
  });

  it('7. no @ (Mo-Sa 00:00-09:00,20:00-24:00; Su)', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (Mo-Sa 00:00-09:00,20:00-24:00; Su)' });
    expect(r.feeWindows[0].when).toEqual(
      byDay([...windows(MO_SA, '00:00-09:00', '20:00-24:00'), ...windows([6], '00:00-24:00')]),
    );
  });

  it('8. no @ (00:00-09:00) — no weekday means every day', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (00:00-09:00)' });
    expect(r.feeWindows[0].when).toEqual(windows([0, 1, 2, 3, 4, 5, 6], '00:00-09:00'));
  });

  it('9./10. 3 hours @ (Mo-Fr 08:00-20:00; Sa 08:00-14:00), with and without the space', () => {
    for (const v of ['3 hours @ (Mo-Fr 08:00-20:00; Sa 08:00-14:00)', '3 hours @ (Mo-Fr 08:00-20:00;Sa 08:00-14:00)']) {
      const r = parseRules({ 'maxstay:conditional': v });
      expect(r.unknown).toEqual([]);
      expect(r.maxstayWindows).toEqual([
        { value: 180, when: byDay([...windows(MO_FR, '08:00-20:00'), ...windows([5], '08:00-14:00')]) },
      ]);
    }
  });

  it('11. no_parking @ (Mo-Fr 07:00-17:00)', () => {
    const r = parseRules({ 'restriction:conditional': 'no_parking @ (Mo-Fr 07:00-17:00)' });
    expect(r.restrictionWindows).toEqual([{ value: 'no_parking', when: windows(MO_FR, '07:00-17:00') }]);
  });

  it('12. no @ (Mo-Fr 00:00-09:00,18:00-24:00; Sa-Su)', () => {
    const r = parseRules({ 'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,18:00-24:00; Sa-Su)' });
    expect(r.feeWindows[0].when).toEqual(
      byDay([...windows(MO_FR, '00:00-09:00', '18:00-24:00'), ...windows([5, 6], '00:00-24:00')]),
    );
  });
});

describe('parseHours', () => {
  it('lets a later rule replace an earlier one for the days it names', () => {
    expect(parseHours('Mo-Fr 08:00-18:00; We 08:00-12:00')).toEqual(
      byDay([...windows([0, 1, 3, 4], '08:00-18:00'), ...windows([2], '08:00-12:00')]),
    );
  });

  it('reads "off" as no window for those days', () => {
    expect(parseHours('Mo-Su 08:00-18:00; Su off')).toEqual(windows([0, 1, 2, 3, 4, 5], '08:00-18:00'));
  });

  it('splits an overnight range at midnight', () => {
    expect(parseHours('Fr 22:00-06:00')).toEqual([
      { day: 4, from: t('22:00'), to: 1440 },
      { day: 5, from: 0, to: t('06:00') },
    ]);
  });

  it('wraps weekday ranges and accepts lists and 24/7', () => {
    expect(parseHours('Sa-Mo 10:00-12:00').map((w) => w.day)).toEqual([0, 5, 6]);
    expect(parseHours('Mo,We 10:00-12:00').map((w) => w.day)).toEqual([0, 2]);
    expect(parseHours('24/7')).toHaveLength(7);
  });

  it('reads "," before a weekday as an additional rule (real Berlin values)', () => {
    const r = parseRules({ 'maxstay:conditional': '2 hours @ (Mo-Fr 09:00-19:00, Sa 09:00-14:00)' });
    expect(r.unknown).toEqual([]);
    expect(r.maxstayWindows[0].when).toEqual(byDay([...windows(MO_FR, '09:00-19:00'), ...windows([5], '09:00-14:00')]));
    // An additional rule adds to the day instead of replacing it.
    expect(parseHours('Mo 08:00-10:00, Mo 12:00-14:00')).toEqual(windows([0], '08:00-10:00', '12:00-14:00'));
    expect(parseHours('Mo 08:00-10:00; Mo 12:00-14:00')).toEqual(windows([0], '12:00-14:00'));
  });

  it('keeps a comma inside a weekday list a weekday list', () => {
    expect(parseHours('Mo,We 10:00-12:00; Sa,Su off')).toEqual(windows([0, 2], '10:00-12:00'));
  });

  it('accepts a space after the comma between time ranges', () => {
    expect(parseHours('Mo 08:00-12:00, 14:00-18:00')).toEqual(windows([0], '08:00-12:00', '14:00-18:00'));
  });
});

describe('parseRules — never guesses', () => {
  it.each([
    ['public holidays', 'no @ (Mo-Fr 09:00-20:00; PH off)'],
    ['months', 'no @ (Jan-Mar Mo-Fr 09:00-18:00)'],
    ['sunrise', 'no @ (sunrise-sunset)'],
    ['fallback rules', 'no @ (Mo-Fr 09:00-18:00 || "nach Vereinbarung")'],
    ['an impossible time', 'no @ (Mo-Fr 25:00-26:00)'],
    ['unbalanced brackets', 'no @ (Mo-Fr 09:00-18:00'],
    ['an unknown value', 'maybe @ (Mo-Fr 09:00-18:00)'],
    ['a user-group condition (real: "none @ residents")', 'no @ (Mo-Fr 09:00-20:00); yes @ residents'],
  ])('%s → unknown, no windows', (_label, value) => {
    const r = parseRules({ 'fee:conditional': value });
    expect(r.feeWindows).toEqual([]);
    expect(r.unknown).toEqual([`fee:conditional=${value}`]);
  });

  it('keeps reading the other tags when one is unreadable', () => {
    const r = parseRules({ fee: 'yes', 'fee:conditional': 'no @ (PH)', zone: '23' });
    expect(r.fee).toBe('yes');
    expect(r.zone).toBe('23');
    expect(r.unknown).toEqual(['fee:conditional=no @ (PH)']);
  });

  it('reads several conditions in one value', () => {
    const r = parseRules({
      'restriction:conditional': 'no_stopping @ (Mo-Fr 07:00-09:00); loading_only @ (Mo-Fr 09:00-12:00)',
    });
    expect(r.restrictionWindows.map((c) => c.value)).toEqual(['no_stopping', 'loading_only']);
  });
});

describe('plain tags', () => {
  it('reads fee, restriction, access, zone and disc', () => {
    const r = parseRules({
      fee: 'no',
      restriction: 'no_stopping',
      access: 'private',
      zone: '23',
      'authentication:disc': 'yes',
      maxstay: '2 h',
    });
    expect(r).toMatchObject({
      fee: 'no',
      restriction: 'no_stopping',
      access: 'private',
      zone: '23',
      disc: true,
      maxstayMin: 120,
      unknown: [],
    });
  });

  it('treats restriction=none and maxstay=no as no rule', () => {
    const r = parseRules({ restriction: 'none', maxstay: 'no' });
    expect(r.restriction).toBeNull();
    expect(r.maxstayMin).toBeNull();
    expect(r.unknown).toEqual([]);
  });

  it('returns empty rules for no tags', () => {
    expect(parseRules({})).toMatchObject({ fee: null, zone: null, disc: false, unknown: [] });
  });
});

describe('parseDuration', () => {
  it.each([
    ['3 hours', 180],
    ['1 hour', 60],
    ['2 h', 120],
    ['90 minutes', 90],
    ['30 min', 30],
    ['1.5 hours', 90],
    ['1 day', 1440],
  ])('%s → %d min', (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it('refuses a bare number (no agreed unit) and nonsense', () => {
    expect(() => parseDuration('180')).toThrow();
    expect(() => parseDuration('0 hours')).toThrow();
    expect(() => parseDuration('a while')).toThrow();
  });
});
