export function normalizeHostname(value = "") {
  const first = String(value || "").split(",")[0].trim().toLowerCase();
  if (!first) return "";
  const withoutProtocol = first.replace(/^https?:\/\//, "");
  if (withoutProtocol.startsWith("[")) {
    const end = withoutProtocol.indexOf("]");
    return end > 0 ? withoutProtocol.slice(1, end) : "";
  }
  return withoutProtocol.split(":")[0];
}

export function isAllowedRequestHostname(requestHost, {
  adminHostname = "",
  publicHostname = ""
} = {}) {
  const expectedAdmin = normalizeHostname(adminHostname);
  if (!expectedAdmin) return true;
  return new Set([expectedAdmin, normalizeHostname(publicHostname)].filter(Boolean))
    .has(normalizeHostname(requestHost));
}

export function isAllowedRequestOrigin(source, adminBaseUrl) {
  if (!source) return true;
  try {
    return new URL(source).origin === new URL(adminBaseUrl).origin;
  } catch {
    return false;
  }
}
