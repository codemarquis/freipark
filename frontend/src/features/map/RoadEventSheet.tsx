import { useEffect, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetMethods } from '@gorhom/bottom-sheet/lib/typescript/types';
import type { RoadEventKind, RoadEventProperties } from './RoadEventsLayer';

const SNAP_POINTS = ['35%', '60%'];

const KIND_COLOUR: Record<RoadEventKind, string> = {
  closure: '#dc2626',
  entry_exit_closure: '#dc2626',
  roadworks: '#f97316',
  short_term_roadworks: '#f59e0b',
  construction: '#64748b',
};

/** "21 Oct, 16:00" in the user's language, German local time (the source's). */
function formatEnd(iso: string, language: string): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  try {
    return date.toLocaleString(language, { ...options, timeZone: 'Europe/Berlin' });
  } catch {
    return date.toLocaleString(language, options); // older Intl without timeZone support
  }
}

interface RoadEventSheetProps {
  event: RoadEventProperties | null;
  onClose: () => void;
}

/** Details for a tapped roadworks/closure line (SPEC-road-closures.md). */
export function RoadEventSheet({ event, onClose }: RoadEventSheetProps) {
  const { t, i18n } = useTranslation();
  const sheetRef = useRef<BottomSheetMethods>(null);

  useEffect(() => {
    if (event) sheetRef.current?.snapToIndex(0);
    else sheetRef.current?.close();
  }, [event]);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onClose={onClose}
      style={styles.sheet}
    >
      <BottomSheetView style={styles.content}>
        {event && (
          <>
            <Text style={[styles.kind, { color: KIND_COLOUR[event.kind] }]}>{t(`roadEvents.${event.kind}`)}</Text>
            {event.title !== '' && <Text style={styles.title}>{event.title}</Text>}
            {event.subtitle && <Text style={styles.subtitle}>{event.subtitle}</Text>}
            {event.ends_at && (
              <Text style={styles.until}>
                {t('roadEvents.until', { date: formatEnd(event.ends_at, i18n.language) })}
              </Text>
            )}
            {event.description.map((line, i) => (
              <Text key={i} style={styles.description}>
                {line}
              </Text>
            ))}
            <Text style={styles.source}>
              {t('roadEvents.source', {
                name: t(event.kind === 'construction' ? 'roadEvents.sourceOsm' : 'roadEvents.sourceAutobahn'),
              })}
            </Text>
          </>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

// Same sheet look as SpotDetailSheet.
const styles = StyleSheet.create({
  sheet: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
  },
  kind: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 8,
  },
  until: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: 10,
  },
  description: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 2,
  },
  source: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 12,
  },
});
