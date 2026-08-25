import type { ClothingItem } from "../../types";
import { drawContained, loadImage } from "./image";

function drawMannequin(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#f4efe6");
  gradient.addColorStop(1, "#e4d5c3");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#d7c4b0";
  ctx.beginPath();
  ctx.ellipse(width / 2, 92, 38, 46, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(width / 2 - 70, 150);
  ctx.lineTo(width / 2 + 70, 150);
  ctx.lineTo(width / 2 + 58, 390);
  ctx.lineTo(width / 2 - 58, 390);
  ctx.closePath();
  ctx.fill();

  ctx.fillRect(width / 2 - 48, 390, 36, 210);
  ctx.fillRect(width / 2 + 12, 390, 36, 210);
}

const LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  accessory: { x: 190, y: 28, w: 160, h: 90 },
  outerwear: { x: 95, y: 128, w: 350, h: 280 },
  top: { x: 130, y: 145, w: 280, h: 230 },
  dress: { x: 120, y: 145, w: 300, h: 360 },
  bottom: { x: 145, y: 360, w: 250, h: 230 },
  shoes: { x: 155, y: 575, w: 230, h: 130 },
  bag: { x: 390, y: 300, w: 140, h: 160 },
};

export async function mockCollage(
  items: ClothingItem[],
  imageUrls: Record<string, string>,
  modelSrc?: string,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 540;
  canvas.height = 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas unsupported");
  }

  if (modelSrc) {
    try {
      const model = await loadImage(modelSrc);
      ctx.fillStyle = "#f3f2ee";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawContained(ctx, model, 0, 0, canvas.width, canvas.height);
    } catch {
      drawMannequin(ctx, canvas.width, canvas.height);
    }
  } else {
    drawMannequin(ctx, canvas.width, canvas.height);
  }

  const order = ["bottom", "top", "dress", "outerwear", "shoes", "bag", "accessory"] as const;
  const sorted = [...items].sort(
    (a, b) => order.indexOf(a.category) - order.indexOf(b.category),
  );

  for (const item of sorted) {
    const src = imageUrls[item.imageId];
    const box = LAYOUT[item.category];
    if (!src || !box) continue;
    try {
      const image = await loadImage(src);
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 18;
      drawContained(ctx, image, box.x, box.y, box.w, box.h);
      ctx.restore();
    } catch {
      // skip broken image
    }
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}
