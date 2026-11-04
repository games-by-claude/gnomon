// Captures the real game in headless Chromium (WebGL through SwiftShader):
//   node tools/capture.mjs smoke            load the build, play a level, report console errors
//   node tools/capture.mjs shots            screenshots into .arcadible/gallery and store art PNGs
//   node tools/capture.mjs videos [name]    art videos and gallery videos (frames -> ffmpeg)
import puppeteer from "puppeteer-core";
import http from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { spawnSync } from "node:child_process";

const DIST = "dist";
const ART = ".arcadible";
const GALLERY = join(ART, "gallery");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".json": "application/json", ".css": "text/css" };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    const f = join(DIST, p);
    if (!existsSync(f) || statSync(f).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function launch() {
  return puppeteer.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    protocolTimeout: 600000,
    args: [
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      "--use-gl=angle",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--autoplay-policy=no-user-gesture-required",
      "--font-render-hinting=none",
    ],
  });
}

async function openPage(browser, port, { width, height, dpr = 1, mobile = false, log = [] }) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  page.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => log.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  try {
    await page.waitForFunction(() => globalThis.__gnomon && __gnomon.state.mode !== "loading", { timeout: 30000 });
  } catch (err) {
    console.error("page did not boot. console:\n" + log.join("\n"));
    throw err;
  }
  await page.evaluate(() => __gnomon.setManual(true));
  return page;
}

// Advance the game by `seconds` in fixed steps, optionally running a script per step.
async function advance(page, seconds, fps = 30) {
  await page.evaluate(
    (seconds, fps) => {
      const n = Math.round(seconds * fps);
      for (let i = 0; i < n; i++) __gnomon.frame(1 / fps);
    },
    seconds,
    fps,
  );
}

// Winning sun scripts per level, found by tools/autoplay.mjs in the real
// simulation. Each run is [seconds, azimuth change per second, elevation change per second].
const PLAYS = JSON.parse(readFileSync("tools/plays.json", "utf8"));
// A frozen intro: frames render, but the game doesn't advance, so the scripted
// play starts from exactly the state the autoplayer started from.
const intro = (script, seconds = 1) => [[seconds, 0, 0, true], ...script];
// The first `seconds` of a script, for a mid-level screenshot.
function head(script, seconds) {
  const out = [];
  let left = seconds;
  for (const [t, a, e, f] of script) {
    if (left <= 0) break;
    out.push([Math.min(t, left), a, e, f]);
    left -= t;
  }
  return out;
}

async function runScript(page, script, fps, onFrame) {
  let frame = 0;
  for (const [seconds, dAz, dEl, freeze] of script) {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      await page.evaluate(
        (dAz, dEl, fps, freeze) => {
          const g = __gnomon.game();
          if (g && (dAz || dEl)) g.rotate(dAz / fps, dEl / fps);
          __gnomon.frame(freeze ? 0 : 1 / fps);
        },
        dAz,
        dEl,
        fps,
        !!freeze,
      );
      if (onFrame) await onFrame(frame);
      frame++;
    }
  }
  return frame;
}

const TITLE_CSS = (size, where) => `
  position:absolute; ${where}; z-index: 20; pointer-events:none; font-family: ui-rounded, "DejaVu Sans", system-ui, sans-serif;
  font-weight: 800; font-size:${size}px; letter-spacing:.26em; text-indent:.26em; color:#fff3cf; text-align:center;
  text-shadow: 0 ${size / 18}px ${size / 6}px rgba(40,20,30,.55), 0 0 ${size / 3}px rgba(255,200,120,.35);`;

async function addTitle(page, size, where) {
  await page.evaluate(
    (css) => {
      const d = document.createElement("div");
      d.id = "capture-title";
      d.textContent = "GNOMON";
      d.setAttribute("style", css);
      document.body.appendChild(d);
    },
    TITLE_CSS(size, where),
  );
}

const ART_LEVEL = {
  id: "art",
  name: "Gnomon",
  chapter: 2,
  hint: "The great dial. Turn the whole sky and walk the hours.",
  sun: { az: 120, el: 32, elMin: 20, elMax: 60 },
  map: [
    "..............",
    "....o.......o.",
    "..3......3....",
    "..3...........",
    "......666.....",
    "......666..2..",
    "..o...666..2..",
    "....S.........",
    "...........3..",
    "..4...........",
    "..4....o...E..",
    "..............",
  ],
};

const ICON_LEVEL = {
  id: "icon",
  name: "Icon",
  chapter: 0,
  sun: { az: 135, el: 38, elMin: 20, elMax: 60 },
  map: ["...E", "..4.", ".S..", "...."],
};

