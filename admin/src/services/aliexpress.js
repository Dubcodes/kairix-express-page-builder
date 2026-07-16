import crypto from "node:crypto";
import { config } from "../config.js";

function validatedEndpoint(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.username || url.password) throw new Error(`${label} must not contain URL credentials`);
  if (process.env.NODE_ENV === "production") {
    const hostname = url.hostname.toLowerCase();
    const officialHost = hostname === "aliexpress.com" || hostname.endsWith(".aliexpress.com") || hostname === "aliexpress.us" || hostname.endsWith(".aliexpress.us");
    if (url.protocol !== "https:" || !officialHost) {
      throw new Error(`${label} must use HTTPS on an official AliExpress hostname in production`);
    }
  } else if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return url;
}

async function boundedFetch(url, options) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw new Error("AliExpress request timed out");
    throw new Error("AliExpress request failed");
  }
}

export function buildAuthUrl(connection, state) {
  const authUrl = connection.auth_base_url || config.aliexpressAuthUrl;
  if (!authUrl) {
    const error = new Error("AliExpress auth endpoint is not configured");
    error.code = "setup_required";
    throw error;
  }
  const url = validatedEndpoint(authUrl, "AliExpress auth endpoint");
  url.searchParams.set("client_id", connection.app_key || "");
  url.searchParams.set("redirect_uri", `${config.adminBaseUrl.replace(/\/$/, "")}/api/integrations/aliexpress/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCodeForToken(connection, code) {
  const tokenUrl = connection.token_base_url || config.aliexpressTokenUrl;
  if (!tokenUrl) {
    const error = new Error("AliExpress token endpoint is not configured");
    error.code = "setup_required";
    throw error;
  }
  const response = await boundedFetch(validatedEndpoint(tokenUrl, "AliExpress token endpoint"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: connection.app_key || "",
      client_secret: connection.app_secret || "",
      redirect_uri: `${config.adminBaseUrl.replace(/\/$/, "")}/api/integrations/aliexpress/callback`
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error_description || json.error || "AliExpress token exchange failed");
  return json;
}

export function signRequest(params, secret) {
  const text = Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key] ?? ""}`)
    .join("");
  return crypto.createHmac("sha256", secret || "").update(text).digest("hex").toUpperCase();
}

export async function callAliExpressApi(connection, method, params = {}) {
  const apiUrl = connection.api_base_url || config.aliexpressApiUrl;
  if (!connection.enabled || !connection.app_key) {
    const error = new Error("AliExpress connection is not enabled or missing an app key");
    error.code = "setup_required";
    throw error;
  }
  if (!apiUrl) {
    const error = new Error("AliExpress API endpoint is not configured");
    error.code = "setup_required";
    throw error;
  }
  const signed = {
    ...params,
    method,
    app_key: connection.app_key,
    timestamp: new Date().toISOString(),
    sign_method: "sha256",
    access_token: connection.access_token || ""
  };
  signed.sign = signRequest(signed, connection.app_secret || "");
  const response = await boundedFetch(validatedEndpoint(apiUrl, "AliExpress API endpoint"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(signed)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.error_response) throw new Error(json.error_response?.msg || json.error_description || json.error || "AliExpress API request failed");
  return json;
}

export function fetchProductList(connection, params = {}) {
  return callAliExpressApi(connection, "aliexpress.solution.seller.product.list.get", params);
}

export function fetchProductInfo(connection, params = {}) {
  return callAliExpressApi(connection, "aliexpress.solution.product.info.get", params);
}

export async function testConnection(connection) {
  const result = await fetchProductList(connection, { page_size: 1, current_page: 1 });
  return { ok: true, result };
}

export function normalizeAliExpressProduct(raw = {}) {
  const id = raw.product_id || raw.item_id || raw.id || raw.productId || "";
  const title = raw.subject || raw.title || raw.product_title || raw.name || "";
  const url = raw.product_detail_url || raw.product_url || raw.url || "";
  const image = raw.image_url || raw.product_main_image_url || raw.main_image || "";
  return {
    externalId: String(id),
    title: String(title),
    sku: String(raw.sku_code || raw.sku || ""),
    imageUrl: String(image),
    productUrl: String(url),
    price: raw.sale_price || raw.price || "",
    stockCount: Number.isFinite(Number(raw.stock)) ? Number(raw.stock) : null,
    raw
  };
}
