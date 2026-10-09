import type { IncomingMessage } from "node:http";
import { readBodyLimited } from "./body";
import { logAiCall, type AiCallLog } from "./aiLog";

export interface ChatPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBodyLimited(req);
  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    const error = new Error("请求体不是合法 JSON") as Error & { status: number };
    error.status = 400;
    throw error;
  }
}

/**
 * 调用 SiliconFlow chat completions（复用 IMAGE_API_KEY/IMAGE_API_BASE）。
 * 超时/网络错误/upstream 非 2xx 统一抛错，由调用方决定降级。
 */
export async function chatCompletion(
  env: Record<string, string>,
  options: { model: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number; timeoutMs?: number; caller?: string },
): Promise<string> {
  const key = env.IMAGE_API_KEY?.trim();
  if (!key) {
    const error = new Error("no_key") as Error & { status: number };
    error.status = 501;
    throw error;
  }
  const base = (env.IMAGE_API_BASE || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const started = Date.now();
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 800,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`llm upstream ${response.status}: ${text.slice(0, 200)}`) as Error & {
        status?: number;
        upstreamStatus?: number;
      };
      error.upstreamStatus = response.status;
      throw error;
    }
    const data = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("llm returned empty content");
    }
    logAiCall({ call: (options.caller as AiCallLog["call"]) ?? "chat", upstream: "siliconflow", ms: Date.now() - started, ok: true });
    return content;
  } catch (error) {
    logAiCall({
      call: (options.caller as AiCallLog["call"]) ?? "chat",
      upstream: "siliconflow",
      ms: Date.now() - started,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 120) : undefined,
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 LLM 输出中提取 JSON（容忍 markdown 代码块包裹） */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("no json in llm output");
  const opener = candidate[start];
  const closer = opener === "[" ? "]" : "}";
  const end = candidate.lastIndexOf(closer);
  if (end <= start) throw new Error("unbalanced json in llm output");
  return JSON.parse(candidate.slice(start, end + 1));
}
