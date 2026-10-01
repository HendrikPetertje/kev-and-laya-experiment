import { laya, timed, h, pct, bar, heat, toast, errorText } from "./laya.js";

const WIKI = "https://en.wikipedia.org/w/api.php";
const MAX_HOPS = 20;
const MAX_LINKS = 500;
const CHUNK = 50;
const $ = (id) => document.getElementById(id);

let gen = 0;

async function wiki(params) {
  const url = new URL(WIKI);
  for (const [k, v] of Object.entries({ format: "json", formatversion: 2, origin: "*", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia: HTTP ${res.status}`);
  return res.json();
}

/** Resolve redirects / casing to the canonical article title. */
async function canonical(title) {
  const data = await wiki({ action: "query", titles: title, redirects: 1 });
  const page = data.query.pages[0];
  if (page.missing) throw new Error(`No Wikipedia article called "${title}"`);
  return page.title;
}

/** All article-namespace links on a page (following redirects), capped at MAX_LINKS. */
async function links(title) {
  const out = [];
  let cont = {};
  do {
    const data = await wiki({ action: "query", titles: title, redirects: 1, prop: "links", plnamespace: 0, pllimit: "max", ...cont });
    for (const l of data.query.pages[0].links || []) out.push(l.title);
    cont = data.continue || null;
  } while (cont && out.length < MAX_LINKS);
  return [...new Set(out)].filter((t) => !/^(List of|Index of)|\(disambiguation\)$/.test(t)).slice(0, MAX_LINKS);
}

async function randomTitle() {
  const data = await wiki({ action: "query", list: "random", rnnamespace: 0, rnlimit: 1 });
  return data.query.random[0].title;
}

const articleUrl = (t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replaceAll(" ", "_"))}`;

function renderPath(path, done) {
  $("hops").textContent = path.length - 1;
  $("path").replaceChildren(
    ...path.flatMap((t, i) => [
      i ? h("span", { class: "arrow" }, "→") : null,
      h("a", { href: articleUrl(t), target: "_blank", rel: "noopener", class: done && i === path.length - 1 ? "goal" : null }, t),
    ]),
  );
}

function renderLinks(scored, visited) {
  $("links").className = "";
  $("links").replaceChildren(
    h("div", { class: "rank" }, scored.slice(0, 12).map(({ t, p }, i) =>
      h("div", { class: `rank-item ${i === 0 ? "top" : ""} ${visited.has(t) ? "dim" : ""}`, style: { gridTemplateColumns: "28px minmax(0,1fr) 120px 48px" } },
        h("span", { class: "n" }, i + 1), h("span", { class: "name", title: t }, t), bar(p, heat(p)), h("span", { class: "p" }, pct(p))))),
  );
}

const status = (t) => ($("status").textContent = t);

async function race() {
  const myGen = ++gen;
  $("go").disabled = true;
  try {
    const [start, target] = await Promise.all([canonical($("start").value.trim()), canonical($("target").value.trim())]);
    const path = [start];
    const visited = new Set(path);
    let layaMs = 0;
    renderPath(path);
    while (path.length <= MAX_HOPS) {
      const here = path.at(-1);
      if (here === target) {
        renderPath(path, true);
        status(`Reached "${target}" in ${path.length - 1} hops. Laya spent ${(layaMs / 1000).toFixed(1)} s thinking.`);
        toast(`Made it in ${path.length - 1} hops!`, "ok");
        return;
      }
      status(`Reading links on "${here}"…`);
      const all = await links(here);
      if (myGen !== gen) return;
      if (all.includes(target)) {
        path.push(target);
        renderPath(path);
        continue;
      }
      const options = all.filter((t) => !visited.has(t));
      if (!options.length) throw new Error(`Dead end: "${here}" has no unvisited links.`);

      // Score every link with one shared noul question, 50 links per batch call.
      const question = {
        toward: {
          type: "noul",
          instructions: `We are racing through Wikipedia to reach the article "${target}" by clicking links. Would opening this article bring us closer to "${target}" (it is closely related, or a broad topic likely to link to it)?`,
        },
      };
      const scored = [];
      for (let i = 0; i < options.length; i += CHUNK) {
        status(`Scoring ${options.length} links on "${here}"… (${Math.min(i + CHUNK, options.length)}/${options.length})`);
        const chunk = options.slice(i, i + CHUNK);
        const { data, ms } = await timed(() => laya.batch(chunk.map((t) => `Wikipedia article: ${t}`), question));
        if (myGen !== gen) return;
        layaMs += ms;
        data.results.forEach((r, j) => scored.push({ t: chunk[j], p: r.answers.toward.noul }));
        scored.sort((a, b) => b.p - a.p);
        renderLinks(scored, visited);
      }
      const next = scored[0].t;
      visited.add(next);
      path.push(next);
      renderPath(path);
    }
    status(`Gave up after ${MAX_HOPS} hops.`);
  } catch (err) {
    if (myGen === gen) {
      status(errorText(err));
      toast(errorText(err));
    }
  } finally {
    if (myGen === gen) $("go").disabled = false;
  }
}

$("go").onclick = race;
$("random").onclick = async () => {
  try {
    const [a, b] = await Promise.all([randomTitle(), randomTitle()]);
    $("start").value = a;
    $("target").value = b;
  } catch (err) {
    toast(errorText(err));
  }
};
