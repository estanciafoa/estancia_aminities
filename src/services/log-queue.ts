import AsyncStorage from '@react-native-async-storage/async-storage';

import { postAttendanceLog, type AttendanceLogRow } from './sheets';
import { bumpDailyStat, getDeployedAmenity } from './storage';

const QUEUE_KEY = '@estancia_amenities_log_queue';

interface QueuedLog extends AttendanceLogRow {
  qid: string; // unique queue id
  timestamp: string; // ISO time of the actual check-in/out
}

let flushing = false;

async function readQueue(): Promise<QueuedLog[]> {
  const data = await AsyncStorage.getItem(QUEUE_KEY);
  return data ? JSON.parse(data) : [];
}

async function writeQueue(items: QueuedLog[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/**
 * Queue a log row locally (instant) and kick off a background flush.
 * The actual check-in time is captured now and sent when flushed.
 */
export async function enqueueLog(row: AttendanceLogRow): Promise<void> {
  const queue = await readQueue();
  // The amenity logged is always the one this device gates, captured now.
  const amenity = row.amenity || (await getDeployedAmenity()).toUpperCase();
  queue.push({
    ...row,
    amenity,
    qid: `${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    timestamp: new Date().toISOString(),
  });
  await writeQueue(queue);
  // Update the local daily counter that powers the home dashboard.
  if (row.direction === 'IN' || row.direction === 'OUT') void bumpDailyStat(row.direction);
  // Fire-and-forget; never blocks the UI.
  void flushLogs();
}

export async function getPendingCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Try to push every queued row to the sheet. Stops on the first failure
 * (likely offline) so order is preserved and it retries later.
 */
export async function flushLogs(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    let queue = await readQueue();
    while (queue.length > 0) {
      const item = queue[0];
      const { qid, timestamp, ...row } = item;
      try {
        await postAttendanceLog(row, timestamp);
      } catch {
        break; // network/Apps Script issue — keep the rest for next time
      }
      queue = (await readQueue()).filter((q) => q.qid !== qid);
      await writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
}
