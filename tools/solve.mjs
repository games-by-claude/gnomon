// Proves each level is beatable under a conservative model: the shade must be
// in shadow at every moment, the sun turns in fixed steps, and the shade walks
// one tile at a time. Prints the solution length and how much dew is reachable.
import { parseLevel, shadowMap, isShadowed, sunDir, isWalkableKind, KIND, wrapAz } from "../src/core.js";
import { LEVELS } from "../src/levels.js";

const AZ_STEP = 3;
const EL_STEP = 3;
const args = process.argv.slice(2);

if (args[0] === "show") {
  const L = parseLevel(LEVELS.find((l) => l.id === args[1]));
  show(L, +args[2], +args[3]);
  process.exit(0);
}

if (args[0] === "fix") {
  // For each level whose start is lit, list start angles that are shadowed and solvable.
  for (const def of LEVELS) {
    if (args.length > 1 && !args.slice(1).includes(def.id)) continue;
    const L0 = parseLevel(def);
    const d0 = sunDir(L0.sun.az, L0.sun.el);
    if (isShadowed(L0, L0.height, L0.start.x, L0.start.z, d0) && solve(L0).exit) continue;
    const found = [];
    for (let az = 0; az < 360 && found.length < 6; az += 6) {
      for (const el of [L0.sun.el, L0.sun.elMin + 3, L0.sun.elMax - 3]) {
        if (L0.sun.azMin !== null && !inArc(az, L0.sun.azMin, L0.sun.azMax)) continue;
        const L = parseLevel({ ...def, sun: { ...def.sun, az, el } });
        if (!isShadowed(L, L.height, L.start.x, L.start.z, sunDir(az, el))) continue;
        const r = solve(L);
        if (r.exit) {
          found.push(`az ${az} el ${el}: moves ${r.exit.moves} turns ${r.exit.turns} dew ${r.dew}/${L.dew.length}`);
          break;
        }
      }
    }
    console.log(def.id, found.length ? found : "NO SOLVABLE START");
  }
  process.exit(0);
}

