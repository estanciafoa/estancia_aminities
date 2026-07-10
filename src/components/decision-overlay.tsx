import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { type DecisionResult } from '@/services/subscription';

// Buzzer sourced from the IDCHECKER app (failure tone).
const BUZZER = require('../../assets/sounds/buzzer.mp3');

export default function DecisionOverlay({
  result,
  onDismiss,
  onPayNow,
}: {
  result: DecisionResult | null;
  onDismiss: () => void;
  onPayNow?: () => void;
}) {
  const player = useAudioPlayer(BUZZER);

  useEffect(() => {
    // Allow the buzzer to sound even when the phone is on silent.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (result?.buzzer) {
      try {
        player.seekTo(0);
        player.play();
      } catch {
        /* ignore */
      }
    }
  }, [result, player]);

  if (!result || !result.overlay) return null;

  const bg =
    result.decision === 'DENIED' ? '#7F1D1D' : result.decision === 'REGISTER' ? '#B45309' : '#1E3A8A';
  // Offer Pay Now on any unpaid outcome (warn / overdue / denied).
  // Razorpay payment hidden for now — flip this back on to re-enable the button.
  const showPay = false && !!onPayNow && (result.decision === 'WARN' || result.decision === 'REGISTER' || result.decision === 'DENIED');

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onDismiss}>
      <View style={[styles.full, { backgroundColor: bg }]}>
        <Text style={styles.title}>{result.title}</Text>
        <Text style={styles.message}>{result.message}</Text>
        {showPay && (
          <TouchableOpacity style={styles.payBtn} onPress={onPayNow} activeOpacity={0.85}>
            <Text style={styles.payText}>PAY NOW</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={onDismiss} activeOpacity={0.85}>
          <Text style={styles.btnText}>Got it!</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { fontSize: 40, fontWeight: '900', color: '#FFFFFF', textAlign: 'center', letterSpacing: 1, marginBottom: 24 },
  message: { fontSize: 20, fontWeight: '600', color: '#FFFFFF', textAlign: 'center', lineHeight: 30 },
  btn: { marginTop: 20, backgroundColor: '#FFFFFF', paddingHorizontal: 48, paddingVertical: 18, borderRadius: 14 },
  btnText: { fontSize: 22, fontWeight: '900', color: '#0F172A', letterSpacing: 1 },
  payBtn: { marginTop: 44, backgroundColor: '#00A844', paddingHorizontal: 56, paddingVertical: 20, borderRadius: 14 },
  payText: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: 2 },
});
