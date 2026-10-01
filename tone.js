import { laya, timed, h, pct, bar, heat, toast, errorText } from "./laya.js";

// good: whether a high value is desirable in a professional reply
const AXES = [
  { key: "polite", label: "Polite", q: "Is the writer polite and respectful?", good: true },
  { key: "empathetic", label: "Empathetic", q: "Does the writer acknowledge the reader's feelings or situation?", good: true },
  { key: "clear", label: "Clear", q: "Is the message clear and easy to understand?", good: true },
  { key: "actionable", label: "Actionable", q: "Does the message state concrete next steps or actions?", good: true },
  { key: "confident", label: "Confident", q: "Does the writer sound confident and competent?", good: true },
  { key: "defensive", label: "Defensive", q: "Is the writer defensive or blaming the reader?", good: false },
  { key: "angry", label: "Irritated", q: "Does the writer sound irritated, sarcastic or angry?", good: false },
  { key: "vague", label: "Vague", q: "Is the message vague or evasive?", good: false },
];

const QUESTIONS = Object.fromEntries(AXES.map((a) => [a.key, { type: "noul", instructions: a.q }]));
const R = 120;
const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const s = (tag, attrs) => {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const pt = (i, r) => {
  const a = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
};
const poly = (vals) => vals.map((v, i) => pt(i, Math.max(0.04, v) * R).join(",")).join(" ");

// ---------- static radar frame ----------
const svg = $("radar");
[0.25, 0.5, 0.75, 1].forEach((f) => svg.append(s("polygon", { class: "grid-ring", points: poly(AXES.map(() => f)) })));
AXES.forEach((a, i) => {
  const [x, y] = pt(i, R);
  svg.append(s("line", { class: "axis", x1: 0, y1: 0, x2: x, y2: y }));
  const [lx, ly] = pt(i, R + 24);
  const t = s("text", { class: "label", x: lx, y: ly + 4, "text-anchor": Math.abs(lx) < 5 ? "middle" : lx > 0 ? "start" : "end" });
  t.textContent = a.label;
  if (!a.good) t.setAttribute("style", "fill:#fda4af");
  svg.append(t);
});
const prevShape = s("polygon", { class: "shape prev", points: poly(AXES.map(() => 0)) });
const shape = s("polygon", { class: "shape", points: poly(AXES.map(() => 0)) });
svg.append(prevShape, shape);
const dots = AXES.map((_, i) => {
  const c = s("circle", { class: "pt", r: 3, cx: 0, cy: 0 });
  svg.append(c);
  return c;
});

// ---------- updates ----------
let last = null;

function update(vals, data, ms) {
  if (last) prevShape.setAttribute("points", poly(last));
  last = vals;
  shape.setAttribute("points", poly(vals));
  vals.forEach((v, i) => {
    const [x, y] = pt(i, Math.max(0.04, v) * R);
    dots[i].setAttribute("cx", x);
    dots[i].setAttribute("cy", y);
  });

  $("signals").replaceChildren(
    ...AXES.map((a, i) => {
      const goodness = a.good ? vals[i] : 1 - vals[i];
      return h("div", { class: "signal" }, h("span", {}, a.label), h("span", { class: "p" }, pct(vals[i])), bar(vals[i], heat(goodness)));
    }),
  );

  // Overall score: mean "goodness" across axes.
  const score = AXES.reduce((sum, a, i) => sum + (a.good ? vals[i] : 1 - vals[i]), 0) / AXES.length;
  const worst = AXES.map((a, i) => ({ a, g: a.good ? vals[i] : 1 - vals[i] })).sort((x, y) => x.g - y.g).slice(0, 2);
  const tips = {
    polite: "add a greeting or a thank-you",
    empathetic: "acknowledge how this affected them",
    clear: "shorten sentences, one point each",
    actionable: "say exactly what happens next and when",
    confident: "drop hedging words like 'maybe' and 'I think'",
    defensive: "own the issue instead of explaining whose fault it is",
    angry: "remove sarcasm and exclamation marks",
    vague: "add specifics: dates, names, numbers",
  };
  const mood = score > 0.75 ? "Ready to send ✓" : score > 0.55 ? "Decent, could be sharper" : "Rewrite before sending";

  $("verdict").className = "";
  $("verdict").replaceChildren(
    h("div", { style: { font: "700 44px var(--mono)", color: heat(score), letterSpacing: "-0.04em" } }, pct(score)),
    h("div", { style: { fontWeight: 600, marginBottom: "10px" } }, mood),
    score <= 0.85 &&
      h("div", { class: "verdict" }, h("b", {}, "Try: "), worst.filter((w) => w.g < 0.7).map((w) => tips[w.a.key]).join("; ") || "small polish only"),
  );
  $("lat").textContent = `${ms} ms · ${(data.routing?.model ?? data.model)} · ${data.usage?.input_tokens} tokens`;
}

// debounce + drop stale responses
let timer, seq = 0;
$("msg").addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const text = $("msg").value.trim();
    if (text.length < 8) return;
    const id = ++seq;
    $("lat").textContent = "analysing…";
    try {
      const { data, ms } = await timed(() => laya.predict(text, QUESTIONS));
      if (id !== seq) return;
      update(AXES.map((a) => data.answers[a.key].noul), data, ms);
    } catch (err) {
      if (id === seq) toast(errorText(err));
    }
  }, 450);
});
