const fs = require("fs");
const path = require("path");

// Patterns that indicate leaked secrets
const SECRET_PATTERNS = [
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { name: "OpenAI API Key", regex: /sk-(?!ant-)(?:proj-|live-|)[a-zA-Z0-9_-]{20,}/g },
  { name: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g },
  { name: "GitHub Token", regex: /gh[ps]_[a-zA-Z0-9]{36,}/g },
  { name: "Stripe Key", regex: /sk_live_[a-zA-Z0-9]{20,}/g },
  { name: "Google API Key", regex: /AIza[0-9A-Za-z\-_]{35}/g },
  { name: "Supabase Key", regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{50,}/g },
  { name: "Private Key", regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: "Generic Secret", regex: /(?:secret|password|token|apikey|api_key)\s*[:=]\s*['"][a-zA-Z0-9_\-]{16,}['"]/gi },
];

// File extensions to scan
const SCAN_EXTENSIONS = [
  ".js", ".ts", ".jsx", ".tsx", ".py", ".env", ".json",
  ".yaml", ".yml", ".toml", ".cfg", ".conf", ".ini",
];

// Files/dirs to skip
const SKIP_DIRS = [
  "node_modules", ".git", ".next", "__pycache__", "dist",
  "build", ".venv", "venv", ".cache",
];

const SKIP_FILES = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

// Common subdirectories for server config files
const SERVER_SUBDIRS = ["", "src", "server", "lib", "app"];

function scanDirectory(rootDir, dir, maxDepth = 4, currentDepth = 0) {
  const findings = [];

  if (currentDepth > maxDepth) return findings;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return findings;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Handle symlinks
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const resolved = fs.realpathSync(fullPath);
        const stat = fs.statSync(resolved);
        isDir = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue;
      }
    }

    if (isDir) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      findings.push(...scanDirectory(rootDir, fullPath, maxDepth, currentDepth + 1));
    } else if (isFile) {
      if (SKIP_FILES.includes(entry.name)) continue;

      const ext = path.extname(entry.name).toLowerCase();
      const relPath = path.relative(rootDir, fullPath);

      // Check for .env files with content
      if (entry.name.startsWith(".env")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const lines = content.split("\n").filter(
            (l) => l.trim() && !l.startsWith("#") && l.includes("=")
          );
          const nonEmpty = lines.filter((l) => {
            const val = l.split("=").slice(1).join("=").trim();
            return val && val !== '""' && val !== "''" && val !== "your_key_here";
          });
          if (nonEmpty.length > 0) {
            findings.push({
              type: "env_file",
              file: relPath,
              message: `.env file with ${nonEmpty.length} value(s) — these could be exposed to visitors`,
              severity: "high",
              details: nonEmpty.map((l) => l.split("=")[0].trim()),
            });
          }
        } catch {
          // skip
        }
        continue;
      }

      if (!SCAN_EXTENSIONS.includes(ext)) continue;

      // Scan file contents for secrets
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 512 * 1024) continue;

        const content = fs.readFileSync(fullPath, "utf-8");

        // Skip binary files (check for null bytes)
        if (content.indexOf("\0") !== -1) continue;

        for (const pattern of SECRET_PATTERNS) {
          // Reset regex lastIndex for global flag
          pattern.regex.lastIndex = 0;

          let match;
          while ((match = pattern.regex.exec(content)) !== null) {
            const lines = content.substring(0, match.index).split("\n");
            const lineNum = lines.length;

            findings.push({
              type: "secret",
              file: relPath,
              message: `${pattern.name} found`,
              severity: "critical",
              line: lineNum,
              preview: match[0].substring(0, 8) + "..." + match[0].substring(match[0].length - 4),
            });
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }

  return findings;
}

// Check for dangerous server configurations
function scanServerConfig(dir) {
  const findings = [];
  const serverFiles = ["server.js", "server.ts", "app.js", "app.ts", "index.js", "index.ts"];

  for (const subdir of SERVER_SUBDIRS) {
    const searchDir = subdir ? path.join(dir, subdir) : dir;

    for (const file of serverFiles) {
      const fullPath = path.join(searchDir, file);
      if (!fs.existsSync(fullPath)) continue;

      const relPath = path.relative(dir, fullPath);

      try {
        const content = fs.readFileSync(fullPath, "utf-8");

        if (/express\.static\s*\(\s*['"]\/['"]|express\.static\s*\(\s*__dirname\s*\)/.test(content)) {
          findings.push({
            type: "config",
            file: relPath,
            message: "express.static may be serving your root directory",
            severity: "high",
          });
        }

        if (/cors\(\s*\)/.test(content)) {
          findings.push({
            type: "config",
            file: relPath,
            message: "CORS is fully open — any website can make requests to your app",
            severity: "medium",
          });
        }
      } catch {
        // skip
      }
    }
  }

  return findings;
}

function runSecurityScan(dir) {
  const findings = [
    ...scanDirectory(dir, dir),
    ...scanServerConfig(dir),
  ];

  return {
    findings,
    critical: findings.filter((f) => f.severity === "critical"),
    high: findings.filter((f) => f.severity === "high"),
    medium: findings.filter((f) => f.severity === "medium"),
    clean: findings.length === 0,
  };
}

module.exports = { runSecurityScan };
