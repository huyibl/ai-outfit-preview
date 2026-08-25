import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export function parseEnvFile(filePath: string): Record<string, string> {
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

export function loadImageEnv() {
  const fileEnv = parseEnvFile(resolve(process.cwd(), ".env"));
  const pick = (name: string, fallback = "") => {
    if (Object.prototype.hasOwnProperty.call(fileEnv, name)) return fileEnv[name].trim();
    return (process.env[name] || fallback).trim();
  };
  return {
    IMAGE_API_KEY: pick("IMAGE_API_KEY"),
    IMAGE_API_BASE: pick("IMAGE_API_BASE"),
    IMAGE_MODEL: pick("IMAGE_MODEL"),
    IMAGE_TXT_MODEL: pick("IMAGE_TXT_MODEL"),
    IMAGE_EDIT_MODEL: pick("IMAGE_EDIT_MODEL"),
    DASHSCOPE_API_KEY: pick("DASHSCOPE_API_KEY"),
    DASHSCOPE_BASE: pick("DASHSCOPE_BASE") || "https://dashscope.aliyuncs.com",
    DASHSCOPE_TRYON_MODEL: pick("DASHSCOPE_TRYON_MODEL") || "aitryon-plus",
  };
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function toDataUrl(bytes: ArrayBuffer, mime = "image/png") {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function asPngDataUri(image?: string) {
  if (!image) return undefined;
  const trimmed = image.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

function dataUriToFile(dataUri: string, fallbackName: string) {
  const match = dataUri.trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error(`invalid image data for ${fallbackName}`);
  const mime = match[1];
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : mime.includes("webp") ? "webp" : "png";
  return {
    buffer: Buffer.from(match[2], "base64"),
    mime,
    filename: `${fallbackName}.${ext}`,
  };
}

async function uploadDashscopeOss(key: string, base: string, model: string, dataUri: string, name: string) {
  const policyRes = await fetch(
    `${base}/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(model)}`,
    { headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } },
  );
  const policyJson = (await policyRes.json()) as {
    data?: {
      policy: string;
      signature: string;
      upload_dir: string;
      upload_host: string;
      oss_access_key_id: string;
      x_oss_object_acl: string;
      x_oss_forbid_overwrite: string;
    };
    message?: string;
  };
  if (!policyRes.ok || !policyJson.data) {
    throw new Error(`上传凭证失败：${policyJson.message || policyRes.status}`);
  }
  const file = dataUriToFile(dataUri, name);
  const objectKey = `${policyJson.data.upload_dir}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.filename}`;
  const form = new FormData();
  form.append("OSSAccessKeyId", policyJson.data.oss_access_key_id);
  form.append("policy", policyJson.data.policy);
  form.append("Signature", policyJson.data.signature);
  form.append("key", objectKey);
  form.append("x-oss-object-acl", policyJson.data.x_oss_object_acl);
  form.append("x-oss-forbid-overwrite", policyJson.data.x_oss_forbid_overwrite);
  form.append("success_action_status", "200");
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.filename);
  const uploaded = await fetch(policyJson.data.upload_host, { method: "POST", body: form });
  if (!uploaded.ok) {
    const detail = await uploaded.text().catch(() => "");
    throw new Error(`上传模特/衣图失败（HTTP ${uploaded.status}）${detail.slice(0, 160)}`);
  }
  return `oss://${objectKey}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickTryonImageUrl(payload: Record<string, unknown>) {
  const output = (payload.output ?? payload) as Record<string, unknown>;
  if (typeof output.image_url === "string") return output.image_url;
  if (typeof output.result_url === "string") return output.result_url;
  const results = output.results as Array<{ url?: string }> | undefined;
  if (results?.[0]?.url) return results[0].url;
  return null;
}

export async function generateTryOnWithDashscope(
  env: Record<string, string>,
  person: string,
  top?: string,
  bottom?: string,
) {
  const key = env.DASHSCOPE_API_KEY?.trim();
  if (!key) {
    const error = new Error("no_tryon_key");
    (error as Error & { status: number }).status = 501;
    throw error;
  }
  if (!top && !bottom) {
    throw new Error("虚拟试衣需要上衣或下装图片");
  }
  const base = (env.DASHSCOPE_BASE || "https://dashscope.aliyuncs.com").replace(/\/$/, "");
  const model = env.DASHSCOPE_TRYON_MODEL || "aitryon-plus";
  const personUrl = await uploadDashscopeOss(key, base, model, person, "person");
  const input: Record<string, string> = { person_image_url: personUrl };
  if (top) input.top_garment_url = await uploadDashscopeOss(key, base, model, top, "top");
  if (bottom) input.bottom_garment_url = await uploadDashscopeOss(key, base, model, bottom, "bottom");

  const submit = await fetch(`${base}/api/v1/services/aigc/image2image/image-synthesis/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
      "X-DashScope-OssResourceResolve": "enable",
    },
    body: JSON.stringify({
      model,
      input,
      parameters: { restore_face: true, resolution: -1 },
    }),
  });
  const submitted = (await submit.json()) as {
    output?: { task_id?: string; task_status?: string; message?: string };
    message?: string;
    code?: string;
  };
  if (!submit.ok || !submitted.output?.task_id) {
    throw new Error(
      submitted.output?.message ||
        submitted.message ||
        submitted.code ||
        `试衣提交失败（HTTP ${submit.status}）`,
    );
  }

  const taskId = submitted.output.task_id;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(2000);
    const poll = await fetch(`${base}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = (await poll.json()) as {
      output?: {
        task_status?: string;
        message?: string;
        image_url?: string;
        result_url?: string;
        results?: Array<{ url?: string }>;
      };
    };
    const status = data.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = pickTryonImageUrl(data as Record<string, unknown>);
      if (!url) throw new Error("试衣成功但没有返回图片");
      const imgRes = await fetch(url);
      const mime = imgRes.headers.get("content-type") || "image/jpeg";
      return toDataUrl(await imgRes.arrayBuffer(), mime);
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw new Error(data.output?.message || `试衣失败（${status}）`);
    }
  }
  throw new Error("试衣超时，请稍后重试");
}

export async function generateWithApi(
  env: Record<string, string>,
  prompt: string,
  image?: string,
  negativePrompt?: string,
  mode: "txt2img" | "img2img" = "txt2img",
  image2?: string,
  image3?: string,
) {
  const key = env.IMAGE_API_KEY?.trim();
  if (!key) {
    const error = new Error("no_key");
    (error as Error & { status: number }).status = 501;
    throw error;
  }

  const base = (env.IMAGE_API_BASE || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const txtModel = env.IMAGE_TXT_MODEL || "Kwai-Kolors/Kolors";
  const editModel = env.IMAGE_EDIT_MODEL || env.IMAGE_MODEL || "Qwen/Qwen-Image-Edit-2509";
  const model = mode === "img2img" ? editModel : txtModel;
  const isEdit = mode === "img2img" || /edit|kontext/i.test(model);
  if (isEdit && !image) {
    throw new Error("图生图需要模特参考图");
  }

  const payload: Record<string, unknown> = { model, prompt };
  if (negativePrompt) payload.negative_prompt = negativePrompt;
  if (isEdit && image) payload.image = asPngDataUri(image);
  if (isEdit && image2) payload.image2 = asPngDataUri(image2);
  if (isEdit && image3) payload.image3 = asPngDataUri(image3);

  if (base.includes("openai.com")) {
    payload.n = 1;
    payload.size = "1024x1024";
    payload.response_format = "b64_json";
  } else if (!isEdit) {
    payload.image_size = "720x1280";
    if (model.includes("Kolors")) {
      payload.batch_size = 1;
      payload.num_inference_steps = 30;
      payload.guidance_scale = 7.5;
    }
  } else {
    payload.num_inference_steps = 20;
    payload.guidance_scale = 4;
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
    const raw = first.b64_json.trim();
    return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  }
  if (first?.url) {
    const imgRes = await fetch(first.url);
    const mime = imgRes.headers.get("content-type") || "image/png";
    return toDataUrl(await imgRes.arrayBuffer(), mime);
  }
  throw new Error("no image in upstream response");
}

export async function handlePreviewRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET") {
    const env = loadImageEnv();
    sendJson(res, 200, {
      configured: Boolean(env.IMAGE_API_KEY || env.DASHSCOPE_API_KEY),
      tryon: Boolean(env.DASHSCOPE_API_KEY),
      image: Boolean(env.IMAGE_API_KEY),
    });
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
      image2?: string;
      image3?: string;
      mode?: "txt2img" | "img2img" | "tryon";
      person?: string;
      top?: string;
      bottom?: string;
    };
    const env = loadImageEnv();
    if (body.mode === "tryon") {
      if (!body.person?.trim()) {
        sendJson(res, 400, { error: "missing_person" });
        return;
      }
      const image = await generateTryOnWithDashscope(env, body.person, body.top, body.bottom);
      sendJson(res, 200, { image, source: "tryon" });
      return;
    }
    const prompt = body.prompt?.trim();
    if (!prompt) {
      sendJson(res, 400, { error: "missing_prompt" });
      return;
    }
    const mode = body.mode === "img2img" ? "img2img" : "txt2img";
    const image = await generateWithApi(
      env,
      prompt,
      body.image,
      body.negativePrompt,
      mode,
      body.image2,
      body.image3,
    );
    sendJson(res, 200, { image, source: "api" });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    sendJson(res, status, {
      error: error instanceof Error ? error.message : "generate_failed",
    });
  }
}
