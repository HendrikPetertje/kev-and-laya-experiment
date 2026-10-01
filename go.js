import { laya, timed, h, pct, toast, errorText } from "./laya.js";

// ---------- config ----------
const N = 9;
const KOMI = 7.5;
const MAX_MOVES = 160;
const MAX_CANDIDATES = 12; // Laya degrades above ~20 options
const COLS = "ABCDEFGHJ"; // Go skips "I"
const EMPTY = 0, BLACK = 1, WHITE = 2;
const other = (c) => 3 - c;
const NAME = { [BLACK]: "Black", [WHITE]: "White" };

const $ = (id) => document.getElementById(id);
const coord = (i) => `${COLS[i % N]}${N - Math.floor(i / N)}`;
const neighbors = (() => {
  const nb = [];
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = Math.floor(i / N), a = [];
    if (x > 0) a.push(i - 1);
    if (x < N - 1) a.push(i + 1);
    if (y > 0) a.push(i - N);
    if (y < N - 1) a.push(i + N);
    nb.push(a);
  }
  return nb;
})();

// ---------- rules engine ----------
function group(board, i) {
  const color = board[i], stones = [i], libs = new Set(), seen = new Set([i]);
  for (let k = 0; k < stones.length; k++) {
    for (const n of neighbors[stones[k]]) {
      if (board[n] === EMPTY) libs.add(n);
      else if (board[n] === color && !seen.has(n)) { seen.add(n); stones.push(n); }
    }
  }
  return { stones, libs };
}

/** Returns { board, captured } or null if illegal (occupied, suicide, ko). */
function tryPlay(game, i, color) {
  if (game.board[i] !== EMPTY || i === game.ko) return null;
  const board = game.board.slice();
  board[i] = color;
  let captured = [];
  for (const n of neighbors[i]) {
    if (board[n] === other(color)) {
      const g = group(board, n);
      if (g.libs.size === 0) { g.stones.forEach((s) => (board[s] = EMPTY)); captured.push(...g.stones); }
    }
  }
  captured = [...new Set(captured)];
  const own = group(board, i);
  if (own.libs.size === 0) return null; // suicide
  // simple ko: single stone captured by a single stone that now has one liberty
  const ko = captured.length === 1 && own.stones.length === 1 && own.libs.size === 1 ? captured[0] : -1;
  return { board, captured, ko, own };
}

function isOwnEye(board, i, color) {
  if (board[i] !== EMPTY) return false;
  if (!neighbors[i].every((n) => board[n] === color)) return false;
  const x = i % N, y = Math.floor(i / N);
  const diags = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    .map(([dx, dy]) => [x + dx, y + dy])
    .filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N)
    .map(([a, b]) => board[b * N + a]);
  const bad = diags.filter((d) => d === other(color)).length;
  return diags.length < 4 ? bad === 0 : bad <= 1;
}

/** Area scoring: stones + empty regions bordered by one color only. */
function score(board) {
  const owner = new Array(N * N).fill(EMPTY);
  let b = 0, w = 0;
  const seen = new Set();
  for (let i = 0; i < N * N; i++) {
    if (board[i] === BLACK) { b++; owner[i] = BLACK; continue; }
    if (board[i] === WHITE) { w++; owner[i] = WHITE; continue; }
    if (seen.has(i)) continue;
    const region = [i], borders = new Set();
    seen.add(i);
    for (let k = 0; k < region.length; k++) {
      for (const n of neighbors[region[k]]) {
        if (board[n] === EMPTY && !seen.has(n)) { seen.add(n); region.push(n); }
        else if (board[n] !== EMPTY) borders.add(board[n]);
      }
    }
    if (borders.size === 1) {
      const c = [...borders][0];
      region.forEach((r) => (owner[r] = c));
      c === BLACK ? (b += region.length) : (w += region.length);
    }
  }
  return { black: b, white: w + KOMI, owner };
}

