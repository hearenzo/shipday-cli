#!/usr/bin/env node

const http = require("http");
const https = require("https");
const { exec } = require("child_process");
const readline = require("readline");

const ui = require("../src/ui.js");
const { runSecurityScan } = require("../src/security-scan.js");

// ─── Config ─────────────────────────────────────────
const DAWN_URL = process.env.DAWN_URL || "https://shipday.dev";
const API_URL = `${DAWN_URL}/api/projects`;
const DEFAULT_PORT = 3000;

// ─── Parse Args ─────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  ui.logo();
  console.log("  Usage: shipday-cli [port] [options]");
  console.log("");
  console.log("  Arguments:");
  console.log("    port          Port your app is running on (default: 3000)");
  console.log("");
  console.log("  Options:");
  console.log("    --skip-scan   Skip the security scan");
  console.log("    --dir <path>  Directory to scan (default: current dir)");
  console.log("    -h, --help    Show this help");
  console.log("");
  console.log("  Examples:");
  console.log("    npx shipday-cli 3000");
  console.log("    npx shipday-cli 8080 --skip-scan");
  console.log("");
  process.exit(0);
}

const skipScan = args.includes("--skip-scan");
const dirIndex = args.indexOf("--dir");
const scanDir = dirIndex !== -1 ? args[dirIndex + 1] : process.cwd();
const port = parseInt(args.find((a) => /^\d+$/.test(a))) || DEFAULT_PORT;

