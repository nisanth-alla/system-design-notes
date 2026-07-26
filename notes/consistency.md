# Consistency

## What it is

Consistency describes what a reader is guaranteed to see after a write has happened somewhere in the system. In a single-node database this is usually not interesting — read-after-write is just how it works. It becomes a real design question the moment data is replicated across multiple nodes, regions, or caches, because now "after a write" doesn't mean the same instant everywhere.

The spectrum runs roughly from **strong consistency** (every reader, everywhere, sees the latest write immediately after it's acknowledged) to **eventual consistency** (readers will see the latest write *eventually*, but there's a window — milliseconds to seconds, sometimes longer — where different replicas disagree).

## When to use it

**Strong consistency** when:

- Correctness depends on everyone agreeing on the current state right now — account balances, inventory counts that gate whether you can sell an item, leader election, anything where two people acting on stale data causes a real-world conflict (double-booking, overselling, double-spending).
- The system is small enough, or the access pattern localized enough, that the latency and availability cost of coordinating across nodes is acceptable.

**Eventual consistency** when:

- Staleness for a short window is harmless — social media likes/view counts, search index updates, most caching, activity feeds.
- You need high availability and low latency across geographically distributed nodes, and are willing to trade "everyone agrees right now" for "everyone agrees very soon."
- The data model naturally tolerates it — anything append-only or where later writes don't depend on reading the absolute latest state first.

## Tradeoffs

This is fundamentally the CAP theorem showing up in a design review: when a network partition happens between nodes, you must choose between staying available (and risking inconsistency) or staying consistent (and refusing some requests until the partition heals). You don't get to skip this choice — you only get to choose which failure mode you're comfortable with, and pick it in advance rather than in an incident.

- Strong consistency costs latency (coordination between nodes takes time) and availability (a node that can't reach a quorum has to refuse writes, or reads, rather than guess).
- Eventual consistency costs correctness guarantees — you have to actually reason about what happens when two clients read different values for the same key at the same time, which is a real design burden, not a footnote.
- "Eventual" is doing a lot of work in that phrase. How eventual? Milliseconds or minutes? If you can't answer that for your system, you don't actually know what you've built — put a number on it (even an approximate SLA) so downstream consumers can plan around it.
- Strong consistency in a distributed system is usually implemented via consensus protocols (Raft, Paxos) or single-writer designs — both of which are real engineering investments, not a checkbox.

## Real example

A bank transfer needs strong consistency on the balance check-and-deduct step — if two concurrent withdrawals both read the same "sufficient funds" balance before either deduction lands, you've just let someone overdraw. This is usually handled with a single source of truth for the balance (or serializable transactions / optimistic locking with a version check) rather than trusting eventually-consistent replicas for that specific operation.

Contrast with the "last transaction time" shown on a dashboard, or a notification that a transfer completed — those can be eventually consistent. If the dashboard is 500ms stale, nobody loses money; it's just a UI staleness that resolves itself on the next poll or refresh.

The pattern worth noticing: it's rarely "this whole system is strongly consistent" or "eventually consistent" — it's usually a handful of operations that truly need strong guarantees, sitting inside a much larger system that's eventually consistent everywhere else. Identify which operations those are early; don't default the whole system to strong consistency just because one code path needs it.

## 5-line summary

- Consistency is about what a reader sees, and how soon, after a write happens elsewhere in the system.
- Strong consistency: correct and current everywhere, at the cost of latency and availability during partitions.
- Eventual consistency: available and fast, but readers can briefly see stale data — fine when staleness is harmless.
- CAP means you don't get to dodge this tradeoff during a network partition — decide in advance which failure mode you accept.
- Most real systems are eventually consistent by default, with a small number of operations carved out to be strongly consistent where correctness actually demands it.