// ---------- candidate generation (Laya chooses, we propose) ----------
function candidates(game, color) {
  const list = [];
  const opp = other(color);
  for (let i = 0; i < N * N; i++) {
    if (isOwnEye(game.board, i, color)) continue;
    const r = tryPlay(game, i, color);
    if (!r) continue;

    let value = 0;
    const notes = [];
    if (r.captured.length) { value += 10 * r.captured.length; notes.push(`captures ${r.captured.length} stone${r.captured.length > 1 ? "s" : ""}`); }

    // Rescues own groups that were in atari
    const saved = new Set();
    for (const n of neighbors[i]) {
      if (game.board[n] === color) {
        const g = group(game.board, n);
        if (g.libs.size === 1) g.stones.forEach((s) => saved.add(s));
      }
    }
    if (saved.size && r.own.libs.size > 1) { value += 8 * saved.size; notes.push(`saves ${saved.size} stone${saved.size > 1 ? "s" : ""} from capture`); }

    // Puts opponent groups in atari
    const atari = new Set();
    for (const n of neighbors[i]) {
      if (r.board[n] === opp) {
        const g = group(r.board, n);
        if (g.libs.size === 1) g.stones.forEach((s) => atari.add(s));
      }
    }
    if (atari.size) { value += 4 * atari.size; notes.push(`puts ${atari.size} enemy stone${atari.size > 1 ? "s" : ""} in atari`); }

    if (r.own.libs.size === 1 && !r.captured.length) { value -= 12; notes.push("self-atari, can be captured next move (bad)"); }
    else if (r.own.libs.size >= 4) { value += 1; notes.push("strong shape with many liberties"); }

    // Positional flavour
    const x = i % N, y = Math.floor(i / N);
    const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
    const empty = game.board.filter((v) => v === EMPTY).length;
    if (empty > N * N * 0.75) {
      if (edge === 2) { value += 3; notes.push("opening point on 3rd line"); }
      else if (edge === 0) { value -= 3; notes.push("first line, too low in the opening"); }
    } else if (edge === 0 && !r.captured.length && !saved.size) { value -= 1; notes.push("edge move"); }

    const friends = neighbors[i].filter((n) => game.board[n] === color).length;
    const enemies = neighbors[i].filter((n) => game.board[n] === opp).length;
    if (enemies && !atari.size) { value += 1; notes.push("contact with enemy stones"); }
    if (friends && !saved.size) notes.push("connects to own stones");
    if (!friends && !enemies && !notes.length) notes.push("quiet move in open space");

    value += Math.random() * 0.8; // variety between games
    list.push({ key: coord(i), i, value, desc: notes.join(", ") });
  }
  list.sort((a, b) => b.value - a.value);
  const top = list.slice(0, MAX_CANDIDATES);
  const lateGame = game.moves.length > 30 || top.every((c) => c.value < 1);
  if (lateGame || !top.length) top.push({ key: "pass", i: -1, value: 0, desc: "pass: no useful moves left, the board is settled" });
  return top;
}

function describe(game, color) {
  const rows = [];
  for (let y = 0; y < N; y++) {
    const r = [];
    for (let x = 0; x < N; x++) r.push(".XO"[game.board[y * N + x]]);
    rows.push(`${String(N - y).padStart(2)} ${r.join(" ")}`);
  }
  const last = game.moves.at(-1);
  return [
    `Game of Go, 9x9 board. X = Black, O = White. You play ${NAME[color]} (${color === BLACK ? "X" : "O"}).`,
    `Move ${game.moves.length + 1}. Captures: Black ${game.caps[BLACK]}, White ${game.caps[WHITE]}. Komi ${KOMI}.`,
    last ? `Opponent's last move: ${last.key}.` : "This is the first move.",
    `   ${COLS.split("").join(" ")}`,
    ...rows,
  ].join("\n");
}

// ---------- game state ----------
let game, running = false, looping = false, gen = 0, lastCands = null;

