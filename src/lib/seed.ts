import type { ClothingItem } from "../types";
import { blobFromUrl, putImage } from "./db";
import { hasSeededFlag, markSeeded } from "./storage";

interface SeedSpec {
  file: string;
  item: ClothingItem;
}

export const SEED_ITEMS: SeedSpec[] = [
  {
    file: "coat-red.png",
    item: {
      id: "seed-coat-red",
      name: "红色冬外套",
      category: "outerwear",
      color: "红色",
      season: "winter",
      occasion: "daily",
      notes: "保暖大衣",
      imageId: "seed-coat-red",
    },
  },
  {
    file: "jacket-orange.png",
    item: {
      id: "seed-jacket-orange",
      name: "橙色夹克",
      category: "top",
      color: "橙色",
      season: "autumn",
      occasion: "daily",
      notes: "休闲连帽",
      imageId: "seed-jacket-orange",
    },
  },
  {
    file: "jacket-plaid.png",
    item: {
      id: "seed-jacket-plaid",
      name: "格纹外套",
      category: "outerwear",
      color: "棕色",
      season: "autumn",
      occasion: "work",
      notes: "通勤格纹",
      imageId: "seed-jacket-plaid",
    },
  },
  {
    file: "skirt-grey.png",
    item: {
      id: "seed-skirt-grey",
      name: "灰色半裙",
      category: "bottom",
      color: "灰色",
      season: "autumn",
      occasion: "daily",
      notes: "A字半裙",
      imageId: "seed-skirt-grey",
    },
  },
  {
    file: "shoes-white.png",
    item: {
      id: "seed-shoes-white",
      name: "白色运动鞋",
      category: "shoes",
      color: "白色",
      season: "all",
      occasion: "sport",
      notes: "百搭小白鞋",
      imageId: "seed-shoes-white",
    },
  },
  {
    file: "bag-black.png",
    item: {
      id: "seed-bag-black",
      name: "黑色托特包",
      category: "bag",
      color: "黑色",
      season: "all",
      occasion: "daily",
      notes: "通勤托特",
      imageId: "seed-bag-black",
    },
  },
];

export async function seedIfNeeded(existingCount: number): Promise<ClothingItem[]> {
  if (existingCount > 0 || hasSeededFlag()) {
    return [];
  }
  const items: ClothingItem[] = [];
  for (const spec of SEED_ITEMS) {
    const blob = await blobFromUrl(`/seed/${spec.file}`);
    await putImage(spec.item.imageId, blob);
    items.push(spec.item);
  }
  markSeeded();
  return items;
}