const PLACES = {
  // name: [width, height, level, camera, title]
  splash: { w: 1920, h: 1080, level: ART_LEVEL, cam: { pitch: 0.8, yaw: 0.45 }, script: [[10, 14, 0]] },
  banner: { w: 2560, h: 1280, level: ART_LEVEL, cam: { pitch: 0.8, yaw: 0.5, dist: 25, target: [-4.2, 0.4, 0] }, title: [150, "left:7%; top:50%; transform:translateY(-55%)"], script: [[10, 14, 0]] },
  cover: { w: 1536, h: 1024, level: ART_LEVEL, cam: { pitch: 0.78, yaw: 0.4 }, title: [120, "left:0; right:0; top:11%"], script: [[9, 15, 0]] },
  poster: { w: 1024, h: 1536, level: ART_LEVEL, cam: { pitch: 0.95, yaw: 0.35 }, title: [96, "left:0; right:0; top:10%"], script: [[9, 15, 0]] },
  icon: { w: 1024, h: 1024, level: ICON_LEVEL, cam: { pitch: 0.75, yaw: 0.35, dist: 5.2, target: [0.4, 0.3, 0.2] }, script: [[1.75, 9, 0], [3.5, -9, 0], [1.75, 9, 0]] },
};

async function setup(page, place) {
  await page.evaluate((def) => {
    __gnomon.startCustom(def);
    __gnomon.setUIVisible(false);
    __gnomon.game().hold = true;
  }, place.level);
  await page.evaluate((cam) => __gnomon.view.setCamera(cam), place.cam);
  if (place.title) await addTitle(page, place.title[0], place.title[1]);
  await advance(page, 0.5);
}

