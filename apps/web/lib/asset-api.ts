import type { CoverAsset } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export async function uploadImage(accountDID: string, file: File, altText?: string) {
  const dimensions = await imageDimensions(file);
  const body = new FormData();
  body.append("accountDID", accountDID);
  body.append("file", file);
  if (altText) body.append("altText", altText);
  body.append("width", String(dimensions.width));
  body.append("height", String(dimensions.height));

  const response = await fetch(`${API_BASE}/api/assets/upload`, {
    method: "POST",
    credentials: "include",
    headers: { accept: "application/json" },
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { reason?: string } | null;
    throw new Error(payload?.reason ?? `Image upload failed: ${response.status}`);
  }
  return response.json() as Promise<CoverAsset>;
}

export function assetContentURL(assetID: string) {
  return `${API_BASE}/api/assets/${encodeURIComponent(assetID)}/content`;
}

function imageDimensions(file: File) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected file is not a readable image."));
    };
    image.src = url;
  });
}
