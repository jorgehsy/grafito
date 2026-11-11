#!/usr/bin/env node
// `pnpm share`: lets people outside your network join a room on the Grafito that runs on this machine
// (docs/adr/0009-rooms-over-a-tunnel.md). It builds the front, starts the server in share mode on one local
// port (the page, the API and the room sockets), and only then opens a Cloudflare quick tunnel to that port.
// Guests can load the page and join a room they were sent the link of; everything else is yours alone.
//
//   pnpm share                 build, serve, tunnel
//   pnpm share --no-build      reuse apps/web/dist as it is
//   pnpm share --no-tunnel     share mode on this machine only (to try it without going public)
//   pnpm share --port 8790     the local port (default 8790, or GRAFITO_SHARE_PORT)
//
// Nothing is installed for you: without `cloudflared` it says how to get it and stops.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tunnelUrl } from "./tunnel-url.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const portArg = args.includes("--port") ? args[args.indexOf("--port") + 1] : process.env.GRAFITO_SHARE_PORT;
const port = Number(portArg ?? 8790);
const say = (msg) => console.log(`[share] ${msg}`);

if (flag("--help") || flag("-h")) {
  console.log("Usage: pnpm share [--no-build] [--no-tunnel] [--port <n>]");
  process.exit(0);
}
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error(`[share] not a usable port: ${portArg}`);
  process.exit(1);
}

const useTunnel = !flag("--no-tunnel");
if (useTunnel && spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error) {
  say("cloudflared is not installed, so there is no tunnel to open. Install it and run this again:");
  say("");
  say("  brew install cloudflared");
  say("");
  say("(other systems: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)");
  say("To try share mode on this machine only, without a tunnel: pnpm share --no-tunnel");
  process.exit(0);
}

// ---- Children never outlive this script: a tunnel left open is a public address nobody is watching. ----

/** @type {import("node:child_process").ChildProcess[]} */
const children = [];
let stopping = false;
const alive = (c) => c.exitCode === null && c.signalCode === null;
const killAll = (signal) => { for (const c of children) if (alive(c)) { try { c.kill(signal); } catch { /* already gone */ } } };

/** Stops everything and exits with `code`: asks the children to stop, then stops them. */
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  killAll("SIGTERM");
  const hard = setTimeout(() => { killAll("SIGKILL"); process.exit(code); }, 1500);
  const check = setInterval(() => { if (!children.some(alive)) { clearTimeout(hard); clearInterval(check); process.exit(code); } }, 50);
}
// Ctrl+C, `kill`, the terminal closing, the script failing: all of them close the tunnel.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"]) process.on(sig, () => stop(sig === "SIGINT" ? 0 : 1));
process.on("uncaughtException", (e) => { console.error(`[share] ${e?.stack ?? e}`); stop(1); });
process.on("unhandledRejection", (e) => { console.error(`[share] ${e?.stack ?? e}`); stop(1); });
// the last chance, whatever the way out: nothing can be awaited here, so this is the hard stop
process.on("exit", () => killAll("SIGKILL"));

/**
 * And for the one way out no handler sees (this process killed with SIGKILL): a small watcher, outside this
 * process, that stops the children when this one is gone. The server also watches for it itself.
 */
function watchdog() {
  const pids = children.filter(alive).map((c) => String(c.pid));
  if (!pids.length) return;
  const code = `
    const [parent, ...pids] = process.argv.slice(1).map(Number);
    const gone = (pid) => { try { process.kill(pid, 0); return false; } catch { return true; } };
    setInterval(() => {
      if (pids.every(gone)) process.exit(0);
      if (!gone(parent)) return;
      for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch {} }
      setTimeout(() => { for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} } process.exit(0); }, 1500);
    }, 1000);`;
  spawn(process.execPath, ["-e", code, String(process.pid), ...pids], { stdio: "ignore", detached: true }).unref();
}

// ---- 1. The front, built: the server serves apps/web/dist. ----

if (!flag("--no-build")) {
  say("building the front…");
  const built = spawnSync("pnpm", ["--filter", "@grafito/web", "build"], { cwd: root, stdio: "inherit" });
  if (built.status !== 0) {
    console.error("[share] the build failed; nothing was started");
    process.exit(built.status ?? 1);
  }
}
if (!existsSync(resolve(root, "apps/web/dist/index.html"))) {
  console.error("[share] there is no built front in apps/web/dist: run without --no-build");
  process.exit(1);
}

// ---- 2. The server first, in share mode, on this machine only. No tunnel exists yet. ----

