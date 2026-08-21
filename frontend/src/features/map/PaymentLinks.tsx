import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

const EASYPARK_IOS_NATIVE = 'itms-apps://apps.apple.com/app/id449594317';
const EASYPARK_IOS_WEB = 'https://apps.apple.com/us/app/easypark-parking-made-easy/id449594317';
const EASYPARK_ANDROID = 'https://play.google.com/store/apps/details?id=net.easypark.android';

function openEasyPark() {
  if (Platform.OS === 'ios') {
    Linking.openURL(EASYPARK_IOS_NATIVE).catch(() =>
      Linking.openURL(EASYPARK_IOS_WEB).catch(() => {})
    );
  } else {
    Linking.openURL(EASYPARK_ANDROID).catch(() => {});
  }
}

export function PaymentLinks() {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.button}
        onPress={openEasyPark}
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
