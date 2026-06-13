import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCheckedIn, getDeployedAmenity, type CheckedInEntry } from '@/services/storage';

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch {
    return '';
  }
}

export default function InsideScreen() {
  const router = useRouter();
  const [people, setPeople] = useState<CheckedInEntry[]>([]);
  const [amenity, setAmenity] = useState('');

  useFocusEffect(
    useCallback(() => {
      getDeployedAmenity().then(setAmenity);
      getCheckedIn().then((list) =>
        setPeople([...list].sort((a, b) => a.flat.localeCompare(b.flat) || a.name.localeCompare(b.name))),
      );
    }, []),
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.titleBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.backText}>‹ BACK</Text>
        </TouchableOpacity>
        <Text style={styles.titleText}>INSIDE{amenity ? ` · ${amenity.toUpperCase()}` : ''}</Text>
        <View style={{ width: 56 }} />
      </View>

      <View style={styles.countBar}>
        <Text style={styles.countNum}>{people.length}</Text>
        <Text style={styles.countLabel}>CURRENTLY INSIDE</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {people.length === 0 ? (
          <Text style={styles.empty}>No one is currently checked in.</Text>
        ) : (
          people.map((p) => (
            <View key={p.key} style={styles.row}>
              <View style={styles.flatBadge}>
                <Text style={styles.flatText}>{p.flat || '—'}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{p.name || p.student_id || '—'}</Text>
                <Text style={styles.meta}>
                  {p.category}
                  {p.student_id ? ` · ${p.student_id}` : ''} · in {fmtTime(p.checkInAt)}
                </Text>
              </View>
            </View>
          ))
        )}
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
  titleText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  countBar: {
    backgroundColor: '#EFF6FF',
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
  },
  countNum: { fontSize: 44, fontWeight: '900', color: '#208AEF' },
  countLabel: { fontSize: 12, fontWeight: '800', color: '#475569', letterSpacing: 2 },
  body: { padding: 16 },
  empty: { fontSize: 15, fontWeight: '600', color: '#94A3B8', textAlign: 'center', marginTop: 40 },
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
    minWidth: 64,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    alignItems: 'center',
    marginRight: 14,
  },
  flatText: { color: '#FFFFFF', fontWeight: '900', fontSize: 16 },
  info: { flex: 1 },
  name: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  meta: { fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 2 },
});
