import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

// U+2699 GEAR + U+FE0E (text presentation): a plain symbol that takes the
// text colour, not a colour emoji. No icon library needed (SPEC-settings.md).
const GEAR = '⚙︎';

interface SettingsButtonProps {
  onPress: () => void;
}

/** Top-right map button that opens Settings (replaces AccountButton). */
export function SettingsButton({ onPress }: SettingsButtonProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('settings.a11y')}
      hitSlop={8}
    >
      <Text style={styles.gear}>{GEAR}</Text>
    </Pressable>
  );
}

// Same position and shadow as the old AccountButton, so the search bar's
// right margin still fits.
const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 62,
    right: 12,
    zIndex: 10,
    width: 40,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  gear: {
    fontSize: 18,
    color: '#1e293b',
  },
});
