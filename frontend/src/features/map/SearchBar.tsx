import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useGeocoder, type GeoResult } from './useGeocoder';

type Props = {
  onSelect: (result: GeoResult) => void;
};

export function SearchBar({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { results, loading } = useGeocoder(query);

  const showDropdown = focused && query.trim().length >= 2;

  function handleSelect(result: GeoResult) {
    setQuery('');
    setFocused(false);
    inputRef.current?.blur();
    onSelect(result);
  }

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="Search in Germany…"
          placeholderTextColor="#94a3b8"
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator style={styles.spinner} size="small" color="#6366f1" />}
      </View>

      {showDropdown && results.length > 0 && (
        <FlatList
          style={styles.dropdown}
          keyboardShouldPersistTaps="handled"
          data={results}
          keyExtractor={(r) => r.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.row} onPress={() => handleSelect(item)}>
              <Text style={styles.rowText} numberOfLines={2}>
                {item.label}
              </Text>
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 56,
    left: 12,
    right: 96,
    zIndex: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    height: 44,
    fontSize: 15,
    color: '#0f172a',
  },
  spinner: {
    marginLeft: 8,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    maxHeight: 280,
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  rowText: {
    fontSize: 14,
    color: '#1e293b',
    lineHeight: 19,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 14,
  },
});
