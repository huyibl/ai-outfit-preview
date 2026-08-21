import type { BackupFile, ClothingItem, Outfit } from "../types";
import { blobToDataUrl, clearImages, dataUrlToBlob, getImage, putImage } from "./db";

export async function exportBackup(items: ClothingItem[], outfits: Outfit[]): Promise<BackupFile> {
  const images: Record<string, string> = {};
  for (const item of items) {
    const blob = await getImage(item.imageId);
    if (blob) {
      images[item.imageId] = await blobToDataUrl(blob);
    }
  }
  return { version: 1, items, outfits, images };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importBackup(raw: string): Promise<{
  items: ClothingItem[];
  outfits: Outfit[];
  imageUrls: Record<string, string>;
}> {
  const parsed = JSON.parse(raw) as BackupFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.items) || !parsed.images) {
    throw new Error("备份格式不正确");
  }
  await clearImages();
  const imageUrls: Record<string, string> = {};
  for (const [imageId, dataUrl] of Object.entries(parsed.images)) {
    const blob = dataUrlToBlob(dataUrl);
    await putImage(imageId, blob);
    imageUrls[imageId] = URL.createObjectURL(blob);
  }
  return {
    items: parsed.items,
    outfits: Array.isArray(parsed.outfits) ? parsed.outfits : [],
    imageUrls,
  };
}
