import fs from "node:fs";

function trailingNewlinesRemoved(value) {
  return String(value).replace(/(?:\r\n|\r|\n)+$/g, "");
}

export function resolveSecret(name, {
  env = process.env,
  readFileSync = fs.readFileSync
} = {}) {
  const fileVariable = `${name}_FILE`;
  const configuredPath = String(env[fileVariable] ?? "").trim();
  if (configuredPath) {
    let contents;
    try {
      contents = readFileSync(configuredPath, "utf8");
    } catch (error) {
      const reason = error?.code === "ENOENT" ? "does not exist" : "could not be read";
      throw new Error(`${fileVariable} ${reason}.`);
    }
    const secret = trailingNewlinesRemoved(contents);
    if (!secret.length) throw new Error(`${fileVariable} is empty.`);
    return secret;
  }
  return env[name] === undefined ? "" : String(env[name]);
}
