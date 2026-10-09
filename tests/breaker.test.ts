import { beforeEach, describe, expect, it } from "vitest";
import { CircuitBreaker, resetBreakers, stylistLlmBreaker, tryonBreaker } from "../server/breaker";

function makeBreaker(now = { value: 1_000_000 }) {
  return new CircuitBreaker({
    name: "test",
    failThreshold: 3,
    cooldownMs: 120_000,
    maxCooldownMs: 480_000,
    now: () => now.value,
  });
}

describe("CircuitBreaker 全分支", () => {
  beforeEach(() => resetBreakers());

  it("closed 状态下正常放行", () => {
    const breaker = makeBreaker();
    expect(breaker.canTry()).toBe(true);
  });

  it("连续失败达到阈值后熔断，冷却期内拒绝", () => {
    const now = { value: 1_000_000 };
    const breaker = makeBreaker(now);
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.canTry()).toBe(true); // 未到阈值
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.canTry()).toBe(false);
    now.value += 60_000; // 冷却未到
    expect(breaker.canTry()).toBe(false);
  });

  it("冷却结束后半开放行一次，成功则闭合且冷却复位", () => {
    const now = { value: 1_000_000 };
    const breaker = makeBreaker(now);
    for (let index = 0; index < 3; index += 1) breaker.recordFailure();
    now.value += 120_000;
    expect(breaker.canTry()).toBe(true);
    expect(breaker.snapshot().state).toBe("half-open");
    breaker.recordSuccess();
    expect(breaker.snapshot()).toMatchObject({ state: "closed", failStreak: 0, cooldownMs: 120_000 });
    expect(breaker.canTry()).toBe(true);
  });

  it("半开再失败 → 重新熔断且冷却翻倍；翻倍有上限", () => {
    const now = { value: 1_000_000 };
    const breaker = makeBreaker(now);
    for (let index = 0; index < 3; index += 1) breaker.recordFailure();
    now.value += 120_000;
    expect(breaker.canTry()).toBe(true);
    breaker.recordFailure(now.value);
    expect(breaker.snapshot().state).toBe("open");
    expect(breaker.snapshot().cooldownMs).toBe(480_000); // 240 再翻倍
    now.value += 480_000;
    expect(breaker.canTry()).toBe(true);
    breaker.recordFailure(now.value);
    expect(breaker.snapshot().cooldownMs).toBe(480_000); // 达到 maxCooldownMs 后不再翻倍
    now.value += 480_000;
    expect(breaker.canTry()).toBe(true);
    breaker.recordFailure(now.value);
    expect(breaker.snapshot().cooldownMs).toBe(480_000);
  });

  it("多实例互不影响", () => {
    for (let index = 0; index < 3; index += 1) tryonBreaker.recordFailure();
    expect(tryonBreaker.snapshot().state).toBe("open");
    expect(stylistLlmBreaker.snapshot().state).toBe("closed");
    expect(stylistLlmBreaker.canTry()).toBe(true);
  });

  it("成功会清零失败计数，孤立的零星失败不触发熔断", () => {
    const breaker = makeBreaker();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.snapshot().state).toBe("closed"); // failStreak 从未连续到 3
  });
});
