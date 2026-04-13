import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

const status2xx = new Counter("status_2xx");
const status3xx = new Counter("status_3xx");
const status4xx = new Counter("status_4xx");
const status5xx = new Counter("status_5xx");
const status0xx = new Counter("status_0xx");
const endpointReqs = new Counter("endpoint_reqs");
const endpointFailures = new Counter("endpoint_failures");
const endpointDuration = new Trend("endpoint_duration", true);

function readDotEnv() {
  const candidates = ["./load-test/.env", "./.env"];
  try {
    for (const filePath of candidates) {
      try {
        const raw = open(filePath);
        const result = {};
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq <= 0) continue;
          const key = trimmed.slice(0, eq).trim();
          const value = trimmed.slice(eq + 1).trim();
          if (!key) continue;
          result[key] = value;
        }
        return result;
      } catch (_err) {
        // Try next candidate.
      }
    }
  } catch (_err) {
    // Fall through.
  }
  return {};
}

const DOTENV = readDotEnv();
const envValue = (key, fallback = "") => {
  const fromRuntime = __ENV[key];
  if (fromRuntime !== undefined && fromRuntime !== "") return fromRuntime;
  const fromDotEnv = DOTENV[key];
  if (fromDotEnv !== undefined && fromDotEnv !== "") return fromDotEnv;
  return fallback;
};

const BASE_URL = envValue("BASE_URL").replace(/\/$/, "");
const STUDENT_TOKEN = envValue("STUDENT_TOKEN");
const FACULTY_TOKEN = envValue("FACULTY_TOKEN");
const HOD_TOKEN = envValue("HOD_TOKEN");
const EXAM_ID = envValue("EXAM_ID");
const RESPONSE_ID = envValue("RESPONSE_ID");
const THINK_MS = Number(envValue("THINK_MS", "250"));

const READ_VUS = Number(envValue("READ_VUS", "25"));
const READ_DURATION = envValue("READ_DURATION", "2m");
const HEARTBEAT_VUS = Number(envValue("HEARTBEAT_VUS", "15"));
const HEARTBEAT_DURATION = envValue("HEARTBEAT_DURATION", "2m");

