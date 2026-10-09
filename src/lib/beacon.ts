// 客户端事件回流（采样：每分钟最多 1 条，防刷；服务端另有 2KB/30 次每分每 IP 限制）
const KEY = "ai-outfit-preview:beacon-at";
const MIN_INTERVAL = 60_000;

export function reportEvent(event: Record<string, unknown>) {
  try {
    const now = Date.now();
    const last = Number(localStorage.getItem(KEY) || 0);
    if (now - last < MIN_INTERVAL) return;
    localStorage.setItem(KEY, String(now));
    void fetch("/api/v1/beacon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    }).catch(() => {
      // 上报失败静默
    });
  } catch {
    // 隐私模式等 localStorage 不可用：放弃上报
  }
}
