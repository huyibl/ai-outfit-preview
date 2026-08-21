import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadImageEnv() {
  const fileEnv = parseEnvFile(resolve(process.cwd(), ".env"));
  return {
    IMAGE_API_KEY: (fileEnv.IMAGE_API_KEY || process.env.IMAGE_API_KEY || "").trim(),
    IMAGE_API_BASE: (fileEnv.IMAGE_API_BASE || process.env.IMAGE_API_BASE || "").trim(),
    IMAGE_MODEL: (fileEnv.IMAGE_MODEL || process.env.IMAGE_MODEL || "").trim(),
    IMAGE_TXT_MODEL: (fileEnv.IMAGE_TXT_MODEL || process.env.IMAGE_TXT_MODEL || "").trim(),
    IMAGE_EDIT_MODEL: (fileEnv.IMAGE_EDIT_MODEL || process.env.IMAGE_EDIT_MODEL || "").trim(),
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function toDataUrl(bytes: ArrayBuffer, mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function generateWithApi(
  env: Record<string, string>,
  prompt: string,
  image?: string,
  negativePrompt?: string,
  mode: "txt2img" | "img2img" = "txt2img",
) {
  const key = env.IMAGE_API_KEY?.trim();
  if (!key) {
    const error = new Error("no_key");
    (error as Error & { status: number }).status = 501;
    throw error;
  }

  const base = (env.IMAGE_API_BASE || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const txtModel = env.IMAGE_TXT_MODEL || "Kwai-Kolors/Kolors";
  const editModel = env.IMAGE_EDIT_MODEL || env.IMAGE_MODEL || "Qwen/Qwen-Image-Edit";
  const model = mode === "img2img" ? editModel : txtModel;
  const isEdit = mode === "img2img" || /edit|kontext/i.test(model);
  if (isEdit && !image) {
    throw new Error("图生图需要模特参考图");
  }

  const payload: Record<string, unknown> = { model, prompt };
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  if (isEdit && image) payload.image = image;

  if (base.includes("openai.com")) {
    payload.n = 1;
    payload.size = "1024x1024";
    payload.response_format = "b64_json";
  } else if (!isEdit) {
    payload.image_size = "720x1280";
    if (model.includes("Kolors")) {
      payload.batch_size = 1;
      payload.num_inference_steps = 25;
      payload.guidance_scale = 9;
    }
  }

  const response = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`upstream ${response.status}: ${text.slice(0, 400)}`);
  }

  const data = JSON.parse(text) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    images?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.images?.[0] ?? data.data?.[0];
  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`;
  }
  if (first?.url) {
    const imgRes = await fetch(first.url);
    const mime = imgRes.headers.get("content-type") || "image/png";
    return toDataUrl(await imgRes.arrayBuffer(), mime);
  }
  throw new Error("no image in upstream response");
}

function previewApiPlugin() {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/api/preview")) {
      next();
      return;
    }
    if (req.method === "GET") {
      sendJson(res, 200, { configured: Boolean(loadImageEnv().IMAGE_API_KEY) });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)) || "{}") as {
        prompt?: string;
        negativePrompt?: string;
        image?: string;
        mode?: "txt2img" | "img2img";
      };
      const prompt = body.prompt?.trim();
      if (!prompt) {
        sendJson(res, 400, { error: "missing_prompt" });
        return;
      }
      const mode = body.mode === "img2img" ? "img2img" : "txt2img";
      const image = await generateWithApi(
        loadImageEnv(),
        prompt,
        body.image,
        body.negativePrompt,
        mode,
      );
      sendJson(res, 200, { image, source: "api" });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 502;
      sendJson(res, status, {
        error: error instanceof Error ? error.message : "generate_failed",
      });
    }
  };

  return {
    name: "preview-api",
    configureServer(server: { middlewares: { use: (fn: typeof handler) => void } }) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: typeof handler) => void } }) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), previewApiPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
