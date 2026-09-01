import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Numpad, { FLAT_LENGTH } from '@/components/numpad';
import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import { getCheckedInByFlat, removeCheckedIn, type CheckedInEntry } from '@/services/storage';

type Step = 'flat' | 'people';

export default function CheckOutScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('flat');
  const [flat, setFlat] = useState('');
  const [people, setPeople] = useState<CheckedInEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const advancing = useRef(false);

  // Auto-advance once a full flat number has been keyed in — same as CHECK IN.
  useEffect(() => {
    if (step !== 'flat' || flat.length !== FLAT_LENGTH) return;
    void findPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, step]);

  const pressKey = (k: string) => {
    if (k === '⌫') {
      setFlat((f) => f.slice(0, -1));
      return;
    }
    setFlat((f) => (f.length >= FLAT_LENGTH ? f : f + k));
  };

  const findPeople = async () => {
    if (advancing.current) return;
    advancing.current = true;
    setSearching(true);
    try {
      const list = await getCheckedInByFlat(flat);
      setPeople(list);
      setStep('people');
    } finally {
      setSearching(false);
      advancing.current = false;
    }
  };

  const backToFlat = () => {
    setStep('flat');
    setFlat('');
    setPeople([]);
  };

  const onBack = () => {
    if (step === 'flat') router.back();
    else backToFlat();
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
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>CHECK OUT{step === 'flat' ? '' : `  ·  ${flat}`}</Text>
        <View style={{ width: 64 }} />
      </View>

      {step === 'flat' && <Numpad value={flat} onKey={pressKey} disabled={searching} accent="#DC2626" />}

      {step === 'people' && (
        <ScrollView contentContainerStyle={styles.peopleBody}>
          <Text style={styles.flatHeadline}>FLAT {flat}</Text>
          {people.length > 0 ? (
            <Text style={styles.peopleHint}>TAP CHECK OUT</Text>
          ) : (
            <Text style={styles.peopleHint}>NO ONE FROM THIS FLAT IS CHECKED IN</Text>
          )}

          {people.map((p) => (
            <View key={p.key} style={styles.personRow}>
              <View style={styles.personInfo}>
                <Text style={styles.personName}>{p.name || p.student_id || '—'}</Text>
                <Text style={styles.personMeta}>
                  {p.category}
                  {p.student_id ? ` · ${p.student_id}` : ''}
                  {p.gender ? ` · ${p.gender === 'F' ? 'F' : 'M'}` : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.outBtn} onPress={() => handleCheckOut(p)} disabled={!!checkingOut}>
                {checkingOut === p.key ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.outText}>CHECK OUT</Text>
                )}
              </TouchableOpacity>
            </View>
          ))}

          {people.length === 0 && (
            <TouchableOpacity style={styles.addNewBtn} activeOpacity={0.85} onPress={backToFlat}>
              <Text style={styles.addNewText}>‹ TRY ANOTHER FLAT</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
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
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 64 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },

  // People list — matches the CHECK IN (Family) list sizing.
  peopleBody: { padding: 24, paddingBottom: 48 },
  flatHeadline: { fontSize: 34, fontWeight: '900', color: '#0F172A', letterSpacing: 2, textAlign: 'center' },
  peopleHint: {
    fontSize: 13,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  personRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 92,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  personInfo: { flex: 1, paddingRight: 12 },
  personName: { fontSize: 30, fontWeight: '800', color: '#0F172A' },
  personMeta: { fontSize: 14, fontWeight: '700', color: '#64748B', marginTop: 4, letterSpacing: 1 },
  outBtn: {
    minHeight: 68,
    paddingHorizontal: 22,
    borderRadius: 14,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 150,
  },
  outText: { color: '#FFFFFF', fontWeight: '900', fontSize: 20, letterSpacing: 1 },
  addNewBtn: {
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#DC2626',
    borderStyle: 'dashed',
    backgroundColor: '#FEF2F2',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  addNewText: { fontSize: 24, fontWeight: '900', color: '#DC2626', letterSpacing: 1 },
});
