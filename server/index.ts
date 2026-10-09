import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { handleApiRequest } from "./api";
import { loadImageEnv } from "./previewApi";

const DIST_DIR = resolve(process.cwd(), "dist");
const PORT = Number(loadImageEnv().PORT || process.env.PORT || 8787);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".task": "application/octet-stream",
  ".wasm": "application/wasm",
};

function serveStatic(res: ServerResponse, urlPath: string) {
  const relative = urlPath.replace(/^\/+/, "") || "index.html";
  let file = normalize(join(DIST_DIR, relative));
  if (!file.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA 回退：非资源路径全部回 index.html
    file = join(DIST_DIR, "index.html");
  }
  res.setHeader("Content-Type", MIME[extname(file)] || "application/octet-stream");
  res.setHeader("Cache-Control", file.endsWith("index.html") ? "no-cache" : "public, max-age=604800");
  createReadStream(file).pipe(res);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/api/preview" || url.startsWith("/api/v1/")) {
    try {
      await handleApiRequest(req, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "internal", message: String(error) } }));
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }
  serveStatic(res, url);
});

server.listen(PORT, () => {
  const env = loadImageEnv();
  console.log(`ai-outfit-preview 已启动: http://127.0.0.1:${PORT}`);
  console.log(
    `  试衣 Key: ${env.DASHSCOPE_API_KEY ? "已配置" : "未配置"} · 图像 Key: ${env.IMAGE_API_KEY ? "已配置" : "未配置"} · 访问令牌: ${env.ACCESS_TOKEN ? "已开启" : "未开启（仅限本机调用）"}`,
  );
});
