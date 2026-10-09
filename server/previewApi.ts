import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tryonBreaker } from "./breaker";
import { logAiCall } from "./aiLog";

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
    // 部署配置（与上游 key 同源读取，支持 .env）
    ACCESS_TOKEN: pick("ACCESS_TOKEN"),
    ALLOWED_ORIGINS: pick("ALLOWED_ORIGINS"),
    PORT: pick("PORT"),
  };
}

export async function toDataUrl(bytes: ArrayBuffer, mime = "image/png") {
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

// 三件同穿能力探测：参数错误 → 永久缓存不支持；服务端错误 → 不缓存下次重试
const tryonCaps: { thirdGarment: boolean | null } = { thirdGarment: null };

function isParamError(status: number, message: string) {
  return (
    status >= 400 &&
    status < 500 &&
    /invalid|param|unknown|not\s?exist|unsupported|unexpected|too long|malformed/i.test(message)
  );
}

export async function generateTryOnWithDashscope(
  env: Record<string, string>,
  person: string,
  top?: string,
  bottom?: string,
  outer?: string,
): Promise<string> {
  const key = env.DASHSCOPE_API_KEY?.trim();
  if (!key) {
    const error = new Error("no_tryon_key");
    (error as Error & { status: number }).status = 501;
    throw error;
  }
  const started = Date.now();
  if (!top && !bottom) {
    throw new Error("虚拟试衣需要上衣或下装图片");
  }
  const base = (env.DASHSCOPE_BASE || "https://dashscope.aliyuncs.com").replace(/\/$/, "");
  const model = env.DASHSCOPE_TRYON_MODEL || "aitryon-plus";
  const personUrl = await uploadDashscopeOss(key, base, model, person, "person");
  const submitOnce = async (withOuter: boolean) => {
    const input: Record<string, string> = { person_image_url: personUrl };
    if (top) input.top_garment_url = await uploadDashscopeOss(key, base, model, top, "top");
    if (bottom) input.bottom_garment_url = await uploadDashscopeOss(key, base, model, bottom, "bottom");
    if (withOuter && outer) input.outer_garment_url = await uploadDashscopeOss(key, base, model, outer, "outer");
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
    const submitted = (await submit.json().catch(() => ({}))) as {
      output?: { task_id?: string; task_status?: string; message?: string };
      message?: string;
      code?: string;
    };
    return { submit, submitted };
  };

  const attemptOuter = Boolean(outer) && tryonCaps.thirdGarment !== false;
  let { submit, submitted } = await submitOnce(attemptOuter);
  if (attemptOuter && (!submit.ok || !submitted.output?.task_id)) {
    const message = submitted.output?.message || submitted.message || submitted.code || "";
    if (isParamError(submit.status, message)) {
      // 服务端不认识第三槽位：永久记为不支持，回退两轮
      tryonCaps.thirdGarment = false;
      ({ submit, submitted } = await submitOnce(false));
    }
    // 5xx/网络类错误不缓存探测结论，下次仍会先试探
  } else if (attemptOuter && submit.ok && submitted.output?.task_id) {
    tryonCaps.thirdGarment = true;
  }

  if (!submit.ok || !submitted.output?.task_id) {
    const message =
      submitted.output?.message ||
      submitted.message ||
      submitted.code ||
      `试衣提交失败（HTTP ${submit.status}）`;
    // 参数类错误（如三件同穿不被支持）是请求问题不是服务故障，不计熔断
    if (!(attemptOuter && tryonCaps.thirdGarment === false && isParamError(submit.status, message))) {
      tryonBreaker.recordFailure();
    }
    logAiCall({ call: "tryon", upstream: "dashscope", ms: Date.now() - started, ok: false, detail: message.slice(0, 120) });
    const error = new Error(message);
    (error as { upstreamStatus?: number }).upstreamStatus = submit.status;
    throw error;
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
      if (!url) {
        tryonBreaker.recordFailure();
        logAiCall({ call: "tryon", upstream: "dashscope", ms: Date.now() - started, ok: false, detail: "no image in result" });
        throw new Error("试衣成功但没有返回图片");
      }
      tryonBreaker.recordSuccess();
      logAiCall({ call: "tryon", upstream: "dashscope", ms: Date.now() - started, ok: true });
      // 直传模式：返回签名 URL，由浏览器直拉，省服务器出口带宽
      return url;
    }
    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      tryonBreaker.recordFailure();
      logAiCall({ call: "tryon", upstream: "dashscope", ms: Date.now() - started, ok: false, detail: String(data.output?.message || status).slice(0, 120) });
      throw new Error(data.output?.message || `试衣失败（${status}）`);
    }
  }
  tryonBreaker.recordFailure();
  logAiCall({ call: "tryon", upstream: "dashscope", ms: Date.now() - started, ok: false, detail: "poll timeout" });
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
  const started = Date.now();
  try {
    const result = await generateWithApiInner(env, prompt, image, negativePrompt, mode, image2, image3);
    logAiCall({ call: mode, upstream: "siliconflow", ms: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    logAiCall({
      call: mode,
      upstream: "siliconflow",
      ms: Date.now() - started,
      ok: false,
      detail: error instanceof Error ? error.message.slice(0, 120) : undefined,
    });
    throw error;
  }
}

async function generateWithApiInner(
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
    const error = new Error(`upstream ${response.status}: ${text.slice(0, 400)}`);
    (error as { upstreamStatus?: number }).upstreamStatus = response.status;
    throw error;
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
    // 直传模式：上游给 URL 就透传，浏览器直拉
    return first.url;
  }
  throw new Error("no image in upstream response");
}
