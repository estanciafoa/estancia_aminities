import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Full-screen large number board shared by CHECK IN (Family/Guest) and CHECK OUT
// so both gates enter the flat number the same way (big touch targets, no system
// keyboard). The parent owns the value + length rule and auto-advances; this
// component only renders the filled-digit display and the key grid.

export const FLAT_LENGTH = 4;

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['', '0', '⌫'],
];

interface Props {
  value: string;
  onKey: (k: string) => void;
  disabled?: boolean;
  length?: number;
  accent?: string; // filled-slot colour (green for IN, red for OUT)
}

export default function Numpad({ value, onKey, disabled, length = FLAT_LENGTH, accent = '#00A844' }: Props) {
  const slots = Array.from({ length }, (_, i) => value[i] ?? '');
  return (
    <View style={styles.numpad}>
      <View style={styles.display}>
        {slots.map((d, i) => (
          <View key={i} style={[styles.slot, d ? { borderColor: accent, backgroundColor: '#FFFFFF' } : null]}>
            <Text style={styles.slotText}>{d || '·'}</Text>
          </View>
        ))}
      </View>

      <View style={styles.keysGrid}>
        {ROWS.map((row, r) => (
          <View key={r} style={styles.keyRow}>
            {row.map((k, c) =>
              k === '' ? (
                <View key={c} style={styles.keySpacer} />
              ) : (
                <TouchableOpacity
                  key={c}
                  style={styles.key}
                  activeOpacity={0.6}
                  disabled={disabled}
                  onPress={() => onKey(k)}>
                  <Text style={[styles.keyText, k === '⌫' && styles.keyTextMuted]}>{k}</Text>
                </TouchableOpacity>
              ),
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  numpad: { flex: 1, padding: 20 },
  display: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 24,
    paddingHorizontal: 4,
  },
  slot: {
    flex: 1,
    maxWidth: 110,
    height: 110,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotText: { fontSize: 64, fontWeight: '900', color: '#0F172A' },
  keysGrid: { flex: 1 },
  keyRow: { flex: 1, flexDirection: 'row' },
  key: {
    flex: 1,
    margin: 6,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
  },
  keySpacer: { flex: 1, margin: 6 },
  keyText: { fontSize: 76, fontWeight: '800', color: '#0F172A' },
  keyTextMuted: { fontSize: 60, color: '#64748B' },
});