let failed = 0;
for (const def of LEVELS) {
  if (args.length && !args.includes(def.id)) continue;
  const L = parseLevel(def);
  const r = solve(L);
  const dewMax = L.dew.length;
  const ok = r.exit !== null;
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${def.id.padEnd(8)} ${def.name.padEnd(24)} grid ${L.w}x${L.h}` +
      (ok ? ` moves ${String(r.exit.moves).padStart(3)} turns ${String(r.exit.turns).padStart(3)}` : "") +
      (dewMax ? ` dew ${r.dew}/${dewMax}` : "") +
      (r.startLit ? "  START IS LIT" : ""),
  );
  if (args.includes("--path") && ok) console.log("   " + r.exit.path.join(" "));
}
process.exit(failed ? 1 : 0);

function solve(L) {
  const azN = Math.round(360 / AZ_STEP);
  const els = [];
  for (let e = L.sun.elMin; e <= L.sun.elMax + 1e-9; e += EL_STEP) els.push(e);
  if (els[els.length - 1] !== L.sun.elMax) els.push(L.sun.elMax);
  const azs = [];
  for (let i = 0; i < azN; i++) azs.push(i * AZ_STEP);
  // Include the level's own start angles so the start state exists.
  if (!azs.includes(L.sun.az)) azs.push(L.sun.az);
  if (!els.includes(L.sun.el)) els.push(L.sun.el);
  azs.sort((a, b) => a - b);
  els.sort((a, b) => a - b);
  const azAllowed = azs.map((a) => L.sun.azMin === null || inArc(a, L.sun.azMin, L.sun.azMax));
  const n = L.w * L.h;
  const nSens = L.sensors.length;
  const sensorIdx = L.sensors.map((s) => s.z * L.w + s.x);
  const dewIdx = L.dew.map((d) => d.z * L.w + d.x);
  const gateIdx = L.gates.map((g) => g.z * L.w + g.x);
  const heightOpen = new Float32Array(L.height);
  for (const g of gateIdx) heightOpen[g] = 0;
  // Shadow maps per (az, el, gateOpen); sensor lit per (az, el, gateOpen)
  const maps = new Map();
  const sensLit = new Map();
  function key(ai, ei, open) {
    return (ai * els.length + ei) * 2 + (open ? 1 : 0);
  }
  function getMap(ai, ei, open) {
    const k = key(ai, ei, open);
    let m = maps.get(k);
    if (!m) {
      const hgt = open ? heightOpen : L.height;
      m = shadowMap(L, hgt, azs[ai], els[ei], new Uint8Array(n));
      maps.set(k, m);
      const d = sunDir(azs[ai], els[ei]);
      let mask = 0;
      sensorIdx.forEach((si, j) => {
        const x = si % L.w;
        const z = (si - x) / L.w;
        if (!isShadowed(L, hgt, x, z, d)) mask |= 1 << j;
      });
      sensLit.set(k, mask);
    }
    return m;
  }
  const startI = L.start.z * L.w + L.start.x;
  const exitI = L.exit.z * L.w + L.exit.x;
  const ai0 = azs.indexOf(L.sun.az);
  const ei0 = els.indexOf(L.sun.el);
  const fullSens = (1 << nSens) - 1;
  const dewBits = 1 << dewIdx.length;
  // state: cell, ai, ei, sensMask, dewMask
  const encode = (c, ai, ei, s, dm) => (((c * azs.length + ai) * els.length + ei) * (fullSens + 1) + s) * dewBits + dm;
  const total = n * azs.length * els.length * (fullSens + 1) * dewBits;
  const seen = new Uint8Array(total);
  const parent = new Map();
  let startLit = false;
  const m0 = getMap(ai0, ei0, nSens === 0);
  if (!m0[startI]) startLit = true;
  const start = encode(startI, ai0, ei0, 0, 0);
  const queue = [start];
  seen[start] = 1;
  let exit = null;
  let bestDew = 0;
  let head = 0;
  const decode = (s) => {
    const dm = s % dewBits;
    s = (s - dm) / dewBits;
    const sm = s % (fullSens + 1);
    s = (s - sm) / (fullSens + 1);
    const ei = s % els.length;
    s = (s - ei) / els.length;
    const ai = s % azs.length;
    const c = (s - ai) / azs.length;
    return [c, ai, ei, sm, dm];
  };
  while (head < queue.length) {
    const s = queue[head++];
    const [c, ai, ei, sm, dm] = decode(s);
    const open = sm === fullSens;
    const map = getMap(ai, ei, open);
    if (!map[c]) continue; // lit: not a legal state
    const dewCount = popcount(dm);
    if (dewCount > bestDew) bestDew = dewCount;
    if (c === exitI) {
      if (exit === null || dewCount > exit.dewCount) {
        exit = { state: s, dewCount };
        if (dewCount === dewIdx.length) break;
      }
      continue;
    }
    const push = (c2, ai2, ei2, sm2, dm2, act) => {
      const open2 = sm2 === fullSens;
      const map2 = getMap(ai2, ei2, open2);
      let sm3 = sm2 | (sensLit.get(key(ai2, ei2, open2)) || 0);
      if (sm3 !== sm2) {
        // gate state changed: recompute with new openness
        const open3 = sm3 === fullSens;
        const map3 = getMap(ai2, ei2, open3);
        if (!map3[c2]) return;
      } else if (!map2[c2]) return;
      let dm3 = dm2;
      const di = dewIdx.indexOf(c2);
      if (di >= 0) dm3 |= 1 << di;
      const s2 = encode(c2, ai2, ei2, sm3, dm3);
      if (seen[s2]) return;
      seen[s2] = 1;
      parent.set(s2, [s, act]);
      queue.push(s2);
    };
    // Turn the sun.
    const aiL = (ai + azs.length - 1) % azs.length;
    const aiR = (ai + 1) % azs.length;
    if (azAllowed[aiL]) push(c, aiL, ei, sm, dm, "L");
    if (azAllowed[aiR]) push(c, aiR, ei, sm, dm, "R");
    if (ei > 0) push(c, ai, ei - 1, sm, dm, "D");
    if (ei < els.length - 1) push(c, ai, ei + 1, sm, dm, "U");
    // Walk.
    const x = c % L.w;
    const z = (c - x) / L.w;
    const tryMove = (c2, act) => {
      const k = L.kind[c2];
      if (k === KIND.GATE ? !open : !isWalkableKind(k)) return;
      push(c2, ai, ei, sm, dm, act);
    };
    if (x > 0) tryMove(c - 1, "w");
    if (x < L.w - 1) tryMove(c + 1, "e");
    if (z > 0) tryMove(c - L.w, "n");
    if (z < L.h - 1) tryMove(c + L.w, "s");
  }
  if (exit === null) return { exit: null, dew: bestDew, startLit };
  const path = [];
  let moves = 0;
  let turns = 0;
  for (let s = exit.state; parent.has(s); ) {
    const [p, act] = parent.get(s);
    path.push(act);
    if ("nsew".includes(act)) moves++;
    else turns++;
    s = p;
  }
  path.reverse();
  return { exit: { moves, turns, path: compress(path) }, dew: exit.dewCount, startLit };
}

function compress(path) {
  const out = [];
  for (const a of path) {
    const last = out[out.length - 1];
    if (last && last[0] === a) out[out.length - 1] = a + (parseInt(last.slice(1) || "1") + 1);
    else out.push(a);
  }
  return out;
}

function popcount(v) {
  let c = 0;
  while (v) {
    c += v & 1;
    v >>= 1;
  }
  return c;
}

function inArc(az, min, max) {
  const span = wrapAz(max - min);
  return wrapAz(az - min) <= span;
}

function show(L, az, el) {
  const m = shadowMap(L, L.height, az, el, new Uint8Array(L.w * L.h));
  for (let z = 0; z < L.h; z++) {
    let row = "";
    for (let x = 0; x < L.w; x++) {
      const i = z * L.w + x;
      const k = L.kind[i];
      const c = L.map[z][x] ?? "_";
      if (k === KIND.PILLAR || k === KIND.GATE || k === KIND.VOID) row += c;
      else if (m[i]) row += c === "." ? "#" : c.toLowerCase() === c ? c.toUpperCase() : c;
      else row += c === "." ? "." : c.toLowerCase();
    }
    console.log(row);
  }
  console.log("# = shadowed floor; upper-case = shadowed special cell; lower-case = lit");
}
