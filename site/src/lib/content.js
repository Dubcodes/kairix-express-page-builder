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

export function stockLabel(product) {
  if (!product?.stock_tracking) return "";
  if (product.stock_display_mode === "hidden") return "";
  if (product.stock_count === null || product.stock_count === undefined || product.stock_count === "") return "Check marketplace listing";
  const count = Number(product.stock_count);
  if (product.stock_display_mode === "exact") return `${count} in stock`;
  if (count <= 0) return "Out of stock";
  if (count <= 4) return "Almost out of stock";
  if (count <= 14) return "Low stock";
  return "10+ available";
}

export function downloadsByType() {
  const order = ["Android", "iOS", "Windows", "Mac", "Firmware", "Manual", "Other"];
  return order.map((type) => ({
    type,
    downloads: content.downloads.filter((download) => download.type === type)
  })).filter((group) => group.downloads.length > 0);
}

export function trackScript(eventType, payload = {}) {
  if (!content.runtimeApiEnabled) return "";
  return `
    window.KAIRIX_TRACK = window.KAIRIX_TRACK || function(type, data) {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: type, path: location.pathname, ...(data || {}) })
      }).catch(function() {});
    };
    if (!window.KAIRIX_TRACK_BOUND) {
      window.KAIRIX_TRACK_BOUND = true;
      document.querySelectorAll('[data-track-download]').forEach(function(link) {
        link.addEventListener('click', function() {
          window.KAIRIX_TRACK('download_click', { downloadId: Number(link.dataset.trackDownload || 0) });
        });
      });
      document.querySelectorAll('[data-track-marketplace]').forEach(function(link) {
        link.addEventListener('click', function() {
          window.KAIRIX_TRACK('marketplace_click', { productId: Number(link.dataset.trackMarketplace || 0) });
        });
      });
      document.querySelectorAll('[data-track-software-bundle]').forEach(function(link) {
        link.addEventListener('click', function() {
          window.KAIRIX_TRACK('software_bundle_download', { metadata: { bundleId: Number(link.dataset.trackSoftwareBundle || 0) } });
        });
      });
    }
    window.KAIRIX_TRACK(${JSON.stringify(eventType)}, ${JSON.stringify(payload)});
  `;
}
