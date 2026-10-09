import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  logAiCall,
  maybeAlert,
  recordTryonOutcome,
  recordStylistOutcome,
  resetAiMetrics,
  tryonDegradationRate,
  tryonP95Ms,
  stylistRuleRate,
} from "../server/aiLog";

describe("aiLog 打点", () => {
  let logged: unknown[] = [];
  const origLog = console.log;

  beforeEach(() => {
    logged = [];
    resetAiMetrics();
    console.log = (...args: unknown[]) => {
      logged.push(args[0]);
    };
  });

  afterEach(() => {
    console.log = origLog;
    vi.unstubAllGlobals();
    delete process.env.ALERT_WEBHOOK;
  });

  it("logAiCall 输出单行 JSON 且字段齐全", () => {
    logAiCall({ call: "tryon", upstream: "dashscope", ms: 1234, ok: true });
    expect(logged).toHaveLength(1);
    const parsed = JSON.parse(logged[0] as string);
    expect(parsed).toMatchObject({ type: "ai_call", call: "tryon", upstream: "dashscope", ms: 1234, ok: true });
    expect(typeof parsed.ts).toBe("string");
  });

  it("降级率窗口：<5 次不出数，达到阈值后算得对", () => {
    for (let index = 0; index < 4; index += 1) recordTryonOutcome({ degraded: false });
    expect(tryonDegradationRate()).toBeNull();
    recordTryonOutcome({ degraded: true });
    recordTryonOutcome({ degraded: true });
    expect(tryonDegradationRate()).toBeCloseTo(2 / 6, 5);
  });

  it("stylist 规则率单独统计", () => {
    for (let index = 0; index < 6; index += 1) recordStylistOutcome(index % 2 === 0);
    expect(stylistRuleRate()).toBeCloseTo(0.5, 5);
  });

  it("P95 取自试衣耗时窗口", () => {
    for (const ms of [10_000, 20_000, 30_000, 40_000, 100_000]) recordTryonOutcome({ degraded: false, ms });
    expect(tryonP95Ms()).toBe(100_000);
  });

  it("降级率超 30% 触发告警 webhook，且一小时内只发一次", async () => {
    process.env.ALERT_WEBHOOK = "https://hooks.example/test";
    const posts: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: { body?: string }) => {
      posts.push(`${url} ${init?.body ?? ""}`);
      return Promise.resolve(new Response("{}"));
    }));
    for (let index = 0; index < 10; index += 1) recordTryonOutcome({ degraded: index < 4 });
    await vi.waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toContain("ai-outfit-preview");
    // 一小时内的第二条告警被抑制
    for (let index = 0; index < 10; index += 1) recordTryonOutcome({ degraded: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts.length).toBe(1);
  });

  it("无 ALERT_WEBHOOK 时静默", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (let index = 0; index < 20; index += 1) recordTryonOutcome({ degraded: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
