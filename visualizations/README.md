# Visualizations

A small Vite + React + TypeScript app with two interactive visualizations, each a browser-based counterpart to one of the runnable experiments in [`../experiments`](../experiments):

- **Cache Stampede** — watch concurrent requests pile onto a database when a hot cache key expires, then watch request coalescing fix it.
- **Idempotent Retries** — watch a retried purchase get charged multiple times, then watch an idempotency key make retries safe.

Live at **[nisanth-alla.github.io/system-design-notes](https://nisanth-alla.github.io/system-design-notes/)**, auto-deployed from `main` via [`../.github/workflows/deploy-visualizations.yml`](../.github/workflows/deploy-visualizations.yml).

## Why this exists alongside the terminal experiments

The terminal experiments in `experiments/` are the primary, complete version of each demo — they hit a real Express server and print real counts. Each visualization has two modes:

- **Simulated** (the default) — pure in-browser logic with shortened timers, so it works instantly for anyone visiting the hosted page with nothing installed. Same event sequence, same outcome, as the real servers — just faked timing.
- **Live** — connects over a WebSocket to the *actual* server in `experiments/cache-stampede` or `experiments/idempotency` running on your machine, and animates its real events as real HTTP requests really happen. Only works if you've cloned the repo and started that server locally first (the hosted GitHub Pages site has no backend of its own — Live mode just points your browser at `localhost`).

Simulated mode isn't a placeholder for Live mode — it's the mode that makes this page usable by anyone with a browser, no setup required. Live mode is for anyone who wants to see the exact same thing happen against real code, not a re-implementation of it.

## Structure

```
src/
  App.tsx                        # landing page, links to both visualizations
  cache-stampede/
    simulation.ts                # pure logic — no DOM, mirrors experiments/cache-stampede/server.ts
    CacheStampedeViz.tsx         # renders both Simulated and Live modes
  idempotency/
    simulation.ts                # pure logic — mirrors experiments/idempotency/server.ts
    IdempotencyViz.tsx
```

Simulation logic is kept separate from rendering so the behavior being demonstrated (request counts, dedup outcomes) is easy to reason about independent of animation/styling concerns. Both modes in each `*Viz.tsx` share the same event-handling code — Live mode just feeds it real events from a WebSocket instead of the simulation's fake ones.

## How to run

```bash
npm install
npm run dev
```

`npm run build` produces a production build in `dist/` with the `base` path set for GitHub Pages (`/system-design-notes/`). If you fork this repo under a different name, update `base` in `vite.config.ts` to `/<your-repo-name>/`.

## Using Live mode

Live mode needs the corresponding real server running from `../experiments`. Either script for a given demo works — each just sets that server's *starting* mode, and you can flip it live from the UI afterwards:

```bash
cd ../experiments
npm install
npm run cache-stampede:naive     # for cache-stampede — or cache-stampede:coalesced, doesn't matter which
npm run idempotency:naive        # for idempotency — or idempotency:idempotent, doesn't matter which
```

Then, in the visualization, switch the "Simulated / Live" toggle to **Live** and click **Connect** (default URLs — `ws://localhost:8001` for cache-stampede, `ws://localhost:8000` for idempotency — match the ports the real servers listen on). Once connected, the mode radio buttons (Naive/Coalesced, Without/With key) call the server's `POST /mode` endpoint and switch its actual behavior live — no need to stop the server and start the other script to compare naive vs. fixed. The "Fire requests" / "Simulate retries" button sends real HTTP requests to whichever mode the server is currently in.

## Deploying your own fork

1. Push to your fork's `main` branch — the workflow in `.github/workflows/deploy-visualizations.yml` runs automatically.
2. One-time setup: in your fork's repo settings, go to **Settings → Pages** and set **Source** to **GitHub Actions**. Without this, `configure-pages` fails with `Get Pages site failed` / HTTP 404.
3. Update `base` in `vite.config.ts` to `/<your-repo-name>/`.
