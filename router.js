import { laya, timed, store, h, pct, bar, toast, errorText } from "./laya.js";

const EXAMPLES = [
  { name: "Billing", desc: "Invoices, payments, refunds, pricing questions and contract renewals." },
  { name: "Platform Ops", desc: "Outages, downtime, latency, infrastructure, deployments and on-call incidents." },
  { name: "Frontend Team", desc: "Bugs in the web portal UI: broken pages, layout issues, buttons not working." },
  { name: "Security", desc: "Suspicious logins, leaked credentials, vulnerabilities, access and permission requests." },
  { name: "Anna (Data)", desc: "Reports, dashboards, exports, analytics and data quality problems." },
  { name: "Customer Success", desc: "Onboarding, training, feature questions, general feedback and account management." },
];

const PALETTE = ["#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#4ade80"];

let targets = store.get("targets", EXAMPLES);
const $ = (id) => document.getElementById(id);

// ---------- targets editor ----------
function renderTargets() {
  const list = $("targets");
  list.replaceChildren(
    ...targets.map((t, i) => {
      const save = () => store.set("targets", targets);
      return h(
        "div",
        { class: "target" },
        h("div", { class: "avatar", style: { background: PALETTE[i % PALETTE.length] } }, (t.name || "?").trim()[0]?.toUpperCase() || "?"),
        h("input", { value: t.name, placeholder: "Name", oninput: (e) => { t.name = e.target.value; save(); } }),
        h("button", { class: "btn ghost", title: "Remove", onclick: () => { targets.splice(i, 1); save(); renderTargets(); } }, "✕"),
        h("textarea", { rows: 2, placeholder: "What do they handle?", oninput: (e) => { t.desc = e.target.value; save(); } }, t.desc),
      );
    }),
  );
  $("count").textContent = targets.length;
  $("warn").textContent = targets.length > 20 ? "⚠ Laya accuracy degrades above ~20 options." : "";
}

$("add").onclick = () => {
  targets.push({ name: "", desc: "" });
  store.set("targets", targets);
  renderTargets();
  $("targets").lastChild.querySelector("input").focus();
};
$("reset").onclick = () => {
  targets = structuredClone(EXAMPLES);
  store.set("targets", targets);
  renderTargets();
};

// ---------- routing ----------
function buildQuestions(valid) {
  // Choice keys must be unique; description goes in as the criterion.
  const criteria = {};
  valid.forEach((t) => (criteria[t.name.trim()] = t.desc.trim() || t.name.trim()));
  return {
    target: {
      type: "choice",
      instructions: "Which department or person is best suited to handle this task or support request?",
      criteria,
    },
    urgency: {
      type: "score",
      instructions: "How urgent is this task?",
      criteria: ["can wait", "this week", "today", "drop everything"],
    },
  };
}

function renderResult(card, text, data, valid, ms) {
  const { target, urgency } = data.answers;
  const ranked = Object.entries(target.probabilities).sort((a, b) => b[1] - a[1]);
  const colorOf = (name) => PALETTE[valid.findIndex((t) => t.name.trim() === name) % PALETTE.length];
  const urgLabel = urgency.legend[Math.round(urgency.score)];
  const urgP = urgency.score / (Object.keys(urgency.legend).length - 1);

  card.className = "result";
  card.replaceChildren(
    h("div", { class: "q" }, text),
    h(
      "div",
      { class: "rank" },
      ranked.map(([name, p], i) =>
        h(
          "div",
          { class: `rank-item ${i === 0 ? "top" : ""} ${p < 0.02 ? "dim" : ""}` },
          h("span", { class: "n" }, i + 1),
          h("span", { class: "name", title: name }, name),
          bar(p, colorOf(name)),
          h("span", { class: "p" }, pct(p)),
        ),
      ),
    ),
    h(
      "div",
      { class: "meta" },
      h("span", { class: "chip", style: { borderColor: `hsl(${130 - urgP * 130} 85% 60%)` } }, `urgency · ${urgLabel}`),
      h("span", {}, `confidence ${pct(target.confidence)}`),
      h("span", {}, `${ms} ms`),
      h("span", {}, (data.routing?.model ?? data.model)),
    ),
  );
}

async function route() {
  const raw = $("task").value.trim();
  if (!raw) return;
  const valid = targets.filter((t) => t.name.trim());
  if (valid.length < 2) return toast("Add at least two named targets first.");

  const tasks = raw.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const questions = buildQuestions(valid);
  $("task").value = "";
  $("empty")?.remove();

  const cards = tasks.map((text) => {
    const card = h("div", { class: "result loading" }, h("div", { class: "q" }, text));
    $("feed").prepend(card);
    return card;
  });

  $("go").disabled = true;
  try {
    // One task -> predict; many -> a single batch call.
    const { data, ms } = await timed(() =>
      tasks.length === 1 ? laya.predict(tasks[0], questions) : laya.batch(tasks.slice(0, 50), questions),
    );
    const results = tasks.length === 1 ? [data] : data.results;
    results.forEach((r, i) => renderResult(cards[i], tasks[i], r, valid, ms));
  } catch (err) {
    cards.forEach((c) => c.remove());
    $("task").value = raw;
    toast(errorText(err));
  } finally {
    $("go").disabled = false;
  }
}

$("task").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    route();
  }
});
$("go").onclick = route;

renderTargets();
