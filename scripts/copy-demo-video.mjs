import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join } from "node:path";

function findWebm(dir) {
  const found = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      found.push(...findWebm(full));
    } else if (name.name.endsWith(".webm")) {
      found.push(full);
    }
  }
  return found;
}

const resultsDir = join(process.cwd(), "demo", "results");
let files = [];
try {
  files = findWebm(resultsDir).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
} catch {
  files = [];
}
if (files.length === 0) {
  console.log("No Playwright webm found; using docs/*.png screenshots for README.");
  process.exit(0);
}

mkdirSync(join(process.cwd(), "demo"), { recursive: true });
mkdirSync(join(process.cwd(), "docs"), { recursive: true });
const dest = join(process.cwd(), "demo", "ai-outfit-demo.webm");
copyFileSync(files[0], dest);
console.log(`Copied ${files[0]} -> ${dest}`);

const ffmpeg = execSync("npx --yes ffmpeg-static", { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .at(-1);
if (!ffmpeg) {
  console.warn("ffmpeg-static not available; skipped docs/tryon-demo.mp4");
  process.exit(0);
}

const mp4 = join(process.cwd(), "docs", "tryon-demo.mp4");
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    dest,
    "-an",
    "-vf",
    "scale=960:-2,fps=16,setpts=0.75*PTS",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "28",
    "-movflags",
    "+faststart",
    mp4,
  ],
  { stdio: "inherit" },
);
console.log(`Wrote ${mp4}`);
