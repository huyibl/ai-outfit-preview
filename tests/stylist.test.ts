import { beforeEach, describe, expect, it } from "vitest";
import {
  breakerSnapshot,
  canTryLlm,
  normalizeIntent,
  recordStylistFailure,
  recordStylistSuccess,
  resetBreaker,
  resetStylistCache,
  ruleEnginePlans,
  stylistCacheKey,
  validatePlans,
  type WardrobeEntry,
} from "../server/stylist";
import { decideQc, parseQcAnswer } from "../server/qc";

function entry(partial: Partial<WardrobeEntry> & { id: string }): WardrobeEntry {
  return { category: "top", ...partial };
}

describe("意图规范化", () => {
  it("场景词映射", () => {
    expect(normalizeIntent("周一通勤穿什么").occasion).toBe("work");
    expect(normalizeIntent("周末约会").occasion).toBe("date");
    expect(normalizeIntent("去健身房").occasion).toBe("sport");
    expect(normalizeIntent("随便穿穿").occasion).toBe("daily");
  });

  it("季节与风格词", () => {
    const intent = normalizeIntent("15度左右，想显干净");
    expect(intent.season).toBe("autumn");
    expect(intent.styleHints).toContain("minimal");
  });

  it("sceneTags 直接参与", () => {
    expect(normalizeIntent("", ["date"]).occasion).toBe("date");
  });
});

const wardrobe: WardrobeEntry[] = [
  entry({ id: "t1", category: "top", color: "白" }),
  entry({ id: "t2", category: "top", color: "黑" }),
  entry({ id: "b1", category: "bottom" }),
  entry({ id: "o1", category: "outerwear" }),
  entry({ id: "s1", category: "shoes" }),
  entry({ id: "d1", category: "dress" }),
  entry({ id: "bag1", category: "bag" }),
];

describe("方案校验器", () => {
  const categoryById = new Map(wardrobe.map((item) => [item.id, item.category]));

  it("剔除幻觉 id 与不足 2 件的方案", () => {
    const { outfits } = validatePlans(
      [
        { styleName: "A", itemIds: ["t1", "ghost-id", "b1"], styleTags: ["x"] },
        { styleName: "B", itemIds: ["t1", "ghost-id"], styleTags: ["y"] },
      ],
      categoryById,
      { allowOuter: true, maxOutfits: 3 },
    );
    expect(outfits).toHaveLength(1);
    expect(outfits[0].itemIds).toEqual(["t1", "b1"]);
  });

  it("连衣裙与上下装互斥的方案被拒绝", () => {
    const { outfits } = validatePlans(
      [
        { styleName: "A", itemIds: ["d1", "t1", "s1"], styleTags: ["x"] },
        { styleName: "B", itemIds: ["t2", "b1", "s1"], styleTags: ["y"] },
      ],
      categoryById,
      { allowOuter: true, maxOutfits: 3 },
    );
    expect(outfits).toHaveLength(1);
    expect(outfits[0].itemIds).toEqual(["t2", "b1", "s1"]);
  });

  it("allowOuter=false 时剔除外套并记缺口", () => {
    const { outfits, gaps } = validatePlans(
      [{ styleName: "A", itemIds: ["t1", "b1", "o1", "s1"], styleTags: ["x"] }],
      categoryById,
      { allowOuter: false, maxOutfits: 3 },
    );
    expect(outfits[0].itemIds).not.toContain("o1");
    expect(gaps.join("")).toContain("外套");
  });
});

describe("规则引擎", () => {
  beforeEach(() => resetStylistCache());

  it("标准衣橱出多套且不含重复方案", () => {
    const result = ruleEnginePlans(wardrobe, { occasion: "daily", season: "all", styleHints: [] }, { allowOuter: true, maxOutfits: 3 });
    expect(result.mode).toBe("rule");
    expect(result.outfits.length).toBeGreaterThanOrEqual(2);
    const idSets = result.outfits.map((plan) => [...plan.itemIds].sort().join(","));
    expect(new Set(idSets).size).toBe(idSets.length);
  });

  it("缺下装时给缺口建议", () => {
    const poorWardrobe = [entry({ id: "only-top", category: "top" })];
    const result = ruleEnginePlans(poorWardrobe, { occasion: "daily", season: "all", styleHints: [] }, { allowOuter: true, maxOutfits: 3 });
    expect(result.outfits).toHaveLength(0);
    expect(result.wardrobeGaps.join("")).toContain("下装");
  });

  it("allowOuter=false 不出外套组合", () => {
    const result = ruleEnginePlans(wardrobe, { occasion: "daily", season: "all", styleHints: [] }, { allowOuter: false, maxOutfits: 3 });
    expect(result.outfits.every((plan) => !plan.itemIds.includes("o1"))).toBe(true);
  });
});

describe("缓存键与熔断", () => {
  beforeEach(() => {
    resetStylistCache();
    resetBreaker();
  });

  it("偏好变化 → 缓存键变化", () => {
    const base = { wardrobe, intent: "通勤", outfitCount: 3, allowOuter: true };
    expect(stylistCacheKey({ ...base, preference: "" })).not.toBe(stylistCacheKey({ ...base, preference: "喜欢：极简×3" }));
  });

  it("连续失败 3 次熔断，冷却后半开放行", () => {
    let now = 1_000_000;
    expect(canTryLlm(now)).toBe(true);
    recordStylistFailure(now);
    recordStylistFailure(now);
    recordStylistFailure(now);
    expect(breakerSnapshot().state).toBe("open");
    expect(canTryLlm(now + 1000)).toBe(false);
    now += 120_000;
    expect(canTryLlm(now)).toBe(true); // half-open
    expect(breakerSnapshot().state).toBe("half-open");
    recordStylistFailure(now); // 半开失败 → 重新 open，冷却继续翻倍（120→240→480）
    expect(canTryLlm(now + 1000)).toBe(false);
    expect(breakerSnapshot().cooldownMs).toBe(480_000);
    now += 240_000;
    recordStylistSuccess();
    expect(breakerSnapshot().state).toBe("closed");
    expect(canTryLlm(now)).toBe(true);
  });
});

describe("质检判定", () => {
  it("解析 LLM 输出", () => {
    const verdict = parseQcAnswer('{"face":true,"body":true,"garment":false,"edge":true}');
    expect(verdict.pass).toBe(false);
    expect(verdict.garment).toBe(false);
  });

  it("不合格需两次一致才生效", () => {
    const bad = parseQcAnswer('{"face":false,"body":true,"garment":true,"edge":true}');
    const good = parseQcAnswer('{"face":true,"body":true,"garment":true,"edge":true}');
    expect(decideQc(bad).pass).toBe(false);
    expect(decideQc(bad, bad).pass).toBe(false);
    expect(decideQc(bad, good).pass).toBe(true); // 两次不一致 → 放行
    expect(decideQc(good, undefined).pass).toBe(true);
  });
});
