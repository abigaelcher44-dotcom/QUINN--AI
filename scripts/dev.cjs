const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const port = process.env.QUINN_PORT || "8787";
const healthUrl = `http://127.0.0.1:${port}/health`;
const dataDir = process.env.QUINN_DATA_DIR || path.join(os.homedir(), ".quinn-ai");

const env = {
  ...process.env,
  QUINN_PORT: port,
  QUINN_DATA_DIR: dataDir,
};

let api = null;
let vite = null;
let ownsApi = false;
let stopping = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function health() {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return { occupied: true, payload: null };
    return { occupied: true, payload: await response.json() };
  } catch {
    return null;
  }
}

async function startApi() {
  const existing = await health();

  if (existing?.payload?.service === "quinn-local-api") {
    console.log(`[QUINN] Reusing local API on port ${port} (PID ${existing.payload.pid}).`);
    return;
  }

  if (existing?.occupied) {
    throw new Error(`Port ${port} is occupied by a service that is not QUINN.`);
  }

  api = spawn(process.execPath, [path.join(root, "local", "server.mjs")], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  ownsApi = true;

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`Local API exited with code ${api.exitCode}.`);
    }

    const result = await health();
    if (
      result?.payload?.service === "quinn-local-api" &&
      Number(result.payload.pid) === api.pid
    ) {
      console.log(`[QUINN] Local API ready at ${healthUrl}.`);
      return;
    }

    if (result?.occupied) {
      throw new Error(`Port ${port} responded, but it is not this QUINN API process.`);
    }

    await sleep(300);
  }

  throw new Error("Timed out waiting for the local API health check.");
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;

  if (vite && vite.exitCode === null) vite.kill();
  if (ownsApi && api && api.exitCode === null) api.kill();

  process.exitCode = code;
}

async function main() {
  await startApi();

  const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
  vite = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });

  vite.on("error", (error) => {
    console.error("[QUINN] Could not start Vite:", error.message);
    stop(1);
  });

  vite.on("exit", (code) => stop(code || 0));

  if (api) {
    api.on("error", (error) => {
      console.error("[QUINN] Local API process error:", error.message);
      stop(1);
    });
    api.on("exit", (code) => {
      if (!stopping) {
        console.error(`[QUINN] Local API stopped unexpectedly (code ${code}).`);
        stop(1);
      }
    });
  }
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

main().catch((error) => {
  console.error("[QUINN] Development startup failed:", error.message);
  stop(1);
});
