import type { Category, ClothingItem } from "../types";

const CONFLICTS: Record<Category, Category[]> = {
  top: ["top", "dress"],
  bottom: ["bottom", "dress"],
  dress: ["dress", "top", "bottom"],
  outerwear: ["outerwear"],
  shoes: ["shoes"],
  accessory: ["accessory"],
  bag: ["bag"],
};

export function addToCanvas(
  canvasIds: string[],
  items: ClothingItem[],
  addId: string,
): string[] {
  if (canvasIds.includes(addId)) {
    return canvasIds;
  }
  const incoming = items.find((item) => item.id === addId);
  if (!incoming) {
    return canvasIds;
  }
  const blocked = new Set(CONFLICTS[incoming.category]);
  const kept = canvasIds.filter((id) => {
    const item = items.find((entry) => entry.id === id);
    return item ? !blocked.has(item.category) : false;
  });
  return [...kept, addId];
}

export function canvasItems(canvasIds: string[], items: ClothingItem[]) {
  return canvasIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is ClothingItem => Boolean(item));
}

export function hasCategory(items: ClothingItem[], category: Category) {
  return items.some((item) => item.category === category);
}
