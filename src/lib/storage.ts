import type { ClothingItem, Outfit } from "../types";

const ITEMS_KEY = "ai-outfit-preview:items";
const OUTFITS_KEY = "ai-outfit-preview:outfits";
const SEEDED_KEY = "ai-outfit-preview:seeded";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadItems(): ClothingItem[] {
  return readJson<ClothingItem[]>(ITEMS_KEY, []);
}

export function loadOutfits(): Outfit[] {
  return readJson<Outfit[]>(OUTFITS_KEY, []);
}

export function saveItems(items: ClothingItem[]) {
  // 图片本体在 IndexedDB，items 里只有元数据，写失败只影响元数据持久化
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
  } catch {
    // 配额不足时放弃本次写入，不阻塞应用
  }
}

export function saveOutfits(outfits: Outfit[]) {
  // outfits 含预览图 base64（单张可达数 MB），容易触发配额：从最旧的开始丢，保住应用不崩
  for (let count = outfits.length; count > 0; count -= 1) {
    try {
      localStorage.setItem(OUTFITS_KEY, JSON.stringify(outfits.slice(0, count)));
      return;
    } catch {
      // 继续丢更旧的
    }
  }
  try {
    localStorage.setItem(OUTFITS_KEY, "[]");
  } catch {
    // 全部放弃
  }
}

export function hasSeededFlag() {
  return localStorage.getItem(SEEDED_KEY) === "1";
}

export function markSeeded() {
  localStorage.setItem(SEEDED_KEY, "1");
}

export function clearMeta() {
  localStorage.removeItem(ITEMS_KEY);
  localStorage.removeItem(OUTFITS_KEY);
}
