import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

function loadEnv() {
  const out = {};
  const file = resolve(process.cwd(), ".env");
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const PROMPTS = {
  female:
    "Photorealistic full-body fashion photograph of ONE young East Asian woman, standing straight facing the camera, arms relaxed. She wears a plain white fitted t-shirt, beige slim trousers, and simple white sneakers. Seamless light gray studio background, even soft studio lighting, natural skin texture. Entire body in frame: head, torso, legs and shoes visible, small space above head and below shoes. No text, no logo, no collage, no extra people.",
  male:
    "Photorealistic full-body fashion photograph of ONE young East Asian man, standing straight facing the camera, arms relaxed. He wears a plain white t-shirt, dark slim trousers, and simple white sneakers. Seamless light gray studio background, even soft studio lighting, natural skin texture. Entire body in frame: head, torso, legs and shoes visible, small space above head and below shoes. No text, no logo, no collage, no extra people.",
};

async function generateOne(env, gender) {
  const base = (env.IMAGE_API_BASE || "https://api.siliconflow.cn/v1").replace(/\/$/, "");
  const model = env.IMAGE_TXT_MODEL || "Kwai-Kolors/Kolors";
  const response = await fetch(`${base}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.IMAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: PROMPTS[gender],
      negative_prompt:
        "cartoon, illustration, anime, mannequin, close-up, portrait crop, extra people, text, watermark, deformed hands",
      image_size: "720x1280",
      batch_size: 1,
      num_inference_steps: 30,
      guidance_scale: 7,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${gender} generate failed HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  const data = JSON.parse(text);
  const first = data.images?.[0] ?? data.data?.[0];
  if (first?.b64_json) {
    return Buffer.from(first.b64_json, "base64");
  }
  if (first?.url) {
    const img = await fetch(first.url);
    if (!img.ok) throw new Error(`${gender} download failed HTTP ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
  throw new Error(`${gender} generate returned no image`);
}

const env = loadEnv();
if (!env.IMAGE_API_KEY) {
  console.error("IMAGE_API_KEY missing");
  process.exit(1);
}

const dir = resolve(process.cwd(), "public/models");
mkdirSync(dir, { recursive: true });

for (const gender of ["female", "male"]) {
  process.stdout.write(`generating ${gender} model...\n`);
  const bytes = await generateOne(env, gender);
  const webp = await sharp(bytes).resize({ height: 1600 }).webp({ quality: 85 }).toBuffer();
  const dest = resolve(dir, `${gender}.webp`);
  writeFileSync(dest, webp);
  process.stdout.write(`wrote ${dest} (${webp.length} bytes)\n`);
}
