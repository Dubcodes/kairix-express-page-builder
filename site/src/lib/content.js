import { sampleContent } from "../data/sampleContent.js";
import fs from "node:fs";
import path from "node:path";

let exportedContent = null;

try {
  const contentPath = path.resolve(process.cwd(), "src", "data", "content.json");
  exportedContent = fs.existsSync(contentPath)
    ? JSON.parse(fs.readFileSync(contentPath, "utf8"))
    : sampleContent;
} catch {
  exportedContent = sampleContent;
}

export const content = exportedContent;

function cleanBasePath() {
  const base = String(content.siteBasePath || "").trim();
  if (!base || base === "/") return "";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}

export function isExternalUrl(value) {
  return typeof value === "string" && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function shouldPassThrough(value) {
  if (!value) return true;
  if (typeof value !== "string") return false;
  return value.startsWith("#") || isExternalUrl(value);
}

export function sitePath(value) {
  if (!value) return "";
  if (shouldPassThrough(value)) return value;
  const base = cleanBasePath();
  const pathValue = String(value);
  const path = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  if (!base) return path;
  if (path === "/") return `${base}/`;
  return `${base}${path}`.replace(/\/{2,}/g, "/");
}

export function assetPath(value) {
  if (!value) return "";
  if (shouldPassThrough(value)) return value;
  return sitePath(value);
}

export function productImage(product) {
  return assetPath(product.image || product.gallery?.[0] || "");
}

export function downloadsByType() {
  const order = ["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"];
  return order.map((type) => ({
    type,
    downloads: content.downloads.filter((download) => download.type === type)
  })).filter((group) => group.downloads.length > 0);
}

export function trackScript(eventType, payload = {}) {
  return `
    window.KAIRIX_TRACK = window.KAIRIX_TRACK || function(type, data) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: type, path: location.pathname, ...(data || {}) })
      }).catch(function() {});
    };
    window.KAIRIX_TRACK(${JSON.stringify(eventType)}, ${JSON.stringify(payload)});
  `;
}
