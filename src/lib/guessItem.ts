import type { Category, ClothingItem } from "../types";

const COLOR_EN: Record<string, string> = {
  红: "red",
  红色: "red",
  橙: "orange",
  橙色: "orange",
  黄: "yellow",
  黄色: "yellow",
  绿: "green",
  绿色: "green",
  蓝: "blue",
  蓝色: "blue",
  紫: "purple",
  紫色: "purple",
  粉: "pink",
  粉色: "pink",
  黑: "black",
  黑色: "black",
  白: "white",
  白色: "white",
  灰: "grey",
  灰色: "grey",
  棕: "brown",
  棕色: "brown",
  米: "beige",
  米色: "beige",
};

export function colorEn(color: string) {
  return COLOR_EN[color] || color;
}

export function isSkirtLike(item: Pick<ClothingItem, "category" | "name">) {
  return item.category === "dress" || /裙|skirt|dress|连衣裙/i.test(item.name);
}

export function guessFromFilename(filename: string): {
  name: string;
  category: Category;
  color: string;
} {
  const name = filename.replace(/\.[^.]+$/, "").trim() || "未命名单品";
  const text = name.toLowerCase();
  let category: Category = "top";
  if (/裙|连衣裙|dress|skirt/.test(text)) category = /连衣裙|dress/.test(text) ? "dress" : "bottom";
  else if (/鞋|sneaker|shoe|boot|靴/.test(text)) category = "shoes";
  else if (/包|bag|tote|handbag/.test(text)) category = "bag";
  else if (/外套|大衣|jacket|coat|hoodie|卫衣/.test(text)) category = "outerwear";
  else if (/裤|pant|jean|trouser/.test(text)) category = "bottom";
  else if (/帽|hat|饰|acc/.test(text)) category = "accessory";

  const colorHit = Object.keys(COLOR_EN).find((key) => name.includes(key));
  return { name, category, color: colorHit || "未填色" };
}

export function garmentEn(item: ClothingItem) {
  const color = colorEn(item.color);
  const note = item.notes?.trim() ? `, ${item.notes.trim()}` : "";
  if (item.category === "dress") return `${color} one-piece dress${note}`;
  if (item.category === "bottom" && isSkirtLike(item)) {
    return `${color} A-line midi skirt (skirt only, not pants)${note}`;
  }
  if (item.category === "bottom") return `${color} trousers${note}`;
  if (item.category === "outerwear") {
    if (/大衣|coat/i.test(item.name)) return `long ${color} double-breasted winter wool coat${note}`;
    if (/夹克|jacket|hoodie|卫衣/i.test(item.name)) return `${color} casual jacket or hoodie${note}`;
    return `${color} outerwear jacket${note}`;
  }
  if (item.category === "shoes") {
    if (/靴|boot/i.test(`${item.name} ${item.notes ?? ""}`)) return `${color} boots${note}`;
    return `${color} sneakers${note}`;
  }
  if (item.category === "bag") return `${color} tote bag held in one hand${note}`;
  if (item.category === "accessory") return `${color} accessory${note}`;
  return `${color} top${note}`;
}
