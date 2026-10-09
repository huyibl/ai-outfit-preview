import { deleteImage, getImage, listImageKeys, putImage } from "./db";

// 生成结果即时落 IndexedDB：key 编码时间戳与字节数，便于 LRU 统计
const PREFIX = "gen:";
const MAX_ITEMS = 50;
const MAX_BYTES = 200 * 1024 * 1024;

function encodeKey(ts: number, bytes: number) {
  return `${PREFIX}${ts}:${bytes}`;
}

function decodeKey(key: string): { ts: number; bytes: number } | null {
  const match = key.match(/^gen:(\d+):(\d+)$/);
  if (!match) return null;
  return { ts: Number(match[1]), bytes: Number(match[2]) };
}

export async function saveGenerationResult(blob: Blob): Promise<void> {
  try {
    await putImage(encodeKey(Date.now(), blob.size), blob);
    await pruneGenerationResults();
  } catch {
    // 存储满/不可用：不阻塞展示
  }
}

export async function loadLatestGenerationResult(): Promise<Blob | undefined> {
  try {
    const keys = (await listImageKeys()).filter((key) => key.startsWith(PREFIX)).sort();
    if (keys.length === 0) return undefined;
    return await getImage(keys[keys.length - 1]);
  } catch {
    return undefined;
  }
}

export async function pruneGenerationResults(): Promise<void> {
  const entries = (await listImageKeys())
    .map((key) => ({ key, info: decodeKey(key) }))
    .filter((entry): entry is { key: string; info: { ts: number; bytes: number } } => entry.info !== null)
    .sort((a, b) => a.info.ts - b.info.ts);
  const sized = entries.map((entry) => ({ key: entry.key, ts: entry.info.ts, bytes: entry.info.bytes }));
  let total = sized.reduce((sum, entry) => sum + entry.bytes, 0);
  let removeIndex = 0;
  while (removeIndex < sized.length && (sized.length - removeIndex > MAX_ITEMS || total > MAX_BYTES)) {
    const entry = sized[removeIndex];
    if (sized.length - removeIndex === 1 && total <= MAX_BYTES) break;
    await deleteImage(entry.key);
    total -= entry.bytes;
    removeIndex += 1;
  }
}