function newGame() {
  gen++;
  running = false;
  looping = false; // any in-flight loop exits via the gen check
  game = { board: new Array(N * N).fill(EMPTY), toMove: BLACK, ko: -1, moves: [], caps: { [BLACK]: 0, [WHITE]: 0 }, over: null };
  lastCands = null;
  $("banner").hidden = true;
  $("thoughts").replaceChildren("No moves yet.");
  $("thoughts").className = "hint";
  $("log").replaceChildren();
  status("Press play to start.");
  draw();
  syncControls();
}

function applyMove(c) {
  const color = game.toMove;
  if (c.i === -1) {
    game.ko = -1;
  } else {
    const r = tryPlay(game, c.i, color);
    game.board = r.board;
    game.ko = r.ko;
    game.caps[color] += r.captured.length;
  }
  game.moves.push({ ...c, color });
  game.toMove = other(color);
  $("log").append(h("span", { class: color === BLACK ? "b" : "w" }, `${game.moves.length}. ${c.key}`));
  $("log").scrollTop = $("log").scrollHeight;

  const passes = game.moves.slice(-2).filter((m) => m.i === -1).length;
  if (passes === 2 || game.moves.length >= MAX_MOVES) finish(passes === 2 ? "both players passed" : `move limit (${MAX_MOVES}) reached`);
}

function finish(reason) {
  const s = score(game.board);
  const winner = s.black > s.white ? BLACK : WHITE;
  const margin = Math.abs(s.black - s.white);
  game.over = { winner, reason, s };
  running = false;
  $("banner").hidden = false;
  $("banner").replaceChildren(
    h("h3", {}, `${NAME[winner]} wins by ${margin}`),
    h("p", {}, `${reason} · Black ${s.black} – White ${s.white} (incl. ${KOMI} komi)`),
  );
  status("Game over. Reset to play again.");
  draw();
  syncControls();
}

async function loop() {
  const myGen = gen;
  while (running && !game.over && myGen === gen) {
    const color = game.toMove;
    const cands = candidates(game, color);
    syncControls(true);
    status(`${NAME[color]} is thinking… (${cands.length} options)`);
    try {
      const criteria = Object.fromEntries(cands.map((c) => [c.key, c.desc]));
      const { data, ms } = await timed(() => laya.predict(describe(game, color), {
        move: {
          type: "choice",
          instructions: `You are a strong Go player playing ${NAME[color]}. Which move is best? Prefer captures, saving your own stones, and claiming territory. Avoid self-atari and passing while useful moves remain.`,
          criteria,
        },
      }));
      if (myGen !== gen || game.over) return; // reset while waiting
      const a = data.answers.move;
      const pick = cands.find((c) => c.key === a.choice) || cands[0];
      lastCands = { cands, probs: a.probabilities, color };
      showThoughts(pick, a, ms, color);
      applyMove(pick);
      draw();
    } catch (err) {
      if (myGen !== gen) return;
      running = false;
      toast(errorText(err));
      status("Paused after an error. Press play to retry.");
    }
    syncControls();
    if (running && !game.over) await new Promise((r) => setTimeout(r, 350));
  }
  if (!game.over && myGen === gen) status(`Paused. ${NAME[game.toMove]} to move.`);
  syncControls();
}

// ---------- UI ----------
function status(t) { $("status").textContent = t; }

function syncControls(thinking = false) {
  $("play").textContent = running ? "❚❚ Pause" : game.moves.length ? "▶ Resume" : "▶ Play";
  $("play").disabled = !!game.over;
  $("p1").className = `player ${game.toMove === BLACK && !game.over ? "turn" : ""} ${thinking && running ? "thinking" : ""}`;
  $("p2").className = `player ${game.toMove === WHITE && !game.over ? "turn" : ""} ${thinking && running ? "thinking" : ""}`;
  $("capB").textContent = game.caps[BLACK];
  $("capW").textContent = game.caps[WHITE];
  $("moveCount").textContent = game.moves.length;
}

