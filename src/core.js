// Gnomon: engine-free game logic. Runs in the browser and in Node.
// A level is a grid. Cells are floor (walkable), void, or pillars of a
// height. The sun is a direction; a floor cell is shadowed when the ray from
// its center toward the sun hits a pillar. The shade walks only on shadowed
// floor, toward dew it can reach and then toward the well (the exit).

const DEG = Math.PI / 180;

export const KIND = {
  FLOOR: 0,
  VOID: 1,
  PILLAR: 2,
  GATE: 3,
  SENSOR: 4,
  EXIT: 5,
  START: 6,
  DEW: 7,
};

export const STEP_DURATION = 0.3; // seconds per tile
export const STEP_PAUSE = 0.04; // seconds between tiles
export const HEAT_RATE = 1 / 1.1; // seconds in sunlight before scorching
export const COOL_RATE = 1 / 1.4;
export const SCORCH_TIME = 1.0; // seconds of the scorch animation
export const TURN_SPEED = 75; // degrees per second from keys
export const TILT_SPEED = 35;

export function parseLevel(def) {
  const rows = def.map;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const height = new Float32Array(w * h);
  const kind = new Uint8Array(w * h);
  let start = null;
  let exit = null;
  const dew = [];
  const sensors = [];
  const gates = [];
  let maxH = 1;
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const c = rows[z][x] ?? "_";
      const i = z * w + x;
      if (c >= "1" && c <= "9") {
        kind[i] = KIND.PILLAR;
        height[i] = +c;
        maxH = Math.max(maxH, +c);
      } else if (c === "_" || c === " ") {
        kind[i] = KIND.VOID;
      } else if (c === "S") {
        kind[i] = KIND.START;
        start = { x, z };
      } else if (c === "E") {
        kind[i] = KIND.EXIT;
        exit = { x, z };
      } else if (c === "o") {
        kind[i] = KIND.DEW;
        dew.push({ x, z });
      } else if (c === "x") {
        kind[i] = KIND.SENSOR;
        sensors.push({ x, z });
      } else if (c === "g") {
        kind[i] = KIND.GATE;
        height[i] = 1;
        gates.push({ x, z });
      } else {
        kind[i] = KIND.FLOOR;
      }
    }
  }
  if (!start || !exit) throw new Error(`level ${def.id} needs S and E`);
  const sun = {
    az: def.sun?.az ?? 210,
    el: def.sun?.el ?? 40,
    elMin: def.sun?.elMin ?? 22,
    elMax: def.sun?.elMax ?? 62,
    azMin: def.sun?.azMin ?? null,
    azMax: def.sun?.azMax ?? null,
  };
  return {
    ...def,
    w,
    h,
    height,
    kind,
    start,
    exit,
    dew,
    sensors,
    gates,
    maxH,
    sun,
  };
}

export function isWalkableKind(k) {
  return k === KIND.FLOOR || k === KIND.START || k === KIND.EXIT || k === KIND.DEW || k === KIND.SENSOR;
}

// Unit vector from a point toward the sun, in grid space (x right, y up, z down the rows).
export function sunDir(az, el) {
  const a = az * DEG;
  const e = el * DEG;
  const c = Math.cos(e);
  return [Math.sin(a) * c, Math.sin(e), Math.cos(a) * c];
}

export function wrapAz(az) {
  az %= 360;
  if (az < 0) az += 360;
  return az;
}

// Exact 2D grid traversal: is the center of cell (x, z) in the shadow of a block?
export function isShadowed(level, height, x, z, d) {
  const [dx, dy, dz] = d;
  if (dy <= 0) return true;
  const w = level.w;
  const h = level.h;
  const tMax = (level.maxH + 0.001) / dy;
  const px = x + 0.5;
  const pz = z + 0.5;
  let cx = x;
  let cz = z;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const adx = Math.abs(dx);
  const adz = Math.abs(dz);
  let tX = adx > 1e-9 ? (dx > 0 ? cx + 1 - px : px - cx) / adx : Infinity;
  let tZ = adz > 1e-9 ? (dz > 0 ? cz + 1 - pz : pz - cz) / adz : Infinity;
  const dX = adx > 1e-9 ? 1 / adx : Infinity;
  const dZ = adz > 1e-9 ? 1 / adz : Infinity;
  let t = 0;
  for (let n = 0; n < 4096; n++) {
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return false;
    if (height[cz * w + cx] > t * dy + 1e-6) return true;
    if (tX < tZ) {
      t = tX;
      tX += dX;
      cx += stepX;
    } else {
      t = tZ;
      tZ += dZ;
      cz += stepZ;
    }
    if (t > tMax) return false;
  }
  return false;
}

