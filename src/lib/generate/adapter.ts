import type { ClothingItem } from "../../types";
import { blendTryOn, cropIdentityRef } from "./blend";
import { composePersonGarment, isolateGarment, toCompactJpeg, toPngDataUrl } from "./image";
import { sortForTryOn } from "./layers";
import { mockCollage } from "./mock";
import { buildLayerEditPrompt, buildNegativePrompt, buildTxtPrompt } from "./prompt";
import { pickTryOnGarments } from "./tryonMap";
import type { ModelGender } from "../models";

export type GenerateMode = "tryon" | "txt2img" | "img2img";

export interface GenerateResult {
  url: string;
  prompt: string;
  source: "api" | "mock";
  warning?: string;
}

interface PreviewBody {
  prompt?: string;
  negativePrompt?: string;
  image?: string;
  image2?: string;
  image3?: string;
  mode: GenerateMode;
  person?: string;
  top?: string;
  bottom?: string;
}

async function postPreview(body: PreviewBody) {
  const response = await fetch("/api/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    image?: string;
    error?: string;
    supportsPair?: boolean;
  };
  return { response, data };
}

export async function generatePreview(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: {
    gender: ModelGender;
    modelSrc: string;
    mode: GenerateMode;
    onProgress?: (text: string) => void;
  },
): Promise<GenerateResult> {
  if (options.mode === "txt2img") {
    return generateTxt(items, imageUrls, options);
  }
  if (options.mode === "img2img") {
    return generateLayeredTryOn(items, imageUrls, options);
  }
  return generateVirtualTryOn(items, imageUrls, options);
}

function tryOnCaption(topItem?: ClothingItem, bottomItem?: ClothingItem) {
  if (topItem?.category === "dress") return `连衣裙：${topItem.name}`;
  const parts: string[] = [];
  if (topItem) parts.push(`上衣：${topItem.name}`);
  if (bottomItem) parts.push(`下装：${bottomItem.name}`);
  return parts.join(" · ") || "虚拟试衣";
}

async function generateVirtualTryOn(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: {
    gender: ModelGender;
    modelSrc: string;
    onProgress?: (text: string) => void;
  },
): Promise<GenerateResult> {
  const { topItem, bottomItem, usable } = pickTryOnGarments(items, imageUrls);
  if (!usable) {
    options.onProgress?.("没有可试衣的上衣/下装，改用图生图");
    const fallback = await generateLayeredTryOn(items, imageUrls, options);
    return {
      ...fallback,
      warning: fallback.warning || "鞋包等单品暂不支持试衣，已改用图生图",
    };
  }

  const status = await fetch("/api/preview")
    .then((response) => response.json() as Promise<{ tryon?: boolean }>)
    .catch(() => ({ tryon: false }));
  if (!status.tryon) {
    options.onProgress?.("未配置试衣 Key，改用 Qwen 图生图");
    const fallback = await generateLayeredTryOn(items, imageUrls, options);
    return { ...fallback, warning: "未配置阿里云试衣 Key，已改用图生图" };
  }

  const caption = tryOnCaption(topItem, bottomItem);
  options.onProgress?.("上传模特与衣图…");
  let tryonError = "";
  try {
    const person = await toCompactJpeg(options.modelSrc);
    const top = topItem ? await toCompactJpeg(await isolateGarment(imageUrls[topItem.imageId])) : undefined;
    const bottom = bottomItem
      ? await toCompactJpeg(await isolateGarment(imageUrls[bottomItem.imageId]))
      : undefined;
    options.onProgress?.("虚拟试衣生成中…");
    const { response, data } = await postPreview({
      mode: "tryon",
      person,
      top,
      bottom,
      prompt: caption,
    });
    if (response.ok && data.image) {
      return { url: data.image, prompt: caption, source: "api" };
    }
    tryonError =
      response.status === 501
        ? "未配置阿里云试衣 Key"
        : data.error || `试衣失败（HTTP ${response.status}）`;
  } catch (error) {
    tryonError = error instanceof Error ? error.message : "试衣失败";
  }

  options.onProgress?.(
    tryonError.includes("未配置") ? "未配置试衣 Key，改用 Qwen 图生图" : "试衣失败，改用 Qwen 图生图",
  );
  const fallback = await generateLayeredTryOn(items, imageUrls, options);
  return { ...fallback, warning: `${tryonError}，已改用图生图` };
}

async function generateTxt(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: { gender: ModelGender },
): Promise<GenerateResult> {
  const prompt = buildTxtPrompt(items, options.gender);
  const { response, data } = await postPreview({
    prompt,
    negativePrompt: buildNegativePrompt(items, options.gender),
    mode: "txt2img",
  });
  if (response.ok && data.image) {
    return { url: data.image, prompt, source: "api" };
  }
  if (response.status === 501) {
    const url = await mockCollage(items, imageUrls, undefined);
    return { url, prompt, source: "mock" };
  }
  throw new Error(data.error || `图像接口失败（HTTP ${response.status}）`);
}

async function generateLayeredTryOn(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: {
    gender: ModelGender;
    modelSrc: string;
    onProgress?: (text: string) => void;
  },
): Promise<GenerateResult> {
  const layers = sortForTryOn(items);
  const prompts: string[] = [];
  const identity = await toPngDataUrl(options.modelSrc);
  let person = identity;
  let usedPair = true;
  let usedFaceRef = true;
  let applied = 0;
  const faceRef = await cropIdentityRef(identity);

  for (let index = 0; index < layers.length; index += 1) {
    const item = layers[index];
    const src = imageUrls[item.imageId];
    if (!src) continue;
    const prompt = buildLayerEditPrompt(item, options.gender);
    prompts.push(prompt);
    options.onProgress?.(`分层换装 ${index + 1}/${layers.length} · ${item.name}`);

    const garment = await isolateGarment(src);
    const personPayload = await toPngDataUrl(person);
    let { response, data } = await postPreview({
      prompt,
      negativePrompt: buildNegativePrompt([item], options.gender),
      image: personPayload,
      image2: usedPair ? garment : undefined,
      image3: usedPair && usedFaceRef ? faceRef : undefined,
      mode: "img2img",
    });

    if (!response.ok && usedFaceRef && isPairLoadError(data.error)) {
      usedFaceRef = false;
      ({ response, data } = await postPreview({
        prompt,
        negativePrompt: buildNegativePrompt([item], options.gender),
        image: personPayload,
        image2: usedPair ? garment : undefined,
        mode: "img2img",
      }));
    }

    if (!response.ok && usedPair && isPairLoadError(data.error)) {
      usedPair = false;
      const composed = await composePersonGarment(personPayload, garment);
      ({ response, data } = await postPreview({
        prompt,
        negativePrompt: buildNegativePrompt([item], options.gender),
        image: composed,
        mode: "img2img",
      }));
    }

    if (response.status === 501) {
      const url = await mockCollage(items, imageUrls, options.modelSrc);
      return { url, prompt: prompts.join(" "), source: "mock" };
    }
    if (!response.ok || !data.image) {
      throw new Error(data.error || `换装失败：${item.name}（HTTP ${response.status}）`);
    }
    options.onProgress?.(`姿态对齐与人体分割 · ${item.name}`);
    person = await blendTryOn(personPayload, data.image, identity, item.category);
    applied += 1;
  }

  if (applied === 0) {
    throw new Error("没有可用的单品图片");
  }

  return { url: person, prompt: prompts.join(" → "), source: "api" };
}

function isPairLoadError(error?: string) {
  return /image2|2509|unsupported|unknown|20015|file path|too long|LoadImage|Data URI|node_id/i.test(
    error || "",
  );
}
