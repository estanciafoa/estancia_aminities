import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  setLastSyncError,
} from '@/services/storage';

const FALLBACK_AMENITIES = ['gym', 'tennis', 'swimming'];

export default function AdminScreen() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [entry, setEntry] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [count, setCount] = useState(0);
  const [syncing, setSyncing] = useState<'all' | 'force-all' | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [amenityOptions, setAmenityOptions] = useState<string[]>(FALLBACK_AMENITIES);
  const [amenity, setAmenity] = useState('');
  const [amenityModal, setAmenityModal] = useState(false);
  const [pwModal, setPwModal] = useState(false);
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    if (!unlocked) return;
    preloadStudents().then(setCount);
    getDeployedAmenity().then((a) => {
      if (a) {
        setAmenity(a);
      } else {
        // No amenity chosen yet on this device — default to gym rather than
        // leaving gating unconfigured.
        setAmenity('gym');
        setDeployedAmenity('gym');
      }
    });
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

  const runSync = async (mode: 'all' | 'force-all') => {
    if (syncing) return;
    setSyncing(mode);
    setSyncFailed(false);
    setSyncMessage(mode === 'all' ? 'Syncing subscriptions + photos…' : 'Re-syncing ALL student photos (one-time)…');
    try {
      const n = await syncStudents({
        photos: true,
        forceAllPhotos: mode === 'force-all',
        onProgress: setSyncMessage,
      });
      setCount(n);
      setSyncMessage(`Synced ${n} subscriptions + photos`);
      await setLastSyncError(null);
      const opts = await getAmenityOptions();
      if (opts.length) setAmenityOptions(opts);
    } catch (e: any) {
      const msg = e?.message || 'Check the network connection and try again.';
      setSyncMessage(`Sync failed: ${msg}`);
      setSyncFailed(true);
      await setLastSyncError(msg);
      Alert.alert(
        'Sync Failed',
        `Could not sync subscriptions / student info.\n\n${msg}\n\nCheck the network connection and try again.`,
      );
    } finally {
      setSyncing(null);
    }
  };

  // Bulk photo re-sync is expensive (every roster ID, not just new/flagged
  // ones) — confirm before running so it's not triggered by a stray tap.
  const confirmForceAllPhotos = () => {
    if (syncing) return;
    Alert.alert(
      'Re-sync ALL photos?',
      'This re-downloads every student photo from the full ZIP archive, not just new or changed ones. It can take a while and use significant data — use it only for one-time recovery (e.g. after clearing app data or setting up a new device).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Re-sync All', onPress: () => runSync('force-all') },
      ],
    );
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
        <TouchableOpacity style={styles.dropdownBtn} onPress={() => setAmenityModal(true)}>
          <Text style={styles.dropdownText}>{(amenity || 'gym').toUpperCase()}</Text>
          <Text style={styles.dropdownChevron}>▾</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Entry is checked against the "{amenity || 'gym'}" subscription.</Text>

        <Text style={styles.section}>DATA</Text>
        <Text style={styles.count}>{count} SUBSCRIPTIONS</Text>
        <TouchableOpacity style={[styles.actBtn, styles.actFilled]} onPress={() => runSync('all')} disabled={!!syncing}>
          {syncing === 'all' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.actFilledText}>SYNC SUBSCRIPTIONS</Text>}
        </TouchableOpacity>
        {syncMessage && (
          <Text style={[styles.syncMessage, syncFailed && styles.syncMessageFailed]}>{syncMessage}</Text>
        )}
        <TouchableOpacity style={[styles.subtleBtn, styles.subtleBtnSpaced]} onPress={confirmForceAllPhotos} disabled={!!syncing}>
          {syncing === 'force-all' ? (
            <ActivityIndicator color="#64748B" />
          ) : (
            <>
              <Text style={styles.subtleBtnIcon}>↻</Text>
              <Text style={styles.subtleBtnText}>RE-SYNC ALL PHOTOS (ZIP)</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.section}>REPORTS</Text>
        <TouchableOpacity style={styles.subtleBtn} onPress={() => router.push('/export')}>
          <Text style={styles.subtleBtnIcon}>📄</Text>
          <Text style={styles.subtleBtnText}>EXPORT REPORT (PDF)</Text>
        </TouchableOpacity>

        <Text style={styles.section}>SECURITY</Text>
        <TouchableOpacity style={styles.subtleBtn} onPress={() => setPwModal(true)}>
          <Text style={styles.subtleBtnIcon}>🔒</Text>
          <Text style={styles.subtleBtnText}>CHANGE PASSCODE</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={amenityModal} transparent animationType="fade" onRequestClose={() => setAmenityModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>This Device Gates</Text>
            {amenityOptions.map((a) => (
              <TouchableOpacity
                key={a}
                style={[styles.amenityOption, amenity === a && styles.amenityOptionActive]}
                onPress={() => {
                  chooseAmenity(a);
                  setAmenityModal(false);
                }}>
                <Text style={[styles.amenityOptionText, amenity === a && styles.amenityOptionTextActive]}>
                  {a.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setAmenityModal(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
  dropdownBtn: {
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownText: { fontSize: 15, fontWeight: '900', color: '#0F172A', letterSpacing: 1 },
  dropdownChevron: { fontSize: 16, fontWeight: '900', color: '#64748B' },
  amenityOption: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  amenityOptionActive: { backgroundColor: '#208AEF' },
  amenityOptionText: { fontSize: 15, fontWeight: '900', color: '#0F172A', letterSpacing: 1 },
  amenityOptionTextActive: { color: '#FFFFFF' },
  hint: { fontSize: 12, color: '#94A3B8', marginTop: 10, lineHeight: 18 },
  count: { fontSize: 22, fontWeight: '900', color: '#0F172A', marginBottom: 12 },
  actBtn: { flex: 1, height: 56, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  actFilled: { backgroundColor: '#0055FF' },
  actFilledText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  syncMessage: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 10 },
  syncMessageFailed: { color: '#DC2626', fontWeight: '900', fontSize: 13 },
  // Shared low-emphasis style for secondary actions (export, change passcode,
  // one-time bulk photo re-sync) — a small icon + muted text, no heavy fill.
  subtleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  subtleBtnSpaced: { marginTop: 14 },
  subtleBtnIcon: { fontSize: 15 },
  subtleBtnText: { color: '#64748B', fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modalCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 16 },
  modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 20, alignSelf: 'stretch' },
  modalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { color: '#64748B', fontSize: 15, fontWeight: '800' },
  modalSave: { backgroundColor: '#0F172A', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  modalSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
});

