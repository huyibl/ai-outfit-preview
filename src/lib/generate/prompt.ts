import type { ClothingItem } from "../../types";
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
    "Match the garment types and colors as specified. Studio lighting, plain background, realistic fabric.",
    "Single person only. No close-up, no portrait crop, no mannequin, no collage, no extra people.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildEditPrompt(items: ClothingItem[], gender: ModelGender) {
  const person = gender === "female" ? "the same young woman" : "the same young man";
  const worn = items.map((item) => `${garmentEn(item)} (${item.name})`).join(", ");
  const skirtRule = items.some(isSkirtLike)
    ? "The person MUST wear a skirt, never pants or trousers."
    : "";
  return [
    `Fashion photo edit: keep ${person} in the center, same face and body.`,
    "Output a WIDE full-body shot: head, legs and shoes all visible, camera pulled back, not a portrait.",
    `Replace their current clothes with these exact items from the thumbnails: ${worn}.`,
    skirtRule,
    "Output one clean photorealistic full-body lookbook photo of only the dressed person.",
    "Do not keep product thumbnails, collage, labels, or extra people in the result.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildNegativePrompt(items: ClothingItem[], gender: ModelGender) {
  const parts = [
    "close-up",
    "portrait",
    "headshot",
    "selfie",
    "upper body crop",
    "cropped at chest",
    "cropped at waist",
    "face zoom",
    "tight framing",
    "collage",
    "thumbnail",
    "inset product photo",
    "mannequin",
    "multiple people",
    "extra limbs",
    "text overlay",
    "split screen",
  ];
  if (gender === "female") parts.push("man", "male", "boy", "beard", "masculine face");
  if (gender === "male") parts.push("woman", "female", "girl", "feminine face");
  if (items.some(isSkirtLike)) parts.push("trousers", "pants", "slacks", "jeans", "shorts");
  return parts.join(", ");
}

export function buildPrompt(items: ClothingItem[]) {
  return buildTxtPrompt(items, "female");
}
