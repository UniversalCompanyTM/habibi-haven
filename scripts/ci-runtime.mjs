// scripts/ci-runtime.mjs — start the preview server, prove it answers, then run the browser harness.
//
// Why this is a script and not four lines of shell in .github/workflows/ci.yml: the shell block is the
// part of the pipeline that needs tuning against a machine nobody is sitting at, and every edit to a
// workflow file has to pass through GitHub's `workflow` scope. Living here, the bootstrap rides ordinary
// git pushes like the rest of the code, and the workflow step is one line that will not need to change
// again.
//
// The bug this fixes: `astro preview` with no `--host` prints "Local http://localhost:4321/", and on a
// Linux runner `localhost` resolves to `::1` before `127.0.0.1`. A probe aimed at 127.0.0.1 then never
// gets an answer from a server that is genuinely up — run #1 failed exactly that way, 40 seconds of
// curl against a healthy preview. So the address is chosen once, passed to the server as `--host`, and
// the same literal is used for the probe and for the harness. No name is resolved twice in two ways.
//
// The server is spawned from the astro CLI entry point rather than through `npm run`, because npm leaves
// a second process holding the port when the parent is killed, and a runner that cannot reap its own
// preview server is a runner that reports a harness failure as a timeout.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE = `${ROOT}site`;
const PORT = Number(process.env.HH_PREVIEW_PORT ?? 4321);
const HOST = process.env.HH_PREVIEW_HOST ?? "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;
const READY_ATTEMPTS = Number(process.env.HH_PREVIEW_WAIT ?? 60);

function previewServer() {
  const child = spawn(
    process.execPath,
    [`${SITE}/node_modules/astro/astro.js`, "preview", "--port", String(PORT), "--host", HOST],
    { cwd: SITE, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  const capture = (chunk) => {
    log += chunk.toString();
    if (log.length > 64_000) log = log.slice(-32_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", (error) => {
    log += `\nspawn failed: ${error.message}\n`;
  });
  return {
    child,
    exited: () => child.exitCode !== null || child.signalCode !== null,
    exitInfo: () => `exit code ${child.exitCode} signal ${child.signalCode}`,
    tail: () => log.trim().split("\n").slice(-25).join("\n"),
  };
}

async function answers(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    // Any HTTP answer at all means the server is listening. A 404 from the preview root would be a
    // routing question for the harness, not a reason to keep waiting here.
    return response.status > 0;
  } catch {
    return false;
  }
}

const server = previewServer();

let ready = false;
for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt += 1) {
  if (server.exited()) break;
  if (await answers(`${BASE}/`)) {
    ready = true;
    console.log(`preview answered on ${BASE} after ${attempt}s`);
    break;
  }
  await sleep(1_000);
}

if (!ready) {
  console.error(
    server.exited()
      ? `preview server died before the harness could run (${server.exitInfo()}).`
      : `preview server never answered on ${BASE} within ${READY_ATTEMPTS}s.`,
  );
  console.error(`--- preview output ---\n${server.tail()}`);
  server.child.kill("SIGTERM");
  process.exit(1);
}

const harness = spawn(
  process.execPath,
  [`${ROOT}scripts/verify-runtime.mjs`, "--base", BASE],
  { cwd: ROOT, stdio: "inherit" },
);

const code = await new Promise((resolve) => {
  harness.on("exit", (exitCode, signal) => resolve(signal ? 124 : (exitCode ?? 1)));
  harness.on("error", (error) => {
    console.error(`harness could not start: ${error.message}`);
    resolve(1);
  });
});

server.child.kill("SIGTERM");
// The harness result is the CI result. A preview server that died while the browser was walking the
// routes is worth saying out loud, but it must not overwrite a pass with a bookkeeping complaint.
if (server.exited()) console.warn(`note: the preview server exited (${server.exitInfo()}) during the harness`);
process.exit(code);
