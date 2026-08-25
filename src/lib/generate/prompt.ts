import type { Category, ClothingItem } from "../../types";
import { garmentEn, isSkirtLike } from "../guessItem";
import type { ModelGender } from "../models";

export function buildTxtPrompt(items: ClothingItem[], gender: ModelGender) {
  const person =
    gender === "female"
      ? "ONE young East Asian WOMAN (female only, feminine body)"
      : "ONE young East Asian MAN (male only, masculine body)";
  const pronoun = gender === "female" ? "She" : "He";
  const worn = items.map((item) => garmentEn(item)).join("; ");
  const skirtRule = items.some(isSkirtLike)
    ? "She is wearing a SKIRT. Do not generate trousers, pants, slacks, or jeans on the bottom."
    : "";
  return [
    `Wide full-body fashion lookbook photograph of ${person}.`,
    "Camera pulled back. The ENTIRE body is in frame: top of the head, torso, legs, AND shoes. Feet must be visible.",
    "Standing straight on a seamless studio floor, small empty space above the head and below the shoes.",
    `${pronoun} is wearing exactly this coordinated outfit: ${worn}.`,
    skirtRule,
    "Match the garment types, colors and fabric as specified. Studio lighting, plain background, photorealistic fabric and natural skin.",
    "Single person only. No close-up, no portrait crop, no mannequin, no collage, no extra people.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildLayerEditPrompt(item: ClothingItem, gender: ModelGender) {
  const person = gender === "female" ? "the same young woman" : "the same young man";
  const garment = garmentEn(item);
  const region = regionHint(item.category, item);
  return [
    `Image 1 is a full-body photo of ${person}. Image 2 is a product photo of ${garment}.`,
    "Image 3 is a close crop of the same face — keep this exact face and hairstyle.",
    `Virtual try-on: ${region}`,
    "Do not change identity, pose, camera distance, hands or studio background.",
    "Only edit the clothing region. Make the garment drape with realistic folds, fabric texture and contact shadows.",
    "Output one clean photorealistic full-body photo of only the dressed person.",
    "Do not show the product card, split screen, collage, labels or extra people.",
  ].join(" ");
}

function regionHint(category: Category, item: ClothingItem) {
  if (category === "dress" || isSkirtLike(item)) {
    return `replace only the lower-body clothing with this exact ${garmentEn(item)} from Image 2.`;
  }
  switch (category) {
    case "bottom":
      return `replace only the pants/skirt with this exact ${garmentEn(item)} from Image 2.`;
    case "top":
      return `replace only the shirt/top with this exact ${garmentEn(item)} from Image 2.`;
    case "outerwear":
      return `put this exact ${garmentEn(item)} from Image 2 on the person, fitting the shoulders and sleeves.`;
    case "shoes":
      return `replace only the shoes with this exact ${garmentEn(item)} from Image 2.`;
    case "bag":
      return `add this exact ${garmentEn(item)} from Image 2 in one hand or on the shoulder.`;
    case "accessory":
      return `add this exact accessory from Image 2, keep the rest of the outfit.`;
    default:
      return `dress the person in this exact garment from Image 2.`;
  }
}

export function buildEditPrompt(items: ClothingItem[], gender: ModelGender) {
  return items.map((item) => buildLayerEditPrompt(item, gender)).join(" ");
}

export function buildNegativePrompt(items: ClothingItem[], gender: ModelGender) {
  const parts = [
    "close-up",
    "portrait",
    "headshot",
    "selfie",
    "upper body crop",
    "cartoon",
    "illustration",
    "plastic skin",
    "warped clothes",
    "floating garment",
    "collage",
    "thumbnail",
    "inset product photo",
    "split screen",
    "mannequin",
    "multiple people",
    "extra limbs",
    "deformed hands",
    "text overlay",
  ];
  if (gender === "female") parts.push("man", "male", "boy", "beard", "masculine face");
  if (gender === "male") parts.push("woman", "female", "girl", "feminine face");
  if (items.some(isSkirtLike)) parts.push("trousers", "pants", "slacks", "jeans", "shorts");
  return parts.join(", ");
}

export function buildPrompt(items: ClothingItem[]) {
  return buildTxtPrompt(items, "female");
}
