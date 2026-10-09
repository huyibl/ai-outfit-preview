// 一次性资源瘦身：把 public 下的模特图/示例衣压缩为 webp。
// 用法：node scripts/optimize-assets.mjs [--force]
// 转换后删除原 png/jpg；引用路径已在 src/lib/models.ts 与 src/lib/seed.ts 改为 .webp。
import { existsSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const MODELS = ["public/models/female", "public/models/male"];
const SEEDS = [
  "public/seed/coat-red",
  "public/seed/jacket-orange",
  "public/seed/jacket-plaid",
  "public/seed/skirt-grey",
  "public/seed/shoes-white",
  "public/seed/bag-black",
];

const force = process.argv.includes("--force");

async function convert(base, { height, quality, alpha }) {
  const sources = [`${base}.png`, `${base}.jpg`, `${base}.jpeg`]
    .map((file) => resolve(file))
    .filter((file) => existsSync(file));
  if (sources.length === 0) return;
  const target = resolve(`${base}.webp`);
  if (existsSync(target) && !force) {
    console.log(`跳过（已存在）: ${target}`);
    return;
  }
  let pipeline = sharp(sources[0]).rotate();
  if (height) pipeline = pipeline.resize({ height });
  else pipeline = pipeline.resize({ width: 800, height: 800, fit: "inside" });
  const info = await pipeline.webp({ quality, alphaQuality: alpha ? 90 : undefined }).toFile(target);
  console.log(
    `${sources[0]} (${(statSync(sources[0]).size / 1024).toFixed(0)}KB) -> ${target} (${(info.size / 1024).toFixed(0)}KB)`,
  );
  for (const file of sources) {
    if (file !== target) unlinkSync(file);
  }
}

for (const base of MODELS) {
  await convert(base, { height: 1600, quality: 85, alpha: true });
}
for (const base of SEEDS) {
  await convert(base, { quality: 82, alpha: false });
}
