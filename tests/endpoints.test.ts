import { beforeEach, describe, expect, it } from "vitest";
import { handleApiRequest, resetBudget, resetIpQuota, resetRateLimits, budgetSpent } from "../server/api";
import { resetBreakers, tryonBreaker } from "../server/breaker";
import type { IncomingMessage, ServerResponse } from "node:http";

interface RecordedResponse {
  status: number;
  headers: Record<string, string | number | string[]>;
  body: string;
}

function makeReq(options: {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  remoteAddress?: string;
}): IncomingMessage {
  const chunks = options.body === undefined ? [] : [Buffer.from(options.body, "utf8")];
  return {
    method: options.method ?? "GET",
    url: options.url,
    headers: options.headers ?? {},
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next: async () => {
          if (index < chunks.length) {
            const value = chunks[index];
            index += 1;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  } as unknown as IncomingMessage;
}

function makeRes() {
  const recorded: RecordedResponse = { status: 0, headers: {}, body: "" };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string | number | string[]) {
      recorded.headers[name.toLowerCase()] = value;
    },
    end(payload?: string) {
      recorded.body = payload ?? "";
      recorded.status = res.statusCode;
    },
  } as unknown as ServerResponse & { __recorded: RecordedResponse };
  Object.defineProperty(res, "__recorded", { value: recorded });
  return res;
}

const openEnv = { ACCESS_TOKEN: "", ALLOWED_ORIGINS: "" };

describe("新端点：鉴权与参数", () => {
  beforeEach(() => {
    resetRateLimits();
    resetBudget();
  });

  it("stylist 缺 intent 返回 bad_request", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/stylist", body: JSON.stringify({ wardrobe: [{ id: "a", category: "top" }] }) }),
      res,
      { env: openEnv },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(400);
    expect(JSON.parse(recorded.body).error.code).toBe("bad_request");
  });

  it("空衣橱返回 inspire 模式", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/stylist", body: JSON.stringify({ intent: "通勤", wardrobe: [] }) }),
      res,
      { env: openEnv },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body).mode).toBe("inspire");
  });

  it("无 key 时 stylist 走规则引擎兜底", async () => {
    const res = makeRes();
    const wardrobe = [
      { id: "t1", category: "top" },
      { id: "b1", category: "bottom" },
      { id: "s1", category: "shoes" },
    ];
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/stylist", body: JSON.stringify({ intent: "秋天通勤", wardrobe }) }),
      res,
      { env: openEnv },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    const payload = JSON.parse(recorded.body);
    expect(recorded.status).toBe(200);
    expect(payload.mode).toBe("rule");
    expect(payload.outfits.length).toBeGreaterThan(0);
    expect(payload.outfits[0].itemIds).toEqual(["t1", "b1", "s1"]);
  });

  it("qc 缺结果图返回 bad_request", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/qc", body: "{}" }), res, { env: openEnv });
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(400);
  });

  it("tag 缺图返回 bad_request", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/tag", body: "{}" }), res, { env: openEnv });
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(400);
  });
});

describe("relay-image SSRF 防护", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("拒绝 http", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/relay-image", body: JSON.stringify({ url: "http://a.aliyuncs.com/x.jpg" }) }),
      res,
      { env: openEnv },
    );
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(400);
  });

  it("拒绝白名单外域名", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/relay-image", body: JSON.stringify({ url: "https://evil.example/x.jpg" }) }),
      res,
      { env: openEnv },
    );
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(400);
  });

  it("白名单内的内网 IP 被拒", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/relay-image", body: JSON.stringify({ url: "https://127.0.0.1/x.jpg" }) }),
      res,
      { env: { ...openEnv, RELAY_HOST_SUFFIXES: "127.0.0.1" } },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(400);
    expect(JSON.parse(recorded.body).error.message).toContain("内网");
  });

  it("10 分钟内第 11 次中转触发限流", async () => {
    let sawLimited = false;
    for (let index = 0; index < 11; index += 1) {
      const res = makeRes();
      await handleApiRequest(
        makeReq({
          method: "POST",
          url: "/api/v1/relay-image",
          body: JSON.stringify({ url: "https://ftp.aliyuncs.com/x.jpg" }),
        }),
        res,
        { env: openEnv },
      );
      if ((res as { __recorded: RecordedResponse }).__recorded.status === 429) {
        sawLimited = true;
        break;
      }
    }
    expect(sawLimited).toBe(true);
  });
});

