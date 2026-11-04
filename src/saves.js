// Progress and settings through the Arcadible SDK, with a localStorage
// fallback for when the game runs outside Arcadible (a plain dev server, or
// the capture tool). One save holds progress, one holds settings.
import { compareSemver } from "./core.js";

const PROGRESS = "progress";
const SETTINGS = "settings";
export const SAVE_FORMAT = 1;

export function emptyProgress() {
  return { format: SAVE_FORMAT, current: 0, levels: {} };
}

export function emptySettings() {
  return { format: SAVE_FORMAT, sound: true };
}

export async function createSaves(gameVersion) {
  const sdk = globalThis.arcadible;
  const saves = {
    where: "local",
    readOnly: false,
    newerVersion: null,
    error: null,
    progress: emptyProgress(),
    settings: emptySettings(),
    build: null,
  };

  if (!sdk) {
    saves.where = "localStorage";
    try {
      saves.progress = migrateProgress(JSON.parse(localStorage.getItem("gnomon." + PROGRESS) || "null"));
      saves.settings = migrateSettings(JSON.parse(localStorage.getItem("gnomon." + SETTINGS) || "null"));
    } catch {
      /* fresh */
    }
    saves.writeProgress = (p) => {
      saves.progress = p;
      try {
        localStorage.setItem("gnomon." + PROGRESS, JSON.stringify(p));
      } catch {
        /* ignore */
      }
      return Promise.resolve();
    };
    saves.writeSettings = (s) => {
      saves.settings = s;
      try {
        localStorage.setItem("gnomon." + SETTINGS, JSON.stringify(s));
      } catch {
        /* ignore */
      }
      return Promise.resolve();
    };
    saves.retry = () => Promise.resolve(true);
    return saves;
  }

  const { build } = await sdk.ready;
  saves.build = build;
  saves.where = sdk.saves.where || "game";

  async function load() {
    try {
      const [p, s] = await Promise.all([sdk.saves.read(PROGRESS), sdk.saves.read(SETTINGS)]);
      saves.progress = migrateProgress(p ? JSON.parse(p) : null);
      saves.settings = migrateSettings(s ? JSON.parse(s) : null);
      saves.error = null;
      // Never write over a save made by a newer version of the game.
      const info = sdk.saves.infoSync(PROGRESS);
      if (info?.version && build?.version && compareSemver(info.version, build.version) > 0) {
        saves.readOnly = true;
        saves.newerVersion = info.version;
      }
      return true;
    } catch (err) {
      // timeout / unavailable / unknown: not the same as "no save". Don't start over.
      saves.error = err?.code || "unavailable";
      return false;
    }
  }
  await load();
  saves.retry = load;

  async function write(name, value, apply) {
    if (saves.readOnly || saves.error) {
      apply(value);
      return;
    }
    // Read before writing, so a save made in another tab isn't lost.
    let merged = value;
    try {
      const other = sdk.saves.readSync(name);
      if (other && name === PROGRESS) merged = mergeProgress(migrateProgress(JSON.parse(other)), value);
    } catch {
      /* not loaded yet: write ours */
    }
    apply(merged);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await sdk.saves.write(name, JSON.stringify(merged));
        return;
      } catch (err) {
        const code = err?.code;
        if (code === "invalid" || code === "too_large" || code === "too_many" || code === "full") {
          console.warn("Gnomon: save failed", code);
          saves.lastWriteError = code;
          return;
        }
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }
  saves.writeProgress = (p) => write(PROGRESS, p, (v) => (saves.progress = v));
  saves.writeSettings = (s) => write(SETTINGS, s, (v) => (saves.settings = v));
  return saves;
}

export function migrateProgress(p) {
  if (!p || typeof p !== "object") return emptyProgress();
  const out = emptyProgress();
  out.current = Number.isInteger(p.current) ? p.current : 0;
  if (p.levels && typeof p.levels === "object") {
    for (const [id, v] of Object.entries(p.levels)) {
      if (v && typeof v === "object") out.levels[id] = { done: !!v.done, dew: v.dew | 0, scorches: v.scorches | 0 };
    }
  }
  return out;
}

export function migrateSettings(s) {
  const out = emptySettings();
  if (s && typeof s === "object" && typeof s.sound === "boolean") out.sound = s.sound;
  return out;
}

export function mergeProgress(a, b) {
  const out = emptyProgress();
  out.current = Math.max(a.current, b.current);
  for (const id of new Set([...Object.keys(a.levels), ...Object.keys(b.levels)])) {
    const x = a.levels[id] || { done: false, dew: 0, scorches: 0 };
    const y = b.levels[id] || { done: false, dew: 0, scorches: 0 };
    out.levels[id] = { done: x.done || y.done, dew: Math.max(x.dew, y.dew), scorches: Math.max(x.scorches, y.scorches) };
  }
  return out;
}
