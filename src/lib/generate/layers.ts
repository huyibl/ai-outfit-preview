import type { Category, ClothingItem } from "../../types";

const LAYER_ORDER: Category[] = [
  "bottom",
  "dress",
  "top",
  "outerwear",
  "shoes",
  "bag",
  "accessory",
];

export function sortForTryOn(items: ClothingItem[]) {
  return [...items].sort((a, b) => LAYER_ORDER.indexOf(a.category) - LAYER_ORDER.indexOf(b.category));
}
