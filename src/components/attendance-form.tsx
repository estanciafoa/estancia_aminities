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
import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import { decideEntry, type DecisionResult } from '@/services/subscription';
import {
  addCheckedIn,
  checkedInKey,
  getFamilyMembers,
  rememberFamilyMember,
  type Category,
  type FamilyMember,
} from '@/services/storage';

interface Props {
  category: Extract<Category, 'Family' | 'Guest'>;
  enableHistory: boolean; // Family remembers; Guest does not
}

export default function AttendanceForm({ category, enableHistory }: Props) {
  const router = useRouter();
  const [flat, setFlat] = useState('');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'M' | 'F' | ''>('');
  const [suggestions, setSuggestions] = useState<FamilyMember[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [overlay, setOverlay] = useState<DecisionResult | null>(null);
  const flatDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enableHistory) return;
    if (flatDebounce.current) clearTimeout(flatDebounce.current);
    flatDebounce.current = setTimeout(async () => {
      const members = flat.trim() ? await getFamilyMembers(flat) : [];
      setSuggestions(members);
    }, 200);
    return () => {
      if (flatDebounce.current) clearTimeout(flatDebounce.current);
    };
  }, [flat, enableHistory]);

  const pickSuggestion = (m: FamilyMember) => {
    setName(m.name);
    setGender(m.gender === 'F' ? 'F' : 'M');
    setSuggestions([]);
  };

  const resetPerson = () => {
    setName('');
    setGender('');
  };

  const handleCheckIn = async () => {
    if (submitting) return;
    if (!flat.trim()) return Alert.alert('Missing flat', 'Enter the flat number.');
    if (!name.trim()) return Alert.alert('Missing name', 'Enter the name.');
    if (!gender) return Alert.alert('Missing gender', 'Select Male or Female.');

    setSubmitting(true);
    try {
      const result = await decideEntry({ category, flat });

      // Allowed entrants are recorded as currently inside (for Check-Out).
      if (result.allowed) {
        await addCheckedIn({
          key: checkedInKey(category, { flat, name }),
          category,
          flat: flat.trim(),
          name: name.trim(),
          gender,
          student_id: '',
          checkInAt: new Date().toISOString(),
        });
        if (enableHistory) await rememberFamilyMember(flat, name, gender);
        setPendingConfirmation('in');
      }

      // Every attempt is queued locally (instant) and synced in the background.
      await enqueueLog({
        category,
        flat: flat.trim(),
        name: name.trim(),
        gender,
        student_id: '',
        direction: 'IN',
        subscription: result.decision,
      });

      if (result.overlay) {
        setOverlay(result);
      } else {
        goHome();
      }
    } finally {
      setSubmitting(false);
    }
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>{category.toUpperCase()} · IN</Text>
        <View style={{ width: 56 }} />
      </View>

      <KeyboardAvoidingView style={styles.container} behavior="padding">
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>FLAT NUMBER</Text>
          <TextInput
            style={styles.input}
            value={flat}
            onChangeText={setFlat}
            placeholder="e.g. 1201"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
            returnKeyType="done"
            onBlur={() => Keyboard.dismiss()}
          />

          {enableHistory && suggestions.length > 0 && (
            <View style={styles.suggestionBox}>
              <Text style={styles.suggestionHint}>TAP TO AUTOFILL</Text>
              {suggestions.map((m) => (
                <TouchableOpacity key={m.name} style={styles.suggestionRow} onPress={() => pickSuggestion(m)}>
                  <Text style={styles.suggestionName}>{m.name}</Text>
                  <Text style={styles.suggestionGender}>{m.gender === 'F' ? 'FEMALE' : 'MALE'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>NAME</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor="#94A3B8"
            autoCapitalize="words"
            returnKeyType="done"
            blurOnSubmit
            onSubmitEditing={() => Keyboard.dismiss()}
            onBlur={() => Keyboard.dismiss()}
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
          <TouchableOpacity style={styles.checkInBtn} onPress={handleCheckIn} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.checkInText}>CHECK IN</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <DecisionOverlay result={overlay} onDismiss={dismissOverlay} />
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
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  body: { padding: 24 },
  label: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  input: {
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#FFFFFF',
  },
  suggestionBox: { marginTop: 8, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#F8FAFC' },
  suggestionHint: { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 1, padding: 8 },
  suggestionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  suggestionName: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  suggestionGender: { fontSize: 11, fontWeight: '800', color: '#64748B', letterSpacing: 1 },
  genderRow: { flexDirection: 'row', gap: 12 },
  genderBtn: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  genderBtnActive: { borderColor: '#208AEF', backgroundColor: '#EFF6FF' },
  genderText: { fontSize: 16, fontWeight: '900', color: '#64748B', letterSpacing: 1 },
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