function parseStudentTokens() {
  const fromCsv = envValue("STUDENT_TOKENS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const numbered = [];
  for (let i = 1; i <= 10; i += 1) {
    const key = `STUDENT_TOKEN_${i}`;
    const value = envValue(key, "").trim();
    if (value) numbered.push(value);
  }

  const merged = [...numbered, ...fromCsv];
  if (merged.length > 0) {
    return Array.from(new Set(merged));
  }

  return STUDENT_TOKEN ? [STUDENT_TOKEN] : [];
}

const STUDENT_TOKENS = parseStudentTokens();

function pickStudentTokenByVu() {
  if (STUDENT_TOKENS.length === 0) return "";
  const vu = Number(__VU || 1);
  const idx = (Math.max(1, vu) - 1) % STUDENT_TOKENS.length;
  return STUDENT_TOKENS[idx];
}

const READ_ROUTE_ALLOWLIST = [
  "/user/session",
  "/exam/list",
  "/exam/available",
  "/exam/faculty-dashboard",
  "/exam/hod-dashboard",
  "/exam/:param/take",
  "/exam/:param/snapshot",
  "/exam/:param/responses",
  "/response/my",
  "/response/my/:param",
  "/response/queries/my",
  "/response/queries/my-faculty",
  "/response/queries/hod-solved",
  "/paper/list",
  "/paper/:param",
  "/paper/:param/download",
  "/paper/:param/download-xlsx",
  "/paper/template/:param",
  "/hod/pending-faculty",
  "/hod/faculty",
  "/exam/sections",
];

function isAllowedReadRoute(route) {
  return READ_ROUTE_ALLOWLIST.includes(route);
}

if (!BASE_URL) {
  throw new Error("BASE_URL is required, e.g. https://your-render-url.onrender.com");
}

function loadDiscoveredRoutes() {
  const candidates = ["./load-test/generated/hotspots.json", "./generated/hotspots.json"];
  for (const filePath of candidates) {
    try {
      const raw = open(filePath);
      const data = JSON.parse(raw);
      if (Array.isArray(data.endpoints)) {
        return data.endpoints.map((x) => x.route).filter(Boolean);
      }
    } catch (_err) {
      // Try next candidate.
    }
  }
  return [];
}

function pickToken(route) {
  const studentToken = pickStudentTokenByVu();
  if (route.includes("/hod") || route.includes("hod-dashboard")) {
    return HOD_TOKEN || FACULTY_TOKEN || studentToken;
  }
  if (
    route.includes("/faculty") ||
    route.includes("faculty-dashboard") ||
    route.startsWith("/paper") ||
    route.includes("/response/queries/my-faculty") ||
    route.includes("/response/queries/:param/answer") ||
    route.includes("/exam/list") ||
    route.includes("/exam/:param/responses") ||
    route.includes("/exam/:param/snapshot")
  ) {
    return FACULTY_TOKEN || HOD_TOKEN || studentToken;
  }
  if (
    route.includes("/response/my") ||
    route.includes("/exam/available") ||
    route.includes("/exam/:param/take") ||
    route.includes("/response/heartbeat")
  ) {
    return studentToken || FACULTY_TOKEN || HOD_TOKEN;
  }
  return studentToken || FACULTY_TOKEN || HOD_TOKEN;
}

function inferMethod(route) {
  if (
    route.includes("/response/heartbeat") ||
    route.includes("/response/submit") ||
    route.includes("/paper/import") ||
    route.includes("/paper/create") ||
    route.includes("/paper/:param/clone") ||
    route.includes("/paper/upload-image") ||
    route.includes("/response/my/:param/flag-question") ||
    route.includes("/response/queries/:param/answer") ||
    route.includes("/exam/:param/retake") ||
    route.includes("/exam/:param/stop") ||
    route.includes("/exam/:param/release-responses") ||
    route.includes("/exam/create") ||
    route.includes("/user/login") ||
    route.includes("/user/register") ||
    route.includes("/user/student-preview") ||
    route.includes("/user/forgot-password") ||
    route.includes("/user/reset-password")
  ) {
    return "POST";
  }
  return "GET";
}

function shouldSkipRawRoute(route) {
  if (!route || typeof route !== "string") return true;
  if (route.includes("${") || route.includes("encodeURIComponent(")) return true;
  if (route.includes("/hod/:param-faculty/:param")) return true;
  if (route.includes("/user/auth/:param")) return true;
  if (route.includes("/response/queries/:param/answer")) return true;
  if (route.includes("/exam/:param") && !route.includes("/exam/:param/take") && !route.includes("/exam/:param/snapshot") && !route.includes("/exam/:param/responses")) {
    return true;
  }
  return false;
}

function materializeRoute(route) {
  let out = route;
  if (out.includes(":param")) {
    if (!EXAM_ID && (out.includes("/exam/") || out.includes("/retake") || out.includes("/snapshot") || out.includes("/responses"))) {
      return null;
    }
    out = out.replace(/:param/g, EXAM_ID || "1");
  }
  if (out.includes("[responseId]") || out.includes("/response/my/:param")) {
    if (!RESPONSE_ID) return null;
    out = out.replace(/:param/g, RESPONSE_ID);
  }
  if (!out.startsWith("/")) out = `/${out}`;
  return out;
}

function makeHeartbeatBody() {
  const now = new Date().toISOString();
  const examId = Number(EXAM_ID || 0);
  return JSON.stringify({
    exam_id: examId,
    heartbeat_at: now,
    event: "heartbeat",
    response_delta: [],
  });
}

const discovered = loadDiscoveredRoutes();
const fallbackRoutes = [
  "/response/heartbeat",
  "/exam/:param/snapshot",
  "/exam/list",
  "/response/my",
  "/user/session",
  "/exam/faculty-dashboard",
  "/exam/hod-dashboard",
  "/exam/:param/responses",
  "/exam/:param/take",
];

const mergedRoutes = Array.from(new Set([...discovered, ...fallbackRoutes]));

const runnableRoutes = mergedRoutes
  .map((rawRoute) => {
    if (shouldSkipRawRoute(rawRoute)) return null;
    const route = materializeRoute(rawRoute);
    if (!route) return null;
    const method = inferMethod(rawRoute);
    if (method === "GET" && !isAllowedReadRoute(rawRoute)) return null;
    const token = pickToken(rawRoute);
    return { rawRoute, route, method, token };
  })
  .filter((x) => x !== null);

const readCandidates = runnableRoutes.filter((r) => r.method === "GET" && !!r.token);
const heartbeatEnabled = Boolean(EXAM_ID && STUDENT_TOKENS.length > 0);

export const options = {
  scenarios: {
    read_mix: {
      executor: "constant-vus",
      vus: READ_VUS,
      duration: READ_DURATION,
      exec: "readMix",
    },
    ...(heartbeatEnabled
      ? {
          heartbeat_storm: {
            executor: "constant-vus",
            vus: HEARTBEAT_VUS,
            duration: HEARTBEAT_DURATION,
            exec: "heartbeatStorm",
          },
        }
      : {}),
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
    checks: ["rate>0.95"],
    status_5xx: ["count<1"],
  },
};

function trackStatus(res) {
  const s = Number(res && res.status ? res.status : 0);
  if (s >= 200 && s < 300) status2xx.add(1);
  else if (s >= 300 && s < 400) status3xx.add(1);
  else if (s >= 400 && s < 500) status4xx.add(1);
  else if (s >= 500 && s < 600) status5xx.add(1);
  else status0xx.add(1);
}

function trackEndpointMetrics(endpoint, scenario, res) {
  const tags = { endpoint, scenario };
  endpointReqs.add(1, tags);
  if (res && res.timings && Number.isFinite(res.timings.duration)) {
    endpointDuration.add(res.timings.duration, tags);
  }
  const status = Number(res && res.status ? res.status : 0);
  if (status < 200 || status >= 400) {
    endpointFailures.add(1, tags);
  }
}

function extractEndpointFromMetricKey(key) {
  const m = key.match(/endpoint:([^,}]+)/);
  return m ? m[1] : null;
}

