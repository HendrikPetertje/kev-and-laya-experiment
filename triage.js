import { laya, timed, h, pct, bar, heat, toast, errorText } from "./laya.js";

const LANES = {
  bug: { label: "Bugs", color: "#f43f5e", desc: "something is broken, crashing, erroring or not working as expected" },
  outage: { label: "Outage", color: "#fb923c", desc: "service down, unreachable, severe slowness affecting many users" },
  billing: { label: "Billing", color: "#fbbf24", desc: "invoices, charges, refunds, pricing, payments" },
  access: { label: "Access", color: "#60a5fa", desc: "login, password, permissions, accounts, security" },
  feature: { label: "Feature request", color: "#a78bfa", desc: "asks for new functionality or an improvement" },
  question: { label: "Question", color: "#22d3ee", desc: "how-to questions, information requests" },
  praise: { label: "Feedback", color: "#34d399", desc: "thanks, compliments, general feedback" },
};

const QUESTIONS = {
  category: {
    type: "choice",
    instructions: "What kind of ticket is this?",
    criteria: Object.fromEntries(Object.entries(LANES).map(([k, v]) => [k, v.desc])),
  },
  urgency: {
    type: "score",
    instructions: "How urgent is this ticket?",
    criteria: ["not urgent", "soon", "today", "critical right now"],
  },
  churn: { type: "noul", instructions: "Is the customer threatening to cancel, leave, or switch to a competitor?" },
  positive: { type: "noul", instructions: "Is the customer's tone positive or satisfied?" },
};

const SAMPLE = `We were billed twice for March. Please refund the duplicate.
The dashboard has been completely down for all our users since 9am!!
Would be great if we could export the trip report as Excel.
How do I add a new driver to my fleet?
I can't log in anymore, the password reset email never arrives.
Just wanted to say the new map view is fantastic, great job team.
Your app crashes every single time I open the settings page. Third time I report this, fix it or we move to another provider.
Can we get a quote for 200 extra licenses?
API returns 500 on /vehicles since the last deploy.
Some colleague of mine should not have admin rights, please revoke them ASAP.`;

const $ = (id) => document.getElementById(id);

$("sample").onclick = () => ($("inbox").value = SAMPLE);

function split(raw) {
  const parts = raw.includes("\n\n") ? raw.split(/\n\s*\n/) : raw.split("\n");
  return parts.map((s) => s.trim()).filter(Boolean);
}

function render(tickets) {
  const byLane = Object.fromEntries(Object.keys(LANES).map((k) => [k, []]));
  tickets.forEach((t) => byLane[t.category]?.push(t));
  const maxU = QUESTIONS.urgency.criteria.length - 1;

  let delay = 0;
  $("board").replaceChildren(
    ...Object.entries(LANES)
      .filter(([k]) => byLane[k].length)
      .map(([k, lane]) =>
        h(
          "div",
          { class: "lane" },
          h("h3", {}, h("span", { class: "dot", style: { background: lane.color } }), lane.label, h("span", { class: "count" }, byLane[k].length)),
          byLane[k]
            .sort((a, b) => b.urgency - a.urgency)
            .map((t) => {
              const u = t.urgency / maxU;
              return h(
                "div",
                { class: "ticket", style: { "--c": lane.color, animationDelay: `${(delay += 40)}ms` } },
                h("div", { class: "t", title: t.text }, t.text),
                h("div", { class: "urgency-gauge" }, "urgency", bar(u, heat(1 - u)), t.urgencyLabel),
                h(
                  "div",
                  { class: "chips", style: { marginTop: "8px" } },
                  t.churn > 0.5 && h("span", { class: "chip", style: { borderColor: "var(--warn)", color: "var(--warn)" } }, `churn ${pct(t.churn)}`),
                  h("span", { class: "chip" }, `${pct(t.confidence)} sure`),
                  h("span", { class: "chip" }, t.positive > 0.6 ? "😊" : t.positive < 0.25 ? "😠" : "😐"),
                ),
              );
            }),
        ),
      ),
  );

  const avgMood = tickets.reduce((s, t) => s + t.positive, 0) / tickets.length;
  $("stats").hidden = false;
  $("s-total").textContent = tickets.length;
  $("s-urgent").textContent = tickets.filter((t) => t.urgency >= maxU - 1.5).length;
  $("s-churn").textContent = tickets.filter((t) => t.churn > 0.5).length;
  $("s-mood").textContent = pct(avgMood);
  $("s-mood").style.color = heat(avgMood);
}

async function triage() {
  const states = split($("inbox").value);
  if (!states.length) return;
  if (states.length > 50) toast(`Only the first 50 of ${states.length} tickets are processed.`);

  $("go").disabled = true;
  $("go").textContent = "Triaging…";
  try {
    const { data, ms } = await timed(() => laya.batch(states.slice(0, 50), QUESTIONS));
    const tickets = data.results
      .map((r, i) => {
        const a = r.answers;
        return {
          text: states[i],
          category: a.category.choice,
          confidence: a.category.confidence,
          urgency: a.urgency.score,
          urgencyLabel: a.urgency.legend[Math.round(a.urgency.score)],
          churn: a.churn.noul,
          positive: a.positive.noul,
        };
      });
    render(tickets);
    toast(`Triaged ${tickets.length} tickets in ${ms} ms`, "ok");
  } catch (err) {
    toast(errorText(err));
  } finally {
    $("go").disabled = false;
    $("go").textContent = "Triage →";
  }
}

$("go").onclick = triage;
$("inbox").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    triage();
  }
});
