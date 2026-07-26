# System Design Notes

A working set of notes I keep while designing, reviewing, and debugging distributed systems — and while prepping for system design interviews.

Most system design content online is either a 40-minute YouTube video or a one-line flashcard. Neither is useful when you're actually stuck on a design decision at 11pm. This repo is my attempt at the middle ground: notes short enough to re-read in five minutes, but with enough real detail that they hold up when someone asks "wait, why would you do it that way?"

Each note follows the same shape on purpose — so once you know the format, you can skim any file in this repo and know exactly where to look for the part you need. Where a concept has a failure mode worth actually seeing rather than reading about, there's a small runnable TypeScript experiment to go with it — and for two of them, a **[live interactive visualization](https://nisanth-alla.github.io/system-design-notes/)** you can click through without cloning anything.

## Structure

```
notes/
  caching.md
  queues.md
  consistency.md
  retries-and-idempotency.md
  database-design.md
  api-design.md
experiments/
  idempotency/          # runnable TypeScript demo of unsafe retries -> double charge -> fix
  cache-stampede/        # runnable TypeScript demo of a thundering herd -> request coalescing fix
  shared/                # WebSocket broadcaster used by both, so the visualizations' Live mode can watch real events
visualizations/
  src/cache-stampede/    # in-browser version of the cache-stampede experiment (Simulated + Live modes)
  src/idempotency/       # in-browser version of the idempotency experiment (Simulated + Live modes)
```

## How to read these notes

Every note in `notes/` follows this structure:

1. **Definition** — what it actually is, in plain language
2. **When to use it** — the situations that call for it (and the ones that don't)
3. **Tradeoffs** — what you give up, because everything costs something
4. **Real example** — a system or scenario where this showed up in practice
5. **5-line summary** — the version you'd say out loud in an interview

The `experiments/` folder is different — it's runnable TypeScript, not notes. If a concept is easier to understand by breaking it than by reading about it, it gets an experiment: a small Express server (or two) plus a script that reproduces the bug, then fixes it. Start with [`experiments/idempotency`](experiments/idempotency) — it reproduces a double-charge bug from unsafe retries, then fixes it with an idempotency key. [`experiments/cache-stampede`](experiments/cache-stampede) reproduces a thundering herd on a hot cache key, then fixes it with request coalescing.

Not every note has a matching experiment, and that's intentional — a note earns one when there's an actual failure worth watching happen, not as a checkbox. Consistency and API design, for example, are contracts and tradeoffs more than bugs to trigger, so they stay as notes with inline code snippets.

## Interactive visualizations

Two of the experiments — cache stampede and idempotent retries — are fundamentally about timing: many things happening at once, or the same thing happening more than once. That's harder to build intuition for from scrolling console output than from watching it happen, so those two have a small React app that animates them in the browser: **[nisanth-alla.github.io/system-design-notes](https://nisanth-alla.github.io/system-design-notes/)**.

This is a bonus layer, not a replacement — the notes and terminal experiments are the primary, complete content on their own. The visualizations exist for the two cases where seeing the race condition happen actually teaches something a log line can't. Each one has a **Simulated** mode (works instantly, no setup) and a **Live** mode (connects over a WebSocket to the actual server in `experiments/`, running on your machine, and animates its real events instead of faked ones) — see [`visualizations/`](visualizations) for how to run either.

## Why this exists

I got tired of re-deriving the same tradeoffs every time a design question came up — cache-aside vs. write-through, at-least-once vs. exactly-once, strong vs. eventual consistency. Writing it down once, in a consistent format, made it something I could actually reuse instead of re-Googling.

If you're studying for interviews, working through your own designs, or just enjoy this kind of thing — welcome. The notes are opinionated in places. If you think one of them is wrong, or you've hit an edge case I didn't cover, open an issue. That's exactly the kind of thing that makes a note better.

## Notes index

| Note | What it covers |
|---|---|
| [caching.md](notes/caching.md) | Cache-aside vs. write-through, invalidation, stampedes |
| [queues.md](notes/queues.md) | When a queue helps, delivery guarantees, backpressure |
| [consistency.md](notes/consistency.md) | Strong vs. eventual, CAP tradeoffs in practice |
| [retries-and-idempotency.md](notes/retries-and-idempotency.md) | Safe retries, idempotency keys, dedup |
| [database-design.md](notes/database-design.md) | Normalization, indexing, sharding, when SQL vs. NoSQL |
| [api-design.md](notes/api-design.md) | Versioning, pagination, error contracts, REST vs. RPC |

## Running the experiments

`experiments/` is a single TypeScript/Node project — one `package.json` and `tsconfig.json` shared across all experiments, with npm scripts namespaced per experiment (`<experiment>:<script>`):

```bash
cd experiments
npm install

npm run idempotency:naive        # or idempotency:idempotent, then idempotency:client
npm run cache-stampede:naive     # or cache-stampede:coalesced, then cache-stampede:load
```

See each experiment's own README for what to expect and what edge cases are worth poking at.

## Running the visualizations locally

`visualizations/` is a separate small Vite + React + TypeScript app (its own `package.json`, independent of `experiments/`):

```bash
cd visualizations
npm install
npm run dev
```

It's also live at [nisanth-alla.github.io/system-design-notes](https://nisanth-alla.github.io/system-design-notes/), auto-deployed from `main` via the GitHub Actions workflow in `.github/workflows/deploy-visualizations.yml`. That hosted page's Simulated mode works immediately; its Live mode needs the real `experiments/` server running locally too — see [`visualizations/README.md`](visualizations/README.md#using-live-mode).

## A note on staying current

I revisit these periodically rather than writing them once and forgetting them — system design "best practices" shift as tools mature (see: the industry's slow migration from ad-hoc retries to proper idempotency keys, or how caching strategy changes once you have a real CDN in front of you). If you're reading this and something feels dated, that's a good sign it's due for a pass — feel free to flag it.

## License

MIT — see [LICENSE](LICENSE). Use whatever's useful, adapt it, fork it for your own notes.
