import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { enqueueLog } from '@/services/log-queue';
import { getCheckedIn, getDeployedAmenity, removeCheckedIn, type CheckedInEntry } from '@/services/storage';

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

  const reload = useCallback(async () => {
    const list = await getCheckedIn();
    setPeople([...list].sort((a, b) => a.flat.localeCompare(b.flat) || a.name.localeCompare(b.name)));
  }, []);

  useFocusEffect(
    useCallback(() => {
      getDeployedAmenity().then(setAmenity);
      reload();
    }, [reload]),
  );

  const checkOut = async (entry: CheckedInEntry) => {
    await enqueueLog({
      category: entry.category,
      flat: entry.flat,
      name: entry.name,
      gender: entry.gender,
      student_id: entry.student_id,
      direction: 'OUT',
      subscription: '',
    });
    await removeCheckedIn(entry.key);
    await reload();
  };

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
        {people.length > 0 && <Text style={styles.hint}>← Swipe a name left to check out</Text>}
        {people.length === 0 ? (
          <Text style={styles.empty}>No one is currently checked in.</Text>
        ) : (
          people.map((p) => (
            <Swipeable
              key={p.key}
              renderRightActions={() => (
                <TouchableOpacity style={styles.swipeAction} onPress={() => checkOut(p)}>
                  <Text style={styles.swipeActionText}>CHECK{'\n'}OUT</Text>
                </TouchableOpacity>
              )}
              overshootRight={false}>
              <View style={styles.row}>
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
            </Swipeable>
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
  hint: { fontSize: 12, fontWeight: '700', color: '#94A3B8', marginBottom: 10, textAlign: 'right' },
  empty: { fontSize: 15, fontWeight: '600', color: '#94A3B8', textAlign: 'center', marginTop: 40 },
  swipeAction: {
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    marginBottom: 10,
    borderRadius: 10,
  },
  swipeActionText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13, letterSpacing: 1, textAlign: 'center' },
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
