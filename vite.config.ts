import { createReadStream, cpSync, existsSync, mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApiRequest } from "./server/api";

function previewApiPlugin() {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== "/api/preview" && !url.startsWith("/api/v1/")) {
      next();
      return;
    }
    try {
      await handleApiRequest(req, res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: "internal", message: String(error) } }));
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

function mediapipeWasmPlugin() {
  const wasmDir = resolve(process.cwd(), "node_modules/@mediapipe/tasks-vision/wasm");
  const mime: Record<string, string> = {
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
  };
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith("/mediapipe-wasm/")) {
      next();
      return;
    }
    const name = req.url.slice("/mediapipe-wasm/".length).split("?")[0];
    const file = resolve(wasmDir, name);
    if (!file.startsWith(wasmDir) || !existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
    createReadStream(file).pipe(res);
  };
  return {
    name: "mediapipe-wasm",
    configureServer(server: { middlewares: { use: (fn: typeof handler) => void } }) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: typeof handler) => void } }) {
      server.middlewares.use(handler);
    },
    closeBundle() {
      const dest = resolve(process.cwd(), "dist/mediapipe-wasm");
      if (!existsSync(wasmDir)) return;
      mkdirSync(dest, { recursive: true });
      cpSync(wasmDir, dest, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), previewApiPlugin(), mediapipeWasmPlugin()],
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    include: ["@mediapipe/tasks-vision"],
  },
});