describe("每日试衣预算闸", () => {
  beforeEach(() => {
    resetRateLimits();
    resetBudget();
  });

  it("预算耗尽后返回 budget_exhausted", async () => {
    const env = { ...openEnv, DAILY_BUDGET_YUAN: "0.4" };
    const body = JSON.stringify({ mode: "tryon", person: "data:image/png;base64,x", top: "data:image/png;base64,y" });
    // 第一次：预算内 → 走到无 key 的 501
    const first = makeRes();
    await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/preview", body }), first, { env });
    expect((first as { __recorded: RecordedResponse }).__recorded.status).toBe(501);
    expect(budgetSpent()).toBeGreaterThan(0);
    // 第二次：已超预算 → budget_exhausted
    const second = makeRes();
    await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/preview", body }), second, { env });
    const recorded = (second as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(429);
    expect(JSON.parse(recorded.body).error.code).toBe("budget_exhausted");
  });

  it("DAILY_BUDGET_YUAN=0 时闸门关闭", async () => {
    const env = { ...openEnv, DAILY_BUDGET_YUAN: "0" };
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "POST",
        url: "/api/v1/preview",
        body: JSON.stringify({ mode: "tryon", person: "x", top: "y" }),
      }),
      res,
      { env },
    );
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(501);
  });
});


describe("IP 每日软配额", () => {
  beforeEach(() => {
    resetRateLimits();
    resetBudget();
    resetIpQuota();
    resetBreakers();
  });

  it("超过 TRYON_DAILY_PER_IP 后带 X-Quota-Notice 头但仍然处理", async () => {
    const env = { ...openEnv, TRYON_DAILY_PER_IP: "2" };
    const body = JSON.stringify({ mode: "tryon", person: "x", top: "y" });
    for (let index = 0; index < 2; index += 1) {
      const res = makeRes();
      await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/preview", body }), res, { env });
      const recorded = (res as { __recorded: RecordedResponse }).__recorded;
      expect(recorded.status).toBe(501);
      expect(recorded.headers["x-quota-notice"]).toBeUndefined();
    }
    const third = makeRes();
    await handleApiRequest(makeReq({ method: "POST", url: "/api/v1/preview", body }), third, { env });
    const recorded = (third as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(501); // 软限制：仍处理
    expect(recorded.headers["x-quota-notice"]).toBe("ip-daily-soft");
  });
});

describe("试衣熔断快速返回", () => {
  beforeEach(() => {
    resetRateLimits();
    resetBudget();
    resetIpQuota();
    resetBreakers();
  });

  it("熔断开路时立即 503 tryon_degraded，不等待上游", async () => {
    for (let index = 0; index < 3; index += 1) tryonBreaker.recordFailure();
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "POST",
        url: "/api/v1/preview",
        body: JSON.stringify({ mode: "tryon", person: "x", top: "y" }),
      }),
      res,
      { env: { ...openEnv, DASHSCOPE_API_KEY: "k" } },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(503);
    expect(JSON.parse(recorded.body).error.code).toBe("tryon_degraded");
  });
});

describe("beacon 端点", () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it("正常事件返回 ok", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/beacon", body: JSON.stringify({ event: "tryon_degraded", level: "qwen" }) }),
      res,
      { env: openEnv },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body).ok).toBe(true);
  });

  it("超过 2KB 返回 413", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/beacon", body: JSON.stringify({ pad: "x".repeat(3 * 1024) }) }),
      res,
      { env: openEnv },
    );
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(413);
  });

  it("第 31 次触发限流", async () => {
    let sawLimited = false;
    for (let index = 0; index < 31; index += 1) {
      const res = makeRes();
      await handleApiRequest(
        makeReq({ method: "POST", url: "/api/v1/beacon", body: JSON.stringify({ event: "ping" }) }),
        res,
        { env: openEnv },
      );
      if ((res as { __recorded: RecordedResponse }).__recorded.status === 429) {
        sawLimited = true;
        break;
      }
    }
    expect(sawLimited).toBe(true);
  });
});
