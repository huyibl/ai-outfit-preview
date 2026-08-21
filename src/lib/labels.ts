import type { Category, Occasion, Season } from "../types";

export const CATEGORY_LABELS: Record<Category, string> = {
  top: "上衣",
  bottom: "下装",
  dress: "连衣裙",
  outerwear: "外套",
  shoes: "鞋",
  accessory: "配饰",
  bag: "包",
};

export const SEASON_LABELS: Record<Season, string> = {
  all: "全部",
  spring: "春天",
  summer: "夏天",
  autumn: "秋天",
  winter: "冬天",
};

export const OCCASION_LABELS: Record<Occasion, string> = {
  all: "全部",
  daily: "日常",
  work: "通勤",
  date: "约会",
  sport: "运动",
};

export const FILTER_CATEGORIES: Array<Category | "all"> = [
  "all",
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "bag",
];

export const ITEM_CATEGORIES: Category[] = [
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "accessory",
  "bag",
];

export const ITEM_SEASONS: Season[] = ["all", "spring", "summer", "autumn", "winter"];
export const ITEM_OCCASIONS: Occasion[] = ["all", "daily", "work", "date", "sport"];

export function categoryLabel(value: Category | "all") {
  return value === "all" ? "全部" : CATEGORY_LABELS[value];
}
