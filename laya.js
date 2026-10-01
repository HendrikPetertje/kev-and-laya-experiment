// Shared Laya client + UI helpers. Imported as an ES module by every page.

const API = "/api"; // proxied by server.mjs (laya-serve sends no CORS headers)
export const DEFAULT_BACKEND = "http://localhost:8100";
export const getBackend = () => store.get("backend", DEFAULT_BACKEND);

/**
 * Error text from either backend: laya-serve (FastAPI) sends `detail` as a string or
 * a list of validation errors; Kev sends `error: { message }`.
 */
function errorMessage(data) {
  if (Array.isArray(data.detail)) return data.detail.map((d) => d.msg).join("; ");
  if (typeof data.detail === "string") return data.detail;
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
  if (!res.ok) throw new Error(errorMessage(data) || `HTTP ${res.status}`);
  return data;
}

export const laya = {
  health: () => call("/health"),
  predict: (state, questions, model = getModel()) => call("/v1/systemone", { state, questions, model }),
  batch: async (states, questions, model = getModel()) => {
    if ((await flavor()) !== "kev") return call("/v1/systemone/batch", { states, questions, model });
    // Kev batches take one full request per item and wrap each result as { ok, result, error }.
    const data = await call("/v1/systemone/batch", { items: states.map((state) => ({ state, questions, model })) });
    const results = data.results.map((r) => {
      if (!r.ok) throw new Error(errorMessage(r) || `Batch item ${r.index} failed`);
      return r.result;
    });
    return { ...data, results };
  },
};

/** "kev" or "laya", detected once per backend from /health (Kev reports a `backend` field). */
let flavorCache = null;
function flavor() {
  const backend = getBackend();
  if (flavorCache?.backend !== backend) {
    flavorCache = { backend, kind: call("/health").then((s) => (s.backend ? "kev" : "laya")).catch(() => "laya") };
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
  return err.name === "TimeoutError" ? "Laya did not answer in time" : err.message;
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
    title: "Decision backend (laya-serve or Kev). Empty resets to the default.",
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
      const ok = s.status === "ok";
      status.className = `status ${ok ? "ok" : "down"}`;
      status.lastChild.textContent = ok ? `${s.backend ? "kev" : "laya"} · ${s.device || s.backend}` : s.status || "down";
    } catch {
      status.className = "status down";
      status.lastChild.textContent = "unreachable";
    }
  };
  refresh();
  setInterval(refresh, 30_000);
}

mountChrome();