function topEndpointSummaries(data, limit = 10) {
  const rows = new Map();
  for (const [key, metric] of Object.entries(data.metrics)) {
    const endpoint = extractEndpointFromMetricKey(key);
    if (!endpoint) continue;

    if (!rows.has(endpoint)) {
      rows.set(endpoint, { endpoint, reqs: 0, failures: 0, p95: null, avg: null });
    }
    const row = rows.get(endpoint);

    if (key.startsWith("endpoint_reqs{")) {
      row.reqs = metric?.values?.count ?? row.reqs;
    }
    if (key.startsWith("endpoint_failures{")) {
      row.failures = metric?.values?.count ?? row.failures;
    }
    if (key.startsWith("endpoint_duration{")) {
      row.p95 = metric?.values?.["p(95)"] ?? row.p95;
      row.avg = metric?.values?.avg ?? row.avg;
    }
  }

  const items = Array.from(rows.values()).filter((r) => r.reqs > 0);
  const withRates = items.map((r) => ({
    ...r,
    failRate: r.reqs > 0 ? r.failures / r.reqs : 0,
  }));

  const slowest = withRates
    .filter((r) => r.p95 !== null)
    .sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0))
    .slice(0, limit);

  const mostFailing = withRates
    .filter((r) => r.failures > 0)
    .sort((a, b) => b.failRate - a.failRate)
    .slice(0, limit);

  return { slowest, mostFailing };
}

