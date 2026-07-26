import { useState } from "react";
import CacheStampedeViz from "./cache-stampede/CacheStampedeViz";
import IdempotencyViz from "./idempotency/IdempotencyViz";

type Page = "home" | "cache-stampede" | "idempotency";

const REPO_URL = "https://github.com/nisanth-alla/system-design-notes";

export default function App() {
  const [page, setPage] = useState<Page>("home");

  return (
    <div className="app">
      <header className="app-header">
        <button className="app-title" onClick={() => setPage("home")}>
          System Design Notes — Visualizations
        </button>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="app-repo-link">
          View the repo →
        </a>
      </header>

      {page === "home" && (
        <main className="home">
          <p className="home-intro">
            These are bonus, in-browser versions of two of the runnable experiments
            in the repo — built to make two specific failure modes click faster than
            reading console output does. The markdown notes and terminal experiments
            are the primary content; this is just another way to see the same thing.
          </p>

          <div className="home-cards">
            <button className="home-card" onClick={() => setPage("cache-stampede")}>
              <h3>Cache Stampede</h3>
              <p>Watch 20 concurrent requests pile onto a database when a hot cache key expires — then watch request coalescing fix it.</p>
            </button>
            <button className="home-card" onClick={() => setPage("idempotency")}>
              <h3>Idempotent Retries</h3>
              <p>Watch a retried purchase get charged three times — then watch an idempotency key make retries safe.</p>
            </button>
          </div>
        </main>
      )}

      {page === "cache-stampede" && (
        <main>
          <button className="back-link" onClick={() => setPage("home")}>← Back</button>
          <CacheStampedeViz />
          <p className="deep-dive-links">
            Read more: <a href={`${REPO_URL}/blob/main/notes/caching.md`} target="_blank" rel="noreferrer">notes/caching.md</a>
            {" · "}
            <a href={`${REPO_URL}/tree/main/experiments/cache-stampede`} target="_blank" rel="noreferrer">runnable experiment</a>
          </p>
        </main>
      )}

      {page === "idempotency" && (
        <main>
          <button className="back-link" onClick={() => setPage("home")}>← Back</button>
          <IdempotencyViz />
          <p className="deep-dive-links">
            Read more: <a href={`${REPO_URL}/blob/main/notes/retries-and-idempotency.md`} target="_blank" rel="noreferrer">notes/retries-and-idempotency.md</a>
            {" · "}
            <a href={`${REPO_URL}/tree/main/experiments/idempotency`} target="_blank" rel="noreferrer">runnable experiment</a>
          </p>
        </main>
      )}
    </div>
  );
}