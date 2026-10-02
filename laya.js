// Shared Laya client + UI helpers. Imported as an ES module by every page.

const API = "/api"; // proxied by server.mjs (laya-serve sends no CORS headers)
export const DEFAULT_BACKEND = "http://localhost:8100";
export const getBackend = () => store.get("backend", DEFAULT_BACKEND);

/**
 * Error text from any backend: laya-serve (FastAPI) sends `detail` as a string or
 * a list of validation errors; Kev sends `error: { message }`; the hosted wrapper
 * sends `error` as a string (plus `code` and `hint`).
 */
function errorMessage(data) {
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join("; ");
  if (typeof data.detail === "string") return data.detail;
  if (typeof data.error === "string") return data.error;
  return data.error?.message || null;
}

async function call(path, body) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Backend": getBackend(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(95_000),
  });
  const data = await res.json().catch(() => ({}));
  // The hosted wrapper can report errors in a 200 body.
  if (!res.ok || typeof data.error === "string") {
    const err = new Error(errorMessage(data) || `HTTP ${res.status}`);
    err.hint = data.hint;
    err.code = data.code;
    throw err;
  }
  return data;
}

/** The hosted wrapper reports cold starts as timeout/refused; its docs recommend one retry. */
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code !== "timeout" && err.code !== "refused") throw err;
    await new Promise((r) => setTimeout(r, 4000));
    return fn();
  }
}

export const laya = {
  health: () => call("/health"),
  predict: async (state, questions, model = getModel()) => {
    if ((await flavor()) === "hosted") return withRetry(() => call("/predict", { state, questions, model }));
    return call("/v1/systemone", { state, questions, model });
  },
  batch: async (states, questions, model = getModel()) => {
    const kind = await flavor();
    if (kind === "hosted") {
      const data = await withRetry(() => call("/batch", { states, questions, model }));
      const failed = data.results.find((r) => r.error);
      if (failed) throw new Error(errorMessage(failed));
      return data;
    }
    if (kind !== "kev") return call("/v1/systemone/batch", { states, questions, model });
    // Kev batches take one full request per item and wrap each result as { ok, result, error }.
    const data = await call("/v1/systemone/batch", { items: states.map((state) => ({ state, questions, model })) });
    const results = data.results.map((r) => {
      if (!r.ok) throw new Error(errorMessage(r) || `Batch item ${r.index} failed`);
      return r.result;
    });
    return { ...data, results };
  },
};

/**
 * Which API a /health reply comes from: Kev reports `backend`, the hosted wrapper
 * (e.g. https://host/api/laya) reports `healthy`/`warm`, plain laya-serve neither.
 */
const kindOf = (s) => (s.backend ? "kev" : "healthy" in s ? "hosted" : "laya");

/** Backend kind, detected once per backend URL. */
let flavorCache = null;
function flavor() {
  const backend = getBackend();
  if (flavorCache?.backend !== backend) {
    flavorCache = { backend, kind: call("/health").then(kindOf).catch(() => "laya") };
  }
  return flavorCache.kind;
}

/** Run fn and return its result plus wall-clock latency in ms. */
export async function timed(fn) {
  const t0 = performance.now();
  const data = await fn();
  return { data, ms: Math.round(performance.now() - t0) };
}

// ---------- persistence ----------
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("laya:" + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem("laya:" + key, JSON.stringify(value));
  },
};

export const getModel = () => store.get("model", "multilingual");

// ---------- DOM helpers ----------
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const pct = (p) => `${Math.round(p * 100)}%`;

/** Map 0..1 to a red -> amber -> green hue. */
export const heat = (p) => `hsl(${Math.round(p * 130)} 85% 60%)`;

export function bar(p, color = "var(--accent)") {
  return h("div", { class: "bar" }, h("i", { style: { width: pct(p), background: color } }));
}

export function toast(msg, kind = "err") {
  const t = h("div", { class: `toast ${kind}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add("out"), 4200);
  setTimeout(() => t.remove(), 4800);
}

export function errorText(err) {
  if (err.name === "TimeoutError") return "Laya did not answer in time";
  return err.hint ? `${err.message}: ${err.hint}` : err.message;
}

// ---------- shared chrome: nav + status pill + model picker ----------
const PAGES = [
  ["index.html", "Task Router"],
  ["triage.html", "Triage Board"],
  ["tone.html", "Tone Radar"],
  ["go.html", "Laya vs Laya"],
  ["snake.html", "Snake"],
  ["wiki.html", "Wiki Race"],
  ["firewall.html", "Firewall"],
  ["cite.html", "Citations"],
];

function mountChrome() {
  const here = location.pathname.split("/").pop() || "index.html";
  const status = h("span", { class: "status", title: "Laya server status" }, h("b"), "checking…");
  const backend = h("input", {
    class: "backend", value: getBackend(), spellcheck: "false",
    title: "Decision backend: laya-serve or Kev (http://host:port) or the hosted wrapper (https://host/api/laya). Empty resets to the default.",
    onchange: (e) => {
      const v = e.target.value.trim().replace(/\/+$/, "") || DEFAULT_BACKEND;
      e.target.value = v;
      store.set("backend", v);
      refresh();
    },
  });
  const picker = h(
    "select",
    { class: "model", title: "Laya checkpoint", onchange: (e) => store.set("model", e.target.value) },
    ...["multilingual", "english", "typed-decisions", "auto"].map((m) =>
      h("option", { value: m, selected: m === getModel() }, m),
    ),
  );
  const nav = h(
    "header",
    { class: "top" },
    h("a", { class: "brand", href: "index.html" }, h("span", { class: "logo" }, "◆"), "laya", h("small", {}, "lab")),
    h("nav", {}, ...PAGES.map(([href, label]) => h("a", { href, class: href === here ? "on" : null }, label))),
    h("div", { class: "right" }, backend, picker, status),
  );
  document.body.prepend(nav);

  const refresh = async () => {
    try {
      const s = await laya.health();
      const kind = kindOf(s);
      const ok = kind === "hosted" ? s.healthy : s.status === "ok";
      status.className = `status ${ok ? "ok" : "down"}`;
      const detail = kind === "hosted" ? `${s.device || "?"}${s.warm ? "" : s.warming_up ? " · warming up" : " · cold"}` : s.device || s.backend;
      status.lastChild.textContent = ok ? `${kind} · ${detail}` : s.status || "down";
    } catch {
      status.className = "status down";
      status.lastChild.textContent = "unreachable";
    }
  };
  refresh();
  setInterval(refresh, 30_000);
}

mountChrome();
