import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePreview, BudgetExhaustedError } from "../src/lib/generate/adapter";
import type { ClothingItem } from "../src/types";

// 画布依赖全部打桩：adapter 的降级逻辑与画布无关
vi.mock("../src/lib/generate/image", () => ({
  toPngDataUrl: vi.fn(async (src: string) => (src.startsWith("data:") ? src : "data:image/png;base64,stub")),
  toCompactJpeg: vi.fn(async () => "data:image/jpeg;base64,compact"),
  isolateGarment: vi.fn(async () => "data:image/png;base64,garment"),
  prepareGarmentForTryOn: vi.fn(async () => "data:image/png;base64,garment"),
  composePersonGarment: vi.fn(async () => "data:image/png;base64,composed"),
}));
vi.mock("../src/lib/generate/blend", () => ({
  blendTryOn: vi.fn(async () => "data:image/png;base64,blended"),
  cropIdentityRef: vi.fn(async () => "data:image/png;base64,face"),
}));
vi.mock("../src/lib/generate/mock", () => ({
  mockCollage: vi.fn(async () => "data:image/png;base64,mock"),
}));

import { mockCollage } from "../src/lib/generate/mock";

const item = (id: string, category: ClothingItem["category"]): ClothingItem => ({
  id,
  name: id,
  category,
  color: "红",
  season: "all",
  occasion: "all",
  imageId: `img-${id}`,
});

const items = [item("t", "top"), item("b", "bottom")];
const imageUrls = { "img-t": "blob:x", "img-b": "blob:y" };
const baseOptions = {
  gender: "female" as const,
  modelSrc: "data:image/png;base64,model",
  onProgress: undefined,
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/** fetch 桩：按 URL 前缀分发 */
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }));
}

beforeEach(() => {
  vi.mocked(mockCollage).mockClear();
  vi.mocked(mockCollage).mockResolvedValue("data:image/png;base64,mock");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adapter 降级链", () => {
  it("无 key：试衣 501 → 图生图 501 → 拼贴（正常模式，无 degradedLevel）", async () => {
    stubFetch((url) => {
      if (url.includes("/api/v1/capabilities")) return jsonResponse(200, { tryon: false });
      return jsonResponse(501, { error: { code: "not_configured", message: "no_key" } });
    });
    const result = await generatePreview(items, imageUrls, { ...baseOptions, mode: "tryon" });
    expect(result.source).toBe("mock");
    expect(result.degradedLevel).toBeUndefined();
    expect(mockCollage).toHaveBeenCalled();
  });

  it("百炼熔断/故障（503 tryon_degraded）→ 图生图成功 → 标 qwen 降级", async () => {
    stubFetch((url, init) => {
      if (url.includes("/api/v1/capabilities")) return jsonResponse(200, { tryon: true });
      if (url.includes("/api/v1/preview")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.mode === "tryon") return jsonResponse(503, { error: { code: "tryon_degraded", message: "已切换备用方案" } });
        return jsonResponse(200, { image: "data:image/png;base64,qwen" });
      }
      throw new Error("unexpected " + url);
    });
    const result = await generatePreview(items, imageUrls, { ...baseOptions, mode: "tryon" });
    expect(result.source).toBe("api");
    expect(result.degradedLevel).toBe("qwen");
  });

  it("Qwen 上游 502 且一层都没成功 → 拼贴兜底，标 collage", async () => {
    stubFetch((url, init) => {
      if (url.includes("/api/v1/capabilities")) return jsonResponse(200, { tryon: false });
      if (url.includes("/api/v1/preview")) return jsonResponse(502, { error: { code: "upstream_failed", message: "upstream down" } });
      throw new Error("unexpected " + url);
    });
    const result = await generatePreview(items, imageUrls, { ...baseOptions, mode: "img2img" });
    expect(result.source).toBe("mock");
    expect(result.degradedLevel).toBe("collage");
    expect(result.warning).toContain("拼贴");
  });

  it("Qwen 第一层成功、第二层 502 → 返回已完成的 partial 结果并提示，不扔掉已付费的层", async () => {
    let previewCalls = 0;
    stubFetch((url, init) => {
      if (url.includes("/api/v1/capabilities")) return jsonResponse(200, { tryon: false });
      if (url.includes("/api/v1/preview")) {
        previewCalls += 1;
        if (previewCalls === 1) return jsonResponse(200, { image: "data:image/png;base64,ok" });
        return jsonResponse(502, { error: { code: "upstream_failed", message: "down" } });
      }
      throw new Error("unexpected " + url);
    });
    const result = await generatePreview(items, imageUrls, { ...baseOptions, mode: "img2img" });
    expect(result.source).toBe("api");
    expect(result.warning).toContain("未换上");
  });

  it("预算耗尽从 tryon 路径向上抛 BudgetExhaustedError，不静默降级", async () => {
    stubFetch((url) => {
      if (url.includes("/api/v1/capabilities")) return jsonResponse(200, { tryon: true });
      return jsonResponse(429, { error: { code: "budget_exhausted", message: "今日额度已用完" } });
    });
    await expect(generatePreview(items, imageUrls, { ...baseOptions, mode: "tryon" })).rejects.toBeInstanceOf(BudgetExhaustedError);
  });

  it("文生图 501 → 拼贴正常模式", async () => {
    stubFetch((url) => {
      if (url.includes("/api/v1/preview")) return jsonResponse(501, { error: { code: "not_configured", message: "no_key" } });
      throw new Error("unexpected " + url);
    });
    const result = await generatePreview(items, imageUrls, { ...baseOptions, mode: "txt2img" });
    expect(result.source).toBe("mock");
    expect(result.degradedLevel).toBeUndefined();
  });
});
