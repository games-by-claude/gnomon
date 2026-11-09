---
# The facts, filled in by the bench from the transcript when the run ends;
# the sections below are the agent's own, written as it goes.
round: 2
agent: claude
harness: Claude Code 2.1.318
model: claude-fable-5-1
model_note: ""
plan: api-key
arc: 1.0.14
starter: ""
started: 2026-11-04T01:13:09Z
ended: 2026-11-04T02:33:28Z
turns: 1
releases: { tried: 3, published: 3 }
validate_issues: 1
cost_usd: 29.72
cost_note: ""
requests: 84
tokens: { input: 2282, cached: 22000343, cache_written: 1133956, output: 200642, reasoning: null }
title: "Gnomon"
handle: gnomon
version: 1.0.0
shipped: true
transcript: "messages, commands and their output; the model's thinking only as signatures (Claude Code keeps it encrypted)"
transcript_url: https://arcadible.com/data#games-by-agents
prior_work:
  - "01:13:35: cloned games-by-claude/lampward, its own round-one game, and read its TRIAL.md; later copied its AGENTS.md and dotfiles over the starter's"
human: []
redacted:
  - "[redacted: cookie] ×15: a sign-in cookie or form token"
  - "[redacted: device code] ×7: a sign-in code"
  - "[redacted: email] ×43: the agent's inbox"
  - "[redacted: id] ×12: the bench's account ID at its inbox service"
  - "[redacted: name] ×6: a person's name or account"
---

# TRIAL.md

A running log of making an original 3D game with stages and saved progress, publishing it public on Arcadible as @claude with videos on its store page. What I did, in order, and where I had to guess.

## 1. Finding my feet

- `/home/agent/game` was empty. Node 24, npm 11, git, gh, curl, python3 (no pip, no Pillow) were there. The four secrets were in env vars.
- The GitHub org `games-by-claude` already held one repo, `lampward`, with a `TRIAL.md` from an earlier run of this kind of task. I cloned it to `/tmp/lampward-ref` and read it first: it records the Arcadible docs layout, the device-code login trick, and that `arc deploy git` can't be used from here. That saved an hour of rediscovery, and I checked each claim against the current docs rather than trusting it.
- The docs are at developer.arcadible.com, published as `llms-full.txt` (about 300 KB). I downloaded it to `/tmp/docs` and read the sections on the store page, saves, the SDK, the manifest, limits, runtime limitations, best practices, releases, and going public.
- The new facts that matter for this task:
  - **Videos on the store page** come from `.arcadible/<art>_video.mp4` companions to the icon, cover, banner, poster, and splash (same exact aspect ratio and size as the PNG, 3 to 30 seconds, up to 15 MB, no sound), and from MP4s in `.arcadible/gallery/`: a `screenshot_NN.mp4` is a carousel item shown by its first frame with a play mark, and any other MP4 can be embedded in the README description. `trailer` in `arcadible.toml` must be a YouTube or Vimeo URL, and I have no account on either, so I left it out.
  - **Saves**: the hosted script `/arcadible/sdk/v1.js`, `await arcadible.ready`, then `saves.read`; never start a new game when `read` fails; never overwrite a save written by a newer version; save at checkpoints and on `visibilitychange`/`pagehide`; read before write.
  - **`ai`**: the docs say code-generated art and levels don't count, but text a model produced that players see does. Everything players read in this game (level names, hints, the store text) was written by me, a model, so I set `ai = "generative"`.
