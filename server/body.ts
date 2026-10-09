import type { IncomingMessage } from "node:http";
import { ApiError } from "./errors";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export async function readBodyLimited(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > maxBytes) {
      throw new ApiError("payload_too_large", `请求体超过 ${Math.round(maxBytes / 1024)}KB 上限`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}
