// Gnomon: wiring. Input, the loop, progress, and the screens.
import { Game, TURN_SPEED, TILT_SPEED } from "./core.js";
import { LEVELS, CHAPTERS } from "./levels.js";
import { View } from "./render.js";
import { createUI } from "./ui.js";
import { createAudio } from "./audio.js";
import { createSaves } from "./saves.js";

const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "dev";
const canvas = document.getElementById("c");
const loading = document.getElementById("loading");
const loadingText = document.getElementById("loading-text");

for (const L of LEVELS) L.dewMax = L.map.join("").split("o").length - 1;

// The title's backdrop: a dial that the sun crosses on its own.
const ATTRACT = {
  id: "attract",
  name: "Gnomon",
  chapter: 0,
  sun: { az: 120, el: 34, elMin: 20, elMax: 60 },
  map: [
    "...............",
    "....o.........o",
    "..3......3.....",
    "..3............",
    "......666......",
    "......666..2...",
    "..o...666..2...",
    ".....S.........",
    "............3..",
    "..4............",
    "..4....o....E..",
    "...............",
  ],
};

const state = {
  mode: "loading", // loading | title | play | levels | won | paused
  game: null,
  levelIndex: 0,
  paused: false,
  keys: new Set(),
  manual: false,
  attract: false,
  dragging: null,
  turnRate: 0,
  winTimer: 0,
};

const view = new View(canvas);
const audio = createAudio();
let saves = null;
let ui = null;

function unlocked(i) {
  if (i === 0) return true;
  return !!saves.progress.levels[LEVELS[i - 1].id]?.done;
}

function anyDone() {
  return LEVELS.some((L) => saves.progress.levels[L.id]?.done);
}

function resize() {
  const w = Math.max(1, Math.round(canvas.clientWidth || innerWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight || innerHeight));
  const dpr = Math.min(devicePixelRatio || 1, view.coarse ? 1.75 : 2);
  view.resize(w, h, dpr);
}

function attachGame(game) {
  game.on((type, data) => {
    if (type === "step") audio.step();
    else if (type === "dew") {
      audio.dew();
      ui.setDew(game.collected.size, game.level.dewMax);
    } else if (type === "sensor") audio.sensor();
    else if (type === "gate") audio.gate();
    else if (type === "scorch") audio.scorch();
    else if (type === "win") onWin();
    else if (type === "hold") ui.setHold(data);
    else if (type === "reset") {
      ui.setHold(false);
      ui.setDew(0, game.level.dewMax);
    }
  });
}

function startLevel(i) {
  state.levelIndex = i;
  const def = LEVELS[i];
  const game = new Game(def);
  state.game = game;
  state.attract = false;
  state.mode = "play";
  state.paused = false;
  attachGame(game);
  view.setLevel(game);
  resize();
  ui.hideScreens();
  ui.showHud({
    chapter: CHAPTERS[def.chapter].name,
    number: i + 1,
    name: def.name,
    hintText: def.hint,
    dewMax: def.dewMax,
  });
  ui.setHold(false);
  ui.focusCanvas();
  // Remember where to continue, without waiting for the level to end.
  if (saves.progress.current !== i) {
    const p = structuredClone(saves.progress);
    p.current = i;
    saves.writeProgress(p);
  }
}

function showTitle() {
  state.mode = "title";
  state.attract = true;
  const game = new Game(ATTRACT);
  state.game = game;
  view.setLevel(game);
  resize();
  ui.showTitle({ continueLabel: anyDone() ? `Continue: level ${saves.progress.current + 1}` : "Play" });
}

function showLevels() {
  state.mode = "levels";
  ui.showLevels({ levels: LEVELS, chapters: CHAPTERS, progress: saves.progress, unlocked });
}

function onWin() {
  audio.win();
  const i = state.levelIndex;
  const def = LEVELS[i];
  const g = state.game;
  const p = structuredClone(saves.progress);
  const prev = p.levels[def.id] || { done: false, dew: 0, scorches: 0 };
  p.levels[def.id] = { done: true, dew: Math.max(prev.dew, g.collected.size), scorches: prev.scorches + g.scorches };
  if (i + 1 < LEVELS.length) p.current = Math.max(p.current, i + 1);
  saves.writeProgress(p);
  state.winTimer = 1.1;
  state.mode = "won";
}

