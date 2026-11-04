// DOM overlay: HUD, title, level select, win and pause panels, toasts.
// Everything is a real button, so keyboard, mouse, and touch all work.
const CSS = `
#ui { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
#ui button { pointer-events: auto; font: inherit; }
#ui .hud { position: absolute; left: calc(12px + var(--safe-left)); right: calc(12px + var(--safe-right)); top: calc(10px + var(--safe-top)); display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
#ui .title { background: var(--paper); padding: 8px 14px; border-radius: 12px; min-width: 120px; }
#ui .title b { display: block; font-size: 16px; }
#ui .title span { font-size: 11px; opacity: .75; letter-spacing: .14em; text-transform: uppercase; }
#ui .buttons { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
#ui .btn { min-width: 44px; min-height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--paper); color: #fff8ea; font-size: 15px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
#ui .btn.primary { background: var(--gold); color: var(--ink); font-weight: 700; }
#ui .btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
#ui .btn[aria-pressed="true"] { background: #e9e0ff; color: var(--ink); }
#ui .btn:active { transform: translateY(1px); }
#ui .hint { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(14px + var(--safe-bottom)); max-width: min(560px, 92vw); background: var(--paper); padding: 10px 16px; border-radius: 14px; font-size: 14px; text-align: center; line-height: 1.35; }
#ui .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: auto; background: rgba(20, 14, 30, .3); padding: calc(20px + var(--safe-top)) calc(16px + var(--safe-right)) calc(20px + var(--safe-bottom)) calc(16px + var(--safe-left)); overflow: auto; box-sizing: border-box; }
#ui .panel { background: var(--paper); border-radius: 22px; padding: 26px 28px; max-width: 560px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); box-sizing: border-box; }
#ui h1 { font-size: clamp(40px, 9vw, 60px); letter-spacing: .26em; text-indent: .26em; margin: 0 0 2px; font-weight: 800; color: var(--gold); line-height: 1.1; }
#ui h2 { font-size: 24px; margin: 0 0 6px; }
#ui .tag { opacity: .85; margin: 0 0 20px; font-size: 16px; }
#ui .row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
#ui .levels { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 6px 0 14px; }
#ui .lvl { min-height: 58px; flex-direction: column; padding: 6px 4px; font-size: 13px; line-height: 1.2; }
#ui .lvl small { font-size: 11px; opacity: .75; letter-spacing: .08em; }
#ui .lvl:disabled { opacity: .35; cursor: default; }
#ui .lvl.done { box-shadow: inset 0 0 0 2px var(--gold); }
#ui .dots { display: inline-flex; gap: 3px; vertical-align: middle; }
#ui .dots i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 255, 255, .22); }
#ui .dots i.on { background: #9fdcff; box-shadow: 0 0 6px #9fdcff; }
#ui .chapter { font-size: 12px; letter-spacing: .2em; text-transform: uppercase; opacity: .8; margin: 12px 0 4px; text-align: left; }
#ui .toast { position: absolute; top: calc(66px + var(--safe-top)); left: 50%; transform: translateX(-50%); background: #fff3d6; color: var(--ink); padding: 10px 16px; border-radius: 12px; font-size: 14px; max-width: 90vw; pointer-events: auto; display: flex; gap: 10px; align-items: center; box-shadow: 0 8px 30px rgba(0,0,0,.3); }
#ui .toast .btn { background: var(--ink); color: #fff; min-height: 36px; }
#ui .small { font-size: 13px; opacity: .8; margin: 14px 0 0; }
#ui .hidden { display: none !important; }
#ui .credit { position: absolute; bottom: calc(10px + var(--safe-bottom)); left: 0; right: 0; text-align: center; font-size: 12px; opacity: .7; }
@media (max-width: 480px) { #ui .levels { grid-template-columns: repeat(5, 1fr); gap: 5px; } #ui .panel { padding: 20px 14px; } #ui .lvl { font-size: 11px; min-height: 50px; } }
`;

