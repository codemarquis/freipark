import {
  REPORT_TTL_MS,
  activeReport,
  ageMinutes,
  errorCode,
  isActive,
  maxRadiusFor,
} from '../src/features/reports/reportStatus';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const minutesBefore = (m: number): string => new Date(NOW - m * 60_000).toISOString();

describe('isActive', () => {
  it('is false when there is no report', () => {
    expect(isActive(null, NOW)).toBe(false);
    expect(isActive(undefined, NOW)).toBe(false);
  });

  it('is true just inside the 30-minute window', () => {
    expect(isActive(new Date(NOW - REPORT_TTL_MS + 1000).toISOString(), NOW)).toBe(true);
  });

  it('is false at exactly 30 minutes and after', () => {
    expect(isActive(minutesBefore(30), NOW)).toBe(false);
    expect(isActive(minutesBefore(45), NOW)).toBe(false);
  });

  it('treats a slightly-future timestamp (clock skew) as active', () => {
    expect(isActive(new Date(NOW + 5_000).toISOString(), NOW)).toBe(true);
  });

  it('is false for an unparseable timestamp', () => {
    expect(isActive('not-a-date', NOW)).toBe(false);
  });

  // PostgREST serialises timestamptz with microseconds; Hermes's Date.parse
  // isn't guaranteed to accept more than 3 fractional digits.
  it('accepts PostgREST timestamps with microseconds', () => {
    expect(isActive('2026-10-07T11:50:00.123456+00:00', NOW)).toBe(true);
    expect(ageMinutes('2026-10-07T11:50:00.123456+00:00', NOW)).toBe(9);
  });
});

describe('ageMinutes', () => {
  it('rounds down to whole minutes', () => {
    expect(ageMinutes(new Date(NOW - 4.9 * 60_000).toISOString(), NOW)).toBe(4);
  });

  it('never goes negative', () => {
    expect(ageMinutes(new Date(NOW + 60_000).toISOString(), NOW)).toBe(0);
  });
});

describe('activeReport', () => {
  it('returns status and age for an active report', () => {
    expect(activeReport({ report_status: 'free', report_at: minutesBefore(12) }, NOW)).toEqual({
      status: 'free',
      minutesAgo: 12,
    });
  });

  it('returns null for an expired report', () => {
    expect(activeReport({ report_status: 'full', report_at: minutesBefore(31) }, NOW)).toBeNull();
  });

  it('returns null when there is no report', () => {
    expect(activeReport({ report_status: null, report_at: null }, NOW)).toBeNull();
  });

  // MapLibre can drop null-valued feature properties, so a spot read back
  // from a tapped marker may have the fields missing entirely.
  it('returns null when the fields are missing', () => {
    expect(activeReport({}, NOW)).toBeNull();
  });
});

describe('errorCode', () => {
  it.each(['not_authenticated', 'too_far', 'rate_limited_spot', 'rate_limited_hourly'] as const)(
    'passes %s through',
    (code) => {
      expect(errorCode(code)).toBe(code);
    },
  );

  it.each([undefined, '', 'invalid_status', 'spot_not_found', 'JWT expired', 'Network request failed'])(
    'maps %p to unknown',
    (message) => {
      expect(errorCode(message)).toBe('unknown');
    },
  );
});

describe('maxRadiusFor', () => {
  it('allows 150 m for street spots', () => {
    expect(maxRadiusFor('street')).toBe(150);
  });

  it.each(['lot', 'garage', 'zone'] as const)('allows 300 m for %s', (spotType) => {
    expect(maxRadiusFor(spotType)).toBe(300);
  });
});
