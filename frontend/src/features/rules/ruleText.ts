import type { TFunction } from 'i18next';
import type { RuleState, RuleStatus } from './ruleNow';

export type RuleTone = 'free' | 'paid' | 'limited' | 'restricted' | 'neutral' | 'unknown';

export interface RuleText {
  headline: string;
  tone: RuleTone;
  details: string[];
}

const TONE: Record<RuleState, RuleTone> = {
  free: 'free',
  paid: 'paid',
  residents: 'limited',
  customers: 'limited',
  restricted: 'restricted',
  not_public: 'neutral',
  unknown: 'unknown',
};

const TIME_ZONE = 'Europe/Berlin';
const berlinDay = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** "20:00" today, "Mo. 09:00" on a later day — Berlin time, 24-hour like the signs. */
export function formatWhen(when: Date, now: Date, language: string): string {
  const sameDay = berlinDay(when) === berlinDay(now);
  return new Intl.DateTimeFormat(language, {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(sameDay ? {} : { weekday: 'short' }),
  }).format(when);
}

export function formatDuration(minutes: number, t: TFunction): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return t('rules.durationHMin', { h, m });
  if (h) return t('rules.durationH', { h });
  return t('rules.durationMin', { m });
}

function headline(status: RuleStatus, t: TFunction, time: string | null): string {
  switch (status.state) {
    case 'free':
      if (!time) return t('rules.free');
      return status.next === 'paid' ? t('rules.freeUntilPaid', { time }) : t('rules.freeUntil', { time });
    case 'paid':
      if (!time) return t('rules.paid');
      return status.next === 'free' ? t('rules.paidUntilFree', { time }) : t('rules.paidUntil', { time });
    case 'restricted': {
      const what = t(`rules.restriction.${status.restriction ?? 'no_parking'}`);
      return time ? t('rules.restrictedUntil', { what, time }) : what;
    }
    case 'residents':
      return t('rules.residents');
    case 'customers':
      return t('rules.customers');
    case 'not_public':
      return t('rules.notPublic');
    case 'unknown':
      return t('rules.unknown');
  }
}

/** The sheet's rule line: headline, its tone, and the detail lines. */
export function ruleText(status: RuleStatus, t: TFunction, language: string, now: Date): RuleText {
  const time = status.until ? formatWhen(status.until, now, language) : null;
  const details: string[] = [];
  if (status.maxstayMin !== null) {
    const duration = formatDuration(status.maxstayMin, t);
    details.push(
      status.maxstayUntil
        ? t('rules.maxstayUntil', { duration, time: formatWhen(status.maxstayUntil, now, language) })
        : t('rules.maxstay', { duration }),
    );
  }
  if (status.disc) details.push(t('rules.disc'));
  if (status.zone) details.push(t('rules.zone', { zone: status.zone }));
  if (status.incomplete && status.state !== 'unknown') details.push(t('rules.incomplete'));
  return { headline: headline(status, t, time), tone: TONE[status.state], details };
}
