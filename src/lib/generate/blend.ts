import type { Category } from "../../types";
import { drawContained, loadImage } from "./image";
import {
  alignGenerated,
  analyzeBody,
  drawFootShadow,
  facePolygon,
  garmentPolygon,
} from "./pose";

const W = 640;
const H = 1136;

const GARMENT_BOX: Record<Category, { x0: number; y0: number; x1: number; y1: number }> = {
  top: { x0: 0.14, y0: 0.18, x1: 0.86, y1: 0.56 },
  outerwear: { x0: 0.08, y0: 0.16, x1: 0.92, y1: 0.7 },
  bottom: { x0: 0.18, y0: 0.46, x1: 0.82, y1: 0.84 },
  dress: { x0: 0.14, y0: 0.18, x1: 0.86, y1: 0.84 },
  shoes: { x0: 0.22, y0: 0.78, x1: 0.78, y1: 1 },
  bag: { x0: 0.58, y0: 0.36, x1: 1, y1: 0.74 },
  accessory: { x0: 0.28, y0: 0.02, x1: 0.72, y1: 0.2 },
};

function paintFitted(ctx: CanvasRenderingContext2D, image: CanvasImageSource, iw?: number, ih?: number) {
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, W, H);
  if (image instanceof HTMLImageElement) {
    drawContained(ctx, image, 0, 0, W, H);
    return;
  }
  const width = iw ?? (image as HTMLCanvasElement).width;
  const height = ih ?? (image as HTMLCanvasElement).height;
  const scale = Math.min(W / width, H / height);
  const dw = width * scale;
  const dh = height * scale;
  ctx.drawImage(image, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function makeCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  return { canvas, ctx };
}

function fillSoftBox(
  ctx: CanvasRenderingContext2D,
  box: { x0: number; y0: number; x1: number; y1: number },
  blurPx: number,
) {
  ctx.filter = `blur(${blurPx}px)`;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(box.x0 * W, box.y0 * H, (box.x1 - box.x0) * W, (box.y1 - box.y0) * H);
  ctx.filter = "none";
}

function fillSoftPoly(ctx: CanvasRenderingContext2D, poly: { x: number; y: number }[], blurPx: number) {
  if (poly.length < 3) return;
  ctx.filter = `blur(${blurPx}px)`;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i += 1) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.filter = "none";
}

function maskedLayer(
  image: CanvasImageSource,
  paintMask: (ctx: CanvasRenderingContext2D) => void,
) {
  const { canvas, ctx } = makeCanvas();
  if (image instanceof HTMLImageElement) {
    paintFitted(ctx, image);
  } else {
    ctx.drawImage(image, 0, 0, W, H);
  }
  ctx.globalCompositeOperation = "destination-in";
  paintMask(ctx);
  return canvas;
}

function fittedCanvas(image: HTMLImageElement) {
  const { canvas, ctx } = makeCanvas();
  paintFitted(ctx, image);
  return canvas;
}

/** Face crop sent as image3 so the editor can keep identity. */
export async function cropIdentityRef(src: string): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, 512, 512);

  const body = await analyzeBody(image);
  if (body) {
    const nose = body.points[0];
    const ls = body.points[11];
    const rs = body.points[12];
    const span = Math.max(0.28, Math.abs(rs.x - ls.x) * 1.35);
    const cutW = image.width * span;
    const cutH = image.height * Math.min(0.4, span * 1.15);
    const sx = Math.max(0, nose.x * image.width - cutW / 2);
    const sy = Math.max(0, nose.y * image.height - cutH * 0.55);
    ctx.drawImage(image, sx, sy, cutW, cutH, 0, 0, 512, 512);
    return canvas.toDataURL("image/png");
  }

  const cutW = image.width * 0.62;
  const cutH = image.height * 0.34;
  const sx = (image.width - cutW) / 2;
  ctx.drawImage(image, sx, 0, cutW, cutH, 0, 0, 512, 512);
  return canvas.toDataURL("image/png");
}

/**
 * Align the generated try-on to the original pose, keep only the garment
 * region (pose polygon ∩ person mask), then stamp the original face and background.
 */
export async function blendTryOn(
  baseSrc: string,
  generatedSrc: string,
  identitySrc: string,
  category: Category,
): Promise<string> {
  const [base, generated, identity] = await Promise.all([
    loadImage(baseSrc),
    loadImage(generatedSrc),
    loadImage(identitySrc),
  ]);
  const { canvas, ctx } = makeCanvas();
  paintFitted(ctx, base);

  const identityFit = fittedCanvas(identity);
  const generatedFit = fittedCanvas(generated);
  const [identityBody, generatedBody] = await Promise.all([
    analyzeBody(identityFit),
    analyzeBody(generatedFit),
  ]);

  let clothingSource: HTMLCanvasElement | HTMLImageElement = generated;
  if (identityBody && generatedBody) {
    clothingSource = alignGenerated(generatedFit, generatedBody.points, identityBody.points, W, H);
  }

  const garment = maskedLayer(clothingSource, (mask) => {
    if (identityBody) {
      fillSoftPoly(mask, garmentPolygon(identityBody.points, category, W, H), 14);
      if (identityBody.personMask) {
        mask.globalCompositeOperation = "destination-in";
        mask.filter = "blur(6px)";
        mask.drawImage(identityBody.personMask, 0, 0, W, H);
        mask.filter = "none";
      }
      return;
    }
    fillSoftBox(mask, GARMENT_BOX[category], 18);
  });
  ctx.drawImage(garment, 0, 0);

  const face = maskedLayer(identity, (mask) => {
    if (identityBody) {
      fillSoftPoly(mask, facePolygon(identityBody.points, W, H), 12);
      return;
    }
    fillSoftBox(mask, { x0: 0.2, y0: 0, x1: 0.8, y1: 0.26 }, 16);
  });
  ctx.drawImage(face, 0, 0);

  if (identityBody?.personMask) {
    const bg = makeCanvas();
    paintFitted(bg.ctx, identity);
    bg.ctx.globalCompositeOperation = "destination-out";
    bg.ctx.filter = "blur(8px)";
    bg.ctx.drawImage(identityBody.personMask, 0, 0, W, H);
    bg.ctx.filter = "none";
    ctx.drawImage(bg.canvas, 0, 0);
  } else {
    const edges = maskedLayer(identity, (mask) => {
      fillSoftBox(mask, { x0: 0, y0: 0, x1: 0.07, y1: 1 }, 10);
      fillSoftBox(mask, { x0: 0.93, y0: 0, x1: 1, y1: 1 }, 10);
      if (category !== "shoes") {
        fillSoftBox(mask, { x0: 0, y0: 0.93, x1: 1, y1: 1 }, 10);
      }
    });
    ctx.globalAlpha = 0.85;
    ctx.drawImage(edges, 0, 0);
    ctx.globalAlpha = 1;
  }

  if (identityBody) {
    drawFootShadow(ctx, identityBody.points, W, H);
  }

  return canvas.toDataURL("image/png");
}
