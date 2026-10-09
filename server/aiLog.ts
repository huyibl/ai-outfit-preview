/**
 * 上游 AI 调用统一打点：每个上游调用一行 JSON 到 stdout（托管平台负责收集与轮转，不落盘文件）。
 * 降级率按链路分开统计：
 * - tryon：百炼失败或熔断短路（客户端后续走 Qwen/拼贴）÷ 总试衣请求
 * - stylist：规则引擎兜底响应 ÷ 总搭配请求
 * 客户端最终降级级别（degradedLevel）通过 beacon 回流，同样计入 tryon 降级样本。
 */

export interface AiCallLog {
  call: "tryon" | "img2img" | "txt2img" | "stylist" | "qc" | "tag" | "chat";
  upstream: "dashscope" | "siliconflow";
  ms: number;
  ok: boolean;
  degraded?: boolean;
  cacheHit?: boolean;
  caller?: string;
  detail?: string;
}

export function logAiCall(entry: AiCallLog) {
  console.log(
    JSON.stringify({
      type: "ai_call",
      ts: new Date().toISOString(),
      ...entry,
    }),
  );
}

// ---- 滑动窗口降级率（内存态，多实例各自统计，见 deploy.md 限制节） ----

const WINDOW = 20;
const tryonWindow: boolean[] = []; // true = degraded
const stylistWindow: boolean[] = []; // true = rule 模式
const tryonDurations: number[] = [];

export function recordTryonOutcome(input: { degraded: boolean; ms?: number }) {
  tryonWindow.push(input.degraded);
  if (tryonWindow.length > WINDOW) tryonWindow.shift();
  if (typeof input.ms === "number") {
    tryonDurations.push(input.ms);
    if (tryonDurations.length > WINDOW) tryonDurations.shift();
  }
  maybeAlert();
}

export function recordStylistOutcome(ruleMode: boolean) {
  stylistWindow.push(ruleMode);
  if (stylistWindow.length > WINDOW) stylistWindow.shift();
  maybeAlert();
}

export function tryonDegradationRate(): number | null {
  return tryonWindow.length >= 5 ? tryonWindow.filter(Boolean).length / tryonWindow.length : null;
}

export function stylistRuleRate(): number | null {
  return stylistWindow.length >= 5 ? stylistWindow.filter(Boolean).length / stylistWindow.length : null;
}

export function tryonP95Ms(): number | null {
  if (tryonDurations.length < 5) return null;
  const sorted = [...tryonDurations].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95) - 1 < 0 ? 0 : Math.ceil(sorted.length * 0.95) - 1];
}

export function resetAiMetrics() {
  tryonWindow.length = 0;
  stylistWindow.length = 0;
  tryonDurations.length = 0;
  lastAlertAt = 0;
}

// ---- 告警：降级率 >30% 或试衣 P95 >60s，最多每小时一条 ----

let lastAlertAt = 0;
const ALERT_INTERVAL = 3600_000;

export function maybeAlert(env: Record<string, string> = process.env as Record<string, string>, now = Date.now()) {
  const webhook = env.ALERT_WEBHOOK?.trim();
  if (!webhook) return;
  if (now - lastAlertAt < ALERT_INTERVAL) return;
  const reasons: string[] = [];
  const rate = tryonDegradationRate();
  if (rate !== null && rate > 0.3) reasons.push(`试衣降级率 ${(rate * 100).toFixed(0)}%`);
  const p95 = tryonP95Ms();
  if (p95 !== null && p95 > 60_000) reasons.push(`试衣 P95 ${(p95 / 1000).toFixed(0)}s`);
  const ruleRate = stylistRuleRate();
  if (ruleRate !== null && ruleRate > 0.3) reasons.push(`搭配规则引擎占比 ${(ruleRate * 100).toFixed(0)}%`);
  if (reasons.length === 0) return;
  lastAlertAt = now;
  const text = `[ai-outfit-preview] ${reasons.join("；")}（窗口 ${WINDOW} 次）`;
  console.log(JSON.stringify({ type: "alert", ts: new Date().toISOString(), text }));
  void fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: text } }),
  }).catch(() => {
    // 告警失败静默，不打断业务
  });
}
