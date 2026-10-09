import type { ClothingItem } from "../../types";
import { apiFetch } from "../apiClient";
import { saveGenerationResult } from "../resultCache";
import { blendTryOn, cropIdentityRef } from "./blend";
import { composePersonGarment, isolateGarment, prepareGarmentForTryOn, toCompactJpeg, toPngDataUrl } from "./image";
import { sortForTryOn } from "./layers";
import { mockCollage } from "./mock";
import { buildLayerEditPrompt, buildNegativePrompt, buildTxtPrompt } from "./prompt";
import { pickTryOnGarments } from "./tryonMap";
import type { ModelGender } from "../models";

export type GenerateMode = "tryon" | "txt2img" | "img2img" | "stylist";

export interface GenerateResult {
  url: string;
  prompt: string;
  source: "api" | "mock";
  warning?: string;
  qualityFailed?: boolean;
  /** 降级级别：qwen=百炼挂了走图生图；collage=AI 全挂走本地拼贴（仅在"配置过但失败"时设置，无 key 的拼贴是正常模式） */
  degradedLevel?: "qwen" | "collage";
}

// Qwen 层轻量降级计数（非熔断状态机，理由见 server/breaker.ts 注释）：
// Qwen 失败是快速失败，成本低于百炼，容忍 5 次；连续失败后 30s 内直接出拼贴不再试
const QWEN_FAIL_THRESHOLD = 5;
const QWEN_COOLDOWN_MS = 30_000;
let qwenConsecutiveFailures = 0;
let qwenCooldownUntil = 0;

function noteQwenResult(ok: boolean) {
  if (ok) {
    qwenConsecutiveFailures = 0;
    return;
  }
  qwenConsecutiveFailures += 1;
  if (qwenConsecutiveFailures >= QWEN_FAIL_THRESHOLD) {
    qwenCooldownUntil = Date.now() + QWEN_COOLDOWN_MS;
    qwenConsecutiveFailures = 0;
  }
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
  outer?: string;
}

export class BudgetExhaustedError extends Error {
  constructor(message: string) {
    super(message || "今日 AI 试衣额度已用完");
    this.name = "BudgetExhaustedError";
  }
}

interface PreviewData {
  image?: string;
  imageUrl?: string;
  error?: string;
  errorCode?: string;
}

