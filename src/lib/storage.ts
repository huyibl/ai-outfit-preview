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
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export function saveOutfits(outfits: Outfit[]) {
  localStorage.setItem(OUTFITS_KEY, JSON.stringify(outfits));
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
