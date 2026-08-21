import type { ClothingItem } from "../../types";
import { composeReferenceBoard } from "./reference";
import { mockCollage } from "./mock";
import { buildEditPrompt, buildNegativePrompt, buildTxtPrompt } from "./prompt";
import type { ModelGender } from "../models";

export type GenerateMode = "txt2img" | "img2img";

export interface GenerateResult {
  url: string;
  prompt: string;
  source: "api" | "mock";
  warning?: string;
}

export async function generatePreview(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: { gender: ModelGender; modelSrc: string; mode: GenerateMode },
): Promise<GenerateResult> {
  const prompt =
    options.mode === "img2img"
      ? buildEditPrompt(items, options.gender)
      : buildTxtPrompt(items, options.gender);
  const negativePrompt = buildNegativePrompt(items, options.gender);
  const image =
    options.mode === "img2img"
      ? await composeReferenceBoard(options.modelSrc, items, imageUrls)
      : undefined;

  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      negativePrompt,
      image,
      mode: options.mode,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    image?: string;
    error?: string;
  };
  if (response.ok && data.image) {
    return { url: data.image, prompt, source: "api" };
  }
  if (response.status === 501) {
    const url = await mockCollage(items, imageUrls);
    return { url, prompt, source: "mock" };
  }
  throw new Error(data.error || `图像接口失败（HTTP ${response.status}）`);
}
