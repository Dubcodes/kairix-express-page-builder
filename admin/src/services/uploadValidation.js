import fs from "node:fs";
import path from "node:path";

export function isSafeSvgText(value) {
  const text = String(value || "").replace(/^\uFEFF/, "").trim();
  if (!/<svg\b/i.test(text)) return false;
  if (/<(?:script|style|foreignObject|iframe|object|embed|link|meta|base)\b/i.test(text)) return false;
  if (/\son[a-z]+\s*=/i.test(text)) return false;
  if (/(?:javascript:|data:|<!DOCTYPE|<!ENTITY|@import|expression\s*\()/i.test(text)) return false;
  if (/(?:href|xlink:href)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(text)) return false;
  if (/url\s*\(\s*["']?\s*(?:https?:|\/\/|data:|javascript:)/i.test(text)) return false;
  return true;
}

export function uploadContentMatchesExtension(file, readFileSync = fs.readFileSync) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = readFileSync(file.path);
  const starts = (...bytes) => bytes.every((byte, index) => buffer[index] === byte);
  if ([".bin", ".hex", ".uf2"].includes(ext)) return true;
  if (ext === ".jpg" || ext === ".jpeg") return starts(0xff, 0xd8, 0xff);
  if (ext === ".png") return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  if (ext === ".ico") return starts(0x00, 0x00, 0x01, 0x00);
  if (ext === ".gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  if (ext === ".webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (ext === ".pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (ext === ".zip") return starts(0x50, 0x4b) && [0x03, 0x05, 0x07].includes(buffer[2]) && [0x04, 0x06, 0x08].includes(buffer[3]);
  if (ext === ".exe") return starts(0x4d, 0x5a);
  if (ext === ".msi") return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  if (ext === ".pkg") return buffer.subarray(0, 4).toString("ascii") === "xar!";
  if (ext === ".dmg") return buffer.length >= 512 && buffer.subarray(buffer.length - 512, buffer.length - 508).toString("ascii") === "koly";
  if (ext === ".txt") return !buffer.includes(0);
  if (ext === ".svg") return isSafeSvgText(buffer.toString("utf8"));
  return false;
}
