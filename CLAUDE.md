# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project Overview

<!-- TODO: One paragraph — what this project is, who uses it, and the main moving parts. -->

Projects made from [agentic-project-template](https://github.com/adolladivinity/agentic-project-template) log workflow improvements in `docs/template-sync.md`.

This project is **Swapsmith**, a free static Commander deckbuilder with live TCGplayer prices and rules-based swap suggestions ([spec](docs/superpowers/specs/2026-11-02-swapsmith-design.md), [plan](docs/superpowers/plans/2026-11-02-swapsmith-v1.md)).

Stack: TypeScript + Vite static site, no UI framework; Scryfall API called from the browser; Vitest + Playwright; GitHub Pages ([ADR-001](docs/decisions/ADR-001-swapsmith-stack-and-hosting.md)).

## Essential Commands

Any developer should be able to say "run the tests" and have it work on the first try. Keep these accurate.

| Task | Command |
|------|---------|
| Install | `npm ci` (CI also runs `npx playwright install --with-deps chromium`) |
| Dev server | `npm run dev` → http://localhost:5173/swapsmith/ (run as a background task so logs stay visible) |
| Test (all) | `npm run check` (typecheck, unit, e2e); live tests: `SCRYFALL_LIVE=1 npm test`, `EDHREC_LIVE=1 npm test` |
| Test (single file) | `npx vitest run tests/unit/<file>.test.ts` · `npx playwright test tests/e2e/<file>.spec.ts` |
| Lint / typecheck | `npm run typecheck` |
| Format | none yet (no formatter chosen) |
| Android APK | `npm run apk` (signed release; needs JDK 21, Android SDK, signing key). See [`docs/android-build.md`](docs/android-build.md) |
| Docs index | `tools/doc-index.sh` (rebuild `docs/INDEX.md`); `tools/doc-index.sh --check` fails on a missing header or stale index |

## Architecture

- `src/scryfall/` — the only code that calls Scryfall: queued ~100 ms apart (500 ms for search/named/collection), 429 and network-error retry, identical requests in flight shared, 24 h IndexedDB cache (a reply up to a week old is used when Scryfall can't be reached, older ones are deleted). A deck is priced with one cheapest-printing search per ~15 cards; a card's printings load only when its picker opens ([ADR-006](docs/decisions/ADR-006-cheapest-printing-search-and-bounded-cache.md)). Scryfall quirks that shaped it (query length cap, 429s without CORS, lenient batch matching) are listed in the spec's "Data source" section
- `src/edhrec/` — the only code that calls EDHREC (commander pages: inclusion, synergy, themes, brackets, average deck), on the same client one request at a time about a second apart ([ADR-005](docs/decisions/ADR-005-edhrec-commander-data.md)). Suggestions use it first and fall back to Scryfall rules when it has nothing ([spec](docs/superpowers/specs/2026-11-03-recommendations-revamp.md))
- `src/lib/` — pure logic (parser, pricing, suggestions, share links), unit-tested in `tests/unit/`
- `src/lib/similar.ts` — text similarity, deck fit and comparison for the swap-from-card options; pure, unit-tested, constants tuned on recorded Edgar and Breya pages ([spec](docs/superpowers/specs/2026-11-06-swap-from-card.md))
- `src/ui/` — screens; `tests/e2e/` drives them with Scryfall answered from `tests/fixtures/` (real replies; re-record with `RECORD=1 npx vitest run tests/unit/record-fixtures.test.ts`)
- `src/ui/cardDialog.ts` — the tap-a-card dialog: the card pinned on top, similar cards that fit with popularity, a plain comparison and a Swap button ([spec](docs/superpowers/specs/2026-11-06-swap-from-card.md))
- `public/` — manifest, `sw.js` (saves the page and every built file at install from the build's `precache.json`, same-origin only), icons; regenerate PNG icons with `node tools/make-icons.mjs` ([ADR-002](docs/decisions/ADR-002-installable-pwa.md), ADR-006). Fonts are served from `src/fonts/`, never from a font host
- `capacitor.config.ts`, `android/` — the Android app: Capacitor wraps the built `dist/` (built with `--base=./`); the Android project is committed, build output and keys are not. Releases come from `.github/workflows/android.yml` on a `v*` tag ([ADR-003](docs/decisions/ADR-003-android-apk-capacitor.md), [ADR-004](docs/decisions/ADR-004-apk-signing-and-data-safety.md), runbook [`docs/android-build.md`](docs/android-build.md))
- `src/lib/art.ts` — pure Life Counter art logic: `ArtRef`, the picker's Scryfall query (`artQuery`), dominant-color sampling and accent suggestions (`dominantColors`, `readable`, `accentSuggestions`, `parseAccent`), the cache eviction plan; unit-tested in `tests/unit/art.test.ts`
- `src/scryfall/art.ts` — art search and random on the shared Scryfall client (`unique=art`, one request per tap, none per keystroke)
- `src/ui/artStore.ts` — the art image cache: blobs in the `swapsmith-art` IndexedDB, 24 images / 8 MB caps, a keep set, every failure answers null ([ADR-007](docs/decisions/ADR-007-life-counter-art-cache.md)); `src/ui/accent.ts` reads its pixels
- `src/ui/artPicker.ts` — the art picker dialog (search by name or artist, filters, grid, Load more); `src/ui/life.ts` applies a pick, shows art and accents on tiles and offers the suggestions in the edit dialog ([spec](docs/superpowers/specs/2026-11-13-life-counter-art.md))
- `src/ui/native.ts`, `src/ui/backup.ts` — Android back gesture (to Your decks, then exit) and deck backup/restore (share sheet in the app, file download in a browser)
- `.github/workflows/pages.yml` — CI on every push/PR; deploys `dist/` to Pages from `main` only

<!-- TODO: Key directories and what lives where. Prefer an ASCII diagram for data flow. -->

## Where Things Live

**Find docs through [`docs/INDEX.md`](docs/INDEX.md)** — one line per doc (status, date, what it answers), generated from each doc's front matter. Read it instead of listing folders; open only the docs a task needs.

- `docs/decisions/` — ADRs; read before re-deciding anything already decided
- `docs/superpowers/` — specs and plans for features in progress
- `docs/research/` — cited research notes
- `docs/toolbox.md` — tools usable today by need; check before adding a library, MCP, or extension
- `docs/tool-watchlist.md` — vetted but not set up, ruled out, and where to search when the toolbox has nothing
- `docs/template-sync.md` — workflow improvements to send back to the template; `/go` adds rows
- `.mcp.json` — project MCP servers (Lightpanda, Playwright, Context7, DeepWiki); browse through the `browsing` skill
- `packs/` — optional packs (e.g. `packs/codex/`); each README says how to enable it
- `tutorial/` — human setup guide for new machines and new users; keep it in sync when tools or setup steps change

## Workflow

The **Superpowers** plugin is this project's backbone (brainstorm → plan → TDD → review → finish). Don't add competing planner, reviewer, or TDD skills.

- Plans and specs live in `docs/superpowers/` (plan mode writes there too)
- Plans are **vertical slices** (each task touches every layer end-to-end), and every task is gated by tests
- Verification means: run the commands above, then exercise the changed behavior as a user would; run dev servers as background tasks and read their logs
- Reviews prioritize: correctness → security → missing/weakened tests → drift from the plan
- Finish with `/go` (verify → review → simplify → PR). Keep PRs small; squash merge

## Model and Effort Routing

Pass `model` and `effort` on every Agent call using this table; agents with a `model:` line in their frontmatter keep it. Subagents default to Sonnet (`CLAUDE_CODE_SUBAGENT_MODEL`).

| Task type | Model | Effort |
|---|---|---|
| Lookups: file search, link checks, summarizing one page, gathering research pages, yes/no screenshot checks | haiku | low |
| Reading/research digests, docs-only review, runbooks, mechanical edits | sonnet | medium |
| Code review, test writing, multi-file refactors | sonnet | high |
| Security, architecture | opus | high |

Test gates and commits are shell scripts (run the tests, then `git commit` only if they pass), not agents: an agent costs tokens every turn for steps that never need judgment. Agent cost is mostly re-reading context each turn, so a tight scope and few turns save more than a cheaper model. Docs-only and idea-discussion work gets no review agents (see `/go` tiers). One new session per task: `/clear` between unrelated tasks.

**Orchestrator protocol** for multi-step plans run through agents:

- The main session only briefs, reads short reports, and decides; workers do the reading and writing
- Agents run in the background (`run_in_background`) and are never polled; wait for the completion notice
- A cheap gate (a script or a haiku agent) reruns the tests after each worker instead of trusting the worker's summary
- The plan carries an execution-routing table: each piece of work, who does it, model, effort
- After each run, `/retro` on the measurements (tokens, wall time, green on the first try, reruns) moves routing one notch at a time: green first try → one notch lower next time; a rerun → one notch higher; a mechanical bug caught in review → a new test or check, not a reminder

**At the start of each session**, after the user's first request, suggest the main-session effort in one line using the effort table in [`tutorial/tips.md`](tutorial/tips.md#choosing-model-and-effort) (e.g. "Suggested: `/effort medium` — docs work"). Claude can't change the main session's effort itself. When a request is unrelated to the session so far, suggest `/clear` before starting it.

## Conventions

- Finish migrations; never leave two patterns for the same thing side by side. When a convention changes, grep `.claude/` agents and skills for templates still teaching the old one
- Every doc under `docs/` and `tutorial/` starts with front matter: `description`, `status` (`current` | `draft` | `done` | `superseded` + `superseded_by`), `updated`. Run `tools/doc-index.sh` after adding or changing one; `/go` runs `--check`
- One home per fact: link to the doc that owns it instead of copying it. Never cite a `superseded` doc as current
- Before stating project state (what's done, what's next, which branch), confirm it against `git log`/`git status` or the plan's checkboxes; memory notes can be stale
- Path-specific rules live in `.claude/rules/` and load only when matching files are touched
- When the user repeats a multi-step request, suggest turning it into a skill or command in `.claude/`
- Never edit the template repo from a project session; log the change in `docs/template-sync.md` instead

## Git

<important if="committing or staging changes">
- Commit as soon as a task is complete — at least hourly during long work
- Create separate commits per file, each with a message specific to that file's change
</important>

## Gotchas

- **EDHREC is unofficial** (ADR-005): its JSON can change without notice. `parsePage` checks every field and treats anything odd as "no page" (the fallback). An unknown commander answers 403; a partner pair in the wrong order answers `{redirect}` (followed once). Run `EDHREC_LIVE=1 npm test` before review. Re-record with `RECORD=1 npx vitest run tests/unit/record-fixtures.test.ts -t EDHREC`; the e2e mock answers name and role lookups from the recorded cards, since their batches depend on the order a test changes filters.
- **Android signing (data safety):** every APK people install must be signed with the one original key and keep the package id `io.github.saturnskies.swapsmith`, or Android refuses the update and uninstalling deletes users' decks. Never generate a new keystore, never commit `*.keystore`, `*.jks` or `android/keystore.properties` (the repo is public), and never change the package id or the `swapsmith:v1` storage key without a migration. The key lives in the owner's safe copy and in the repo's GitHub secrets. Releases are CI builds only; local builds have a lower `versionCode` and cannot update a phone that has a CI build. Details: ADR-004.
- Gradle downloads from Maven Central can fail with HTTP 429 in cloud sandboxes; rerun the same command, since Gradle keeps what it already fetched.
- Scripted file edits on Windows: Python text mode rewrites LF as CRLF and can double carriage returns; read and write bytes or use `newline=""`, or prefer the Edit tool. Backslashes in a heredoc'd Python string get unescaped twice (`\1` became a control character), so sed or regex text goes through the Edit tool. `git ls-files --eol | grep i/crlf` finds files stored with the wrong endings.
- Saved tool output: when a Bash or agent result says it was saved to a file, Grep it or Read a slice with offset/limit; never open it whole. Whatever is read stays in context and is re-sent every later turn.
- Measure your own transcripts before adopting someone else's token fix: a guard that sounds useful may fire once a session here.
- Re-recording Scryfall fixtures picks up that day's prices, so e2e totals move. Each e2e test reads only its own flow's fixture map (fixtures recorded at different times hold the same request with different prices); update the pinned totals together with the recording. When the app only starts making different requests, `RECORD=fill npx vitest run tests/unit/record-fixtures.test.ts` keeps every reply already recorded and asks the real API only for the missing ones, so recorded suggestions stay put and only the new replies carry today's prices.
- Git Bash rewrites `branch:path` arguments (`git show main:docs/x.md`) into Windows paths; set `MSYS_NO_PATHCONV=1` for those commands.

<!-- Add Claude's recurring mistakes here as you find them. This is the highest-signal section. -->
