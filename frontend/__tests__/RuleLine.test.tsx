import { act, render, screen } from '@testing-library/react-native';
import i18n from '../src/i18n';
import { RuleLine } from '../src/features/rules/RuleLine';

// The most frequent real Berlin rule (SPEC-parking-rules.md).
const BERLIN = {
  fee: 'yes',
  'fee:conditional': 'no @ (Mo-Fr 00:00-09:00,20:00-24:00; Sa 00:00-09:00,18:00-24:00; Su)',
  zone: '23',
};
const DISCLAIMER = 'From OpenStreetMap — signs on site take precedence.';

// 2026-10-08 is a Thursday; Berlin is UTC+2 (CEST).
const THU_1000 = '2026-10-08T08:00:00Z';

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(THU_1000));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('RuleLine', () => {
  it('shows nothing while the details are loading', async () => {
    await render(<RuleLine ruleTags={null} />);
    expect(screen.queryByText(DISCLAIMER)).toBeNull();
  });

  it('paid street, Thursday 10:00: paid until 20:00, then free; zone and disclaimer', async () => {
    await render(<RuleLine ruleTags={BERLIN} />);
    expect(screen.getByText('Paid now until 20:00 · then free')).toBeTruthy();
    expect(screen.getByText('Parking zone 23 (permit holders exempt)')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });

  it('before 09:00 it is free until paid parking starts', async () => {
    jest.setSystemTime(new Date('2026-10-08T06:59:00Z'));
    await render(<RuleLine ruleTags={BERLIN} />);
    expect(screen.getByText('Free now · paid from 09:00')).toBeTruthy();
  });

  it('names the weekday when the change is on a later day', async () => {
    jest.setSystemTime(new Date('2026-10-08T18:00:00Z')); // Thu 20:00
    await render(<RuleLine ruleTags={BERLIN} />);
    expect(screen.getByText(/^Free now · paid from Fri.*09:00$/)).toBeTruthy();
  });

  it('updates by itself when the minute ticks over a boundary', async () => {
    jest.setSystemTime(new Date('2026-10-08T17:59:30Z')); // Thu 19:59:30
    await render(<RuleLine ruleTags={BERLIN} />);
    expect(screen.getByText('Paid now until 20:00 · then free')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText(/^Free now · paid from Fri.*09:00$/)).toBeTruthy();
  });

  it('says "unknown" (with the disclaimer) when there are no rule tags', async () => {
    await render(<RuleLine ruleTags={{}} />);
    expect(screen.getByText('Rules unknown — check the signs')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.queryByText("Some rules couldn't be read")).toBeNull();
  });

  it('shows a restriction and when it ends', async () => {
    await render(<RuleLine ruleTags={{ fee: 'yes', 'restriction:conditional': 'no_parking @ (Mo-Fr 07:00-17:00)' }} />);
    expect(screen.getByText('No parking until 17:00')).toBeTruthy();
  });

  it('shows disc parking with its time limit', async () => {
    await render(
      <RuleLine
        ruleTags={{ 'authentication:disc': 'yes', 'maxstay:conditional': '2 hours @ (Mo-Fr 09:00-19:00, Sa 09:00-14:00)' }}
      />,
    );
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Max. 2 h until 19:00')).toBeTruthy();
    expect(screen.getByText('Parking disc required')).toBeTruthy();
  });

  it('flags unreadable tags without hiding what it could read', async () => {
    await render(<RuleLine ruleTags={{ fee: 'no', maxstay: 'yes' }} />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText("Some rules couldn't be read")).toBeTruthy();
  });

  it('speaks German', async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    await render(<RuleLine ruleTags={BERLIN} />);
    expect(screen.getByText('Jetzt gebührenpflichtig bis 20:00 · dann kostenlos')).toBeTruthy();
    expect(screen.getByText('Aus OpenStreetMap — die Beschilderung vor Ort hat Vorrang.')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('en'); // shared singleton: keep later suites in English
    });
  });
});
