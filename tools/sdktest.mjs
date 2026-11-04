// Runs the game inside a play page (arc serve's local one, or Arcadible's)
// and checks that progress is kept through arcadible.saves across a reload.
//   arc serve --no-build -p 4100 &  then  node tools/sdktest.mjs
//   node tools/sdktest.mjs https://play.arcadible.com/gnomon:staging/ arcadible.io [--check-only]
import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4100/";
const FRAME = process.argv[3] || "127.0.0.1";
const CHECK_ONLY = process.argv.includes("--check-only");

const PLAYS = JSON.parse(readFileSync("tools/plays.json", "utf8"));
// PROFILE=/some/dir keeps the browser's storage between runs, to test that
// saves carry over from one deployed version to the next.
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  protocolTimeout: 600000,
  userDataDir: process.env.PROFILE || undefined,
  args: ["--no-sandbox", "--use-angle=swiftshader", "--use-gl=angle", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const log = [];
page.on("console", (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => log.push(`[pageerror] ${e.message}`));

async function gameFrame() {
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("iframe"), { timeout: 30000 });
  let frame;
  for (let i = 0; i < 100 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes(FRAME));
    if (!frame) await new Promise((r) => setTimeout(r, 200));
  }
  await frame.waitForFunction(() => globalThis.__gnomon && __gnomon.state.mode !== "loading", { timeout: 60000 });
  return frame;
}

let f = await gameFrame();
console.log("frame:", f.url());
console.log("boot:", await f.evaluate(() => ({ where: __gnomon.saves().where, build: arcadible.build, sdk: arcadible.version, version: __gnomon.version, mode: __gnomon.state.mode, progress: JSON.stringify(__gnomon.saves().progress), settings: __gnomon.saves().settings, playLabel: document.querySelector("#ui .primary")?.textContent, error: __gnomon.saves().error, readOnly: __gnomon.saves().readOnly })));
if (CHECK_ONLY) {
  console.log("console:", log.filter((l) => !/404|favicon/.test(l)).join("\n") || "(clean)");
  await browser.close();
  process.exit(0);
}
await f.evaluate(() => {
  __gnomon.setManual(true);
  __gnomon.startLevel(0);
});
for (const [seconds, dAz, dEl] of PLAYS["dawn-1"]) {
  const n = Math.round(seconds * 30);
  for (let i = 0; i < n; i++) {
    await f.evaluate((dAz, dEl) => {
      const g = __gnomon.game();
      if (dAz || dEl) g.rotate(dAz / 30, dEl / 30);
      __gnomon.frame(1 / 30);
    }, dAz, dEl);
  }
}
await new Promise((r) => setTimeout(r, 1500));
console.log("after play:", await f.evaluate(async () => ({ mode: __gnomon.state.mode, names: await arcadible.saves.list(), progress: arcadible.saves.readSync("progress"), info: arcadible.saves.infoSync("progress") })));
// Toggle sound off, so settings get written too.
await f.evaluate(() => document.querySelector('#ui button[title="Toggle sound (M)"]').click());
await new Promise((r) => setTimeout(r, 800));
console.log("settings:", await f.evaluate(() => arcadible.saves.readSync("settings")));
// Reload: does it continue?
f = await gameFrame();
console.log("after reload:", await f.evaluate(() => ({ where: __gnomon.saves().where, progress: __gnomon.saves().progress, settings: __gnomon.saves().settings, playLabel: document.querySelector("#ui .primary")?.textContent, soundLabel: document.querySelector('#ui .screen:not(.hidden) button[aria-pressed]')?.textContent })));
console.log("console:", log.filter((l) => !/404|favicon/.test(l)).join("\n") || "(clean)");
await browser.close();
