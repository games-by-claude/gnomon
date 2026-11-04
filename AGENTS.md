# AGENTS.md

This project is a game for Arcadible, a platform for publishing games. Build it with anything that runs in a browser: if it builds to a folder with an `index.html`, the `arc` CLI checks and deploys it, whatever the engine. Players play it wherever Arcadible is installed, and in any browser.

**This file was written when the project was created, and Arcadible's docs are kept current.** Where they differ, follow the docs. Every page is listed in https://developer.arcadible.com/llms.txt, and is all in https://developer.arcadible.com/llms-full.txt.

## Read the docs first

Read the page that covers what you're changing, every time, rather than relying on what you remember of it.

| Before you change                | Read                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The game                         | https://developer.arcadible.com/build/best-practices.md and https://developer.arcadible.com/build/runtime-limitations.md                                                                            |
| How it saves progress            | https://developer.arcadible.com/build/saves.md, then https://developer.arcadible.com/references/arcadible-sdk/saves.md and its codes in https://developer.arcadible.com/references/arcadible-sdk.md |
| `arcadible.toml`                 | https://developer.arcadible.com/references/arcadible-manifest.md                                                                                                                                    |
| `.arcadible/`                    | https://developer.arcadible.com/publish/store-page.md and https://developer.arcadible.com/references/arcadible-manifest.md                                                                          |
| `README.md`                      | https://developer.arcadible.com/references/arcadible-markdown.md                                                                                                                                    |
| How you deploy, play, or release | https://developer.arcadible.com/references/arcadible-cli.md and https://developer.arcadible.com/publish/releases.md                                                                                 |
| How it releases from GitHub      | https://developer.arcadible.com/publish/deploying-from-github.md                                                                                                                                    |

## Project structure

| Path                 | Contains                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `arcadible.toml`     | The game's id, version, and settings. Never change `id`. If it's missing, `arc init` adds one without scaffolding. |
| `README.md`          | The store page: the title, tagline, bio, and the description between the first and last `---`.                     |
| `.arcadible/`        | The store art, with fixed file names.                                                                              |
| `.arcadible-public/` | The game players load (`workflow.deploy_dir`), with `index.html` at its root. There's no build.                    |

## Commands

```sh
arc serve                     # run the game locally, as Arcadible does, reloading as you edit
arc validate                  # the checks arc deploy runs, with a link to each broken rule
arc deploy                    # validate, pack, publish, and wait until it's published
```

Every `arc` command is in https://developer.arcadible.com/references/arcadible-cli.md. Add `--json` to read a command's result as one JSON document on stdout. A command that fails exits with 1, and its JSON has `error.code`: act on the code, and look it up in https://developer.arcadible.com/references/errors.md, which says what to do.

## What doesn't change

- **Each version starts with empty browser storage,** since each build has its own origin. Keep progress in saves, through the Arcadible SDK: the hosted script, `<script src="/arcadible/sdk/v1.js"></script>`, which Arcadible and `arc serve` serve.
- **The game runs in the Arcadible sandbox,** which `arc serve` reproduces and other local servers don't. Read the runtime limitations before changing how it loads files, stores data, or talks to servers.
- **`/arcadible/` is Arcadible's.** Don't put an `arcadible` folder at the root of `deploy_dir`.

## Rules

- Run `arc validate` after every change to `arcadible.toml`, `README.md`, or `.arcadible/`. It exits with 1 when there are issues.
- Bump `version` in `arcadible.toml` before every deploy. Each version publishes once. A prerelease, such as `1.2.0-beta.1`, goes to `staging`, and any other version to `production`.
- Deploy prereleases to test. Deploy a release version only when the user asks to release: it's what players get, and it publishes the store page.
- Change `visibility` to `public` only when the user asks. It lists the game in the store and in search.
- When a code's entry says the user must act, such as logging in or connecting GitHub in Arcadible Studio, ask them, wait until they say it's done, then run the command again.
