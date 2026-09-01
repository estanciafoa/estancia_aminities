import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DecisionOverlay from '@/components/decision-overlay';
import Numpad, { FLAT_LENGTH } from '@/components/numpad';
import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import { decideEntry, type DecisionResult } from '@/services/subscription';
import {
  addCheckedIn,
  checkedInKey,
  getFamilySuggestions,
  rememberFamilyMember,
  type Category,
  type FamilyMember,
} from '@/services/storage';

interface Props {
  category: Extract<Category, 'Family' | 'Guest'>;
  enableHistory: boolean; // Family remembers; Guest does not
}

type Step = 'flat' | 'people' | 'person';

export default function AttendanceForm({ category, enableHistory }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('flat');
  const [flat, setFlat] = useState('');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [overlay, setOverlay] = useState<DecisionResult | null>(null);
  // The person the current overlay is about — passed to the Pay flow.
  const [payPerson, setPayPerson] = useState<{ name: string; gender: string }>({ name: '', gender: '' });
  const advancing = useRef(false);

  // Auto-advance once a full flat number has been keyed in.
  useEffect(() => {
    if (step !== 'flat' || flat.length !== FLAT_LENGTH) return;
    void proceedFromFlat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat, step]);

  const proceedFromFlat = async () => {
    if (advancing.current) return;
    advancing.current = true;
    try {
      if (enableHistory) {
        const ms = await getFamilySuggestions(flat);
        setMembers(ms);
        setStep('people');
      } else {
        resetPerson();
        setStep('person');
      }
    } finally {
      advancing.current = false;
    }
  };

  const pressKey = (k: string) => {
    if (k === '⌫') {
      setFlat((f) => f.slice(0, -1));
      return;
    }
    setFlat((f) => (f.length >= FLAT_LENGTH ? f : f + k));
  };

  const resetPerson = () => {
    setName('');
    setGender('');
  };

  const backToFlat = () => {
    setStep('flat');
    setFlat('');
    setMembers([]);
    resetPerson();
  };

  const goHome = () => {
    try {
      router.dismissAll();
    } catch {
      router.replace('/');
    }
  };

  const dismissOverlay = () => {
    setOverlay(null);
    goHome();
  };

  const onBack = () => {
    if (step === 'flat') router.back();
    else if (step === 'person' && enableHistory) {
      // Family: go back to the resident list, not all the way to the keypad.
      resetPerson();
      setStep('people');
    } else backToFlat();
  };

  // Records an entry for a fully-resolved person (name + gender known).
  const submit = async (pName: string, pGender: 'M' | 'F') => {
    if (submitting) return;
    Keyboard.dismiss();
    setSubmitting(true);
    setPayPerson({ name: pName, gender: pGender });
    try {
      const result = await decideEntry({ category, flat, name: pName });

      if (result.allowed) {
        await addCheckedIn({
          key: checkedInKey(category, { flat, name: pName }),
          category,
          flat: flat.trim(),
          name: pName.trim(),
          gender: pGender,
          student_id: '',
          checkInAt: new Date().toISOString(),
        });
        if (enableHistory) await rememberFamilyMember(flat, pName, pGender);
        setPendingConfirmation('in');
      }

      await enqueueLog({
        category,
        flat: flat.trim(),
        name: pName.trim(),
        gender: pGender,
        student_id: '',
        direction: 'IN',
        subscription: result.decision,
      });

      if (result.overlay) setOverlay(result);
      else goHome();
    } finally {
      setSubmitting(false);
    }
  };

  const submitNewPerson = () => {
    if (!name.trim()) return Alert.alert('Missing name', 'Enter the name.');
    if (!gender) return Alert.alert('Missing gender', 'Select Male or Female.');
    void submit(name, gender);
  };

  const titleSuffix = step === 'flat' ? '' : `  ·  ${flat}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>
          {category.toUpperCase()} · IN{titleSuffix}
        </Text>
        <View style={{ width: 64 }} />
      </View>

      {step === 'flat' && (
        <Numpad value={flat} onKey={pressKey} disabled={submitting} />
      )}

      {step === 'people' && (
        <ScrollView contentContainerStyle={styles.peopleBody}>
          <Text style={styles.flatHeadline}>FLAT {flat}</Text>
          {members.length > 0 ? (
            <Text style={styles.peopleHint}>TAP A RESIDENT TO CHECK IN</Text>
          ) : (
            <Text style={styles.peopleHint}>NO SAVED RESIDENTS FOR THIS FLAT</Text>
          )}

          {members.map((m) => (
            <TouchableOpacity
              key={m.name}
              style={styles.personRow}
              activeOpacity={0.85}
              disabled={submitting}
              onPress={() => {
                // Known gender → check in straight away; unknown → ask once.
                if (m.gender === 'M' || m.gender === 'F') submit(m.name, m.gender);
                else {
                  setName(m.name);
                  setGender('');
                  setStep('person');
                }
              }}>
              <Text style={styles.personName}>{m.name}</Text>
              <Text style={styles.personGender}>
                {m.gender === 'F' ? 'FEMALE' : m.gender === 'M' ? 'MALE' : 'SET GENDER ›'}
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.addNewBtn}
            activeOpacity={0.85}
            disabled={submitting}
            onPress={() => {
              resetPerson();
              setStep('person');
            }}>
            <Text style={styles.addNewText}>+ ADD NEW PERSON</Text>
          </TouchableOpacity>

          {submitting && <ActivityIndicator size="large" color="#00A844" style={{ marginTop: 24 }} />}
        </ScrollView>
      )}

      {step === 'person' && (
        <KeyboardAvoidingView style={styles.container} behavior="padding">
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.flatHeadline}>FLAT {flat}</Text>

            <Text style={styles.label}>NAME</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor="#94A3B8"
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              blurOnSubmit
              onSubmitEditing={() => Keyboard.dismiss()}
            />

            <Text style={styles.label}>GENDER</Text>
            <View style={styles.genderRow}>
              <TouchableOpacity
                style={[styles.genderBtn, gender === 'M' && styles.genderBtnActive]}
                onPress={() => setGender('M')}>
                <Text style={[styles.genderText, gender === 'M' && styles.genderTextActive]}>MALE</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.genderBtn, gender === 'F' && styles.genderBtnActive]}
                onPress={() => setGender('F')}>
                <Text style={[styles.genderText, gender === 'F' && styles.genderTextActive]}>FEMALE</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity style={styles.checkInBtn} onPress={submitNewPerson} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.checkInText}>CHECK IN</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      <DecisionOverlay
        result={overlay}
        onDismiss={dismissOverlay}
        onPayNow={() => {
          setOverlay(null);
          // '/pay' route types regenerate under `expo start`; cast until then.
          router.push({
            pathname: '/pay' as any,
            params: { flat, name: payPerson.name, category, gender: payPerson.gender },
          });
        }}
      />
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
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 64 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },

  // People list (Family)
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
  personName: { fontSize: 30, fontWeight: '800', color: '#0F172A', flex: 1 },
  personGender: { fontSize: 15, fontWeight: '900', color: '#64748B', letterSpacing: 1 },
  addNewBtn: {
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#208AEF',
    borderStyle: 'dashed',
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
  },
  addNewText: { fontSize: 26, fontWeight: '900', color: '#208AEF', letterSpacing: 1 },

  // Add-person form
  body: { padding: 24 },
  label: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginTop: 24, marginBottom: 8 },
  input: {
    height: 72,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 18,
    fontSize: 26,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  genderRow: { flexDirection: 'row', gap: 14 },
  genderBtn: {
    flex: 1,
    height: 84,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  genderBtnActive: { borderColor: '#208AEF', backgroundColor: '#EFF6FF' },
  genderText: { fontSize: 24, fontWeight: '900', color: '#64748B', letterSpacing: 1 },
  genderTextActive: { color: '#208AEF' },
  footer: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16, backgroundColor: '#FFFFFF' },
  checkInBtn: {
    height: 84,
    borderRadius: 16,
    backgroundColor: '#00A844',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  checkInText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: 2 },
});
