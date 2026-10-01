import { laya, timed, h, pct, bar, toast, errorText } from "./laya.js";

const N = 14;
const CELL = 40;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ARROW = { up: "↑", down: "↓", left: "←", right: "→" };
const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const S = (tag, attrs, text) => {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};

let game, running = false, gen = 0, totalMs = 0, asked = 0, ghost = null;

function newGame() {
  const mid = N >> 1;
  game = { snake: [[mid, mid], [mid - 1, mid], [mid - 2, mid]], dir: "right", food: null, score: 0, steps: 0, over: null, hunger: 0, trail: [] };
  placeFood();
  totalMs = 0;
  asked = 0;
  ghost = null;
}

const key = ([x, y]) => `${x},${y}`;
const inside = ([x, y]) => x >= 0 && y >= 0 && x < N && y < N;

function placeFood() {
  const taken = new Set(game.snake.map(key));
  const free = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!taken.has(key([x, y]))) free.push([x, y]);
  game.food = free[Math.floor(Math.random() * free.length)];
}

/** Cells reachable from `start` if the snake's head moved there (tail moves away too). */
function room(start, eats) {
  const body = game.snake.slice(0, eats ? game.snake.length : game.snake.length - 1);
  const blocked = new Set(body.map(key));
  const seen = new Set([key(start)]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of Object.values(DIRS)) {
      const n = [x + dx, y + dy];
      if (inside(n) && !blocked.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
    }
  }
  return seen.size;
}

const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Plain-language direction from `a` to `b`, e.g. "3 right and 2 up". */
function offset(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const parts = [];
  if (dx) parts.push(`${Math.abs(dx)} ${dx > 0 ? "right" : "left"}`);
  if (dy) parts.push(`${Math.abs(dy)} ${dy > 0 ? "down" : "up"}`);
  return parts.join(" and ") || "same cell";
}

/**
 * Game state for Laya. Kept deliberately small: tested against laya-serve, an
 * ASCII board made it worse, and direction words here ("moving right", "3 left")
 * pull it towards the option with that name. The facts live in the option labels.
 */
function describe() {
  return `Snake game. The goal is to reach the apple without getting trapped. Snake length ${game.snake.length}, apples eaten ${game.score}.`;
}

/** Moves that don't crash this tick, each with all the facts Laya needs. */
function candidates() {
  const head = game.snake[0];
  const body = new Set(game.snake.slice(0, -1).map(key));
  const now = dist(head, game.food);
  return Object.entries(DIRS)
    .map(([name, [dx, dy]]) => {
      const to = [head[0] + dx, head[1] + dy];
      if (!inside(to) || body.has(key(to))) return null;
      const eats = key(to) === key(game.food);
      const space = room(to, eats);
      const d = dist(to, game.food);
      const ago = game.trail.lastIndexOf(key(to));
      // Laya picks best between short, contrasting labels (long notes blur the options),
      // so the label is one verdict; the full board goes into the state.
      const trapped = space < game.snake.length;
      const desc = trapped ? "dead end, the snake gets trapped and dies"
        : eats ? "eats the apple"
        : ago >= 0 ? (d < now ? "closer to the apple, but goes in circles" : "further from the apple and goes in circles")
        : d < now ? "closer to the apple" : "further from the apple";
      return { name, to, eats, space, d, desc };
    })
    .filter(Boolean);
}

async function loop() {
  const myGen = gen;
  while (running && !game.over && myGen === gen) {
    const cands = candidates();
    if (!cands.length) { game.over = "Boxed in, no safe move left."; break; }
    let pick = cands[0], a = null, ms = 0;
    if (cands.length > 1) {
      try {
        const res = await timed(() =>
          laya.predict(describe(), {
            move: {
              type: "choice",
              instructions: "Which move brings the snake closer to the apple?",
              // Neutral keys: with "up"/"right" as keys Laya favours the key name over the label.
              criteria: Object.fromEntries(cands.map((c, i) => [`move ${i + 1}`, c.desc])),
            },
          }),
        );
        if (myGen !== gen) return;
        ms = res.ms;
        asked++;
        // Map "move N" back to direction names for display.
        const raw = res.data.answers.move;
        const probs = Object.fromEntries(cands.map((c, i) => [c.name, raw.probabilities[`move ${i + 1}`] ?? 0]));
        a = { ...raw, probabilities: probs, choice: cands[Number(raw.choice.split(" ")[1]) - 1]?.name };
        pick = cands.find((c) => c.name === a.choice) || pick;
      } catch (err) {
        if (myGen !== gen) return;
        running = false;
        toast(errorText(err));
        break;
      }
    }
    totalMs += ms;
    ghost = a && cands.map((c) => ({ ...c, p: a.probabilities[c.name] ?? 0 }));
    step(pick);
    showThoughts(pick, cands, a, ms);
    draw();
    await new Promise((r) => setTimeout(r, 60));
  }
  running = false;
  draw();
  syncControls();
}

