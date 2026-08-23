import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useAuth } from './useAuth';
import { AuthSheet } from './AuthSheet';

export function AccountButton() {
  const { user, loading } = useAuth();
  const [sheetVisible, setSheetVisible] = useState(false);

  return (
    <>
      <Pressable
        style={styles.button}
        onPress={() => setSheetVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={user ? 'Account' : 'Sign in'}
      >
        {loading ? (
          <ActivityIndicator size="small" color="#6366f1" />
        ) : (
          <Text style={styles.text} numberOfLines={1}>
            {user ? (user.email ?? 'Account') : 'Sign in'}
          </Text>
        )}
      </Pressable>

      <AuthSheet visible={sheetVisible} onClose={() => setSheetVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 62,
    right: 12,
    zIndex: 10,
    maxWidth: 76,
    height: 32,
    paddingHorizontal: 10,
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
  text: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
});
