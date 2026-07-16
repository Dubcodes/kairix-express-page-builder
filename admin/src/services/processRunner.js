import { spawn } from "node:child_process";

export class ProcessExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ProcessExecutionError";
    Object.assign(this, details);
  }
}

function appendBounded(current, chunk, limit) {
  if (current.length >= limit) return current;
  return current + chunk.toString().slice(0, limit - current.length);
}

export function runProcess(command, args, {
  cwd,
  env = process.env,
  timeoutMs = 10 * 60 * 1000,
  maxOutputBytes = 256 * 1024,
  spawnImpl = spawn,
  signal
} = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawnImpl(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let forceKillTimer;
    let timedOut = false;
    let aborted = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      handler(value);
    };

    const onAbort = () => {
      aborted = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceKillTimer.unref?.();
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
      forceKillTimer.unref?.();
    }, timeoutMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk, maxOutputBytes);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk, maxOutputBytes);
    });
    child.on("error", (error) => finish(reject, new ProcessExecutionError("Unable to start process.", {
      code: error.code || "PROCESS_START_FAILED",
      cause: error,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt
    })));
    child.on("close", (code, signal) => {
      const result = { code, signal, stdout, stderr, durationMs: Date.now() - startedAt };
      if (aborted) {
        finish(reject, new ProcessExecutionError("Process was cancelled.", {
          ...result,
          code: "PROCESS_ABORTED",
          aborted: true
        }));
        return;
      }
      if (timedOut) {
        finish(reject, new ProcessExecutionError("Process timed out.", {
          ...result,
          code: "PROCESS_TIMEOUT",
          timedOut: true
        }));
        return;
      }
      if (code === 0) finish(resolve, result);
      else finish(reject, new ProcessExecutionError(`Process exited with code ${code ?? "unknown"}.`, result));
    });
  });
}