function step(pick) {
  game.dir = pick.name;
  game.trail.push(key(game.snake[0]));
  if (game.trail.length > 12) game.trail.shift();
  game.snake.unshift(pick.to);
  game.steps++;
  if (pick.eats) {
    game.score++;
    game.hunger = 0;
    game.trail = [];
    if (game.snake.length === N * N) game.over = "Board filled. Laya wins!";
    else placeFood();
  } else {
    game.snake.pop();
    if (++game.hunger > N * N * 2) game.over = "Starved: going in circles.";
  }
}

function showThoughts(pick, cands, a, ms) {
  $("thoughts").className = "";
  const rows = cands
    .map((c) => ({ c, p: a ? a.probabilities[c.name] ?? 0 : 1 }))
    .sort((x, y) => y.p - x.p);
  $("thoughts").replaceChildren(
    h("div", { style: { marginBottom: "10px" } }, h("b", {}, `${ARROW[pick.name]} ${pick.name}`), a ? "" : h("span", { class: "hint" }, "  (only safe move, no question asked)")),
    h("div", { class: "rank" }, rows.map(({ c, p }, i) =>
      h("div", { class: `rank-item ${i === 0 ? "top" : ""}`, style: { gridTemplateColumns: "28px 60px 1fr 48px" } },
        h("span", { class: "n" }, ARROW[c.name]), h("span", { class: "name" }, c.name), bar(p), h("span", { class: "p" }, pct(p))))),
    h("div", { class: "hint", style: { marginTop: "10px" } }, pick.desc),
    a && h("div", { class: "meta hint", style: { marginTop: "8px", fontFamily: "var(--mono)", fontSize: "11px" } }, `${ms} ms · confidence ${pct(a.confidence)}`),
  );
}

function draw() {
  const svg = $("board");
  svg.setAttribute("viewBox", `0 0 ${N * CELL} ${N * CELL}`);
  const els = [];
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++)
    els.push(S("rect", { class: "cell", x: x * CELL + 2, y: y * CELL + 2, width: CELL - 4, height: CELL - 4, rx: 6 }));
  els.push(S("circle", { class: "food", cx: game.food[0] * CELL + CELL / 2, cy: game.food[1] * CELL + CELL / 2, r: CELL / 3 }));
  game.snake.forEach(([x, y], i) => {
    const fade = 1 - (i / game.snake.length) * 0.6;
    els.push(S("rect", { class: i ? "body" : "head", x: x * CELL + 3, y: y * CELL + 3, width: CELL - 6, height: CELL - 6, rx: 9, opacity: i ? fade : 1 }));
  });
  // Ghost labels: the probabilities Laya gave the alternatives this tick
  for (const g of ghost || []) {
    if (key(g.to) === key(game.snake[0])) continue;
    els.push(S("text", { class: "ghost", x: g.to[0] * CELL + CELL / 2, y: g.to[1] * CELL + CELL / 2, opacity: 0.4 + g.p * 0.6 }, pct(g.p)));
  }
  if (game.over) {
    els.push(S("rect", { x: 0, y: N * CELL / 2 - 40, width: N * CELL, height: 80, fill: "rgba(7,8,13,0.85)" }));
    els.push(S("text", { x: (N * CELL) / 2, y: (N * CELL) / 2, fill: "#fff", "text-anchor": "middle", "dominant-baseline": "central", style: "font:700 20px Inter" }, game.over));
  }
  svg.replaceChildren(...els);
  $("score").textContent = game.score;
  $("steps").textContent = game.steps;
  $("lat").textContent = asked ? Math.round(totalMs / asked) : "–";
}

function syncControls() {
  $("play").textContent = running ? "❚❚ Pause" : game.steps ? "▶ Resume" : "▶ Play";
  $("play").disabled = !!game.over;
}

$("play").onclick = () => {
  running = !running;
  syncControls();
  if (running) loop();
};
$("reset").onclick = () => {
  gen++;
  running = false;
  newGame();
  draw();
  syncControls();
  $("thoughts").className = "hint";
  $("thoughts").textContent = "Press play to start.";
};

newGame();
draw();
syncControls();
