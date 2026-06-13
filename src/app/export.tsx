import * as Print from 'expo-print';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { buildReportHtml, thisMonthStr, todayStr, type ReportMode } from '@/services/report';

export default function ExportScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<ReportMode>('daily');
  const [value, setValue] = useState(todayStr());
  const [busy, setBusy] = useState(false);

  const switchMode = (m: ReportMode) => {
    setMode(m);
    setValue(m === 'daily' ? todayStr() : thisMonthStr());
  };

  const handleExport = async () => {
    if (busy) return;
    const v = value.trim();
    const ok = mode === 'daily' ? /^\d{4}-\d{2}-\d{2}$/.test(v) : /^\d{4}-\d{2}$/.test(v);
    if (!ok) {
      return Alert.alert('Invalid date', mode === 'daily' ? 'Use YYYY-MM-DD.' : 'Use YYYY-MM.');
    }
    Keyboard.dismiss();
    setBusy(true);
    try {
      const { html, count } = await buildReportHtml(mode, v);
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Estancia Amenities Report' });
      } else {
        Alert.alert('Saved', `Report generated (${count} records):\n${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not generate the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>EXPORT PDF</Text>
        <View style={{ width: 56 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>REPORT TYPE</Text>
        <View style={styles.segRow}>
          <TouchableOpacity
            style={[styles.seg, mode === 'daily' && styles.segActive]}
            onPress={() => switchMode('daily')}>
            <Text style={[styles.segText, mode === 'daily' && styles.segTextActive]}>DAILY</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.seg, mode === 'monthly' && styles.segActive]}
            onPress={() => switchMode('monthly')}>
            <Text style={[styles.segText, mode === 'monthly' && styles.segTextActive]}>MONTHLY</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>{mode === 'daily' ? 'DATE (YYYY-MM-DD)' : 'MONTH (YYYY-MM)'}</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder={mode === 'daily' ? '2026-06-12' : '2026-06'}
          placeholderTextColor="#94A3B8"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          onBlur={() => Keyboard.dismiss()}
        />

        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.exportText}>GENERATE PDF</Text>}
        </TouchableOpacity>

        <Text style={styles.note}>
          The report includes totals, a check-ins-by-category pie chart, subscription-status breakdown, and key
          observations (denials, busiest hour, gender split, unique residents).
        </Text>
      </ScrollView>
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
  body: { padding: 24 },
  label: { fontSize: 12, fontWeight: '800', color: '#64748B', letterSpacing: 2, marginTop: 18, marginBottom: 8 },
  segRow: { flexDirection: 'row', gap: 12 },
  seg: {
    flex: 1,
    height: 56,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  segActive: { borderColor: '#0F172A', backgroundColor: '#0F172A' },
  segText: { fontSize: 15, fontWeight: '900', color: '#64748B', letterSpacing: 1 },
  segTextActive: { color: '#FFFFFF' },
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
  exportBtn: {
    marginTop: 32,
    height: 72,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
  },
  exportText: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 2 },
  note: { marginTop: 20, fontSize: 12, color: '#94A3B8', lineHeight: 18 },
});
