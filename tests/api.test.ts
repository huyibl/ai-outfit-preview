import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleApiRequest, resetRateLimits, type ApiRequestOptions } from "../server/api";
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
    headersSent: false,
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

const baseOptions: ApiRequestOptions = {
  env: { ACCESS_TOKEN: "", ALLOWED_ORIGINS: "" },
};

describe("api v1 鉴权与探测", () => {
  beforeEach(() => resetRateLimits());

  it("本机无 token 时可访问 capabilities", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ url: "/api/v1/capabilities" }), res, baseOptions);
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(200);
    expect(JSON.parse(recorded.body)).toMatchObject({ configured: false, tryon: false });
  });

  it("配置 ACCESS_TOKEN 后拒绝无令牌请求", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ url: "/api/v1/capabilities" }), res, {
      env: { ACCESS_TOKEN: "secret", ALLOWED_ORIGINS: "" },
    });
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(401);
    expect(JSON.parse(recorded.body).error.code).toBe("unauthorized");
  });

  it("正确令牌通过", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ url: "/api/v1/capabilities", headers: { authorization: "Bearer secret" } }),
      res,
      { env: { ACCESS_TOKEN: "secret", ALLOWED_ORIGINS: "" } },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(200);
  });

  it("非本机且无 token 时拒绝", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ url: "/api/v1/capabilities", remoteAddress: "8.8.8.8" }), res, baseOptions);
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(401);
  });
});

describe("api v1 请求校验与错误格式", () => {
  beforeEach(() => resetRateLimits());

  it("未知路径返回 404", async () => {
    const res = makeRes();
    await handleApiRequest(makeReq({ url: "/api/other" }), res, baseOptions);
    expect((res as { __recorded: RecordedResponse }).__recorded.status).toBe(404);
  });

  it("非法 JSON 返回 bad_request", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/preview", body: "{oops" }),
      res,
      baseOptions,
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(400);
    expect(JSON.parse(recorded.body).error.code).toBe("bad_request");
  });

  it("缺 prompt 返回 bad_request 并带字段", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/preview", body: JSON.stringify({ mode: "txt2img" }) }),
      res,
      baseOptions,
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    const payload = JSON.parse(recorded.body);
    expect(recorded.status).toBe(400);
    expect(payload.error.code).toBe("bad_request");
    expect(payload.error.field).toBe("prompt");
  });

  it("tryon 缺上衣下装返回 bad_request", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "POST",
        url: "/api/v1/preview",
        body: JSON.stringify({ mode: "tryon", person: "data:image/png;base64,x" }),
      }),
      res,
      baseOptions,
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(400);
    expect(JSON.parse(recorded.body).error.code).toBe("bad_request");
  });

  it("未配置 key 时生成返回 501 not_configured（legacy 格式为字符串 error）", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "POST",
        url: "/api/preview",
        body: JSON.stringify({ prompt: "outfit", mode: "txt2img" }),
      }),
      res,
      baseOptions,
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(501);
    expect(typeof JSON.parse(recorded.body).error).toBe("string");
  });
});

describe("api v1 体积与限流", () => {
  beforeEach(() => resetRateLimits());

  it("超过 8MB 返回 payload_too_large", async () => {
    const res = makeRes();
    const bigPrompt = `{"prompt":"${"x".repeat(9 * 1024 * 1024)}"}`;
    await handleApiRequest(
      makeReq({ method: "POST", url: "/api/v1/preview", body: bigPrompt }),
      res,
      baseOptions,
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(413);
    expect(JSON.parse(recorded.body).error.code).toBe("payload_too_large");
  });

  it("第 11 次请求触发限流 429 并带 Retry-After", async () => {
    let sawLimited = false;
    for (let index = 0; index < 11; index += 1) {
      const res = makeRes();
      await handleApiRequest(
        makeReq({ method: "POST", url: "/api/v1/preview", body: "not-json" }),
        res,
        baseOptions,
      );
      const recorded = (res as { __recorded: RecordedResponse }).__recorded;
      if (recorded.status === 429) {
        expect(recorded.headers["retry-after"]).toBeDefined();
        expect(JSON.parse(recorded.body).error.code).toBe("rate_limited");
        sawLimited = true;
        break;
      }
      expect(recorded.status).toBe(400);
    }
    expect(sawLimited).toBe(true);
  });
});

describe("api v1 CORS", () => {
  beforeEach(() => resetRateLimits());

  it("白名单内的 Origin 预检返回 204 并带 Allow-Origin", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "OPTIONS",
        url: "/api/v1/preview",
        headers: { origin: "https://partner.example" },
      }),
      res,
      { env: { ACCESS_TOKEN: "", ALLOWED_ORIGINS: "https://partner.example" } },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.status).toBe(204);
    expect(recorded.headers["access-control-allow-origin"]).toBe("https://partner.example");
  });

  it("白名单外的 Origin 不带 CORS 头", async () => {
    const res = makeRes();
    await handleApiRequest(
      makeReq({
        method: "OPTIONS",
        url: "/api/v1/preview",
        headers: { origin: "https://evil.example" },
      }),
      res,
      { env: { ACCESS_TOKEN: "", ALLOWED_ORIGINS: "https://partner.example" } },
    );
    const recorded = (res as { __recorded: RecordedResponse }).__recorded;
    expect(recorded.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