// ─── Main ───────────────────────────────────────────
async function main() {
  ui.logo();

  // Step 1: Check if port is active
  ui.step(1, "Checking localhost...");
  const portActive = await checkPort(port);

  if (!portActive) {
    ui.error(`Nothing running on port ${port}`);
    ui.blank();
    ui.info("Start your app first:");
    ui.dim(`  $ npm run dev          # start your app`);
    ui.dim(`  $ npx shipday-cli ${port}    # then ship it`);
    ui.blank();
    process.exit(1);
  }

  ui.success(`localhost:${port} is running`);

  // Step 2: Security scan
  if (!skipScan) {
    ui.blank();
    ui.step(2, "Security scan...");

    // Detect if running from a broad directory (home, root, etc.)
    const resolvedDir = require("path").resolve(scanDir);
    const homeDir = require("os").homedir();
    const isProjectDir = require("fs").existsSync(require("path").join(resolvedDir, "package.json"))
      || require("fs").existsSync(require("path").join(resolvedDir, "requirements.txt"))
      || require("fs").existsSync(require("path").join(resolvedDir, "Cargo.toml"))
      || require("fs").existsSync(require("path").join(resolvedDir, "go.mod"));
    const isBroadDir = resolvedDir === homeDir || resolvedDir === "/" || resolvedDir === "/tmp";

    if (isBroadDir && !isProjectDir) {
      ui.warn("You're running from your home directory — scan skipped.");
      ui.dim("  Run from your project folder for a proper security scan:");
      ui.dim(`  $ cd your-project && npx shipday-cli ${port}`);
    } else {
      const result = runSecurityScan(scanDir);

      if (result.clean) {
        ui.success("No secrets or issues found");
      } else {
        for (const f of result.critical) {
          ui.critical(`${f.message} in ${f.file}${f.line ? `:${f.line}` : ""}`);
          if (f.preview) ui.dim(`    ${f.preview}`);
        }
        for (const f of result.high) {
          ui.warn(`${f.message}`);
          if (f.details) ui.dim(`    Variables: ${f.details.join(", ")}`);
        }
        for (const f of result.medium) {
          ui.dim(`  ℹ ${f.message} (${f.file})`);
        }

        if (result.critical.length > 0) {
          ui.blank();
          ui.warn(`${result.critical.length} critical issue(s) found. Your secrets may be exposed.`);
          const shouldContinue = await askYesNo("  Continue anyway? (y/N): ");
          if (!shouldContinue) {
            ui.blank();
            ui.info("Fix the issues above and try again.");
            ui.blank();
            process.exit(1);
          }
        }
      }
    }
  } else {
    ui.step(2, `Security scan ${ui.DIM}(skipped)${ui.RESET}`);
  }

  // Step 3: Create tunnel
  ui.blank();
  ui.step(3, "Creating tunnel...");
  ui.dim("  First run downloads cloudflared (~30MB). Subsequent runs are instant.");

  let tunnel;
  let tunnelUrl;
  try {
    const { Tunnel } = require("cloudflared");
    tunnel = Tunnel.quick(`http://localhost:${port}`);
    tunnelUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Tunnel creation timed out")), 30000);
      tunnel.on("url", (url) => { clearTimeout(timeout); resolve(url); });
      tunnel.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  } catch (err) {
    ui.error("Failed to create tunnel");
    ui.dim(`  ${err.message}`);
    ui.blank();
    ui.info("Try manually:");
    ui.dim(`  $ npx cloudflared tunnel --url http://localhost:${port}`);
    ui.blank();
    process.exit(1);
  }

  ui.success(`Live at ${ui.CYAN}${tunnelUrl}${ui.RESET}`);

  // Step 4: Ask project details (inline — no web form)
  ui.blank();
  ui.divider();
  ui.blank();

  const title = await ask("  What's it called? ");
  if (!title.trim()) {
    ui.error("Title is required");
    tunnel.stop();
    process.exit(1);
  }

  const tagline = await ask("  One-liner? ");

  // Detect project name from package.json or directory name
  const authorName = await ask(`  Your name ${ui.DIM}(or Enter to skip)${ui.RESET}: `);

  // Step 5: Submit directly to API
  ui.blank();
  ui.step(4, "Shipping to Shipday...");

  try {
    const result = await postProject({
      title: title.trim(),
      tagline: (tagline || title).trim(),
      demoUrl: tunnelUrl,
      authorName: authorName.trim() || "Anonymous Builder",
      problem: "",
      solution: "",
      howToUse: "",
      techStack: [],
      category: "fun",
    });

    if (result.ok) {
      ui.success("Shipped!");
      ui.blank();
      ui.box("Your project is live!", [
        "",
        `${ui.BOLD}${title.trim()}${ui.RESET}`,
        `${ui.DIM}${(tagline || title).trim()}${ui.RESET}`,
        "",
        `${ui.CYAN}${DAWN_URL}/p/${result.project?.id || ""}${ui.RESET}`,
        "",
        `${ui.DIM}Demo: ${tunnelUrl}${ui.RESET}`,
        "",
      ]);

      ui.blank();
      openBrowser(`${DAWN_URL}`);
      ui.dim("  Browser opened → shipday.dev");
    } else {
      ui.error(`Failed: ${result.error || "Unknown error"}`);
      ui.blank();
      ui.info("Try submitting manually:");
      ui.dim(`  ${DAWN_URL}/submit?demoUrl=${encodeURIComponent(tunnelUrl)}`);
    }
  } catch (err) {
    ui.error(`Network error: ${err.message}`);
    ui.blank();
    ui.info("Your tunnel is still running. Submit manually:");
    ui.dim(`  ${DAWN_URL}/submit?demoUrl=${encodeURIComponent(tunnelUrl)}`);
  }

  // Step 6: Keep alive
  ui.blank();
  ui.divider();
  ui.blank();
  ui.dim("  Keep this terminal open — demo stops when you close it.");
  ui.dim("  24 hours on the clock. Get votes to survive!");
  ui.dim("  Press Ctrl+C to stop.");
  ui.blank();

  const startTime = Date.now();
  const statusInterval = setInterval(() => {
    ui.liveStatus(tunnelUrl, port, startTime);
  }, 1000);

  tunnel.on("exit", (code, signal) => {
    clearInterval(statusInterval);
    console.log("");
    ui.blank();
    ui.info("Tunnel closed.");
    ui.blank();
    process.exit(0);
  });

  tunnel.on("error", (err) => {
    clearInterval(statusInterval);
    console.log("");
    ui.error(`Tunnel error: ${err.message}`);
  });

  const cleanup = () => {
    clearInterval(statusInterval);
    console.log("");
    ui.blank();
    ui.info("Shutting down...");
    tunnel.stop();
    ui.success("Done. Your localhost is private again.");
    ui.blank();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ─── Helpers ────────────────────────────────────────

function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, () => resolve(true));
    req.on("error", () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

function postProject(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url = new URL(API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const client = url.protocol === "https:" ? https : http;
    const req = client.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ ok: false, error: "Invalid response" });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start"
    : "xdg-open";
  exec(`${cmd} "${url}"`, () => {});
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer); });
  });
}

function askYesNo(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

// ─── Run ────────────────────────────────────────────
main().catch((err) => {
  ui.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