export function shadowMap(level, height, az, el, out) {
  const d = sunDir(az, el);
  const n = level.w * level.h;
  out = out || new Uint8Array(n);
  for (let z = 0; z < level.h; z++) {
    for (let x = 0; x < level.w; x++) {
      const i = z * level.w + x;
      const k = level.kind[i];
      const passable = isWalkableKind(k) || k === KIND.GATE; // an open gate is floor
      out[i] = passable && height[i] === 0 && isShadowed(level, height, x, z, d) ? 1 : 0;
    }
  }
  return out;
}

// Breadth-first search over open cells. Returns parent indices, -2 for unreached.
export function bfsParents(level, open, fromIndex, parents, queue) {
  const w = level.w;
  const n = w * level.h;
  parents = parents || new Int32Array(n);
  queue = queue || new Int32Array(n);
  parents.fill(-2);
  let head = 0;
  let tail = 0;
  queue[tail++] = fromIndex;
  parents[fromIndex] = -1;
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const z = (i - x) / w;
    let j;
    if (x > 0 && open[(j = i - 1)] && parents[j] === -2) {
      parents[j] = i;
      queue[tail++] = j;
    }
    if (x < w - 1 && open[(j = i + 1)] && parents[j] === -2) {
      parents[j] = i;
      queue[tail++] = j;
    }
    if (z > 0 && open[(j = i - w)] && parents[j] === -2) {
      parents[j] = i;
      queue[tail++] = j;
    }
    if (z < level.h - 1 && open[(j = i + w)] && parents[j] === -2) {
      parents[j] = i;
      queue[tail++] = j;
    }
  }
  return parents;
}

function pathLength(parents, target) {
  let n = 0;
  for (let i = target; parents[i] !== -1; i = parents[i]) n++;
  return n;
}

// Walking distance from every cell to one cell, through floor and gates.
export function distancesFrom(level, index) {
  const n = level.w * level.h;
  const passable = new Uint8Array(n);
  for (let i = 0; i < n; i++) passable[i] = isWalkableKind(level.kind[i]) || level.kind[i] === KIND.GATE ? 1 : 0;
  const parents = bfsParents(level, passable, index);
  const dist = new Uint16Array(n).fill(65535);
  for (let i = 0; i < n; i++) if (parents[i] !== -2) dist[i] = pathLength(parents, i);
  return dist;
}

export function exitDistances(level) {
  return distancesFrom(level, level.exit.z * level.w + level.exit.x);
}

export function pathTo(parents, target) {
  if (parents[target] === -2) return null;
  const path = [];
  for (let i = target; i !== -1; i = parents[i]) path.push(i);
  path.reverse();
  return path;
}

