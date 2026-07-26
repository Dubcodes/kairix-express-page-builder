import { redactSecrets } from "../providers/deploy.js";

const ansiPattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const secretNamePattern = /(?:secret|token|password|credential|private[_-]?key|api[_-]?key)/i;

export function stripDiagnosticAnsi(value) {
  return String(value || "").replace(ansiPattern, "");
}

export function configuredDiagnosticSecrets(env = process.env, extras = []) {
  const environmentSecrets = Object.entries(env)
    .filter(([name, value]) => secretNamePattern.test(name) && String(value || "").length >= 4)
    .map(([, value]) => String(value));
  return [...new Set([...extras, ...environmentSecrets].filter((value) => String(value || "").length >= 4))];
}

function diagnosticProcessError(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current.stderr || current.stdout || Number.isInteger(current.code)) return current;
    current = current.cause;
  }
  return error;
}

function excerpt(value, limit) {
  return stripDiagnosticAnsi(value)
    .replace(/\r?\n+/g, " | ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function ensureSafePublishError(error) {
  if (error && !error.publicMessage) {
    error.publicMessage = "Publish failed. Review the redacted server diagnostics.";
  }
  return error;
}

export function formatPublishFailure({
  jobId,
  stage,
  error,
  env = process.env,
  secrets = [],
  maxLength = 4_000
}) {
  const processError = diagnosticProcessError(error);
  const exitCode = Number.isInteger(processError?.code) ? processError.code : null;
  const stderr = excerpt(processError?.stderr, 2_800);
  const stdout = excerpt(processError?.stdout, 800);
  const message = excerpt(error?.message || error, 1_000);
  const details = [
    stderr ? `stderr: ${stderr}` : "",
    stdout ? `stdout: ${stdout}` : "",
    !stderr && !stdout ? message : ""
  ].filter(Boolean).join(" | ");
  const prefix = `[publish ${jobId}] ${stage} failed${exitCode === null ? "" : ` (exit ${exitCode})`}: `;
  return redactSecrets(
    `${prefix}${details || "No subprocess diagnostic was captured."}`,
    configuredDiagnosticSecrets(env, secrets)
  ).slice(0, maxLength);
}
