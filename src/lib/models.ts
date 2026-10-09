import type { ClothingItem } from "../types";

export type ModelChoice = "auto" | "female" | "male";
export type ModelGender = "female" | "male";

export const CUSTOM_MODEL_ID = "model-custom";

export const MODEL_ASSETS: Record<ModelGender, { src: string; label: string; candidates: string[] }> = {
  female: {
    src: "/models/female.webp",
    label: "女模",
    candidates: ["/models/female.webp"],
  },
  male: {
    src: "/models/male.webp",
    label: "男模",
    candidates: ["/models/male.webp"],
  },
};

export function looksFeminine(items: ClothingItem[]) {
  return items.some(
    (item) =>
      item.category === "dress" ||
      /裙|dress|skirt|连衣裙/i.test(`${item.name} ${item.notes ?? ""}`),
  );
}

export function resolveModelGender(choice: ModelChoice, items: ClothingItem[]): ModelGender {
  if (choice === "male") return "male";
  if (choice === "female") return "female";
  return looksFeminine(items) ? "female" : "female";
}

export async function resolveModelSrc(gender: ModelGender) {
  for (const src of MODEL_ASSETS[gender].candidates) {
    try {
      const response = await fetch(src, { method: "GET" });
      if (response.ok) return src;
    } catch {
      // try next
    }
  }
  throw new Error("未找到模特底图，请把全身照放到 public/models/female.png 或 male.png");
}
