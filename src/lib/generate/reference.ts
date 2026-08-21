import type { ClothingItem } from "../../types";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`failed to load ${src}`));
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

export async function composeReferenceBoard(
  modelSrc: string,
  items: ClothingItem[],
  imageUrls: Record<string, string>,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");

  ctx.fillStyle = "#eeeae3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const model = await loadImage(modelSrc);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(24, 24, 460, 1232);
  drawContained(ctx, model, 24, 24, 460, 1232);

  ctx.fillStyle = "#6b7280";
  ctx.font = "600 16px sans-serif";
  ctx.fillText("MODEL", 40, 48);

  const stripX = 500;
  let y = 24;
  for (const item of items.slice(0, 6)) {
    const src = imageUrls[item.imageId];
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(stripX, y, 196, 150);
    if (src) {
      try {
        const img = await loadImage(src);
        drawContained(ctx, img, stripX + 8, y + 8, 180, 110);
      } catch {
        // skip
      }
    }
    ctx.fillStyle = "#374151";
    ctx.font = "12px sans-serif";
    ctx.fillText(item.name.slice(0, 12), stripX + 10, y + 138);
    y += 162;
  }

  return canvas.toDataURL("image/png");
}
