#!/usr/bin/env node
/**
 * Runs before `npm run dev`.
 *
 * The 2026-11-05 outage was not a code bug: the `petcom-pg` container was
 * stopped, so every page 500'd with `connect ECONNREFUSED 127.0.0.1:5433`.
 * Starting the container here makes that failure impossible to hit silently.
 *
 * Deliberately fails loudly (exit 1) instead of continuing: a dev server with
 * no database serves nothing but 500s.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

const CONTAINER = "petcom-pg";
const DB_USER = "petcom";
const DB_NAME = "petcom";

function run(args, options = {}) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 20_000,
    ...options,
  });
}

function fail(lines) {
  console.error(`\n  ✕ ${lines[0]}`);
  for (const line of lines.slice(1)) console.error(`    ${line}`);
  console.error("");
  process.exit(1);
}

// 1. Is port 3000 already taken? A dev server left running in another terminal
//    makes `next dev` fail with a bare EADDRINUSE; name the cause instead and
//    skip the Docker work entirely.
//    Note: a probe bind does not work on Windows — SO_REUSEADDR lets a second
//    listener bind the same port — so ask whether anything answers instead.
function portAnswers(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

const portInUse =
  (await portAnswers("127.0.0.1", 3000)) || (await portAnswers("::1", 3000));

if (portInUse) {
  fail([
    "Port 3000 is already in use — another dev server is probably still running.",
    "Open http://localhost:3000 to see it, or stop it with:",
    "  Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }",
    "Or start on a different port: npx next dev -p 3001",
  ]);
}

// 2. Is Docker itself reachable? A stopped Docker Desktop looks identical to a
//    missing container from a naive check, so name the real cause.
const engine = run(["version", "--format", "{{.Server.Version}}"]);
if (engine.error?.code === "ENOENT") {
  fail([
    "Docker CLI not found on PATH.",
    "Install Docker Desktop (or start it), then re-run `npm run dev`.",
  ]);
}
if (engine.status !== 0) {
  fail([
    "Docker is installed but not running.",
    "Start Docker Desktop, wait for the whale icon to settle, then re-run `npm run dev`.",
  ]);
}

// 3. Does the container exist at all?
const inspect = run([
  "inspect",
  "--format",
  "{{.State.Running}}",
  CONTAINER,
]);
if (inspect.status !== 0) {
  fail([
    `Docker container "${CONTAINER}" does not exist.`,
    "Recreate it (data lives in the petcom_pg volume):",
    `docker run -d --name ${CONTAINER} -e POSTGRES_USER=${DB_USER} \\`,
    `  -e POSTGRES_PASSWORD=${DB_USER} -e POSTGRES_DB=${DB_NAME} \\`,
    "  -p 5433:5432 -v petcom_pg:/var/lib/postgresql/data \\",
    "  --restart unless-stopped postgres:16-alpine",
    "Then: npm run db:push && npm run db:seed",
  ]);
}

// 4. Start it if it is stopped. `docker start` can lose a race with a container
//    that is still finishing a stop, so retry before declaring failure.
if (inspect.stdout.trim() !== "true") {
  console.log(`  · ${CONTAINER} is stopped — starting it…`);
  let running = false;
  let lastError = "";
  for (let attempt = 0; attempt < 5 && !running; attempt++) {
    const start = run(["start", CONTAINER]);
    lastError = (start.stderr || start.stdout || "").trim();
    const state = run([
      "inspect",
      "--format",
      "{{.State.Running}}",
      CONTAINER,
    ]);
    running = state.status === 0 && state.stdout.trim() === "true";
    if (!running) run(["exec", CONTAINER, "sleep", "1"]);
  }
  if (!running) {
    fail([
      `Could not start ${CONTAINER}.`,
      lastError || "docker start kept returning a non-running state.",
    ]);
  }
}

// 5. Wait for Postgres to accept connections — `docker start` returns before
//    the server is ready on a cold boot.
const deadline = Date.now() + 30_000;
let ready = false;
while (Date.now() < deadline) {
  const ping = run([
    "exec",
    CONTAINER,
    "pg_isready",
    "-U",
    DB_USER,
    "-d",
    DB_NAME,
  ]);
  if (ping.stdout.includes("accepting connections")) {
    ready = true;
    break;
  }
  run(["exec", CONTAINER, "sleep", "0.5"]);
}

if (!ready) {
  fail([
    `${CONTAINER} is running but Postgres never accepted connections (30s).`,
    `Check its log: docker logs --tail 40 ${CONTAINER}`,
  ]);
}

console.log(`  ✓ Postgres ready on localhost:5433 (${CONTAINER})`);