function showWinPanel() {
  const i = state.levelIndex;
  const def = LEVELS[i];
  const allDone = LEVELS.every((L) => saves.progress.levels[L.id]?.done);
  ui.showWin({
    name: def.name,
    dew: state.game.collected.size,
    dewMax: def.dewMax,
    hasNext: i + 1 < LEVELS.length,
    allDone: allDone && i === LEVELS.length - 1,
  });
}

function pause() {
  if (state.mode !== "play" || state.paused) return;
  state.paused = true;
  audio.suspend();
  ui.showPause();
}

function resume() {
  if (!state.paused) return;
  state.paused = false;
  audio.resume();
  ui.hideScreens();
  ui.focusCanvas();
}

function toggleSound() {
  const on = !audio.enabled;
  audio.setEnabled(on);
  ui.setSound(on);
  const s = structuredClone(saves.settings);
  s.sound = on;
  saves.writeSettings(s);
}

// Input -------------------------------------------------------------------

const GAME_KEYS = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);

addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

addEventListener("keydown", (e) => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  audio.unlock();
  if (state.paused) {
    resume();
    return;
  }
  const inPlay = state.mode === "play";
  if (e.code === "KeyM") toggleSound();
  else if (inPlay && e.code === "Space") state.game.toggleHold();
  else if (inPlay && e.code === "KeyR") state.game.reset();
  else if (inPlay && e.code === "Escape") showLevels();
  else if (state.mode === "levels" && e.code === "Escape") (state.attract ? showTitle : () => startLevel(state.levelIndex))();
  else if (state.mode === "title" && (e.code === "Enter" || e.code === "Space") && document.activeElement?.tagName !== "BUTTON") startLevel(saves.progress.current);
  else if (state.mode === "won" && state.winTimer <= 0 && e.code === "Enter" && document.activeElement?.tagName !== "BUTTON") {
    if (state.levelIndex + 1 < LEVELS.length) startLevel(state.levelIndex + 1);
    else showLevels();
  }
  state.keys.add(e.code);
});
addEventListener("keyup", (e) => state.keys.delete(e.code));
addEventListener("blur", () => state.keys.clear());

canvas.addEventListener("pointerdown", (e) => {
  audio.unlock();
  if (state.paused) {
    resume();
    return;
  }
  if (state.mode !== "play") return;
  canvas.setPointerCapture(e.pointerId);
  state.dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
});
canvas.addEventListener("pointermove", (e) => {
  const d = state.dragging;
  if (!d || d.id !== e.pointerId || state.mode !== "play") return;
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  d.x = e.clientX;
  d.y = e.clientY;
  if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) d.moved = true;
  if (d.moved) {
    const k = 220 / Math.min(view.width, view.height); // a full drag across the screen is about a half turn
    state.game.rotate(dx * k * 0.9, -dy * k * 0.55);
    state.turnRate = Math.min(1, Math.hypot(dx, dy) / 12);
  }
});
function endDrag(e) {
  const d = state.dragging;
  if (!d || d.id !== e.pointerId) return;
  state.dragging = null;
  if (!d.moved && performance.now() - d.t < 400 && state.mode === "play") {
    // A tap on the shade toggles waiting.
    const s = view.shadeScreen();
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 48) state.game.toggleHold();
  }
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
addEventListener("blur", () => pause());
addEventListener("pagehide", () => {
  /* progress is written at every checkpoint already */
});

new ResizeObserver(() => resize()).observe(canvas);
addEventListener("resize", resize);

// Loop ----------------------------------------------------------------------