async function postPreview(body: PreviewBody, signal?: AbortSignal) {
  const result = await apiFetch<{ image?: string; imageUrl?: string }>("/api/v1/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const error = result.data.error;
  const errorText = typeof error === "string" ? error : error?.message ?? "请求失败";
  const errorCode = typeof error === "object" ? error?.code : undefined;
  return {
    response: { ok: result.ok, status: result.status },
    data: {
      image: result.data.image,
      imageUrl: result.data.imageUrl,
      error: errorText,
      errorCode: errorCode ?? undefined,
    } as PreviewData,
  };
}

/** 服务端返回远程 URL 时浏览器直拉；失败回退服务器中转。返回可直接 <img> 的地址 */
async function materialize(source: string, signal?: AbortSignal): Promise<string> {
  if (source.startsWith("data:")) return source;
  try {
    const response = await fetch(source, { signal });
    if (response.ok) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const relay = await apiFetch<{ image?: string }>("/api/v1/relay-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: source }),
    signal,
  });
  if (!relay.ok || !relay.data.image) {
    throw new Error("生成结果下载失败");
  }
  return relay.data.image;
}

async function persistResult(url: string) {
  try {
    const blob = await (await fetch(url)).blob();
    await saveGenerationResult(blob);
  } catch {
    // 持久化失败不影响展示
  }
}

async function qcCheck(
  options: { resultUrl?: string; resultDataUrl?: string; baseDataUrl?: string; garmentHint?: string },
): Promise<boolean> {
  try {
    const result = await apiFetch<{ pass?: boolean }>("/api/v1/qc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!result.ok) return true; // QC 服务本身挂了：放行
    return result.data.pass !== false;
  } catch {
    return true;
  }
}

/** 结果收尾：物化 + 落 IndexedDB +（可选）质检。质检两次确认不合格时返回 qualityFailed */
async function finishResult(
  raw: string,
  options: {
    signal?: AbortSignal;
    qcBaseDataUrl?: string;
    qcGarmentHint?: string;
    enforceQuality?: boolean;
  },
): Promise<{ url: string; qualityFailed: boolean }> {
  const url = await materialize(raw, options.signal);
  await persistResult(url);
  if (options.enforceQuality) {
    const passed = await qcCheck({
      resultUrl: url.startsWith("data:") ? undefined : raw,
      resultDataUrl: url.startsWith("data:") ? url : undefined,
      baseDataUrl: options.qcBaseDataUrl,
      garmentHint: options.qcGarmentHint,
    });
    if (!passed) return { url, qualityFailed: true };
  }
  return { url, qualityFailed: false };
}

export async function generatePreview(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: {
    gender: ModelGender;
    modelSrc: string;
    mode: GenerateMode;
    onProgress?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<GenerateResult> {
  if (options.mode === "txt2img") {
    return generateTxt(items, imageUrls, options);
  }
  if (options.mode === "img2img") {
    return generateLayeredTryOn(items, imageUrls, options);
  }
  if (options.mode === "stylist") {
    // stylist 由 store 编排（一次出多套），不走单图链路
    throw new Error("stylist 模式请使用 generateStylistPlans");
  }
  return generateVirtualTryOn(items, imageUrls, options);
}

function tryOnCaption(
  topItem?: ClothingItem,
  bottomItem?: ClothingItem,
  outerItem?: ClothingItem,
  extras: ClothingItem[] = [],
) {
  if (topItem?.category === "dress") {
    const parts = [`连衣裙：${topItem.name}`];
    if (outerItem) parts.push(`外套：${outerItem.name}`);
    parts.push(...extras.map((item) => `${item.category === "shoes" ? "鞋" : "包"}：${item.name}`));
    return parts.join(" · ");
  }
  const parts: string[] = [];
  if (topItem) parts.push(`上衣：${topItem.name}`);
  if (bottomItem) parts.push(`下装：${bottomItem.name}`);
  if (outerItem) parts.push(`外套：${outerItem.name}`);
  parts.push(...extras.map((item) => `${item.category === "shoes" ? "鞋" : "包"}：${item.name}`));
  return parts.join(" · ") || "虚拟试衣";
}

async function generateVirtualTryOn(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: {
    gender: ModelGender;
    modelSrc: string;
    onProgress?: (text: string) => void;
    signal?: AbortSignal;
  },
): Promise<GenerateResult> {
  const { topItem, bottomItem, outerItem, extras, usable } = pickTryOnGarments(items, imageUrls);
  if (!usable) {
    throw new Error("请先添加上衣或下装再试衣（鞋包会在试衣后再补）");
  }

  const status = await apiFetch<{ tryon?: boolean }>("/api/v1/capabilities", { signal: options.signal }).catch(
    (error) => {
      if (options.signal?.aborted) throw error;
      return { ok: false, status: 0, data: { tryon: false } as { tryon?: boolean; error?: undefined } };
    },
  );
  if (!status.data.tryon) {
    options.onProgress?.("未配置试衣 Key，改用 Qwen 图生图");
    const fallback = await generateLayeredTryOn(items, imageUrls, options);
    return { ...fallback, warning: "未配置阿里云试衣 Key，已改用图生图" };
  }

  const caption = tryOnCaption(topItem, bottomItem, outerItem, extras);
  options.onProgress?.("上传模特与衣图…");
  let tryonError = "";
  let warning = "";
  try {
    const basePhoto = await toCompactJpeg(options.modelSrc);
    const top = topItem ? await prepareGarmentForTryOn(imageUrls[topItem.imageId]) : undefined;
    const bottom = bottomItem ? await prepareGarmentForTryOn(imageUrls[bottomItem.imageId]) : undefined;
    options.onProgress?.(outerItem ? "虚拟试衣 · 内搭" : "虚拟试衣生成中…");
    const first = await postPreview(
      {
        mode: "tryon",
        person: basePhoto,
        top,
        bottom,
        prompt: caption,
      },
      options.signal,
    );
    if (!first.response.ok || !(first.data.image ?? first.data.imageUrl)) {
      if (first.data.errorCode === "budget_exhausted") {
        throw new BudgetExhaustedError(first.data.error ?? "");
      }
      tryonError =
        first.response.status === 501
          ? "未配置阿里云试衣 Key"
          : first.data.error || `试衣失败（HTTP ${first.response.status}）`;
    } else {
      let current = await materialize(first.data.image ?? first.data.imageUrl!, options.signal);
      if (outerItem) {
        options.onProgress?.(`虚拟试衣 · 外套 ${outerItem.name}`);
        const outer = await prepareGarmentForTryOn(imageUrls[outerItem.imageId]);
        const second = await postPreview(
          {
            mode: "tryon",
            person: await toCompactJpeg(current),
            top: outer,
            prompt: caption,
          },
          options.signal,
        );
        if (second.response.ok && (second.data.image ?? second.data.imageUrl)) {
          current = await materialize(second.data.image ?? second.data.imageUrl!, options.signal);
        } else {
          warning = `外套试衣未成功（${second.data.error || `HTTP ${second.response.status}`}），已保留内搭`;
        }
      }
      let finalUrl = current;
      if (extras.length > 0) {
        options.onProgress?.("补鞋/包…");
        const withExtras = await overlayAccessories(current, extras, imageUrls, options);
        finalUrl = withExtras.url;
        if (withExtras.warning) warning = [warning, withExtras.warning].filter(Boolean).join("；");
      }
      const garmentHint = [topItem, bottomItem, outerItem]
        .filter(Boolean)
        .map((item) => `${item!.name}（${item!.color}）`)
        .join("、");
      options.onProgress?.("质检中…");
      const finished = await finishResult(finalUrl, {
        signal: options.signal,
        qcBaseDataUrl: basePhoto,
        qcGarmentHint: garmentHint,
        enforceQuality: true,
      });
      if (finished.qualityFailed) {
        // 试衣链路质检不过 → 走图生图兜底一次（layered 内部有同样的质检与重试）
        options.onProgress?.("试衣效果未达标，改用图生图重试…");
        const fallback = await generateLayeredTryOn(items, imageUrls, options);
        return {
          ...fallback,
          warning: "试衣效果未达标，已改用图生图",
          degradedLevel: fallback.degradedLevel ?? (fallback.source === "mock" ? "collage" : "qwen"),
        };
      }
      return { url: finished.url, prompt: caption, source: "api", warning: warning || undefined };
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof BudgetExhaustedError) throw error;
    tryonError = error instanceof Error ? error.message : "试衣失败";
  }

  options.onProgress?.(
    tryonError.includes("未配置") ? "未配置试衣 Key，改用 Qwen 图生图" : "试衣失败，改用 Qwen 图生图",
  );
  const fallback = await generateLayeredTryOn(items, imageUrls, options);
  return {
    ...fallback,
    warning: `${tryonError}，已改用图生图`,
    degradedLevel: fallback.degradedLevel ?? (fallback.source === "mock" ? "collage" : "qwen"),
  };
}

async function overlayAccessories(
  personSrc: string,
  extras: ClothingItem[],
  imageUrls: Record<string, string>,
  options: { gender: ModelGender; onProgress?: (text: string) => void; signal?: AbortSignal },
) {
  let person = await toPngDataUrl(personSrc);
  const missed: string[] = [];
  for (const item of extras) {
    const src = imageUrls[item.imageId];
    if (!src) continue;
    options.onProgress?.(`补 ${item.name}`);
    const garment = await isolateGarment(src);
    const { response, data } = await postPreview(
      {
        prompt: buildLayerEditPrompt(item, options.gender),
        negativePrompt: buildNegativePrompt([item], options.gender),
        image: person,
        image2: garment,
        mode: "img2img",
      },
      options.signal,
    );
    if (response.ok && data.image) {
      person = data.image;
    } else {
      missed.push(item.name);
    }
  }
  return {
    url: person,
    warning: missed.length ? `${missed.join("、")} 未换上` : undefined,
  };
}

async function generateTxt(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  options: { gender: ModelGender; signal?: AbortSignal },
): Promise<GenerateResult> {
  const prompt = buildTxtPrompt(items, options.gender);
  const { response, data } = await postPreview(
    {
      prompt,
      negativePrompt: buildNegativePrompt(items, options.gender),
      mode: "txt2img",
    },
    options.signal,
  );
  if (response.ok && (data.image ?? data.imageUrl)) {
    const { url } = await finishResult(data.image ?? data.imageUrl!, { signal: options.signal });
    return { url, prompt, source: "api" };
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
    signal?: AbortSignal;
    qcRetried?: boolean;
  },
): Promise<GenerateResult> {
  const layers = sortForTryOn(items);
  const prompts: string[] = [];
  const identity = await toPngDataUrl(options.modelSrc);
  let person = identity;
  let usedPair = true;
  let usedFaceRef = true;
  let applied = 0;
  let upstreamFailures = 0;
  const faceRef = await cropIdentityRef(identity);

  // 冷却期内不再试 Qwen，直接拼贴（连续失败后的保护窗）
  if (Date.now() < qwenCooldownUntil) {
    const url = await mockCollage(items, imageUrls, options.modelSrc);
    noteQwenResult(false);
    return {
      url,
      prompt: "AI 服务暂不可用，已用本地拼贴",
      source: "mock",
      warning: "AI 服务暂不可用，已用本地拼贴",
      degradedLevel: "collage",
    };
  }

  for (let index = 0; index < layers.length; index += 1) {
    const item = layers[index];
    const src = imageUrls[item.imageId];
    if (!src) continue;
    const prompt = buildLayerEditPrompt(item, options.gender);
    prompts.push(prompt);
    options.onProgress?.(`分层换装 ${index + 1}/${layers.length} · ${item.name}`);

    const garment = await isolateGarment(src);
    const personPayload = await toPngDataUrl(person);
    let { response, data } = await postPreview(
      {
        prompt,
        negativePrompt: buildNegativePrompt([item], options.gender),
        image: personPayload,
        image2: usedPair ? garment : undefined,
        image3: usedPair && usedFaceRef ? faceRef : undefined,
        mode: "img2img",
      },
      options.signal,
    );

    if (!response.ok && usedFaceRef && isPairLoadError(data.error)) {
      usedFaceRef = false;
      ({ response, data } = await postPreview(
        {
          prompt,
          negativePrompt: buildNegativePrompt([item], options.gender),
          image: personPayload,
          image2: usedPair ? garment : undefined,
          mode: "img2img",
        },
        options.signal,
      ));
    }

    if (!response.ok && usedPair && isPairLoadError(data.error)) {
      usedPair = false;
      const composed = await composePersonGarment(personPayload, garment);
      ({ response, data } = await postPreview(
        {
          prompt,
          negativePrompt: buildNegativePrompt([item], options.gender),
          image: composed,
          mode: "img2img",
        },
        options.signal,
      ));
    }

    if (response.status === 501) {
      // 未配置 key：走拼贴是正常模式，不算降级
      const url = await mockCollage(items, imageUrls, options.modelSrc);
      return { url, prompt: prompts.join(" "), source: "mock" };
    }
    if (response.status >= 500 || response.status === 0) {
      // 上游故障：零成功落拼贴；已有成功层则带上警告返回部分结果（不扔掉已付费的层）
      upstreamFailures += 1;
      if (applied === 0) break;
      noteQwenResult(false);
      return {
        url: person,
        prompt: prompts.join(" → "),
        source: "api",
        warning: `服务波动，${item.name} 未换上`,
        degradedLevel: "qwen",
      };
    }
    if (!response.ok || !data.image) {
      throw new Error(data.error || `换装失败：${item.name}（HTTP ${response.status}）`);
    }
    options.onProgress?.(`姿态对齐与人体分割 · ${item.name}`);
    person = await blendTryOn(personPayload, data.image, identity, item.category);
    applied += 1;
  }

  if (applied === 0) {
    if (upstreamFailures > 0) {
      noteQwenResult(false);
      const url = await mockCollage(items, imageUrls, options.modelSrc);
      return {
        url,
        prompt: "AI 服务暂不可用，已用本地拼贴",
        source: "mock",
        warning: "AI 服务暂不可用，已用本地拼贴",
        degradedLevel: "collage",
      };
    }
    throw new Error("没有可用的单品图片");
  }
  noteQwenResult(true);

  options.onProgress?.("质检中…");
  const finished = await finishResult(person, {
    signal: options.signal,
    qcBaseDataUrl: identity,
    enforceQuality: true,
  });
  if (finished.qualityFailed && !options.qcRetried) {
    options.onProgress?.("效果未达标，重试一次…");
    const retried = await generateLayeredTryOn(items, imageUrls, { ...options, qcRetried: true });
    return retried;
  }
  return {
    url: finished.url,
    prompt: prompts.join(" → "),
    source: "api",
    qualityFailed: finished.qualityFailed || undefined,
  };
}

function isPairLoadError(error?: string) {
  return /image2|2509|unsupported|unknown|20015|file path|too long|LoadImage|Data URI|node_id/i.test(
    error || "",
  );
}
