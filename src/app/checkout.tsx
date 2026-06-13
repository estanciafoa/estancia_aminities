import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import { getCheckedInByFlat, removeCheckedIn, type CheckedInEntry } from '@/services/storage';

export default function CheckOutScreen() {
  const router = useRouter();
  const [flat, setFlat] = useState('');
  const [people, setPeople] = useState<CheckedInEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const handleFind = async () => {
    if (!flat.trim()) return Alert.alert('Missing flat', 'Enter the flat number.');
    Keyboard.dismiss();
    setSearching(true);
    try {
      const list = await getCheckedInByFlat(flat);
      setPeople(list);
    } finally {
      setSearching(false);
    }
  };

  const handleCheckOut = async (entry: CheckedInEntry) => {
    if (checkingOut) return;
    setCheckingOut(entry.key);
    try {
      await enqueueLog({
        category: entry.category,
        flat: entry.flat,
        name: entry.name,
        gender: entry.gender,
        student_id: entry.student_id,
        direction: 'OUT',
        subscription: '',
      });
      await removeCheckedIn(entry.key);
      setPendingConfirmation('out');
      goHome();
    } finally {
      setCheckingOut(null);
    }
  };

  const goHome = () => {
    try {
      router.dismissAll();
    } catch {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>CHECK OUT</Text>
        <View style={{ width: 56 }} />
      </View>

      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>FLAT NUMBER</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              value={flat}
              onChangeText={setFlat}
              placeholder="e.g. 1201"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              returnKeyType="search"
              onSubmitEditing={handleFind}
              onBlur={() => Keyboard.dismiss()}
            />
            <TouchableOpacity style={styles.findBtn} onPress={handleFind} disabled={searching}>
              {searching ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.findText}>FIND</Text>}
            </TouchableOpacity>
          </View>

          {people !== null && (
            <View style={styles.listSection}>
              <Text style={styles.listHeader}>CURRENTLY CHECKED IN</Text>
              {people.length === 0 ? (
                <Text style={styles.emptyText}>No one from this flat is currently checked in.</Text>
              ) : (
                people.map((p) => (
                  <View key={p.key} style={styles.personRow}>
                    <View style={styles.personInfo}>
                      <Text style={styles.personName}>{p.name || p.student_id || '—'}</Text>
                      <Text style={styles.personMeta}>
                        {p.category}
                        {p.student_id ? ` · ${p.student_id}` : ''}
                        {p.gender ? ` · ${p.gender === 'F' ? 'F' : 'M'}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.outBtn}
                      onPress={() => handleCheckOut(p)}
                      disabled={!!checkingOut}>
                      {checkingOut === p.key ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.outText}>CHECK OUT</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#DC2626',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 56 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  body: { padding: 24 },
  label: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  findBtn: { width: 96, height: 56, backgroundColor: '#DC2626', justifyContent: 'center', alignItems: 'center' },
  findText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  listSection: { marginTop: 28 },
  listHeader: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginBottom: 12 },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#94A3B8' },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  personInfo: { flex: 1 },
  personName: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  personMeta: { fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 2 },
  outBtn: { backgroundColor: '#DC2626', paddingHorizontal: 18, paddingVertical: 14, borderRadius: 10, minWidth: 120, alignItems: 'center' },
  outText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
});
