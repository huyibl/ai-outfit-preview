// 设备层试衣配额：第一道防线（普通用户）；localStorage 可被清掉绕过，
// 恶意者由 IP 软限提示 + 全局预算闸兜底（见 server/api.ts）
const KEY = "ai-outfit-preview:tryon-quota";
export const DEVICE_TRYON_DAILY_LIMIT = 10;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function deviceQuotaLeft(): number {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as { date?: string; count?: number };
    const used = raw.date === today() ? raw.count || 0 : 0;
    return Math.max(0, DEVICE_TRYON_DAILY_LIMIT - used);
  } catch {
    return DEVICE_TRYON_DAILY_LIMIT;
  }
}

/** 服务端 budget_exhausted（全局额度耗尽）时不计数：不惩罚被服务端额度连坐的用户 */
export function countDeviceTryon() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}") as { date?: string; count?: number };
    const used = raw.date === today() ? raw.count || 0 : 0;
    localStorage.setItem(KEY, JSON.stringify({ date: today(), count: used + 1 }));
  } catch {
    // 写不进去就放弃，下次仍然放行
  }
}
