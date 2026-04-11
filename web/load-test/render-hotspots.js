import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const status2xx = new Counter("status_2xx");
const status3xx = new Counter("status_3xx");
const status4xx = new Counter("status_4xx");
const status5xx = new Counter("status_5xx");
const status0xx = new Counter("status_0xx");

function readDotEnv() {
  try {
    const raw = open("./.env");
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
    return {};
  }
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

if (!BASE_URL) {
  throw new Error("BASE_URL is required, e.g. https://your-render-url.onrender.com");
}

function loadDiscoveredRoutes() {
  try {
    const raw = open("./generated/hotspots.json");
    const data = JSON.parse(raw);
    if (Array.isArray(data.endpoints)) {
      return data.endpoints.map((x) => x.route).filter(Boolean);
    }
  } catch (_err) {
    // ignore missing generated file
  }
  return [];
}

function pickToken(route) {
  if (route.includes("/hod") || route.includes("hod-dashboard")) return HOD_TOKEN || FACULTY_TOKEN || STUDENT_TOKEN;
  if (route.includes("/faculty") || route.includes("faculty-dashboard")) return FACULTY_TOKEN || HOD_TOKEN || STUDENT_TOKEN;
  return STUDENT_TOKEN || FACULTY_TOKEN || HOD_TOKEN;
}

function inferMethod(route) {
  if (route.includes("/response/heartbeat")) return "POST";
  if (route.includes("/response/submit")) return "POST";
  return "GET";
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
    const route = materializeRoute(rawRoute);
    if (!route) return null;
    const method = inferMethod(rawRoute);
    const token = pickToken(rawRoute);
    return { rawRoute, route, method, token };
  })
  .filter((x) => x !== null);

const readCandidates = runnableRoutes.filter((r) => r.method === "GET");
const heartbeatEnabled = Boolean(EXAM_ID && (STUDENT_TOKEN || FACULTY_TOKEN || HOD_TOKEN));

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
  const token = STUDENT_TOKEN || FACULTY_TOKEN || HOD_TOKEN;
  const body = makeHeartbeatBody();

  const res = http.post(`${BASE_URL}/response/heartbeat`, body, {
    headers: {
      "Content-Type": "application/json",
      "x-session-token": token,
    },
    tags: { endpoint: "/response/heartbeat", scenario: "heartbeat_storm" },
  });

  trackStatus(res);

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
  const text = [
    `Load test summary @ ${new Date().toISOString()}`,
    `Base URL: ${BASE_URL}`,
    `Read candidates: ${readCandidates.length}`,
    `Heartbeat scenario: ${heartbeatEnabled ? "enabled" : "disabled"}`,
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
  ].join("\n");

  return {
    [`load-test/results/summary-${ts}.txt`]: text,
    [`load-test/results/summary-${ts}.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}
