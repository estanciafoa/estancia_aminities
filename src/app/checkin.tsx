import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CheckInTypeScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>CHECK IN</Text>
        <View style={{ width: 56 }} />
      </View>

      <View style={styles.menu}>
        <Text style={styles.prompt}>WHO IS CHECKING IN?</Text>
        <TouchableOpacity
          style={[styles.bigButton, styles.familyButton]}
          onPress={() => router.push('/family')}
          activeOpacity={0.85}>
          <Text style={styles.bigButtonText}>FAMILY</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigButton, styles.studentButton]}
          onPress={() => router.push('/student')}
          activeOpacity={0.85}>
          <Text style={styles.bigButtonText}>STUDENTS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigButton, styles.guestButton]}
          onPress={() => router.push('/guest')}
          activeOpacity={0.85}>
          <Text style={styles.bigButtonText}>GUEST</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#00A844',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 56 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  menu: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 },
  prompt: { fontSize: 13, fontWeight: '800', color: '#64748B', letterSpacing: 2, textAlign: 'center', marginBottom: 4 },
  bigButton: { height: 110, borderRadius: 16, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  familyButton: { backgroundColor: '#208AEF' },
  studentButton: { backgroundColor: '#7C3AED' },
  guestButton: { backgroundColor: '#0F766E' },
  bigButtonText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: 3 },
});
