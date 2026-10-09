const DB_NAME = "ai-outfit-preview";
const STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putImage(imageId: string, blob: Blob) {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).put(blob, imageId));
  } finally {
    db.close();
  }
}

export async function getImage(imageId: string): Promise<Blob | undefined> {
  const db = await openDb();
  try {
    return await requestToPromise(db.transaction(STORE).objectStore(STORE).get(imageId));
  } finally {
    db.close();
  }
}

export async function deleteImage(imageId: string) {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).delete(imageId));
  } finally {
    db.close();
  }
}

export async function clearImages() {
  const db = await openDb();
  try {
    await requestToPromise(db.transaction(STORE, "readwrite").objectStore(STORE).clear());
  } finally {
    db.close();
  }
}

export async function listImageKeys(): Promise<string[]> {
  const db = await openDb();
  try {
    const keys = await requestToPromise<IDBValidKey[]>(
      db.transaction(STORE).objectStore(STORE).getAllKeys(),
    );
    return keys.map(String);
  } finally {
    db.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/png";
  const bytes = atob(data);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    buffer[i] = bytes.charCodeAt(i);
  }
  return new Blob([buffer], { type: mime });
}

export async function blobFromUrl(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}`);
  }
  return response.blob();
}
