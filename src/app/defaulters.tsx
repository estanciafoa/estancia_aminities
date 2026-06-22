import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchLogRows } from '@/services/sheets';

const UNPAID = ['WARN', 'REGISTER', 'DENIED'];

interface Defaulter {
  flat: string;
  name: string;
  amenity: string;
  attempts: number;
  lastStatus: string;
  lastTime: string;
}

function currentMonthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(): string {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export default function DefaultersScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Defaulter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const logs = await fetchLogRows();
      const prefix = currentMonthPrefix();
      const map = new Map<string, Defaulter>();
      for (const r of logs) {
        if (r.direction !== 'IN') continue;
        const status = (r.subscription || '').toUpperCase();
        if (!UNPAID.includes(status)) continue;
        if (!r.timestamp.startsWith(prefix)) continue;
        const key = `${r.flat}|${r.name}`.toLowerCase();
        const cur =
          map.get(key) ||
          { flat: r.flat, name: r.name, amenity: r.amenity, attempts: 0, lastStatus: status, lastTime: r.timestamp };
        cur.attempts += 1;
        // logs are chronological; keep the latest seen as "last"
        cur.lastStatus = status;
        cur.lastTime = r.timestamp;
        if (r.amenity) cur.amenity = r.amenity;
        map.set(key, cur);
      }
      const list = Array.from(map.values()).sort(
        (a, b) => b.attempts - a.attempts || b.lastTime.localeCompare(a.lastTime),
      );
      setRows(list);
    } catch (e: any) {
      setError(e?.message || 'Could not load the attendance log');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const statusStyle = (s: string) =>
    s === 'DENIED' ? styles.badgeDenied : s === 'REGISTER' ? styles.badgeRegister : styles.badgeWarn;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>DEFAULTERS</Text>
        <TouchableOpacity onPress={load} hitSlop={12}>
          <Text style={styles.backText}>↻</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.subBar}>
        <Text style={styles.subText}>Unpaid entry attempts · {monthLabel()}</Text>
        <Text style={styles.countText}>{rows.length}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#208AEF" />
          <Text style={styles.muted}>Loading attendance log…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No unpaid attempts this month. 🎉</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {rows.map((d) => (
            <View key={`${d.flat}|${d.name}`} style={styles.row}>
              <View style={styles.flatBadge}>
                <Text style={styles.flatText}>{d.flat || '—'}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{d.name || '—'}</Text>
                <Text style={styles.meta}>
                  {d.amenity ? `${d.amenity} · ` : ''}
                  {d.attempts} attempt{d.attempts > 1 ? 's' : ''} · last {d.lastTime.slice(5, 16)}
                </Text>
              </View>
              <View style={[styles.badge, statusStyle(d.lastStatus)]}>
                <Text style={styles.badgeText}>{d.lastStatus}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
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
  backText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', minWidth: 40 },
  titleText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  subBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FEF2F2',
    borderBottomWidth: 1,
    borderBottomColor: '#FEE2E2',
  },
  subText: { fontSize: 13, fontWeight: '800', color: '#991B1B', letterSpacing: 0.5 },
  countText: { fontSize: 18, fontWeight: '900', color: '#991B1B' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  muted: { fontSize: 15, fontWeight: '600', color: '#64748B', marginTop: 12, textAlign: 'center' },
  errText: { fontSize: 14, fontWeight: '700', color: '#DC2626', textAlign: 'center', marginBottom: 20 },
  retryBtn: { backgroundColor: '#208AEF', paddingHorizontal: 36, paddingVertical: 14, borderRadius: 10 },
  retryText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  body: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  flatBadge: {
    minWidth: 60,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 12,
  },
  flatText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  info: { flex: 1 },
  name: { fontSize: 17, fontWeight: '800', color: '#0F172A' },
  meta: { fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 8 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  badgeWarn: { backgroundColor: '#D97706' },
  badgeRegister: { backgroundColor: '#CA8A04' },
  badgeDenied: { backgroundColor: '#DC2626' },
});