export function createUI(handlers) {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement("div");
  root.id = "ui";
  document.body.appendChild(root);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (label, cls, onClick, attrs = {}) => {
    const b = el("button", "btn " + (cls || ""), label);
    b.type = "button";
    for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      handlers.onClick?.();
      onClick(e);
    });
    return b;
  };

  // HUD
  const hud = el("div", "hud hidden");
  const title = el("div", "title");
  const titleSmall = el("span", "", "");
  const titleBig = el("b", "", "");
  const dots = el("div", "dots");
  title.append(titleSmall, titleBig, dots);
  const buttons = el("div", "buttons");
  const holdBtn = btn("Wait", "", () => handlers.onHold(), { "aria-pressed": "false", title: "Make the shade wait (Space)" });
  const restartBtn = btn("Restart", "", () => handlers.onRestart(), { title: "Restart the level (R)" });
  const menuBtn = btn("Levels", "", () => handlers.onLevels(), { title: "Level select (Escape)" });
  const soundBtn = btn("Sound", "", () => handlers.onSound(), { "aria-pressed": "true", title: "Toggle sound (M)" });
  buttons.append(holdBtn, restartBtn, menuBtn, soundBtn);
  hud.append(title, buttons);
  root.appendChild(hud);
  const hint = el("div", "hint hidden");
  root.appendChild(hint);

  // Title screen
  const titleScreen = el("div", "screen hidden");
  const tp = el("div", "panel");
  tp.append(el("h1", "", "GNOMON"), el("p", "tag", "Turn the sun. Walk the shadow."));
  const playBtn = btn("Play", "primary", () => handlers.onPlay());
  const levelsBtn = btn("Levels", "", () => handlers.onLevels());
  const soundBtn2 = btn("Sound", "", () => handlers.onSound(), { "aria-pressed": "true" });
  const trow = el("div", "row");
  trow.append(playBtn, levelsBtn, soundBtn2);
  const titleNote = el("p", "small", "Drag to turn the sun. The shade can only walk in shadow. Lead it to the well.");
  tp.append(trow, titleNote);
  titleScreen.appendChild(tp);
  titleScreen.appendChild(el("div", "credit", "Made by Claude for games-by-claude"));
  root.appendChild(titleScreen);

  // Level select
  const levelScreen = el("div", "screen hidden");
  const lp = el("div", "panel");
  const lpBody = el("div");
  const backBtn = btn("Back", "", () => handlers.onBack());
  lp.append(el("h2", "", "Levels"), lpBody, backBtn);
  levelScreen.appendChild(lp);
  root.appendChild(levelScreen);

  // Win panel
  const winScreen = el("div", "screen hidden");
  const wp = el("div", "panel");
  const winTitle = el("h2", "", "The well");
  const winText = el("p", "tag", "");
  const winDots = el("div", "dots");
  const nextBtn = btn("Next", "primary", () => handlers.onNext());
  const replayBtn = btn("Replay", "", () => handlers.onRestart());
  const winLevelsBtn = btn("Levels", "", () => handlers.onLevels());
  const wrow = el("div", "row");
  wrow.append(nextBtn, replayBtn, winLevelsBtn);
  wp.append(winTitle, winDots, winText, wrow);
  winScreen.appendChild(wp);
  root.appendChild(winScreen);

  // Pause panel
  const pauseScreen = el("div", "screen hidden");
  const pp = el("div", "panel");
  const resumeBtn = btn("Resume", "primary", () => handlers.onResume());
  pp.append(el("h2", "", "Paused"), resumeBtn);
  pauseScreen.appendChild(pp);
  root.appendChild(pauseScreen);

  // Toast
  const toast = el("div", "toast hidden");
  root.appendChild(toast);
  let toastTimer = 0;

  const screens = [titleScreen, levelScreen, winScreen, pauseScreen];
  function show(screen) {
    for (const s of screens) s.classList.toggle("hidden", s !== screen);
    if (screen) {
      const first = screen.querySelector(".primary") || screen.querySelector("button");
      first?.focus({ preventScroll: true });
    }
  }
  function dotsInto(container, n, max) {
    container.replaceChildren();
    for (let i = 0; i < max; i++) {
      const d = el("i", i < n ? "on" : "");
      container.appendChild(d);
    }
  }

  return {
    showTitle({ continueLabel }) {
      playBtn.textContent = continueLabel || "Play";
      hud.classList.add("hidden");
      hint.classList.add("hidden");
      show(titleScreen);
    },
    showLevels({ levels, chapters, progress, unlocked }) {
      lpBody.replaceChildren();
      chapters.forEach((ch, ci) => {
        const grid = el("div", "levels");
        lpBody.append(el("div", "chapter", `${ch.name}: ${ch.blurb}`), grid);
        levels.forEach((L, i) => {
          if (L.chapter !== ci) return;
          const rec = progress.levels[L.id];
          const b = btn("", "lvl" + (rec?.done ? " done" : ""), () => handlers.onSelect(i));
          b.append(el("small", "", String(i + 1)), el("span", "", L.name));
          if (L.dewMax) {
            const d = el("div", "dots");
            dotsInto(d, rec?.dew || 0, L.dewMax);
            b.appendChild(d);
          }
          b.disabled = !unlocked(i);
          grid.appendChild(b);
        });
      });
      show(levelScreen);
    },
    showWin({ name, dew, dewMax, hasNext, allDone }) {
      winTitle.textContent = allDone ? "Every shadow walked" : name;
      winText.textContent = allDone
        ? "The shade has crossed every ruin. Thank you for playing."
        : dewMax
          ? `Dew gathered: ${dew} of ${dewMax}.`
          : "The shade reached the well.";
      dotsInto(winDots, dew, dewMax);
      winDots.classList.toggle("hidden", !dewMax);
      nextBtn.classList.toggle("hidden", !hasNext);
      show(winScreen);
    },
    showPause() {
      show(pauseScreen);
    },
    hideScreens() {
      show(null);
    },
    showHud({ chapter, number, name, hintText, dewMax }) {
      titleSmall.textContent = `${chapter} ${number}`;
      titleBig.textContent = name;
      dotsInto(dots, 0, dewMax);
      dots.classList.toggle("hidden", !dewMax);
      hud.classList.remove("hidden");
      hint.textContent = hintText || "";
      hint.classList.toggle("hidden", !hintText);
    },
    setDew(n, max) {
      dotsInto(dots, n, max);
    },
    setHint(text) {
      hint.textContent = text || "";
      hint.classList.toggle("hidden", !text);
    },
    setHold(on) {
      holdBtn.setAttribute("aria-pressed", on ? "true" : "false");
      holdBtn.textContent = on ? "Walk" : "Wait";
    },
    setSound(on) {
      for (const b of [soundBtn, soundBtn2]) {
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.textContent = on ? "Sound" : "Muted";
      }
    },
    toast(message, { action, onAction, ms = 6000 } = {}) {
      toast.replaceChildren(el("span", "", message));
      if (action) toast.appendChild(btn(action, "", () => { toast.classList.add("hidden"); onAction?.(); }));
      toast.classList.remove("hidden");
      clearTimeout(toastTimer);
      if (ms) toastTimer = setTimeout(() => toast.classList.add("hidden"), ms);
    },
    isScreenOpen() {
      return screens.some((s) => !s.classList.contains("hidden"));
    },
    focusCanvas() {
      document.getElementById("c")?.focus({ preventScroll: true });
    },
  };
}