function ffmpeg(framesDir, out, fps, w, h) {
  const r = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(framesDir, "f%04d.png"), "-vf", `scale=${w}:${h}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-crf", "21", "-preset", "medium", "-movflags", "+faststart", out],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error("ffmpeg failed for " + out);
}

const cmd = process.argv[2] || "smoke";
const only = process.argv.slice(3);
const { server, port } = await serve();
const browser = await launch();
try {
  if (cmd === "dbg") {
    // node tools/capture.mjs dbg "<js expression evaluated in the page>" [out.png]
    const log = [];
    const page = await openPage(browser, port, { width: 1280, height: 720, log });
    const r = await page.evaluate(only[0]);
    console.log(JSON.stringify(r, null, 1));
    mkdirSync("/tmp/smoke", { recursive: true });
    await page.screenshot({ path: only[1] || "/tmp/smoke/dbg.png" });
    console.log("console:", log.join("\n") || "(clean)");
  } else if (cmd === "smoke") {
    const log = [];
    const page = await openPage(browser, port, { width: 1280, height: 720, log });
    const t0 = Date.now();
    let wins = 0;
    for (const [id, script] of Object.entries(PLAYS)) {
      await page.evaluate((id) => __gnomon.startLevel(__gnomon.LEVELS.findIndex((l) => l.id === id)), id);
      await runScript(page, intro(script), 30);
      await advance(page, 1.5); // the win panel appears after the sink animation
      const r = await page.evaluate(() => ({ mode: __gnomon.state.mode, steps: __gnomon.game().steps, scorches: __gnomon.game().scorches, dew: __gnomon.game().collected.size, dewMax: __gnomon.game().level.dewMax, panel: !!document.querySelector("#ui .screen:not(.hidden)") }));
      if (r.mode === "won") wins++;
      console.log("play", id.padEnd(7), JSON.stringify(r));
    }
    console.log(`${wins}/${Object.keys(PLAYS).length} levels won by script (${Date.now() - t0} ms)`);
    const prog = await page.evaluate(() => JSON.stringify(__gnomon.saves().progress));
    console.log("progress:", prog);
    await page.evaluate(() => __gnomon.startLevel(0));
    await runScript(page, head(intro(PLAYS["dawn-1"]), 2.5), 30);
    mkdirSync("/tmp/smoke", { recursive: true });
    await page.screenshot({ path: "/tmp/smoke/dawn-1.png" });
    await page.evaluate(() => __gnomon.showTitle());
    await advance(page, 1);
    await page.screenshot({ path: "/tmp/smoke/title.png" });
    await page.evaluate(() => __gnomon.showLevels());
    await advance(page, 0.2);
    await page.screenshot({ path: "/tmp/smoke/levels.png" });
    console.log("console:", log.length ? log.join("\n") : "(clean)");
  } else if (cmd === "shots") {
    mkdirSync(GALLERY, { recursive: true });
    const log = [];
    // Gameplay screenshots at 1920x1080, with the HUD.
    const doGallery = !only.length || only.includes("gallery");
    const page = doGallery ? await openPage(browser, port, { width: 1920, height: 1080, log }) : null;
    if (doGallery) {
    const shots = [
      ["screenshot_01", "dawn-1", head(intro(PLAYS["dawn-1"]), 4.3)],
      ["screenshot_03", "dusk-5", head(intro(PLAYS["dusk-5"]), 7)],
      ["screenshot_04", "noon-1", head(intro(PLAYS["noon-1"]), 4.6)],
      ["screenshot_05", "dusk-1", head(intro(PLAYS["dusk-1"]), 4)],
      ["screenshot_06", "noon-5", head(intro(PLAYS["noon-5"]), 5)],
    ];
    for (const [name, id, script] of shots) {
      await page.evaluate((id) => __gnomon.startLevel(__gnomon.LEVELS.findIndex((l) => l.id === id)), id);
      await runScript(page, script, 30);
      await page.screenshot({ path: join(GALLERY, name + ".png") });
      console.log("shot", name, id);
    }
    await page.evaluate(() => __gnomon.showLevels());
    await advance(page, 0.3);
    await page.screenshot({ path: join(GALLERY, "screenshot_07.png") });
    await page.close();
    // Phone screenshots, landscape, 19.5:9.
    const phone = await openPage(browser, port, { width: 975, height: 450, dpr: 2, mobile: true, log });
    for (const [name, id, script] of [["screenshot_01_phone", "dawn-1", head(intro(PLAYS["dawn-1"]), 4.3)], ["screenshot_02_phone", "dusk-5", head(intro(PLAYS["dusk-5"]), 7)]]) {
      await phone.evaluate((id) => __gnomon.startLevel(__gnomon.LEVELS.findIndex((l) => l.id === id)), id);
      await runScript(phone, script, 30);
      await phone.screenshot({ path: join(GALLERY, name + ".png") });
      console.log("shot", name);
    }
    await phone.close();
    }
    // Store art stills.
    for (const [name, place] of Object.entries(PLACES)) {
      if (only.length && !only.includes(name) && !(only.includes("art") && !only.includes("gallery"))) continue;
      if (only.length === 1 && only[0] === "gallery") continue;
      const p = await openPage(browser, port, { width: place.w, height: place.h, log });
      await setup(p, place);
      await advance(p, 0.1);
      await p.screenshot({ path: join(ART, name + ".png") });
      console.log("art", name);
      await p.close();
    }
    console.log("console:", log.filter((l) => !l.startsWith("[log]")).join("\n") || "(clean)");
  } else if (cmd === "videos") {
    const fps = 30;
    const jobs = [];
    for (const [name, place] of Object.entries(PLACES)) jobs.push({ out: join(ART, name + "_video.mp4"), place, name });
    jobs.push({
      name: "screenshot_02",
      out: join(GALLERY, "screenshot_02.mp4"),
      play: [["dawn-1", intro(PLAYS["dawn-1"])], ["noon-1", intro(PLAYS["noon-1"])], ["dusk-1", intro(PLAYS["dusk-1"])]],
      w: 1920,
      h: 1080,
    });
    jobs.push({ name: "evening-walk", out: join(GALLERY, "evening-walk.mp4"), play: [["dusk-5", intro(PLAYS["dusk-5"])]], w: 1920, h: 1080 });
    for (const job of jobs) {
      if (only.length && !only.includes(job.name)) continue;
      const t0 = Date.now();
      const frames = `/tmp/frames-${job.name}`;
      rmSync(frames, { recursive: true, force: true });
      mkdirSync(frames, { recursive: true });
      const log = [];
      let n = 0;
      if (job.place) {
        const page = await openPage(browser, port, { width: job.place.w, height: job.place.h, log });
        await setup(page, job.place);
        n = await runScript(page, job.place.script, fps, async (i) => {
          await page.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
        });
        await page.close();
        ffmpeg(frames, job.out, fps, job.place.w, job.place.h);
      } else {
        const page = await openPage(browser, port, { width: job.w, height: job.h, log });
        for (const [id, script] of job.play) {
          await page.evaluate((id) => __gnomon.startLevel(__gnomon.LEVELS.findIndex((l) => l.id === id)), id);
          const made = await runScript(page, script, fps, async (i) => {
            await page.screenshot({ path: join(frames, `f${String(n + i).padStart(4, "0")}.png`) });
          });
          n += made;
        }
        await page.close();
        ffmpeg(frames, job.out, fps, job.w, job.h);
      }
      rmSync(frames, { recursive: true, force: true });
      const size = statSync(job.out).size;
      console.log(`video ${job.out}: ${n} frames, ${(size / 1024 / 1024).toFixed(1)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      const errs = log.filter((l) => !l.startsWith("[log]"));
      if (errs.length) console.log("console:", errs.join("\n"));
    }
  }
} finally {
  await browser.close();
  server.close();
}
