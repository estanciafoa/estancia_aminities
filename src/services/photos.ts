import {
  EncodingType,
  deleteAsync,
  documentDirectory,
  getInfoAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import JSZip from 'jszip';


// Face photos extracted from the Drive ZIP live here, named "<FlatNo>.jpg".
const PHOTOS_DIR = `${documentDirectory}student_photos`;

function isImageFile(name: string): boolean {
  return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
}

function getFileStem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

async function ensurePhotosDir(): Promise<string> {
  const info = await getInfoAsync(PHOTOS_DIR);
  if (!info.exists) {
    await makeDirectoryAsync(PHOTOS_DIR, { intermediates: true });
  }
  return PHOTOS_DIR;
}

/**
 * Extract images from a base64-encoded ZIP into the local photos folder.
 * The ZIP is served inline (base64) by the Apps Script `get_zip` proxy.
 * Files are written using their bare name (e.g. "3257.jpg"). Returns the count.
 * Adapted from IDCHECKER's importPhotosFromBase64.
 *
 * The faces ZIP holds ~1600 images, but this app only needs the synced
 * students. Pass `wantedIds` to extract just those (huge speed/space win);
 * omit it to extract everything.
 */
export async function importPhotosFromBase64(
  zipBase64: string,
  wantedIds?: string[],
): Promise<number> {
  if (!zipBase64) return 0;

  const want = wantedIds ? new Set(wantedIds.map((id) => id.trim().toLowerCase())) : null;
  const dir = await ensurePhotosDir();
  const zip = await JSZip.loadAsync(zipBase64, { base64: true });
  const files = Object.values(zip.files).filter((f) => {
    if (f.dir || !isImageFile(f.name)) return false;
    if (!want) return true;
    const stem = getFileStem((f.name.split('/').pop() || f.name)).toLowerCase();
    return want.has(stem);
  });

  let done = 0;
  for (const f of files) {
    const fileName = f.name.split('/').pop() || f.name;
    const dataBase64 = await f.async('base64');
    await writeAsStringAsync(`${dir}/${fileName}`, dataBase64, { encoding: EncodingType.Base64 });
    done++;
  }
  return done;
}

/**
 * Populate local_photo on each item from the extracted files, matching the
 * file stem (case-insensitive) against a key derived from each item.
 * Mirrors IDCHECKER's attachLocalPhotosById.
 */
export async function attachLocalPhotos<T extends { local_photo?: string }>(
  items: T[],
  getKey: (item: T) => string,
): Promise<T[]> {
  const dir = await ensurePhotosDir();
  const names = (await readDirectoryAsync(dir)).filter(isImageFile);

  // Index available photos by lowercased stem for fast, case-insensitive lookup.
  const byStem = new Map<string, string>();
  for (const n of names) byStem.set(getFileStem(n).toLowerCase(), n);

  return items.map((item) => {
    const match = byStem.get((getKey(item) || '').trim().toLowerCase());
    return match ? { ...item, local_photo: `${dir}/${match}` } : item;
  });
}

/** Delete all extracted face photos. */
export async function clearPhotos(): Promise<void> {
  try {
    const info = await getInfoAsync(PHOTOS_DIR);
    if (info.exists) await deleteAsync(PHOTOS_DIR, { idempotent: true });
  } catch {
    /* ignore */
  }
}
