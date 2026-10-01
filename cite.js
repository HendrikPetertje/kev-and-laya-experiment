import { laya, timed, h, pct, toast, errorText } from "./laya.js";

const SAMPLES = {
  "Eiffel Tower": {
    claim: "The Eiffel Tower was built for the 1889 World's Fair.",
    source:
      "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France. It is named after the engineer Gustave Eiffel, whose company designed and built the tower from 1887 to 1889. Locally nicknamed \"La dame de fer\", it was constructed as the centrepiece of the 1889 World's Fair. Although initially criticised by some of France's leading artists, it has since become a global cultural icon. The tower received 5,889,000 visitors in 2022.",
  },
  "Coffee myth": {
    claim: "Drinking coffee stunts children's growth.",
    source:
      "The idea that coffee stunts growth has circulated for decades. However, there is no scientific evidence that caffeine affects height. Long-term studies following children into adulthood found no difference in growth between coffee drinkers and non-drinkers. The myth may stem from early 20th-century advertising for coffee substitutes. Health experts still advise limiting caffeine for children because it can disrupt sleep.",
  },
  "Mixed bag": {
    claim: "The company's revenue grew in 2025.",
    source:
      "Acme Corp reported its annual results on Monday. Revenue for 2025 came in at €412 million, down from €450 million a year earlier. The CEO blamed weaker demand in Europe. Operating margin improved slightly thanks to cost cuts. The company also announced a new headquarters in Rotterdam.",
  },
};

const LABELS = {
  supports: "the sentence provides evidence that the claim is true",
  contradicts: "the sentence provides evidence that the claim is false",
  unrelated: "the sentence says nothing about whether the claim is true",
};

const $ = (id) => document.getElementById(id);

/** Naive sentence splitter that keeps "e.g." / "Dr." / decimals mostly intact. */
const sentences = (text) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?]["”')\]]?)\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);

async function check() {
  const claim = $("claim").value.trim();
  const source = $("source").value.trim();
  if (!claim || !source) return toast("Give both a claim and a source.");
  const parts = sentences(source).slice(0, 50);
  $("go").disabled = true;
  try {
    const { data, ms } = await timed(() =>
      Promise.all([
        laya.batch(parts.map((s) => `Claim: ${claim}\nSource sentence: ${s}`), {
          relation: { type: "choice", instructions: "How does the source sentence relate to the claim?", criteria: LABELS },
        }),
        laya.predict(`Claim: ${claim}\n\nSource:\n${source}`, {
          overall: {
            type: "choice",
            instructions: "Taking the whole source into account, is the claim supported by it?",
            criteria: {
              supported: "the source confirms the claim",
              contradicted: "the source shows the claim is false",
              "not addressed": "the source does not say whether the claim is true",
            },
          },
        }),
      ]),
    );
    const [batch, whole] = data;
    render(parts, batch.results.map((r) => r.answers.relation), whole.answers.overall, ms);
  } catch (err) {
    toast(errorText(err));
  } finally {
    $("go").disabled = false;
  }
}

function render(parts, rels, overall, ms) {
  const best = (label) => rels.reduce((m, r, i) => (r.probabilities[label] > m.p ? { p: r.probabilities[label], i } : m), { p: 0, i: -1 });
  const sup = best("supports");
  const con = best("contradicts");
  const color = { supported: "var(--good)", contradicted: "var(--bad)", "not addressed": "var(--muted)" }[overall.choice];

  $("verdict").className = "";
  $("verdict").replaceChildren(
    h("div", { class: "big-verdict", style: { color } }, overall.choice.toUpperCase()),
    h("div", { style: { fontWeight: 600, marginBottom: "10px" } }, `${pct(overall.probabilities[overall.choice])} on the whole source · confidence ${pct(overall.confidence)}`),
    h("div", { class: "verdict" },
      h("b", {}, "Strongest support: "), sup.p > 0.5 ? `“${parts[sup.i]}” (${pct(sup.p)})` : "none",
      h("br"),
      h("b", {}, "Strongest contradiction: "), con.p > 0.5 ? `“${parts[con.i]}” (${pct(con.p)})` : "none"),
    h("div", { class: "hint", style: { marginTop: "10px", fontFamily: "var(--mono)", fontSize: "11px" } }, `${parts.length} sentences · ${ms} ms`),
  );
  $("view").className = "source-view";
  $("view").replaceChildren(
    ...parts.flatMap((s, i) => {
      const r = rels[i];
      const tip = Object.entries(r.probabilities).map(([k, p]) => `${k} ${pct(p)}`).join(" · ");
      return [h("span", { class: r.choice, title: tip }, s), " "];
    }),
  );
}

$("samples").append(
  ...Object.entries(SAMPLES).map(([label, s]) =>
    h("button", { class: "btn", onclick: () => { $("claim").value = s.claim; $("source").value = s.source; check(); } }, label),
  ),
);
$("go").onclick = check;
