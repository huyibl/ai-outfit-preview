/**
 * 通用熔断状态机（进程内单例，多实例部署需迁移 Redis —— 见 docs/deploy.md 限制节）。
 *
 * 各实例阈值理由（不要"顺手统一"）：
 * - stylist-llm：LLM 失败快速返回（<15s 超时），且规则引擎兜底零成本，容忍 3 次；
 *   冷却 120s 起，翻倍上限 30 分钟 —— LLM 服务抖动常见，给足恢复窗口。
 * - tryon-dashscope：百炼失败=用户白等最长 120s 轮询+按次计费，失败成本极高 →
 *   同样 3 次快速熔断；冷却 120s 起 —— 恢复探测一次就是一条真实计费请求，探得少而准。
 * - qwen（adapter 内轻量计数，非本模块）：Qwen 失败是快速失败（几秒返回错误，无轮询），
 *   单次成本低 → 容忍 5 次；30s 冷却即可，探错也不疼。
 */

export interface BreakerOptions {
  name: string;
  /** 连续失败多少次后熔断 */
  failThreshold: number;
  /** 首次冷却时长（ms），每次熔断翻倍直到 maxCooldownMs */
  cooldownMs: number;
  maxCooldownMs: number;
  now?: () => number;
}

interface BreakerSnapshot {
  name: string;
  state: "closed" | "open" | "half-open";
  failStreak: number;
  openUntil: number;
  cooldownMs: number;
}

export class CircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed";
  private failStreak = 0;
  private openUntil = 0;
  private cooldown: number;

  constructor(private readonly options: BreakerOptions) {
    this.cooldown = options.cooldownMs;
  }

  canTry(now = this.time()): boolean {
    if (this.state === "open") {
      if (now >= this.openUntil) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(now = this.time()) {
    this.state = "closed";
    this.failStreak = 0;
    this.cooldown = this.options.cooldownMs;
  }

  recordFailure(now = this.time()) {
    this.failStreak += 1;
    if (this.state === "half-open" || this.failStreak >= this.options.failThreshold) {
      this.state = "open";
      this.openUntil = now + this.cooldown;
      this.cooldown = Math.min(this.cooldown * 2, this.options.maxCooldownMs);
    }
  }

  snapshot(): BreakerSnapshot {
    return {
      name: this.options.name,
      state: this.state,
      failStreak: this.failStreak,
      openUntil: this.openUntil,
      cooldownMs: this.cooldown,
    };
  }

  reset() {
    this.state = "closed";
    this.failStreak = 0;
    this.openUntil = 0;
    this.cooldown = this.options.cooldownMs;
  }

  private time() {
    return this.options.now ? this.options.now() : Date.now();
  }
}

export const stylistLlmBreaker = new CircuitBreaker({
  name: "stylist-llm",
  failThreshold: 3,
  cooldownMs: 120_000,
  maxCooldownMs: 30 * 60_000,
});

export const tryonBreaker = new CircuitBreaker({
  name: "tryon-dashscope",
  failThreshold: 3,
  cooldownMs: 120_000,
  maxCooldownMs: 30 * 60_000,
});

export function resetBreakers() {
  stylistLlmBreaker.reset();
  tryonBreaker.reset();
}
