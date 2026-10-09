import { describe, expect, it } from "vitest";
import { looksFeminine, resolveModelGender } from "../src/lib/models";
import { pickTryOnGarments } from "../src/lib/generate/tryonMap";
import type { ClothingItem } from "../src/types";

function item(partial: Partial<ClothingItem> & { id: string }): ClothingItem {
  return {
    name: partial.id,
    category: "top",
    color: "红",
    season: "all",
    occasion: "daily",
    imageId: `img-${partial.id}`,
    ...partial,
  };
}

describe("模特选择", () => {
  it("自动档固定使用女模（UI 上自动与女模等价）", () => {
    const dress = item({ id: "d", category: "dress", name: "碎花连衣裙" });
    const shirt = item({ id: "t", category: "top", name: "白T" });
    expect(resolveModelGender("auto", [dress])).toBe("female");
    expect(resolveModelGender("auto", [shirt])).toBe("female");
  });

  it("手选男模生效", () => {
    const dress = item({ id: "d", category: "dress", name: "碎花连衣裙" });
    expect(resolveModelGender("male", [dress])).toBe("male");
  });

  it("looksFeminine 依据名称与备注", () => {
    expect(looksFeminine([item({ id: "a", name: "半身裙" })])).toBe(true);
    expect(looksFeminine([item({ id: "b", name: "夹克", notes: "配裙子" })])).toBe(true);
    expect(looksFeminine([item({ id: "c", name: "夹克" })])).toBe(false);
  });
});

describe("tryon 选衣", () => {
  it("上下装两轮策略：内搭先行，外套第二轮", () => {
    const top = item({ id: "t", category: "top" });
    const bottom = item({ id: "b", category: "bottom" });
    const outer = item({ id: "o", category: "outerwear" });
    const shoes = item({ id: "s", category: "shoes" });
    const result = pickTryOnGarments([top, bottom, outer, shoes], {
      "img-t": "x",
      "img-b": "x",
      "img-o": "x",
      "img-s": "x",
    });
    expect(result.topItem?.id).toBe("t");
    expect(result.bottomItem?.id).toBe("b");
    expect(result.outerItem?.id).toBe("o");
    expect(result.extras.map((entry) => entry.id)).toEqual(["s"]);
    expect(result.usable).toBe(true);
  });

  it("连衣裙与下装互斥，连衣裙独占第一轮", () => {
    const dress = item({ id: "d", category: "dress" });
    const bottom = item({ id: "b", category: "bottom" });
    const result = pickTryOnGarments([dress, bottom], { "img-d": "x", "img-b": "x" });
    expect(result.topItem?.id).toBe("d");
    expect(result.bottomItem).toBeUndefined();
  });

  it("没有图片的单品不参与", () => {
    const top = item({ id: "t", category: "top" });
    const result = pickTryOnGarments([top], {});
    expect(result.usable).toBe(false);
  });

  it("只有外套也可用", () => {
    const outer = item({ id: "o", category: "outerwear" });
    const result = pickTryOnGarments([outer], { "img-o": "x" });
    expect(result.topItem?.id).toBe("o");
    expect(result.usable).toBe(true);
  });
});
