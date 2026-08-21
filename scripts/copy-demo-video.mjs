import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
const files = findWebm(resultsDir).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
if (files.length === 0) {
  console.error("No Playwright webm found under demo/results");
  process.exit(1);
}

mkdirSync(join(process.cwd(), "demo"), { recursive: true });
const dest = join(process.cwd(), "demo", "ai-outfit-demo.webm");
copyFileSync(files[0], dest);
console.log(`Copied ${files[0]} -> ${dest}`);
