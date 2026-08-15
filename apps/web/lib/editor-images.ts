import { assetContentURL } from "@/lib/asset-api";

const anyPubAssetPrefix = "anypub-asset://";
const assetIDPattern = /^[0-9a-f-]+$/i;

export function markdownForAnyPubImage(assetID: string, alt: string) {
  if (!assetIDPattern.test(assetID)) {
    throw new TypeError("Invalid AnyPub asset ID.");
  }

  const safeAlt = alt.replace(/[\]\r\n]/g, "");
  return `![${safeAlt}](${anyPubAssetPrefix}${assetID})`;
}

export function anyPubAssetIDFromImageURL(url: string) {
  if (!url.toLowerCase().startsWith(anyPubAssetPrefix)) {
    return undefined;
  }

  const assetID = url.slice(anyPubAssetPrefix.length);
  return assetIDPattern.test(assetID) ? assetID : undefined;
}

export function resolveAnyPubImageURL(url: string) {
  const assetID = anyPubAssetIDFromImageURL(url);
  return assetID ? assetContentURL(assetID) : undefined;
}
