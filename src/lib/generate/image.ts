function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:\/\//i.test(src)) {
      image.crossOrigin = "anonymous";
    }
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src.slice(0, 48)}`));
    image.src = src;
  });
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** SiliconFlow LoadImage accepts data:image/png;base64,... not raw/jpeg paths. */
export async function toPngDataUrl(src: string, maxW = 640, maxH = 1136): Promise<string> {
  const image = await loadImage(src);
  const scale = Math.min(1, maxW / image.width, maxH / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export const toJpegDataUrl = toPngDataUrl;

export async function toCompactJpeg(src: string, maxW = 1024, maxH = 1536, quality = 0.86) {
  const image = await loadImage(src);
  const scale = Math.min(1, maxW / image.width, maxH / image.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function whitenProductBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  const corners = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of corners) {
    const i = at(x, y);
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  r /= 4;
  g /= 4;
  b /= 4;
  if (0.299 * r + 0.587 * g + 0.114 * b < 175) return;

  const similar = (i: number) => {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    return dr * dr + dg * dg + db * db < 52 * 52;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x += 1) {
    stack.push(x, 0, x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    stack.push(0, y, w - 1, y);
  }
  while (stack.length > 0) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const p = y * w + x;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!similar(i)) continue;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  ctx.putImageData(img, 0, 0);
}

/** Put one garment on a clean white card. No labels. */
export async function isolateGarment(src: string): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawContained(ctx, image, 36, 36, 568, 568);
  whitenProductBackground(ctx, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** Fallback when the edit model only accepts one image. */
export async function composePersonGarment(personSrc: string, garmentSrc: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const person = await loadImage(personSrc);
  const garment = await loadImage(garmentSrc);
  drawContained(ctx, person, 16, 16, 500, 992);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(528, 280, 224, 280);
  drawContained(ctx, garment, 540, 292, 200, 256);
  return canvas.toDataURL("image/png");
}

export { loadImage, drawContained };
