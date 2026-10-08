import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { parseRules } from './parseRules';
import { ruleNow } from './ruleNow';
import { ruleText, type RuleTone } from './ruleText';

const TONE_COLOUR: Record<RuleTone, string> = {
  free: '#16a34a',
  paid: '#d97706',
  limited: '#7c3aed',
  restricted: '#dc2626',
  neutral: '#475569',
  unknown: '#64748b',
};

/** True when the rule line gives a definite answer (anything but "unknown"),
 *  so the sheet can drop its older static access label (SPEC-parking-rules.md).
 *  Checked when the sheet renders; a rule that turns "unknown" later while the
 *  sheet stays open (e.g. only access:conditional, no fee) brings the label
 *  back at the next render. */
export function hasDefiniteRule(ruleTags: Record<string, string> | null): boolean {
  return ruleTags !== null && ruleNow(parseRules(ruleTags)).state !== 'unknown';
}

interface RuleLineProps {
  /** The spot's rule tags; null while spot_details is loading. */
  ruleTags: Record<string, string> | null;
}

/** "Paid now until 20:00 · then free", plus details and the OSM disclaimer
 *  (SPEC-parking-rules.md). Re-evaluated every minute while shown. */
export function RuleLine({ ruleTags }: RuleLineProps) {
  const { t, i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const rules = useMemo(() => (ruleTags ? parseRules(ruleTags) : null), [ruleTags]);
  if (!rules) return null;

  const text = ruleText(ruleNow(rules, now), t, i18n.language, now);
  return (
    <View style={styles.container}>
      <Text style={[styles.headline, { color: TONE_COLOUR[text.tone] }]}>{text.headline}</Text>
      {text.details.map((line) => (
        <Text key={line} style={styles.detail}>
          {line}
        </Text>
      ))}
      <Text style={styles.disclaimer}>{t('rules.disclaimer')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 6,
    marginBottom: 4,
  },
  headline: {
    fontSize: 15,
    fontWeight: '700',
  },
  detail: {
    fontSize: 13,
    color: '#475569',
    marginTop: 2,
  },
  disclaimer: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 4,
  },
});