function showThoughts(pick, a, ms, color) {
  const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 5);
  $("thoughts").className = "";
  $("thoughts").replaceChildren(
    h("div", { style: { marginBottom: "10px" } }, h("b", {}, `${NAME[color]} → ${pick.key}`), h("div", { class: "hint" }, pick.desc)),
    h("div", { class: "rank" }, top.map(([k, p], i) =>
      h("div", { class: `rank-item ${i === 0 ? "top" : ""}`, style: { gridTemplateColumns: "28px 52px 1fr 48px" } },
        h("span", { class: "n" }, i + 1), h("span", { class: "name" }, k),
        h("div", { class: "bar" }, h("i", { style: { width: pct(p), background: "var(--accent)" } })),
        h("span", { class: "p" }, pct(p))))),
    h("div", { class: "meta hint", style: { marginTop: "10px", fontFamily: "var(--mono)", fontSize: "11px" } }, `${ms} ms · confidence ${pct(a.confidence)}`),
  );
}

// ---------- SVG board ----------
const svgNS = "http://www.w3.org/2000/svg";
const S = (tag, attrs, text) => {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
};
const PAD = 50, STEP = (500 - PAD * 2) / (N - 1);
const px = (i) => [PAD + (i % N) * STEP, PAD + Math.floor(i / N) * STEP];

function draw() {
  const svg = $("board");
  svg.replaceChildren(
    S("defs", {}),
  );
  svg.firstChild.innerHTML = `
    <radialGradient id="gb" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#777"/><stop offset=".6" stop-color="#111"/><stop offset="1" stop-color="#000"/></radialGradient>
    <radialGradient id="gw" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e6e6e6"/><stop offset="1" stop-color="#b5b5b5"/></radialGradient>
    <filter id="sh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.8" flood-opacity=".55"/></filter>`;

  for (let k = 0; k < N; k++) {
    const p = PAD + k * STEP;
    svg.append(S("line", { x1: PAD, y1: p, x2: 500 - PAD, y2: p }), S("line", { x1: p, y1: PAD, x2: p, y2: 500 - PAD }));
    svg.append(S("text", { class: "coord", x: p, y: PAD - 22 }, COLS[k]), S("text", { class: "coord", x: PAD - 26, y: p + 4 }, N - k));
  }
  for (const i of [20, 24, 40, 56, 60]) { const [x, y] = px(i); svg.append(S("circle", { class: "hoshi", cx: x, cy: y, r: 3.5 })); }

  // Territory markers at game end
  if (game.over) {
    game.over.s.owner.forEach((o, i) => {
      if (o && game.board[i] === EMPTY) {
        const [x, y] = px(i);
        svg.append(S("rect", { class: "terr", x: x - 7, y: y - 7, width: 14, height: 14, rx: 2, fill: o === BLACK ? "#111" : "#f4f4f4" }));
      }
    });
  }

  const last = game.moves.at(-1);
  game.board.forEach((v, i) => {
    if (!v) return;
    const [x, y] = px(i);
    const isNew = last && last.i === i;
    svg.append(S("circle", { class: isNew ? "st" : "", cx: x, cy: y, r: STEP * 0.47, fill: `url(#${v === BLACK ? "gb" : "gw"})`, filter: "url(#sh)" }));
    if (isNew) svg.append(S("circle", { class: "last", cx: x, cy: y, r: STEP * 0.2, stroke: v === BLACK ? "#fff" : "#000" }));
  });

  // Ghost labels: the probabilities Laya gave the other candidates last turn
  if (lastCands && !game.over) {
    for (const c of lastCands.cands) {
      const p = lastCands.probs[c.key] || 0;
      if (c.i < 0 || game.board[c.i] !== EMPTY || p < 0.03) continue;
      const [x, y] = px(c.i);
      svg.append(S("circle", { cx: x, cy: y, r: 11, fill: "rgba(139,92,246,.75)" }));
      svg.append(S("text", { class: "cand", x, y, fill: "#fff" }, Math.round(p * 100)));
    }
  }
}

$("play").onclick = () => {
  if (game.over) return;
  running = !running;
  syncControls();
  if (running && !looping) {
    looping = true;
    const g = gen;
    loop().finally(() => { if (g === gen) looping = false; });
  }
  else status("Pausing after the current move…");
};
$("reset").onclick = newGame;

newGame();