// What this script proves itself to the server with, to tell it the tunnel's address later.
const control = randomBytes(32).toString("base64url");
const env = { ...process.env, GRAFITO_SHARE: "1", PORT: String(port), GRAFITO_SHARE_CONTROL: control, GRAFITO_PARENT_PID: String(process.pid), NODE_ENV: "production" };
delete env.GRAFITO_PUBLIC_URL;
// tsx straight from the server's own dependencies (it passes signals on to node); through pnpm if it is not there
const serverDir = resolve(root, "apps/server");
const tsx = resolve(serverDir, "node_modules/.bin/tsx");
const server = existsSync(tsx)
  ? spawn(tsx, ["src/index.ts"], { cwd: serverDir, stdio: "inherit", env })
  : spawn("pnpm", ["--filter", "@grafito/server", "exec", "tsx", "src/index.ts"], { cwd: root, stdio: "inherit", env });
children.push(server);
server.on("error", (e) => { console.error(`[share] could not start the server: ${e.message}`); stop(1); });
server.on("exit", (code) => { if (!stopping) { say(`the server stopped (exit ${code}).`); stop(code || 1); } });

const base = `http://127.0.0.1:${port}`;
const announce = (query = "") => fetch(`${base}/api/share/public-url${query}`, { method: "PUT", headers: { "X-Grafito-Control": control } });

/**
 * Waits until the server this script started answers on the port. Not just "something answers": the tunnel
 * must never be opened onto another program that happened to hold the port. Only our server knows the
 * control secret, so only it answers 204 here; and if the port was taken, our server has already exited.
 */
async function serverIsOurs() {
  for (let i = 0; i < 150; i++) {
    if (stopping || !alive(server)) return false;
    try {
      const res = await announce();
      if (res.status === 204) return true;
      // something answered, and it is not the server we started
      console.error(`[share] port ${port} is answered by another program (HTTP ${res.status}); not opening a tunnel onto it`);
      return false;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`[share] the server did not answer on port ${port}`);
  return false;
}

// ---- 3. The tunnel, only once the server is known to be the one behind the port. ----

function openTunnel() {
  return new Promise((resolveUrl, reject) => {
    say("opening a Cloudflare quick tunnel…");
    // 127.0.0.1, not localhost: the server listens on IPv4 loopback only
    const tunnel = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", base], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    children.push(tunnel);
    let seen = "";
    let found = false;
    const timer = setTimeout(() => { if (!found) reject(new Error(`cloudflared gave no address in 45 s. Its output:\n${seen}`)); }, 45_000);
    const read = (chunk) => {
      if (found) return;
      seen = (seen + chunk.toString()).slice(-8000);
      const url = tunnelUrl(seen);
      if (!url) return;
      found = true;
      clearTimeout(timer);
      resolveUrl(url);
    };
    tunnel.stdout.on("data", read);
    tunnel.stderr.on("data", read);
    tunnel.on("error", (e) => { clearTimeout(timer); reject(e); });
    tunnel.on("exit", (code) => {
      clearTimeout(timer);
      if (!found) return reject(new Error(`cloudflared stopped (exit ${code}) before giving an address. Its output:\n${seen}`));
      if (!stopping) { say("the tunnel closed: the public link no longer works. Stopping."); stop(1); }
    });
  });
}

async function main() {
  if (!(await serverIsOurs())) return stop(1);
  watchdog();

  let publicUrl = null;
  if (useTunnel) {
    try {
      publicUrl = await openTunnel();
    } catch (e) {
      console.error(`[share] ${e.message}`);
      return stop(1);
    }
    watchdog(); // again, now that the tunnel is one of the children
    // The server only answers to names it knows: tell it the tunnel's. If it does not take it, the tunnel goes.
    const told = await announce(`?url=${encodeURIComponent(publicUrl)}`).then((r) => r.status, () => 0);
    if (told !== 204 || !alive(server)) {
      console.error(`[share] the server did not take the tunnel's address (HTTP ${told}); closing the tunnel`);
      return stop(1);
    }
  }
  if (stopping) return;

  const line = "─".repeat(72);
  console.log(`\n${line}`);
  console.log("  Grafito is shared.\n");
  console.log("  You (the owner): open the owner link printed above in your browser, on this machine.");
  console.log("  It works once. If you need another (a different browser), restart `pnpm share`.");
  console.log(`  Then keep working at  http://localhost:${port}  and not at the public address:`);
  console.log("  through the tunnel you are a guest too.\n");
  if (publicUrl) {
    console.log(`  Public address:  ${publicUrl}`);
    console.log("  Guests need a room link, not just that address: press Collaborate, then Share,");
    console.log("  and send the link it shows (it ends in #k=…, the room's invite token).");
    console.log("  Whoever has a room link can use Claude at your cost, up to the room's limits.");
  } else {
    console.log("  No tunnel (--no-tunnel): only this machine reaches it.");
  }
  console.log("\n  Ctrl+C stops the server and closes the tunnel; the links stop working.");
  console.log(`${line}\n`);
}

await main();
