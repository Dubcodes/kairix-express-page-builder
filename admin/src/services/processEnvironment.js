const sensitiveNamePattern = /(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|CREDENTIAL)/i;
const secretFileNames = new Set([
  "SESSION_SECRET_FILE",
  "ENCRYPTION_SECRET_FILE",
  "CLOUDFLARE_API_TOKEN_FILE"
]);

export function sanitizedChildEnvironment(base = process.env, overrides = {}) {
  const safe = {};
  for (const [name, value] of Object.entries(base || {})) {
    if (sensitiveNamePattern.test(name) || secretFileNames.has(name)) continue;
    safe[name] = value;
  }
  return { ...safe, ...overrides };
}
