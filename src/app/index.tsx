import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { consumePendingConfirmation, type ConfirmKind } from '@/services/confirmation';
import { getPendingCount } from '@/services/log-queue';
import { getCheckedIn, getDeployedAmenity, getLastSyncTime, getTodayStats } from '@/services/storage';

function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return 'never';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function HomeScreen() {
  const router = useRouter();
  const [amenity, setAmenity] = useState('');
  const [insideCount, setInsideCount] = useState(0);
  const [todayIn, setTodayIn] = useState(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [confirm, setConfirm] = useState<{ kind: ConfirmKind; message: string } | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      getDeployedAmenity().then(setAmenity);
      getCheckedIn().then((list) => setInsideCount(list.length));
      getTodayStats().then((s) => setTodayIn(s.in));
      getLastSyncTime().then(setLastSync);
      getPendingCount().then(setPending);
      const pending = consumePendingConfirmation();
      if (pending) {
        setConfirm(pending);
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        confirmTimer.current = setTimeout(() => setConfirm(null), 4500);
      }
      return () => {
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
      };
    }, []),
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/admin')} hitSlop={12}>
          <Text style={styles.iconText}>⚙︎</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>ESTANCIA ACCESS</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/inside')} hitSlop={12}>
          <Text style={styles.iconText}>👥</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.amenityBar} activeOpacity={0.7} onPress={() => router.push('/inside')}>
        {amenity ? (
          <Text style={styles.amenityText}>
            GATING: <Text style={styles.amenityName}>{amenity.toUpperCase()}</Text>
          </Text>
        ) : (
          <Text style={styles.amenityWarn}>⚠ AMENITY NOT SET — OPEN ADMIN</Text>
        )}
        <View style={styles.insidePill}>
          <Text style={styles.insidePillText}>👥 {insideCount} INSIDE</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNum}>{todayIn}</Text>
          <Text style={styles.statLabel}>TODAY'S ENTRIES</Text>
        </View>
        <TouchableOpacity style={styles.statCard} activeOpacity={0.7} onPress={() => router.push('/inside')}>
          <Text style={styles.statNum}>{insideCount}</Text>
          <Text style={styles.statLabel}>INSIDE NOW</Text>
        </TouchableOpacity>
        <View style={styles.statCard}>
          <Text style={[styles.statNum, pending > 0 && styles.statNumWarn]}>{pending}</Text>
          <Text style={styles.statLabel}>UNSYNCED</Text>
        </View>
      </View>
      <Text style={styles.syncLine}>
        Last sync: {fmtAgo(lastSync)}
        {pending > 0 ? '  ·  syncing…' : ''}
      </Text>

      <View style={styles.menu}>
        <TouchableOpacity
          style={[styles.bigButton, styles.inButton]}
          onPress={() => router.push('/checkin')}
          activeOpacity={0.85}>
          <Text style={styles.bigButtonText}>IN</Text>
          <Text style={styles.bigButtonSub}>CHECK IN</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigButton, styles.outButton]}
          onPress={() => router.push('/checkout')}
          activeOpacity={0.85}>
          <Text style={styles.bigButtonText}>OUT</Text>
          <Text style={styles.bigButtonSub}>CHECK OUT</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <TouchableOpacity style={styles.confirmOverlay} activeOpacity={1} onPress={() => setConfirm(null)}>
          <View style={[styles.confirmCard, confirm?.kind === 'out' && styles.confirmCardOut]}>
            <Text style={styles.confirmTick}>{confirm?.kind === 'out' ? '👋' : '✅'}</Text>
            <Text style={styles.confirmText}>{confirm?.message}</Text>
            <Text style={styles.confirmHint}>TAP TO DISMISS</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  titleBar: {
    backgroundColor: '#208AEF',
    paddingVertical: 16,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBtn: { width: 40, alignItems: 'center' },
  iconText: { fontSize: 22, color: '#FFFFFF' },
  titleText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  amenityBar: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  amenityText: { fontSize: 13, fontWeight: '700', color: '#475569', letterSpacing: 1 },
  amenityName: { color: '#208AEF', fontWeight: '900' },
  amenityWarn: { fontSize: 12, fontWeight: '900', color: '#D97706', letterSpacing: 0.5 },
  insidePill: { backgroundColor: '#208AEF', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  insidePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statNum: { fontSize: 30, fontWeight: '900', color: '#0F172A' },
  statNumWarn: { color: '#D97706' },
  statLabel: { fontSize: 10, fontWeight: '800', color: '#64748B', letterSpacing: 1, marginTop: 2 },
  syncLine: { fontSize: 11, fontWeight: '700', color: '#94A3B8', textAlign: 'center', marginTop: 8 },
  menu: { flex: 1, justifyContent: 'center', padding: 24, gap: 24 },
  bigButton: { flex: 1, borderRadius: 20, justifyContent: 'center', alignItems: 'center', elevation: 4 },
  inButton: { backgroundColor: '#00A844' },
  outButton: { backgroundColor: '#DC2626' },
  bigButtonText: { color: '#FFFFFF', fontSize: 72, fontWeight: '900', letterSpacing: 4 },
  bigButtonSub: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 4, marginTop: 4, opacity: 0.9 },
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  confirmCard: {
    backgroundColor: '#00A844',
    borderRadius: 20,
    paddingVertical: 36,
    paddingHorizontal: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 420,
  },
  confirmCardOut: { backgroundColor: '#208AEF' },
  confirmTick: { fontSize: 64, marginBottom: 12 },
  confirmText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', textAlign: 'center', lineHeight: 32 },
  confirmHint: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', letterSpacing: 2, marginTop: 20, opacity: 0.85 },
});
