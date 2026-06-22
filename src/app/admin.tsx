import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { syncStudents } from '@/services/sheets';
import {
  getAdminPasscode,
  getAmenityOptions,
  getDeployedAmenity,
  preloadStudents,
  setAdminPasscode,
  setDeployedAmenity,
} from '@/services/storage';

const FALLBACK_AMENITIES = ['gym', 'tennis', 'pool'];

export default function AdminScreen() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState<'data' | 'all' | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [amenityOptions, setAmenityOptions] = useState<string[]>(FALLBACK_AMENITIES);
  const [amenity, setAmenity] = useState('');
  const [pwModal, setPwModal] = useState(false);
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    if (!unlocked) return;
    preloadStudents().then(setCount);
    getDeployedAmenity().then(setAmenity);
    getAmenityOptions().then((opts) => setAmenityOptions(opts.length ? opts : FALLBACK_AMENITIES));
  }, [unlocked]);

  const tryUnlock = async () => {
    const code = await getAdminPasscode();
    if (entry === code) {
      setUnlocked(true);
      setError(null);
    } else {
      setError('Incorrect passcode');
      setEntry('');
    }
  };

  const runSync = async (mode: 'data' | 'all') => {
    if (syncing) return;
    setSyncing(mode);
    setSyncMessage(mode === 'data' ? 'Syncing subscriptions…' : 'Syncing subscriptions + photos…');
    try {
      const n = await syncStudents({ photos: mode === 'all' });
      setCount(n);
      setSyncMessage(`Synced ${n} subscriptions${mode === 'all' ? ' + photos' : ''}`);
      const opts = await getAmenityOptions();
      if (opts.length) setAmenityOptions(opts);
    } catch (e: any) {
      setSyncMessage(`Sync failed: ${e?.message || 'check connection'}`);
    } finally {
      setSyncing(null);
    }
  };

  const chooseAmenity = async (a: string) => {
    setAmenity(a);
    await setDeployedAmenity(a);
  };

  const saveNewPasscode = async () => {
    const v = newPw.trim();
    if (!v) return;
    await setAdminPasscode(v);
    setNewPw('');
    setPwModal(false);
  };

  // ---- Passcode gate ----
  if (!unlocked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.titleBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backText}>‹ BACK</Text>
          </TouchableOpacity>
          <Text style={styles.titleText}>ADMIN</Text>
          <View style={{ width: 56 }} />
        </View>
        <View style={styles.gate}>
          <Text style={styles.gateLabel}>ENTER ADMIN PASSCODE</Text>
          <TextInput
            style={styles.codeInput}
            value={entry}
            onChangeText={setEntry}
            placeholder="••••"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            onSubmitEditing={tryUnlock}
            returnKeyType="go"
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity style={styles.unlockBtn} onPress={tryUnlock}>
            <Text style={styles.unlockText}>UNLOCK</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Admin panel ----
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>ADMIN</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.section}>THIS DEVICE GATES</Text>
        <View style={styles.amenityRow}>
          {amenityOptions.map((a) => (
            <TouchableOpacity
              key={a}
              style={[styles.amenityBtn, amenity === a && styles.amenityBtnActive]}
              onPress={() => chooseAmenity(a)}>
              <Text style={[styles.amenityText, amenity === a && styles.amenityTextActive]}>
                {a.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>
          {amenity
            ? `Entry is checked against the "${amenity}" subscription.`
            : 'No amenity selected — entry is allowed for any current subscription.'}
        </Text>

        <Text style={styles.section}>DATA</Text>
        <Text style={styles.count}>{count} SUBSCRIPTIONS</Text>
        <View style={styles.syncRow}>
          <TouchableOpacity style={[styles.actBtn, styles.actOutline]} onPress={() => runSync('data')} disabled={!!syncing}>
            {syncing === 'data' ? <ActivityIndicator color="#0055FF" /> : <Text style={styles.actOutlineText}>SYNC DATA</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actBtn, styles.actFilled]} onPress={() => runSync('all')} disabled={!!syncing}>
            {syncing === 'all' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.actFilledText}>SYNC + PHOTOS</Text>}
          </TouchableOpacity>
        </View>
        {syncMessage && <Text style={styles.syncMessage}>{syncMessage}</Text>}

        <Text style={styles.section}>REPORTS</Text>
        <TouchableOpacity style={[styles.actBtn, styles.actDark]} onPress={() => router.push('/export')}>
          <Text style={styles.actDarkText}>📄  EXPORT REPORT (PDF)</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actBtn, styles.actDark, styles.actSpaced]} onPress={() => router.push('/defaulters')}>
          <Text style={styles.actDarkText}>⚠️  DEFAULTERS (UNPAID)</Text>
        </TouchableOpacity>

        <Text style={styles.section}>SECURITY</Text>
        <TouchableOpacity style={[styles.actBtn, styles.actOutline]} onPress={() => setPwModal(true)}>
          <Text style={styles.actOutlineText}>CHANGE PASSCODE</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={pwModal} transparent animationType="fade" onRequestClose={() => setPwModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Passcode</Text>
            <TextInput
              style={styles.codeInput}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="••••"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity onPress={() => { setPwModal(false); setNewPw(''); }} style={styles.modalCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveNewPasscode} style={styles.modalSave}>
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 56 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
  gate: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  gateLabel: { fontSize: 13, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginBottom: 16 },
  codeInput: {
    width: 200,
    height: 64,
    borderWidth: 2,
    borderColor: '#0F172A',
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 8,
    color: '#0F172A',
  },
  errorText: { color: '#DC2626', fontWeight: '800', marginTop: 12 },
  unlockBtn: { marginTop: 24, backgroundColor: '#0F172A', paddingHorizontal: 48, paddingVertical: 16, borderRadius: 12 },
  unlockText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  body: { padding: 24 },
  section: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginTop: 24, marginBottom: 10 },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  amenityBtn: { borderWidth: 2, borderColor: '#E2E8F0', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 10 },
  amenityBtnActive: { borderColor: '#208AEF', backgroundColor: '#208AEF' },
  amenityText: { fontSize: 15, fontWeight: '900', color: '#64748B', letterSpacing: 1 },
  amenityTextActive: { color: '#FFFFFF' },
  hint: { fontSize: 12, color: '#94A3B8', marginTop: 10, lineHeight: 18 },
  count: { fontSize: 22, fontWeight: '900', color: '#0F172A', marginBottom: 12 },
  syncRow: { flexDirection: 'row', gap: 12 },
  actBtn: { flex: 1, height: 56, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  actOutline: { borderWidth: 2, borderColor: '#0055FF', backgroundColor: '#FFFFFF' },
  actOutlineText: { color: '#0055FF', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  actFilled: { backgroundColor: '#0055FF' },
  actFilledText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  actDark: { backgroundColor: '#0F172A' },
  actSpaced: { marginTop: 12 },
  actDarkText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15, letterSpacing: 1 },
  syncMessage: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 16 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 20, alignSelf: 'stretch' },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: '#64748B', fontSize: 15, fontWeight: '800' },
  modalSave: { backgroundColor: '#0F172A', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});