- **Sudo works here** (it didn't in the Lampward run), so I installed Chromium 156, ffmpeg (with libx264), Xvfb, and ImageMagick with apt. Headless Chromium renders WebGL2 through SwiftShader when launched with `--use-angle=swiftshader --use-gl=angle --enable-unsafe-swiftshader --no-sandbox`, which I confirmed with a tiny WebGL2 page before committing to it. That means every screenshot and video is the real game rendering, captured by puppeteer-core.

## 2. Logging in without a browser

- Same recipe as the Lampward log, which I re-verified: run `arc login --no-browser --no-qrcode` in the background, read the code it prints, then drive account.arcadible.com with curl and a cookie jar: GET `/login` for its `csrf`, POST email/password/csrf (302 to arcadible.com), GET `/link` for a fresh `csrf`, POST `dac=<code>` (302 to `/login`), GET `/login` for another `csrf`, POST the credentials once more (302 to the CLI docs with `?welcome`). `arc login` printed "Logged in." about a second later, and `arc whoami` shows `gba-claude@agentmail.to`.
- Guess that held: the page's reCAPTCHA still isn't enforced on the server side.

## 3. Project setup

- `arc init -y` in the non-empty directory added only `arcadible.toml` with a fresh id and `0.1.0-beta.1`. I copied the starter's `.editorconfig`, `.gitattributes`, `.gitignore`, and `AGENTS.md` from the Lampward repo (they came from the blank starter).
- Dependencies: `three` (the renderer), `esbuild` (one minified bundle, so the game is a single script plus `index.html`), and `puppeteer-core` (drives the system Chromium for captures). There's a build step: `npm run build` writes `dist/`, which is `deploy_dir`.

## 4. The game: Gnomon

- Premise: you don't control the character; you control the sun. A small "shade" can only exist in shadow, and walks by itself along whatever shadow it can reach, toward dew and then toward the well. Sandstone pillars of different heights cast the shadows, and turning the sun swings them all like the hand of a sundial. Fifteen hand-made levels in three chapters add long and short shadows, drops, sun stones that open gates when sunlight hits them, a sun that only crosses part of the sky, and a final "great dial".
- Why this: it's 3D in substance, not just in looks. The puzzle is literally the projection of 3D geometry onto the ground, and three.js's real shadow map, driven by the same sun vector, draws exactly the shadow the game logic tests, so what the player sees is what the rules use.
- Structure: `src/core.js` is engine-free (grid, sun, exact per-tile shadow ray tests with a 2D grid traversal, BFS pathfinding, the state machine, a `clone()` for search tools). `src/render.js` is three.js (instanced tiles and pillars, a directional light with a shadow map that follows the sun, a shade with glowing eyes, a sundial ring around each island with the sun as an orb on it). `src/ui.js` is a DOM overlay of real buttons, so keyboard, mouse, and touch all drive every menu. `src/audio.js` is synthesized (no files). `src/saves.js` wraps the SDK. `esbuild` bundles everything into one `dist/game.js` (about 580 KB, three.js included).
- Saves: one `progress` save (current level, per-level done/dew/scorches) and one `settings` save (sound). Written when a level is completed and when a level is started (so "Continue" returns to where you were), after `arcadible.ready` and a `read`. A failed read shows a toast and disables writing rather than starting over; a save stamped by a newer version makes this version read-only; `saves.where === "memory"` shows a notice. Off Arcadible (the capture tool's local server) it falls back to `localStorage`.

### Where I had to guess, and what I checked instead

- **Camera and sky.** My first render had a flat dark backdrop. The probe showed why: the camera looks down at about 53 degrees, so the sky sphere's upper half is never in frame. I reworked the below-horizon colors into a warm hazy gradient and added the sundial ring with the sun as an orb, since the sun sprite in the sky could never be seen either.
- **three.js r187 dropped `PCFSoftShadowMap`.** The console warning told me; I switched to `PCFShadowMap` with a radius.
- **Level design without hands.** I couldn't play the levels, so I wrote two tools instead of guessing:
  - `tools/solve.mjs`: a breadth-first search over (cell, sun azimuth in 3-degree steps, elevation, sun stones lit, dew) that requires the shade to be in shadow at every moment. It proved each level solvable and found start angles where the start tile is shadowed; the first drafts of 8 levels had a lit start, two were impossible at their elevation range (short shadows with pillars too far apart), and the "Spiral" was trivial (walls on both sides of every corridor shadow it from any direction), so it became "Switchback", with a wall on one side only.
  - It also found a real bug: open gates were never walkable, because the shadow map only counted ordinary floor. Two gate levels had passed only because their gates could be walked around; I redesigned them so the gates are true chokepoints.
  - `tools/autoplay.mjs`: a beam search over sun moves in the actual simulation (the real auto-walker, heat, timing), which proved every level can be beaten, with all of its dew, by turning the sun alone. Its winning scripts drive the screenshots and videos, so the store media are genuine, successful plays.
- **The auto-walker's rule.** The first version only walked when a complete shadow path to the well existed, so in level 1 it just sat while the shadow swept past. Now it goes for reachable dew, then the well, and otherwise to the reachable shadowed cell nearest the well (or the nearest shadow when it's standing in light). That made the "follow the sweeping shadow" puzzles work.
- **`ai = "generative"`.** Code-drawn art doesn't count under Arcadible's definition, but the text players read was written by a model, so I disclosed.

## 5. Store media, all from the running game

- `tools/capture.mjs` serves `dist/` on a local port, opens it in headless Chromium through puppeteer-core, switches the game to a manual clock (`__gnomon.setManual(true)` and `__gnomon.frame(dt)`), and then either screenshots a state or renders frames at 30 fps and hands them to ffmpeg (libx264, yuv420p, faststart). Every PNG and MP4 in `.arcadible/` is therefore the real renderer, driven by the real game, with the real HUD in the gameplay shots.
- The gameplay videos are the autoplayer's winning scripts replayed in the browser. To make that deterministic, the one-second intro before each play renders frames with `dt = 0`, so the simulation starts in exactly the state the autoplayer started from. My first attempt let the intro advance the game, and 4 of 15 replays diverged (the shade had already walked before the first turn). With the frozen intro, all 15 win in the browser, the same as in Node.
- Camera: at the first camera pitch (53 degrees), a sun standing near the camera threw every shadow behind its pillar, where the player couldn't see the shade. I steepened the camera (60 degrees) and added a faint silhouette of the shade that draws only where a pillar hides it (a `GreaterDepth` test on a sphere slightly larger than the body, so the body itself never triggers it; the first version, same size as the body, drew a moiré over the shade and showed up in the icon).
- Art: `splash` is the attract dial with no text, `cover`, `banner`, and `poster` carry only the title (allowed), the `icon` is a close-up of the shade in a pillar's shadow with no text. Each has a `_video.mp4` companion of the same size: the sun crossing the dial (about 10 seconds; 7 for the icon, which rocks the sun so the shade stays in shadow). Gallery: `screenshot_01` and `_03` to `_07` are PNGs from levels 1, 15, 6, 11, 10, and the level list; `screenshot_02.mp4` is three levels played to completion; `evening-walk.mp4` (the finale played through) is embedded in the description; two `_phone` screenshots are taken at a 19.5:9 landscape viewport with a device pixel ratio of 2.
- The banner's first composition put the title over the island; I moved the camera target so the island sits to the right.
- `pkill -f capture.mjs` killed my own shell, exactly as the Lampward log warned. I did it anyway, once.

## 6. Testing the saves for real

- `arc serve --no-build -p 4100` runs the local play page with Arcadible's own SDK host (it fetches the SDK's files from Arcadible at start). `tools/sdktest.mjs` opens that page in headless Chromium, finds the game's frame (origin `127.0.0.1`, apart from the page's `localhost`, as on Arcadible), and checks the whole loop: at boot `saves.where` is `"game"` and `arcadible.build` is `{ version: "0.1.0-beta.1", channel: "local" }`; after the scripted play of level 1 the `progress` save holds `current: 1` and `dawn-1: done`, stamped with the version; toggling sound writes `settings`; after a full reload the title reads "Continue: level 2" and the sound button "Muted". Console clean. The same script takes a play URL and a frame origin, so it can run against staging after the deploy.

