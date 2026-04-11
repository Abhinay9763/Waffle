import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const OUT_DIR = path.join(ROOT, "load-test", "generated");
const OUT_FILE = path.join(OUT_DIR, "hotspots.json");

const ROUTE_REGEX = /\$\{API\}\/([^`"'\s)]+)/g;

const SCORE_HINTS = [
  ["/response/heartbeat", 70],
  ["/response/submit", 40],
  ["/exam/:param/snapshot", 35],
  ["/exam/:param/live", 25],
  ["/exam/:param/take", 25],
  ["/exam/list", 15],
  ["/response/my", 15],
  ["/user/session", 10],
  ["/exam/faculty-dashboard", 12],
  ["/exam/hod-dashboard", 12],
];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeRoute(raw) {
  let route = `/${raw}`;
  route = route.split("?")[0];
  route = route.replace(/\$\{[^}]+\}/g, ":param");
  route = route.replace(/:param:\w+/g, ":param");
  route = route.replace(/\/+/, "/");
  return route;
}

function scoreRoute(route, count, fileCount) {
  let score = count * 3 + fileCount * 2;
  for (const [needle, bonus] of SCORE_HINTS) {
    if (route.includes(needle)) score += bonus;
  }
  return score;
}

async function main() {
  const files = await walk(SRC_DIR);
  const routeMap = new Map();

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const body = await fs.readFile(file, "utf8");

    let match;
    while ((match = ROUTE_REGEX.exec(body)) !== null) {
      const normalized = normalizeRoute(match[1]);
      const item = routeMap.get(normalized) ?? { count: 0, files: new Set() };
      item.count += 1;
      item.files.add(rel);
      routeMap.set(normalized, item);
    }
  }

  const endpoints = Array.from(routeMap.entries())
    .map(([route, meta]) => {
      const filesUsed = Array.from(meta.files).sort();
      return {
        route,
        matches: meta.count,
        files: filesUsed,
        file_count: filesUsed.length,
        score: scoreRoute(route, meta.count, filesUsed.length),
      };
    })
    .sort((a, b) => b.score - a.score);

  const payload = {
    generated_at: new Date().toISOString(),
    source_root: "src",
    top_n_recommendation: Math.min(12, endpoints.length),
    endpoints,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));

  const top = endpoints.slice(0, 12);
  console.log("Detected hotspot endpoints (top 12):");
  for (const item of top) {
    console.log(`- score=${item.score.toString().padStart(3, " ")}  matches=${item.matches.toString().padStart(2, " ")}  ${item.route}`);
  }
  console.log(`\nSaved: ${path.relative(ROOT, OUT_FILE).replace(/\\/g, "/")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
