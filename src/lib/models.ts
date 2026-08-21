import type { ClothingItem } from "../types";

export type ModelChoice = "auto" | "female" | "male";
export type ModelGender = "female" | "male";

export const MODEL_ASSETS: Record<ModelGender, { src: string; label: string }> = {
  female: { src: "/models/female.svg", label: "女模" },
  male: { src: "/models/male.svg", label: "男模" },
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