let last = performance.now();
function frame(dt) {
  const game = state.game;
  if (game) {
    if (state.mode === "play" && !state.paused) {
      let dAz = 0;
      let dEl = 0;
      const k = state.keys;
      if (k.has("ArrowLeft") || k.has("KeyA")) dAz -= TURN_SPEED * dt;
      if (k.has("ArrowRight") || k.has("KeyD")) dAz += TURN_SPEED * dt;
      if (k.has("ArrowUp") || k.has("KeyW")) dEl += TILT_SPEED * dt;
      if (k.has("ArrowDown") || k.has("KeyS")) dEl -= TILT_SPEED * dt;
      if (dAz || dEl) {
        game.rotate(dAz, dEl);
        state.turnRate = 0.6;
      }
      game.update(dt);
    } else if (state.attract) {
      game.setSun(game.az + 9 * dt, game.el + Math.sin(game.time * 0.25) * 2 * dt);
      game.time += dt;
      game.refreshShadows();
    } else if (state.mode === "won") {
      game.update(dt);
      state.winTimer -= dt;
      if (state.winTimer <= 0 && !ui.isScreenOpen()) showWinPanel();
    }
    audio.turning(state.turnRate, game.el);
    state.turnRate = Math.max(0, state.turnRate - dt * 4);
  }
  view.update(game, dt);
  view.render();
}

function loop(now) {
  requestAnimationFrame(loop);
  if (state.manual) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frame(dt);
}

// Boot ----------------------------------------------------------------------

async function boot() {
  loadingText.textContent = "Loading saves";
  saves = await createSaves(VERSION);
  ui = createUI({
    onClick: () => audio.click(),
    onPlay: () => startLevel(Math.min(saves.progress.current, LEVELS.length - 1)),
    onLevels: showLevels,
    onSelect: (i) => startLevel(i),
    onRestart: () => {
      if (state.mode === "won") startLevel(state.levelIndex);
      else state.game?.reset();
    },
    onHold: () => state.game?.toggleHold(),
    onSound: toggleSound,
    onNext: () => startLevel(Math.min(state.levelIndex + 1, LEVELS.length - 1)),
    onBack: () => (state.attract ? showTitle() : startLevel(state.levelIndex)),
    onResume: resume,
  });
  audio.setEnabled(saves.settings.sound);
  ui.setSound(saves.settings.sound);
  resize();
  showTitle();
  requestAnimationFrame(loop);
  loading.classList.add("gone");
  setTimeout(() => loading.remove(), 600);

  if (saves.error) {
    ui.toast("Couldn't load your progress, so nothing will be saved this time.", {
      action: "Retry",
      ms: 0,
      onAction: async () => {
        if (await saves.retry()) ui.toast("Progress loaded.");
        else ui.toast("Still can't reach your saves.", { action: "Retry", ms: 0, onAction: () => location.reload() });
      },
    });
  } else if (saves.where === "memory") {
    ui.toast("Progress won't be kept after you close the game.");
  } else if (saves.readOnly) {
    ui.toast(`A newer version of Gnomon (${saves.newerVersion}) saved this progress, so this one won't save.`, { ms: 9000 });
  }
}

// For the capture tool and tests.
globalThis.__gnomon = {
  version: VERSION,
  LEVELS,
  get state() {
    return state;
  },
  view,
  saves: () => saves,
  startLevel,
  showTitle,
  showLevels,
  setManual(on) {
    state.manual = on;
    last = performance.now();
  },
  frame,
  resize,
  // Load a level definition that isn't in the list (for store art).
  startCustom(def, { hud = false } = {}) {
    def.dewMax = def.map.join("").split("o").length - 1;
    const game = new Game(def);
    state.game = game;
    state.attract = false;
    state.mode = "play";
    state.paused = false;
    attachGame(game);
    view.setLevel(game);
    resize();
    ui.hideScreens();
    if (hud) ui.showHud({ chapter: "Dusk", number: 15, name: def.name, hintText: def.hint, dewMax: def.dewMax });
    return game;
  },
  setUIVisible(on) {
    document.getElementById("ui").style.display = on ? "" : "none";
  },
  game: () => state.game,
};

boot().catch((err) => {
  console.error(err);
  loadingText.textContent = "Something went wrong. Reload to try again.";
});
