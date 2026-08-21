import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

// iOS URL verified against App Store listing (id449594317).
// Android package net.easypark.android — unverified, update if Play Store listing differs.
const EASYPARK_URL =
  Platform.OS === 'ios'
    ? 'https://apps.apple.com/us/app/easypark-parking-made-easy/id449594317'
    : 'https://play.google.com/store/apps/details?id=net.easypark.android';

export function PaymentLinks() {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.button}
        onPress={() => Linking.openURL(EASYPARK_URL)}
      >
        <Text style={styles.buttonText}>Open EasyPark</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  button: {
    flex: 1,
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
});
