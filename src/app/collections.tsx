import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  fetchDayTransactions,
  isPaymentConfigured,
  todayISO,
  type DayPayment,
} from '@/services/payments';

/** Shift a "YYYY-MM-DD" day by n days (stays in local/IST calendar terms). */
function shiftDay(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}

/** "2026-07-09" → "Thu, 9 Jul 2026". */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Unix seconds (UTC) → "3:42 PM" in IST. */
function istTime(unixSec: number): string {
  if (!unixSec) return '';
  return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function coversLabel(covers: string): string {
  return covers
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' + ');
}

export default function CollectionsScreen() {
  const router = useRouter();
  const [date, setDate] = useState<string>(todayISO());
  const [payments, setPayments] = useState<DayPayment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      if (!isPaymentConfigured()) {
        throw new Error('Payments are not set up yet. Ask the admin to configure the payment link.');
      }
      const res = await fetchDayTransactions(d);
      setPayments(res.payments);
      setTotal(res.total_rupees);
    } catch (e: any) {
      setError(e?.message || 'Could not load payments');
      setPayments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(date);
    }, [load, date]),
  );

  const go = (n: number) => setDate((d) => shiftDay(d, n));
  const isToday = date === todayISO();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>COLLECTIONS</Text>
        <TouchableOpacity onPress={() => load(date)} hitSlop={12}>
          <Text style={styles.backText}>↻</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.dateBar}>
        <TouchableOpacity style={styles.navBtn} onPress={() => go(-1)} hitSlop={10}>
          <Text style={styles.navText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.dateText}>{prettyDate(date)}</Text>
        <TouchableOpacity
          style={[styles.navBtn, isToday && styles.navBtnDisabled]}
          onPress={() => !isToday && go(1)}
          disabled={isToday}
          hitSlop={10}>
          <Text style={[styles.navText, isToday && styles.navTextDisabled]}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.summary}>
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryNum}>₹{total.toLocaleString('en-IN')}</Text>
          <Text style={styles.summaryLabel}>COLLECTED</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryBlock}>
          <Text style={styles.summaryNum}>{payments.length}</Text>
          <Text style={styles.summaryLabel}>PAYMENTS</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#208AEF" />
          <Text style={styles.muted}>Loading payments…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => load(date)}>
            <Text style={styles.retryText}>TRY AGAIN</Text>
          </TouchableOpacity>
        </View>
      ) : payments.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.muted}>No payments {isToday ? 'yet today' : 'on this day'}.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {payments.map((pmt) => (
            <View key={pmt.id} style={styles.row}>
              <View style={styles.flatBadge}>
                <Text style={styles.flatText}>{pmt.flat || '—'}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{pmt.name || '—'}</Text>
                <Text style={styles.meta}>
                  {coversLabel(pmt.covers) || 'Amenity'}
                  {pmt.month ? ` · ${pmt.month}` : ''}
                  {istTime(pmt.created_at) ? ` · ${istTime(pmt.created_at)}` : ''}
                </Text>
              </View>
              <Text style={styles.amount}>₹{pmt.amount.toLocaleString('en-IN')}</Text>
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
  dateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: { backgroundColor: '#F8FAFC' },
  navText: { fontSize: 24, fontWeight: '900', color: '#0F172A', lineHeight: 26 },
  navTextDisabled: { color: '#CBD5E1' },
  dateText: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    backgroundColor: '#ECFDF5',
    borderBottomWidth: 1,
    borderBottomColor: '#D1FAE5',
  },
  summaryBlock: { alignItems: 'center', flex: 1 },
  summaryDivider: { width: 1, height: 40, backgroundColor: '#A7F3D0' },
  summaryNum: { fontSize: 26, fontWeight: '900', color: '#065F46' },
  summaryLabel: { fontSize: 11, fontWeight: '800', color: '#047857', letterSpacing: 1, marginTop: 2 },
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
  amount: { fontSize: 17, fontWeight: '900', color: '#065F46', marginLeft: 8 },
});
