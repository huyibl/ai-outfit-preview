import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Category } from "../../types";

export type BodyPoint = { x: number; y: number; v: number };

export interface BodyAnalysis {
  points: BodyPoint[];
  personMask: HTMLCanvasElement | null;
}

const WASM_CANDIDATES = ["/mediapipe-wasm", "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"];
const MODEL_PATH = "/mediapipe/pose_landmarker_lite.task";

const I = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
};

let landmarkerPromise: Promise<PoseLandmarker | null> | null = null;

async function createLandmarker(): Promise<PoseLandmarker | null> {
  for (const wasmPath of WASM_CANDIDATES) {
    try {
      const fileset = await FilesetResolver.forVisionTasks(wasmPath);
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        outputSegmentationMasks: true,
      });
    } catch {
      // try next wasm host
    }
  }
  return null;
}

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker();
  }
  return landmarkerPromise;
}

function maskToCanvas(mask: { width: number; height: number; getAsFloat32Array: () => Float32Array; getAsUint8Array: () => Uint8Array; hasFloat32Array: () => boolean }, w: number, h: number) {
  const src = mask.hasFloat32Array() ? mask.getAsFloat32Array() : mask.getAsUint8Array();
  const mw = mask.width;
  const mh = mask.height;
  const tmp = document.createElement("canvas");
  tmp.width = mw;
  tmp.height = mh;
  const tctx = tmp.getContext("2d");
  if (!tctx) return null;
  const img = tctx.createImageData(mw, mh);
  const isFloat = src instanceof Float32Array;
  for (let i = 0; i < mw * mh; i += 1) {
    const v = isFloat ? (src as Float32Array)[i] : (src as Uint8Array)[i] / 255;
    const a = v > 0.35 ? 255 : 0;
    const o = i * 4;
    img.data[o] = 255;
    img.data[o + 1] = 255;
    img.data[o + 2] = 255;
    img.data[o + 3] = a;
  }
  tctx.putImageData(img, 0, 0);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, w, h);
  return canvas;
}

export async function analyzeBody(image: HTMLImageElement | HTMLCanvasElement): Promise<BodyAnalysis | null> {
  const landmarker = await getLandmarker();
  if (!landmarker) return null;
  try {
    const result = landmarker.detect(image);
    const pose = result.landmarks[0];
    if (!pose || pose.length < 29) {
      result.close();
      return null;
    }
    const points = pose.map((p) => ({ x: p.x, y: p.y, v: p.visibility }));
    const w = "width" in image && typeof image.width === "number" ? image.width : (image as HTMLCanvasElement).width;
    const h = "height" in image && typeof image.height === "number" ? image.height : (image as HTMLCanvasElement).height;
    const mask = result.segmentationMasks?.[0]
      ? maskToCanvas(result.segmentationMasks[0], w, h)
      : null;
    result.close();
    if ((points[I.lShoulder].v ?? 0) < 0.35 || (points[I.rShoulder].v ?? 0) < 0.35) {
      return null;
    }
    return { points, personMask: mask };
  } catch {
    return null;
  }
}

