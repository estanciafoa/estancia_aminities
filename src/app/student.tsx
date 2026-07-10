import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DecisionOverlay from '@/components/decision-overlay';
import { setPendingConfirmation } from '@/services/confirmation';
import { enqueueLog } from '@/services/log-queue';
import { decideEntry, type DecisionResult } from '@/services/subscription';
import {
  addCheckedIn,
  checkedInKey,
  getDeployedAmenity,
  getRosterById,
  hasStudentSubscription,
  type RosterEntry,
} from '@/services/storage';

function normalizeScannedCode(rawCode: string): string {
  return String(rawCode || '')
    .replace(/[ -]/g, '')
    .trim();
}

export default function StudentScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [student, setStudent] = useState<RosterEntry | null>(null);
  const [scannedId, setScannedId] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [hasSub, setHasSub] = useState(false);
  const [manualId, setManualId] = useState('');
  const [wedgeInput, setWedgeInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [overlay, setOverlay] = useState<DecisionResult | null>(null);
  const [manualFocused, setManualFocused] = useState(false);

  const wedgeInputRef = useRef<TextInput>(null);
  const manualInputRef = useRef<TextInput>(null);
  const wedgeInputBufferRef = useRef('');
  const wedgeLookupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wedgeLookupInFlightRef = useRef(false);

  useEffect(() => {
    return () => {
      if (wedgeLookupTimerRef.current) clearTimeout(wedgeLookupTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const manualIsFocused = manualInputRef.current?.isFocused?.() ?? false;
    if (showResult || manualFocused || manualIsFocused) return;
    const t = setTimeout(() => wedgeInputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [showResult, manualFocused]);

  const refocusWedgeInputIfNeeded = () => {
    setTimeout(() => {
      const manualIsFocused = manualInputRef.current?.isFocused?.() ?? false;
      if (!showResult && !manualIsFocused) wedgeInputRef.current?.focus();
    }, 80);
  };

  const lookup = async (id: string) => {
    const found = await getRosterById(id);
    setScannedId(id);
    setStudent(found);
    setNotFound(!found);
    if (found) {
      const amenity = await getDeployedAmenity();
      setHasSub(await hasStudentSubscription(found.flat, found.name, amenity));
    } else {
      setHasSub(false);
    }
    setShowResult(true);
  };

  const runLookup = async (rawCode: string) => {
    const trimmed = normalizeScannedCode(rawCode);
    if (!trimmed) return;
    setLoading(true);
    await lookup(trimmed);
    setLoading(false);
  };

  const handleManualLookup = async () => {
    if (!manualId.trim()) return;
    await runLookup(manualId.trim());
    setManualId('');
  };

  const clearWedgeInput = () => {
    wedgeInputBufferRef.current = '';
    setWedgeInput('');
  };

  const handleWedgeInputChange = (value: string) => {
    wedgeInputBufferRef.current = value;
    setWedgeInput(value);
  };

  const handleWedgeLookup = (event?: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
    const submittedText = event?.nativeEvent?.text || '';
    const candidateText = submittedText || wedgeInputBufferRef.current || wedgeInput;
    if (wedgeLookupTimerRef.current) clearTimeout(wedgeLookupTimerRef.current);
    wedgeLookupTimerRef.current = setTimeout(async () => {
      const latestInput = wedgeInputBufferRef.current || candidateText;
      const normalized = normalizeScannedCode(latestInput);
      if (!normalized || showResult || loading || wedgeLookupInFlightRef.current) {
        clearWedgeInput();
        return;
      }
      wedgeLookupInFlightRef.current = true;
      try {
        await runLookup(latestInput);
      } finally {
        wedgeLookupInFlightRef.current = false;
        clearWedgeInput();
      }
    }, 120);
  };

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned) return;
      setScanned(true);
      await runLookup(data.trim());
    },
    [scanned],
  );

  const resetScan = () => {
    setScanned(false);
    setCameraActive(false);
    setShowResult(false);
    setStudent(null);
    setScannedId('');
    setNotFound(false);
    setHasSub(false);
  };

  const handleCheckIn = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const id = scannedId;
      const flat = student?.flat || '';
      const name = student?.name || '';
      const result = await decideEntry({ category: 'Student', flat, name });

      if (result.allowed) {
        await addCheckedIn({
          key: checkedInKey('Student', { studentId: id }),
          category: 'Student',
          flat,
          name,
          gender: '',
          student_id: id,
          checkInAt: new Date().toISOString(),
        });
        setPendingConfirmation('in');
      }

      await enqueueLog({
        category: 'Student',
        flat,
        name,
        gender: '',
        student_id: id,
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

  // RESULT SCREEN with CHECK IN
  if (showResult) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.statusBanner, notFound ? styles.deniedBanner : styles.verifiedBanner]}>
          <Text style={styles.bannerText}>{notFound ? 'NOT IN SYSTEM' : 'STUDENT'}</Text>
        </View>

        <View style={styles.resultBody}>
          {notFound ? (
            <>
              <View style={styles.facePhotoFallback}>
                <Text style={styles.facePhotoInitial}>?</Text>
              </View>
              <Text style={styles.resultName}>ID: {scannedId}</Text>
              <Text style={styles.notFoundSub}>Not found in the student roster.</Text>
            </>
          ) : student ? (
            <>
              {student.local_photo ? (
                <Image source={{ uri: student.local_photo }} style={styles.facePhoto} resizeMode="cover" />
              ) : (
                <View style={styles.facePhotoFallback}>
                  <Text style={styles.facePhotoInitial}>{(student.name || '?').charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <Text style={styles.resultName}>{student.name || '—'}</Text>
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>STUDENT</Text>
              </View>
              <View style={styles.infoBar}>
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>ID</Text>
                  <Text style={styles.infoValue}>{student.id}</Text>
                </View>
                <View style={styles.infoSep} />
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>FLAT NO</Text>
                  <Text style={styles.infoValue}>{student.flat || '—'}</Text>
                </View>
                <View style={styles.infoSep} />
                <View style={styles.infoItem}>
                  <Text style={styles.infoLabel}>VALID TILL</Text>
                  <Text style={styles.infoValue}>{student.validTill || '—'}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {student && hasSub ? (
          <TouchableOpacity style={styles.checkInBtn} onPress={handleCheckIn} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.checkInText}>CHECK IN</Text>}
          </TouchableOpacity>
        ) : student ? (
          <View style={styles.noSubBox}>
            <Text style={styles.noSubText}>NO SUBSCRIPTION YET</Text>
          </View>
        ) : null}
        <TouchableOpacity style={styles.cancelBtn} onPress={resetScan}>
          <Text style={styles.cancelText}>CANCEL / SCAN AGAIN</Text>
        </TouchableOpacity>

        <DecisionOverlay
          result={overlay}
          onDismiss={dismissOverlay}
          onPayNow={() => {
            setOverlay(null);
            // '/pay' route types regenerate under `expo start`; cast until then.
            router.push({
              pathname: '/pay' as any,
              params: {
                flat: student?.flat || '',
                name: student?.name || '',
                category: 'Student',
                gender: '',
                student_id: scannedId,
              },
            });
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        <View style={styles.titleBar}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.backText}>‹ BACK</Text>
          </TouchableOpacity>
          <Text style={styles.titleText}>STUDENT · IN</Text>
          <View style={{ width: 56 }} />
        </View>

        <TextInput
          ref={wedgeInputRef}
          value={wedgeInput}
          onChangeText={handleWedgeInputChange}
          onSubmitEditing={handleWedgeLookup}
          autoFocus
          blurOnSubmit={false}
          showSoftInputOnFocus={false}
          style={styles.hiddenWedgeInput}
          caretHidden
          onBlur={refocusWedgeInputIfNeeded}
        />

        {!cameraActive ? (
          <TouchableOpacity
            style={styles.placeholderContainer}
            onPress={() => {
              if (!permission?.granted) {
                requestPermission();
                return;
              }
              setCameraActive(true);
            }}
            activeOpacity={0.7}>
            <Text style={styles.placeholderTitle}>TAP TO SCAN ID</Text>
            <Text style={styles.placeholderSubtext}>
              {permission?.granted ? 'Camera opens for barcode scanning' : 'Grant camera permission to scan'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.cameraContainer}>
            <CameraView
              style={styles.camera}
              facing="front"
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8'] }}
              onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
            />
            <View style={styles.overlay}>
              <View style={styles.viewfinder}>
                <View style={[styles.corner, styles.cornerTL]} />
                <View style={[styles.corner, styles.cornerTR]} />
                <View style={[styles.corner, styles.cornerBL]} />
                <View style={[styles.corner, styles.cornerBR]} />
              </View>
              <Text style={styles.scanHint}>ALIGN BARCODE WITHIN FRAME</Text>
              <TouchableOpacity style={styles.closeCameraBtn} onPress={() => setCameraActive(false)}>
                <Text style={styles.closeCameraText}>CLOSE CAMERA</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#0055FF" />
            <Text style={styles.loadingText}>LOOKING UP...</Text>
          </View>
        )}

        <View style={styles.manualSection}>
          <Text style={styles.manualLabel}>ENTER STUDENT ID</Text>
          <View style={styles.manualRow}>
            <TextInput
              ref={manualInputRef}
              style={styles.manualInput}
              value={manualId}
              onChangeText={setManualId}
              onFocus={() => setManualFocused(true)}
              onBlur={() => setManualFocused(false)}
              placeholder="Scan or type student ID"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleManualLookup}
            />
            <TouchableOpacity style={styles.lookupBtn} onPress={handleManualLookup} disabled={loading}>
              <Text style={styles.lookupBtnText}>LOOK UP</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  hiddenWedgeInput: { position: 'absolute', width: 1, height: 1, opacity: 0.01, left: -100, top: -100 },
  titleBar: {
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', width: 56 },
  titleText: { fontSize: 20, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  placeholderContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F3FF' },
  placeholderTitle: { fontSize: 24, fontWeight: '900', color: '#7C3AED', marginTop: 16, letterSpacing: 2 },
  placeholderSubtext: { fontSize: 13, fontWeight: '600', color: '#475569', marginTop: 8 },
  cameraContainer: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  viewfinder: { width: 250, height: 250, position: 'relative' },
  corner: { position: 'absolute', width: 40, height: 40, borderColor: '#FFFFFF' },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4 },
  scanHint: { marginTop: 24, color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  closeCameraBtn: { marginTop: 28, backgroundColor: '#7C3AED', paddingHorizontal: 24, paddingVertical: 14, borderWidth: 2, borderColor: '#FFFFFF' },
  closeCameraText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.85)' },
  loadingText: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#475569' },
  manualSection: { padding: 16, paddingHorizontal: 20, backgroundColor: '#F8FAFC', borderTopWidth: 2, borderTopColor: '#000000' },
  manualLabel: { fontSize: 12, fontWeight: '700', color: '#64748B', letterSpacing: 2, marginBottom: 8 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualInput: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
  },
  lookupBtn: { width: 96, height: 56, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#000000' },
  lookupBtnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
  statusBanner: { height: 64, justifyContent: 'center', alignItems: 'center' },
  verifiedBanner: { backgroundColor: '#7C3AED' },
  deniedBanner: { backgroundColor: '#FF3B30' },
  bannerText: { fontSize: 26, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  resultBody: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  facePhoto: { width: 200, height: 240, borderRadius: 12, backgroundColor: '#0F172A', marginBottom: 16 },
  facePhotoFallback: { width: 200, height: 240, borderRadius: 12, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  facePhotoInitial: { fontSize: 110, fontWeight: '900', color: '#FFFFFF' },
  resultName: { fontSize: 30, fontWeight: '900', color: '#0F172A', textAlign: 'center', marginBottom: 10 },
  notFoundSub: { fontSize: 15, fontWeight: '600', color: '#475569', textAlign: 'center', marginTop: 6 },
  typeBadge: { backgroundColor: '#7C3AED', paddingHorizontal: 18, paddingVertical: 6, borderRadius: 20, marginBottom: 18 },
  typeBadgeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  infoBar: { flexDirection: 'row', backgroundColor: '#0F172A', paddingVertical: 16, paddingHorizontal: 12, alignSelf: 'stretch' },
  infoItem: { flex: 1, alignItems: 'center' },
  infoLabel: { fontSize: 10, fontWeight: '700', color: '#94A3B8', letterSpacing: 1 },
  infoValue: { fontSize: 16, fontWeight: '900', color: '#FFFFFF', marginTop: 4, textAlign: 'center' },
  infoSep: { width: 1, backgroundColor: '#334155' },
  checkInBtn: { height: 100, backgroundColor: '#00A844', justifyContent: 'center', alignItems: 'center' },
  checkInText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  noSubBox: { height: 100, backgroundColor: '#FEF3C7', justifyContent: 'center', alignItems: 'center' },
  noSubText: { color: '#B45309', fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  cancelBtn: { height: 56, justifyContent: 'center', alignItems: 'center' },
  cancelText: { color: '#64748B', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
});