## 7. Staging

- `arc deploy` of `0.1.0-beta.1` (with `npm run build` run by the CLI) published to staging in about a minute: https://play.arcadible.com/gnomon:staging/, build origin `4a37cb69-….arcadible.io`. The "Release Published [Staging]" email reached the AgentMail inbox at 02:18:56Z.
- `tools/sdktest.mjs` against the real play page: `saves.where` is `"game"`, `arcadible.build` is `{ version: "0.1.0-beta.1", channel: "staging" }`, the scripted play of level 1 wins, the `progress` save is stamped with the version, and after a reload the title reads "Continue: level 2". The only console warnings are the play page's own manifest notices. Headless Chromium loads play.arcadible.com without any bot wall.
- A bug the re-shot screenshots caught: the hidden-shade silhouette stayed at rest height while the body bobbed during a step, so the top of the body poked outside it and the silhouette showed as a grey dome on every walking frame. Fixed by moving the silhouette with the body; the gameplay screenshots and the two gameplay videos were rendered again, and that fix is the second prerelease, which doubles as the cross-version saves check: a persistent Chromium profile that saved on beta.1 opens beta.2 and must continue at level 2.
- `0.1.0-beta.2` (the silhouette fix and the reordered gallery) published to staging at 02:30Z, email at 02:30:23Z. The cross-version check passed with a persistent Chromium profile: the save written by beta.1 opened on beta.2 as "Continue: level 2" (`readOnly: false`), a play on beta.2 re-stamped the save with `0.1.0-beta.2`, and then the beta.1 version link opened that newer save with `readOnly: true`, so an older build never writes over a newer one. Production and staging keep separate saves, so players start fresh at 1.0.0, as the docs say.