function px(points: BodyPoint[], index: number, w: number, h: number) {
  return { x: points[index].x * w, y: points[index].y * h };
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function expandPoly(points: { x: number; y: number }[], pad: number) {
  const c = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  c.x /= points.length;
  c.y /= points.length;
  return points.map((p) => ({
    x: c.x + (p.x - c.x) * pad,
    y: c.y + (p.y - c.y) * pad,
  }));
}

export function garmentPolygon(points: BodyPoint[], category: Category, w: number, h: number) {
  const p = (i: number) => px(points, i, w, h);
  const ls = p(I.lShoulder);
  const rs = p(I.rShoulder);
  const lh = p(I.lHip);
  const rh = p(I.rHip);
  const lk = p(I.lKnee);
  const rk = p(I.rKnee);
  const la = p(I.lAnkle);
  const ra = p(I.rAnkle);
  const le = p(I.lElbow);
  const re = p(I.rElbow);
  const rw = p(I.rWrist);
  const nose = p(I.nose);

  let poly: { x: number; y: number }[];
  switch (category) {
    case "top":
      poly = [ls, rs, rh, lh];
      return expandPoly(poly, 1.28);
    case "outerwear":
      poly = [ls, rs, re, rh, lh, le];
      return expandPoly(poly, 1.32);
    case "bottom":
      poly = [lh, rh, rk, ra, la, lk];
      return expandPoly(poly, 1.22);
    case "dress":
      poly = [ls, rs, ra, la];
      return expandPoly(poly, 1.26);
    case "shoes":
      poly = [
        { x: la.x - 40, y: la.y - 36 },
        { x: ra.x + 40, y: ra.y - 36 },
        { x: ra.x + 48, y: ra.y + 70 },
        { x: la.x - 48, y: la.y + 70 },
      ];
      return poly;
    case "bag":
      poly = [
        { x: rw.x - 20, y: rw.y - 30 },
        { x: rh.x + 90, y: rh.y - 40 },
        { x: rh.x + 90, y: rh.y + 90 },
        { x: rw.x - 10, y: rw.y + 80 },
      ];
      return poly;
    case "accessory":
      poly = [
        { x: nose.x - 70, y: nose.y - 90 },
        { x: nose.x + 70, y: nose.y - 90 },
        { x: nose.x + 70, y: nose.y + 40 },
        { x: nose.x - 70, y: nose.y + 40 },
      ];
      return poly;
    default:
      return expandPoly([ls, rs, rh, lh], 1.2);
  }
}

export function facePolygon(points: BodyPoint[], w: number, h: number) {
  const nose = px(points, I.nose, w, h);
  const ls = px(points, I.lShoulder, w, h);
  const rs = px(points, I.rShoulder, w, h);
  const shoulderY = Math.min(ls.y, rs.y);
  const width = Math.abs(rs.x - ls.x) * 0.85;
  return [
    { x: nose.x - width, y: 0 },
    { x: nose.x + width, y: 0 },
    { x: nose.x + width, y: shoulderY - 8 },
    { x: nose.x - width, y: shoulderY - 8 },
  ];
}

export function alignGenerated(
  generated: HTMLCanvasElement,
  src: BodyPoint[],
  dst: BodyPoint[],
  w: number,
  h: number,
) {
  const srcS = mid(px(src, I.lShoulder, w, h), px(src, I.rShoulder, w, h));
  const dstS = mid(px(dst, I.lShoulder, w, h), px(dst, I.rShoulder, w, h));
  const srcH = mid(px(src, I.lHip, w, h), px(src, I.rHip, w, h));
  const dstH = mid(px(dst, I.lHip, w, h), px(dst, I.rHip, w, h));
  const srcDx = srcH.x - srcS.x;
  const srcDy = srcH.y - srcS.y;
  const dstDx = dstH.x - dstS.x;
  const dstDy = dstH.y - dstS.y;
  const srcLen = Math.hypot(srcDx, srcDy) || 1;
  const dstLen = Math.hypot(dstDx, dstDy) || 1;
  const scale = dstLen / srcLen;
  const angle = Math.atan2(dstDy, dstDx) - Math.atan2(srcDy, srcDx);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return generated;
  ctx.fillStyle = "#f3f2ee";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(dstS.x, dstS.y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.translate(-srcS.x, -srcS.y);
  ctx.drawImage(generated, 0, 0);
  return canvas;
}

export function drawFootShadow(ctx: CanvasRenderingContext2D, points: BodyPoint[], w: number, h: number) {
  const la = px(points, I.lAnkle, w, h);
  const ra = px(points, I.rAnkle, w, h);
  const c = mid(la, ra);
  ctx.save();
  ctx.fillStyle = "rgba(30, 20, 10, 0.18)";
  ctx.beginPath();
  ctx.ellipse(c.x, Math.min(h - 12, c.y + 18), Math.abs(ra.x - la.x) * 0.85 + 28, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export { I as poseIndex };