export function compareSemver(a, b) {
  const pa = String(a).split("-");
  const pb = String(b).split("-");
  const na = pa[0].split(".").map(Number);
  const nb = pb[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (pa[1] && !pb[1]) return -1;
  if (!pa[1] && pb[1]) return 1;
  if (pa[1] && pb[1]) return pa[1] < pb[1] ? -1 : pa[1] > pb[1] ? 1 : 0;
  return 0;
}

export class Game {
  constructor(def) {
    this.level = parseLevel(def);
    const n = this.level.w * this.level.h;
    this.height = new Float32Array(n);
    this.shadow = new Uint8Array(n);
    this.open = new Uint8Array(n);
    this.parents = new Int32Array(n);
    this.queue = new Int32Array(n);
    this.listeners = [];
    this.scorches = 0;
    this.exitDist = exitDistances(this.level);
    this.reset();
  }

  on(fn) {
    this.listeners.push(fn);
  }

  // A deep copy for search tools (no listeners).
  clone() {
    const g = Object.create(Game.prototype);
    g.level = this.level;
    g.exitDist = this.exitDist;
    g.height = new Float32Array(this.height);
    g.shadow = new Uint8Array(this.shadow);
    g.open = new Uint8Array(this.open.length);
    g.parents = new Int32Array(this.parents.length);
    g.queue = new Int32Array(this.queue.length);
    g.listeners = [];
    g.scorches = this.scorches;
    g.az = this.az;
    g.el = this.el;
    g.shade = { x: this.shade.x, z: this.shade.z };
    g.move = this.move ? { ...this.move } : null;
    g.pause = this.pause;
    g.heat = this.heat;
    g.hold = this.hold;
    g.state = this.state;
    g.timer = this.timer;
    g.time = this.time;
    g.steps = this.steps;
    g.latched = new Set(this.latched);
    g.gateOpen = this.gateOpen;
    g.collected = new Set(this.collected);
    g.path = this.path ? this.path.slice() : null;
    g.dirty = this.dirty;
    g.pathDirty = true;
    g.lit = this.lit;
    return g;
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  reset() {
    const L = this.level;
    this.height.set(L.height);
    this.az = L.sun.az;
    this.el = L.sun.el;
    this.shade = { x: L.start.x, z: L.start.z };
    this.move = null; // { fx, fz, tx, tz, t }
    this.pause = 0.5;
    this.heat = 0;
    this.hold = false;
    this.state = "playing";
    this.timer = 0;
    this.time = 0;
    this.steps = 0;
    this.latched = new Set();
    this.gateOpen = L.gates.length === 0;
    this.collected = new Set();
    this.path = null;
    this.dirty = true;
    this.lit = false;
    this.emit("reset");
  }

  index(x, z) {
    return z * this.level.w + x;
  }

  setSun(az, el) {
    const s = this.level.sun;
    az = wrapAz(az);
    if (s.azMin !== null) az = clampAz(az, s.azMin, s.azMax);
    el = Math.min(s.elMax, Math.max(s.elMin, el));
    if (az !== this.az || el !== this.el) {
      this.az = az;
      this.el = el;
      this.dirty = true;
    }
  }

  rotate(dAz, dEl) {
    this.setSun(this.az + dAz, this.el + dEl);
  }

  // The cell that counts for sunlight: the one the shade is mostly on.
  shadeCell() {
    const m = this.move;
    if (m && m.t >= 0.5) return this.index(m.tx, m.tz);
    return this.index(this.shade.x, this.shade.z);
  }

  shadePosition() {
    const m = this.move;
    if (!m) return [this.shade.x, this.shade.z, 0];
    const t = m.t < 0 ? 0 : m.t > 1 ? 1 : m.t;
    const e = t * t * (3 - 2 * t);
    return [m.fx + (m.tx - m.fx) * e, m.fz + (m.tz - m.fz) * e, Math.sin(t * Math.PI)];
  }

  refreshShadows() {
    if (!this.dirty) return;
    this.dirty = false;
    shadowMap(this.level, this.height, this.az, this.el, this.shadow);
    // Sensors latch when sunlight reaches them.
    if (!this.gateOpen) {
      const d = sunDir(this.az, this.el);
      let changed = false;
      for (const s of this.level.sensors) {
        const i = this.index(s.x, s.z);
        if (!this.latched.has(i) && !isShadowed(this.level, this.height, s.x, s.z, d)) {
          this.latched.add(i);
          changed = true;
          this.emit("sensor", i);
        }
      }
      if (changed && this.latched.size === this.level.sensors.length) {
        this.gateOpen = true;
        for (const g of this.level.gates) this.height[this.index(g.x, g.z)] = 0;
        shadowMap(this.level, this.height, this.az, this.el, this.shadow);
        this.emit("gate");
      }
    }
    this.pathDirty = true;
  }

  sensorLit(i) {
    return this.latched.has(i);
  }

  isOpen(i) {
    const k = this.level.kind[i];
    if (k === KIND.GATE) return this.gateOpen && this.shadow[i] === 1;
    return this.shadow[i] === 1;
  }

  // Where the shade wants to go: dew it can reach through shadow, else the
  // well, else as close to the well as the shadow allows. In sunlight it
  // runs for the nearest shadow first.
  planPath() {
    const L = this.level;
    const n = L.w * L.h;
    for (let i = 0; i < n; i++) this.open[i] = this.isOpen(i) ? 1 : 0;
    const from = this.index(this.shade.x, this.shade.z);
    const fromLit = !this.open[from];
    this.open[from] = 1;
    bfsParents(L, this.open, from, this.parents, this.queue);
    let best = null;
    let bestLen = Infinity;
    if (!fromLit) {
      for (const d of L.dew) {
        const i = this.index(d.x, d.z);
        if (this.collected.has(i)) continue;
        const p = pathTo(this.parents, i);
        if (p && p.length < bestLen) {
          best = p;
          bestLen = p.length;
        }
      }
      if (!best) best = pathTo(this.parents, this.index(L.exit.x, L.exit.z));
    }
    if (!best) {
      // Among reachable shadowed cells, the one nearest the well (by the
      // static distance map), or the nearest shadowed cell when standing in light.
      let target = -1;
      let score = Infinity;
      for (let i = 0; i < n; i++) {
        if (this.parents[i] === -2 || (i === from && fromLit)) continue;
        const dist = this.exitDist[i];
        if (dist === 65535) continue;
        const s = fromLit ? pathLength(this.parents, i) * 1000 + dist : dist * 1000 + pathLength(this.parents, i);
        if (s < score) {
          score = s;
          target = i;
        }
      }
      if (target >= 0 && target !== from) best = pathTo(this.parents, target);
    }
    this.path = best && best.length > 1 ? best : null;
    this.pathDirty = false;
  }

  update(dt) {
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    const L = this.level;
    this.refreshShadows();

    if (this.state === "scorched") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.scorches++;
        this.reset();
      }
      return;
    }
    if (this.state !== "playing") return;

    // Heat from sunlight on the cell the shade is on.
    const cell = this.shadeCell();
    this.lit = this.shadow[cell] === 0;
    if (this.lit) this.heat = Math.min(1, this.heat + dt * HEAT_RATE);
    else this.heat = Math.max(0, this.heat - dt * COOL_RATE);
    if (this.heat >= 1) {
      this.state = "scorched";
      this.timer = SCORCH_TIME;
      this.move = null;
      this.emit("scorch");
      return;
    }

    // Walking.
    if (this.move) {
      const m = this.move;
      m.t += dt / STEP_DURATION;
      if (m.t >= 1) {
        this.shade.x = m.tx;
        this.shade.z = m.tz;
        this.move = null;
        this.pause = STEP_PAUSE;
        this.steps++;
        this.arrive(this.index(m.tx, m.tz));
        this.pathDirty = true;
      }
      return;
    }
    if (this.pause > 0) {
      this.pause -= dt;
      return;
    }
    if (this.hold) {
      this.path = null;
      return;
    }
    if (this.pathDirty) this.planPath();
    if (this.path) {
      const next = this.path[1];
      if (this.isOpen(next)) {
        const x = next % L.w;
        const z = (next - x) / L.w;
        this.move = { fx: this.shade.x, fz: this.shade.z, tx: x, tz: z, t: 0 };
        this.emit("step", next);
      } else {
        this.pathDirty = true;
      }
    }
  }

  arrive(i) {
    const L = this.level;
    const k = L.kind[i];
    if (k === KIND.DEW && !this.collected.has(i)) {
      this.collected.add(i);
      this.emit("dew", i);
    }
    if (k === KIND.EXIT) {
      this.state = "won";
      this.emit("win");
    }
  }

  toggleHold() {
    this.hold = !this.hold;
    this.pathDirty = true;
    this.emit("hold", this.hold);
  }
}

function clampAz(az, min, max) {
  // Clamp to the arc from min to max going clockwise, picking the nearest end.
  const span = wrapAz(max - min);
  const rel = wrapAz(az - min);
  if (rel <= span) return az;
  const past = rel - span;
  const before = 360 - rel;
  return wrapAz(past < before ? max : min);
}