export function readMix() {
  if (readCandidates.length === 0) {
    sleep(1);
    return;
  }

  const idx = Math.floor(Math.random() * readCandidates.length);
  const target = readCandidates[idx];
  const headers = {
    "Content-Type": "application/json",
  };
  if (target.token) headers["x-session-token"] = target.token;

  const res = http.get(`${BASE_URL}${target.route}`, {
    headers,
    tags: { endpoint: target.rawRoute, scenario: "read_mix" },
  });

  trackStatus(res);
  trackEndpointMetrics(target.rawRoute, "read_mix", res);

  check(res, {
    "read request ok": (r) => r.status >= 200 && r.status < 500,
  });

  sleep(THINK_MS / 1000);
}

export function heartbeatStorm() {
  if (!heartbeatEnabled) {
    sleep(1);
    return;
  }
  const token = pickStudentTokenByVu() || FACULTY_TOKEN || HOD_TOKEN;
  const body = makeHeartbeatBody();

  const res = http.post(`${BASE_URL}/response/heartbeat`, body, {
    headers: {
      "Content-Type": "application/json",
      "x-session-token": token,
    },
    tags: { endpoint: "/response/heartbeat", scenario: "heartbeat_storm" },
  });

  trackStatus(res);
  trackEndpointMetrics("/response/heartbeat", "heartbeat_storm", res);

  check(res, {
    "heartbeat status acceptable": (r) => r.status >= 200 && r.status < 500,
  });

  sleep(Math.max(0.05, THINK_MS / 1000));
}

function metricLine(data, name) {
  const metric = data.metrics[name];
  if (!metric || !metric.values) return `${name}: n/a`;
  const vals = metric.values;
  const bits = [];
  for (const key of ["count", "rate", "avg", "med", "p(90)", "p(95)", "p(99)", "max"]) {
    if (vals[key] !== undefined) bits.push(`${key}=${vals[key]}`);
  }
  return `${name}: ${bits.join("  ")}`;
}

export function handleSummary(data) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const tops = topEndpointSummaries(data, 10);

  const slowLines = tops.slowest.length
    ? tops.slowest.map((r) => `- ${r.endpoint}: p95=${r.p95}ms avg=${r.avg}ms reqs=${r.reqs}`)
    : ["- n/a"];

  const failLines = tops.mostFailing.length
    ? tops.mostFailing.map((r) => `- ${r.endpoint}: fail_rate=${(r.failRate * 100).toFixed(2)}% fails=${r.failures}/${r.reqs}`)
    : ["- n/a"];

  const text = [
    `Load test summary @ ${new Date().toISOString()}`,
    `Base URL: ${BASE_URL}`,
    `Read candidates: ${readCandidates.length}`,
    `Heartbeat scenario: ${heartbeatEnabled ? "enabled" : "disabled"}`,
    `Student tokens: ${STUDENT_TOKENS.length}`,
    "",
    metricLine(data, "http_reqs"),
    metricLine(data, "http_req_failed"),
    metricLine(data, "http_req_duration"),
    metricLine(data, "checks"),
    metricLine(data, "status_2xx"),
    metricLine(data, "status_3xx"),
    metricLine(data, "status_4xx"),
    metricLine(data, "status_5xx"),
    metricLine(data, "status_0xx"),
    "",
    "Scenarios:",
    `- read_mix: vus=${READ_VUS}, duration=${READ_DURATION}`,
    `- heartbeat_storm: ${heartbeatEnabled ? `vus=${HEARTBEAT_VUS}, duration=${HEARTBEAT_DURATION}` : "disabled"}`,
    "",
    "Top slow endpoints (p95):",
    ...slowLines,
    "",
    "Top failing endpoints:",
    ...failLines,
  ].join("\n");

  return {
    [`load-test/results/summary-${ts}.txt`]: text,
    [`load-test/results/summary-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}
