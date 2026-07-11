import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import {
  amountForSet,
  checkQrStatus,
  createQr,
  currentMonthLabel,
  fetchPackages,
  isPaymentConfigured,
  PAYABLE_AMENITIES,
  type AmenityPackage,
  type QrInfo,
} from '@/services/payments';
import { decideEntry } from '@/services/subscription';
import {
  addCheckedIn,
  addPaidSubscriptions,
  checkedInKey,
  getDeployedAmenity,
  type Category,
} from '@/services/storage';

const LABELS: Record<string, string> = { gym: 'Gym', swimming: 'Swimming', tennis: 'Tennis' };
const POLL_MS = 4000;
const POLL_LIMIT = 45; // ~3 minutes

type Step = 'select' | 'qr' | 'done';

export default function PayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    flat?: string; name?: string; category?: string; gender?: string; student_id?: string;
  }>();
  const flat = String(params.flat || '').trim();
  const name = String(params.name || '').trim();
  const category = (String(params.category || 'Family') as Category);
  const gender = String(params.gender || '');
  const studentId = String(params.student_id || '');

  const [pkgs, setPkgs] = useState<AmenityPackage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('select');
  const [qr, setQr] = useState<QrInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paidCovers, setPaidCovers] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load packages + preselect the amenity this gate covers.
  useEffect(() => {
    if (!isPaymentConfigured()) {
      setError('Payments are not set up yet. Ask the admin to configure the payment link.');
      return;
    }
    fetchPackages().then(setPkgs).catch((e) => setError(String(e?.message || e)));
    getDeployedAmenity().then((a) => {
      const key = a.trim().toLowerCase();
      if ((PAYABLE_AMENITIES as readonly string[]).includes(key)) setSelected(new Set([key]));
    });
  }, []);

  const amount = amountForSet(pkgs, Array.from(selected), category);

  // Render the payment-link URL as a QR (GIF data URI) on-device.
  const qrDataUrl = useMemo(() => {
    if (!qr?.payUrl) return '';
    try {
      const g = qrcode(0, 'M');
      g.addData(qr.payUrl);
      g.make();
      return g.createDataURL(6, 10);
    } catch {
      return '';
    }
  }, [qr?.payUrl]);

  const toggle = (a: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const onPaid = useCallback(
    async (covers: string[]) => {
      stopPolling();
      const granted = covers.length ? covers : Array.from(selected);
      setPaidCovers(granted);
      setStep('done');
      try {
        await addPaidSubscriptions(flat, name, granted, currentMonthLabel());
        // Now that they're paid, complete the check-in for this gate if allowed.
        const result = await decideEntry({ category, flat, name, studentId });
        if (result.allowed) {
          await addCheckedIn({
            key: checkedInKey(category, { flat, name, studentId }),
            category,
            flat,
            name,
            gender,
            student_id: studentId,
            checkInAt: new Date().toISOString(),
          });
          await enqueueLog({
            category,
            flat,
            name,
            gender,
            student_id: studentId,
            direction: 'IN',
            subscription: result.decision,
          });
          setPendingConfirmation('in');
        }
      } catch {
        /* payment recorded server-side regardless; local best-effort */
      }
    },
    [flat, name, category, gender, studentId, selected],
  );

  const showQr = async () => {
    if (!amount) {
      setError('No price is set for this combination. Ask the admin.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const info = await createQr({
        category,
        flat,
        name,
        amenities: Array.from(selected),
        month: currentMonthLabel(),
      });
      setQr(info);
      setStep('qr');
      // Poll until Razorpay confirms the payment.
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        try {
          const st = await checkQrStatus(info.qrId);
          if (st.paid) onPaid(st.covers || info.covers);
        } catch {
          /* transient; keep polling */
        }
        if (tries >= POLL_LIMIT) stopPolling();
      }, POLL_MS);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const goHome = () => {
    stopPolling();
    try {
      router.dismissAll();
    } catch {
      router.replace('/');
    }
  };

  const onBack = () => {
    if (step === 'qr') {
      stopPolling();
      setQr(null);
      setStep('select');
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={onBack} hitSlop={12}>
          <Text style={styles.backText}>{step === 'done' ? '' : '‹ BACK'}</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>PAY · {flat}</Text>
        <View style={{ width: 64 }} />
      </View>

      {step === 'select' && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.headline}>Select amenities to pay for</Text>
          {(PAYABLE_AMENITIES as readonly string[]).map((a) => {
            const on = selected.has(a);
            return (
              <TouchableOpacity
                key={a}
                style={[styles.checkRow, on && styles.checkRowOn]}
                activeOpacity={0.85}
                onPress={() => toggle(a)}>
                <View style={[styles.box, on && styles.boxOn]}>
                  {on && <Text style={styles.tick}>✓</Text>}
                </View>
                <Text style={styles.checkLabel}>{LABELS[a]}</Text>
              </TouchableOpacity>
            );
          })}

          <View style={styles.amountBox}>
            <Text style={styles.amountLabel}>AMOUNT PAYABLE</Text>
            <Text style={styles.amountValue}>
              {selected.size === 0 ? '—' : amount != null ? '₹' + amount : 'Not available'}
            </Text>
          </View>

          {!!error && <Text style={styles.err}>{error}</Text>}

          <TouchableOpacity
            style={[styles.payBtn, (!amount || busy) && styles.payBtnDisabled]}
            disabled={!amount || busy}
            onPress={showQr}
            activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.payBtnText}>SHOW QR CODE</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}

      {step === 'qr' && qr && (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.headline}>Scan to pay ₹{qr.amount}</Text>
          <Text style={styles.sub}>Scan with your phone camera or any UPI app, then pay</Text>
          <View style={styles.qrWrap}>
            {qrDataUrl ? (
              <Image source={{ uri: qrDataUrl }} style={styles.qr} contentFit="contain" transition={200} />
            ) : (
              <ActivityIndicator color="#00A844" style={{ width: 260, height: 260 }} />
            )}
          </View>
          <View style={styles.waitRow}>
            <ActivityIndicator color="#00A844" />
            <Text style={styles.waitText}>Waiting for payment…</Text>
          </View>
          {!!error && <Text style={styles.err}>{error}</Text>}
          <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} activeOpacity={0.85}>
            <Text style={styles.secondaryText}>CANCEL</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {step === 'done' && (
        <View style={styles.doneBody}>
          <Text style={styles.doneTick}>✓</Text>
          <Text style={styles.doneTitle}>Payment received</Text>
          <Text style={styles.doneMsg}>
            {paidCovers.map((c) => LABELS[c] || c).join(' & ')} subscription recorded for {flat}.
          </Text>
          <TouchableOpacity style={styles.payBtn} onPress={goHome} activeOpacity={0.85}>
            <Text style={styles.payBtnText}>DONE</Text>
          </TouchableOpacity>
        </View>
      )}
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

  body: { padding: 24, paddingBottom: 48 },
  headline: { fontSize: 24, fontWeight: '900', color: '#0F172A', marginBottom: 6 },
  sub: { fontSize: 14, color: '#64748B', marginBottom: 18 },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 76,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    marginTop: 14,
  },
  checkRowOn: { borderColor: '#00A844', backgroundColor: '#F0FDF4' },
  box: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    marginRight: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  boxOn: { borderColor: '#00A844', backgroundColor: '#00A844' },
  tick: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  checkLabel: { fontSize: 26, fontWeight: '800', color: '#0F172A' },

  amountBox: {
    marginTop: 28,
    padding: 20,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  amountLabel: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2 },
  amountValue: { fontSize: 44, fontWeight: '900', color: '#0F172A', marginTop: 6 },

  err: { color: '#DC2626', fontSize: 14, fontWeight: '700', marginTop: 16 },

  payBtn: {
    marginTop: 28,
    height: 76,
    borderRadius: 16,
    backgroundColor: '#00A844',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
  },
  payBtnDisabled: { backgroundColor: '#94A3B8' },
  payBtnText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: 1 },

  qrWrap: {
    alignSelf: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    marginTop: 8,
  },
  qr: { width: 260, height: 260 },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 24 },
  waitText: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  secondaryBtn: {
    marginTop: 28,
    height: 60,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryText: { fontSize: 18, fontWeight: '800', color: '#64748B', letterSpacing: 1 },

  doneBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  doneTick: { fontSize: 96, color: '#00A844', fontWeight: '900' },
  doneTitle: { fontSize: 34, fontWeight: '900', color: '#0F172A', marginTop: 8 },
  doneMsg: { fontSize: 18, color: '#334155', textAlign: 'center', marginTop: 12, lineHeight: 26 },
});
