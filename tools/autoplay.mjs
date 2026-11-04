// Plays every level with the real simulation: a beam search over sun moves,
// stepping the game exactly as the browser does. Proves the levels can be
// beaten by turning the sun alone, and writes the winning scripts for the
// capture tool to tools/plays.json.
import { Game, distancesFrom } from "../src/core.js";
import { LEVELS } from "../src/levels.js";
import { writeFileSync } from "node:fs";

const STEP = 0.4; // seconds per decision
const FPS = 30;
const AZ = [-45, 0, 45];
const EL = [-18, 0, 18];
const BEAM = +(process.argv.find((a) => a.startsWith("--beam="))?.slice(7) || 28);
const MAX_STEPS = +(process.argv.find((a) => a.startsWith("--steps="))?.slice(8) || 110);
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const wantDew = process.argv.includes("--dew");

const plays = {};
let failed = 0;
for (const def of LEVELS) {
  if (only.length && !only.includes(def.id)) continue;
  const t0 = Date.now();
  const r = play(def);
  if (!r) {
    failed++;
    console.log(`FAIL ${def.id.padEnd(8)} ${def.name}`);
    continue;
  }
  plays[def.id] = r.script;
  console.log(
    `ok   ${def.id.padEnd(8)} ${def.name.padEnd(24)} ${r.time.toFixed(1).padStart(5)} s  steps ${String(r.steps).padStart(3)}  dew ${r.dew}/${r.dewMax}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
  );
}
if (!only.length) writeFileSync("tools/plays.json", JSON.stringify(plays, null, 1));
process.exit(failed ? 1 : 0);

function play(def) {
  const root = new Game(def);
  const dewMax = root.level.dew.length;
  const L = root.level;
  const dewDist = L.dew.map((d) => ({ i: d.z * L.w + d.x, dist: distancesFrom(L, d.z * L.w + d.x) }));
  let beam = [{ g: root, actions: [], score: 0 }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const next = [];
    const seen = new Set();
    for (const node of beam) {
      for (const dAz of AZ) {
        for (const dEl of EL) {
          const g = node.g.clone();
          let dead = false;
          for (let f = 0; f < STEP * FPS; f++) {
            if (dAz || dEl) g.rotate(dAz / FPS, dEl / FPS);
            g.update(1 / FPS);
            if (g.state === "scorched") {
              dead = true;
              break;
            }
            if (g.state === "won") break;
          }
          if (dead) continue;
          const actions = node.actions.concat([[dAz, dEl]]);
          if (g.state === "won" && (!wantDew || g.collected.size === dewMax)) {
            return { script: toScript(actions), time: g.time, steps: g.steps, dew: g.collected.size, dewMax };
          }
          if (g.state === "won") continue;
          const cell = g.shadeCell();
          const key = `${cell}|${Math.round(g.az / 5)}|${Math.round(g.el / 5)}|${g.latched.size}|${[...g.collected].join(",")}|${g.move ? 1 : 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let dist = g.exitDist[cell] === 65535 ? 50 : g.exitDist[cell];
          if (wantDew && g.collected.size < dewMax) {
            dist = 50;
            for (const d of dewDist) if (!g.collected.has(d.i) && d.dist[cell] < dist) dist = d.dist[cell];
          }
          const score = -dist * 10 + g.collected.size * (wantDew ? 400 : 40) + g.latched.size * 60 - g.heat * 8 - g.time * 0.5 + (g.lit ? -6 : 0);
          next.push({ g, actions, score });
        }
      }
    }
    if (!next.length) return null;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, BEAM);
  }
  return null;
}

// Merge consecutive identical actions into [seconds, dAz, dEl] runs, with a short tail.
function toScript(actions) {
  const out = [];
  for (const [dAz, dEl] of actions) {
    const last = out[out.length - 1];
    if (last && last[1] === dAz && last[2] === dEl) last[0] = +(last[0] + STEP).toFixed(2);
    else out.push([STEP, dAz, dEl]);
  }
  out.push([1.6, 0, 0]);
  return out;
}