## 8. Release

- Version `1.0.0` with `visibility = "public"`, deployed with `arc deploy` from this machine (the `git` method needs the GitHub App connected in Studio, which is a browser step with a GitHub password I don't have, and the token lacks the `workflow` scope anyway).
- `arc deploy` published `1.0.0` to production at 02:31:43Z (release `e72498f3-…`, build `e9873b14-…`, served from `d7511477-….arcadible.io`). The "Release Published [Production]" email arrived at 02:31:44Z.
- Checked about a minute later, without waiting for the 10-minute propagation window:
  - https://arcadible.com/play/gnomon answers 200 with the title, the bio as `og:description`, and the cover as `og:image`. Its HTML references the icon, poster, splash and `splash_video.mp4`, the cover, the seven gallery items (`screenshot_01.png` to `_07`, with `screenshot_02.mp4` among them), and `evening-walk.mp4` in the description. The "More by" section shows Lampward's icon.
  - The public record (`api.arcadible.com/v1/discover/games/<id>`, the lookup the CLI uses) says `visibility: public`, `ai: generative`, `audience: everyone`, genres puzzle/casual/strategy, inputs mouse/touch/keyboard, orientation any, released 2026-11-04T02:31:43Z.
  - The production build played in headless Chromium through the real play page: `arcadible.build` is `{ version: "1.0.0", channel: "production" }`, `saves.where` is `"game"`, level 1 wins by script, and a reload continues at level 2 with a clean console.

## Where I had to guess, in one place

1. **Logging in without a browser.** Drove the account site's forms with curl, including the second password entry after the device code, which the docs don't describe. Worked first time this run.
2. **Whether the levels are good.** Nobody has played with hands. Two tools stand in: a conservative solver (every level has a shadow-only solution) and a beam-search autoplayer in the real simulation (every level, with all its dew, is beatable by turning the sun alone, in 3 to 23 seconds of play when you know the answer). The difficulty curve is my reading of those numbers: solver turn counts rise from about 25 in Dawn to about 280 in Switchback, and the finale needs 85 turns and 38 moves with all dew. A person may find "Crossing" (level 10) a spike: it was the one level the narrow beam couldn't finish.
3. **The auto-walker.** The shade decides where to walk (dew, then the well, then as near the well as the shadow allows). I believe this is the right feel for a one-input puzzle, and "Wait" exists for when it isn't, but a human might want direct control. Untested with hands.
4. **Touch and phones.** Pointer events, 44 px buttons, safe-area insets, a capped pixel ratio, a smaller shadow map on coarse pointers, and `orientation = "any"` with the camera refitting to any aspect ratio. The phone screenshots are from a 19.5:9 headless viewport at 2x, not a device.
5. **`ai = "generative"`.** All code-drawn, but the words players read were written by a model, so I disclosed rather than argue the definition.
6. **Deploy method.** Direct `arc deploy`, with GitHub as the source of record; the GitHub App step and the Actions workflow are both out of reach from here.
7. **Media composition.** Judged from the PNGs and extracted video frames, not from the store's layouts: title placement on the banner, cover, and poster inside the edge margin, and whether the dial reads well at thumbnail size.

## Links

- Store page: https://arcadible.com/play/gnomon
- Play: https://play.arcadible.com/gnomon/
- Source: https://github.com/games-by-claude/gnomon
