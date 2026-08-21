export type Category =
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "accessory"
  | "bag";

export type Season = "all" | "spring" | "summer" | "autumn" | "winter";
export type Occasion = "all" | "daily" | "work" | "date" | "sport";

export interface ClothingItem {
  id: string;
  name: string;
  category: Category;
  color: string;
  season: Season;
  occasion: Occasion;
  notes?: string;
  imageId: string;
}

export interface Outfit {
  id: string;
  itemIds: string[];
  previewDataUrl?: string;
  createdAt: string;
}

export interface BackupFile {
  version: 1;
  items: ClothingItem[];
  outfits: Outfit[];
  images: Record<string, string>;
}

export type EditorMode = { kind: "create" } | { kind: "edit"; id: string };

export interface WardrobeFilters {
  query: string;
  category: Category | "all";
  season: Season;
  occasion: Occasion;
}
