// Terminal UI helpers — no dependencies, just ANSI codes

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";

function logo() {
  console.log("");
  console.log(`  ${YELLOW}☀️  ${BOLD}Shipday${RESET}${DIM} — from localhost to the world${RESET}`);
  console.log("");
}

function step(num, text) {
  console.log(`  ${DIM}${num}.${RESET} ${text}`);
}

function success(text) {
  console.log(`  ${GREEN}✓${RESET} ${text}`);
}

function warn(text) {
  console.log(`  ${YELLOW}⚠${RESET} ${text}`);
}

function error(text) {
  console.log(`  ${RED}✗${RESET} ${text}`);
}

function critical(text) {
  console.log(`  ${BG_RED}${WHITE} CRITICAL ${RESET} ${text}`);
}

function info(text) {
  console.log(`  ${BLUE}→${RESET} ${text}`);
}

function dim(text) {
  console.log(`  ${DIM}${text}${RESET}`);
}

function blank() {
  console.log("");
}

function divider() {
  console.log(`  ${DIM}${"─".repeat(50)}${RESET}`);
}

function liveStatus(url, port, startTime) {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  const secs = uptime % 60;
  const uptimeStr = `${hours}h ${mins}m ${secs}s`;

  process.stdout.write(
    `\r  ${GREEN}●${RESET} Live ${DIM}|${RESET} ${CYAN}${url}${RESET} ${DIM}→${RESET} localhost:${port} ${DIM}|${RESET} ${uptimeStr} `
  );
}

function box(title, lines) {
  const maxLen = Math.max(title.length, ...lines.map((l) => stripAnsi(l).length));
  const width = Math.min(maxLen + 4, 60);

  console.log(`  ┌${"─".repeat(width)}┐`);
  console.log(`  │ ${BOLD}${title}${RESET}${" ".repeat(width - title.length - 1)}│`);
  console.log(`  ├${"─".repeat(width)}┤`);
  for (const line of lines) {
    const plainLen = stripAnsi(line).length;
    const padding = width - plainLen - 1;
    console.log(`  │ ${line}${" ".repeat(Math.max(0, padding))}│`);
  }
  console.log(`  └${"─".repeat(width)}┘`);
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

module.exports = {
  logo, step, success, warn, error, critical, info, dim, blank, divider,
  liveStatus, box,
  RESET, BOLD, DIM, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE,
};
