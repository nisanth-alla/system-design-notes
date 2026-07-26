# Database Design

## What it is

Database design is the set of decisions about how data is structured, related, and accessed: what tables/collections exist, how they relate, what's indexed, and — once a single machine isn't enough — how data is split across multiple machines. It's easy to underrate because a bad schema doesn't usually fail loudly on day one; it fails quietly, as a slow query six months later that turns into a 2am page once the table hits real size.

## When to use it

Every project needs *some* deliberate database design — the question is really how much rigor to apply, and that scales with two things: how much the data matters if it's wrong, and how large it's going to get.

- Reach for a normalized relational schema when data integrity matters and relationships between entities are core to the domain (orders belong to customers, line items belong to orders) — the kind of thing where an inconsistency is a real bug, not a cosmetic issue.
- Reach for denormalization or NoSQL when read performance at scale matters more than avoiding duplication, or when the data genuinely doesn't have a fixed relational shape (event logs, flexible user-generated content, document-like data).
- Reach for sharding only once a single database instance is actually the bottleneck — not preemptively. Sharding adds real complexity (cross-shard queries, rebalancing, harder joins) that you don't want to pay for before you need it.

## Normalization, indexing, sharding

**Normalization** is organizing tables so each fact is stored once, related via foreign keys, to avoid update anomalies (change a customer's address in one place, not seventeen). The tradeoff is that reads often need joins across multiple tables to reassemble a full picture, and joins get expensive as tables grow. Denormalization deliberately duplicates data to avoid those joins on the read path — it trades storage and write complexity (now you have to keep two copies in sync) for read speed. Most production systems end up somewhere in between: normalized where correctness matters, denormalized on the specific hot read paths where join cost is a proven problem.

**Indexing** is a data structure (usually a B-tree, sometimes a hash index) that lets the database find rows without scanning the whole table. The tradeoff is real and often overlooked: every index speeds up reads on the columns it covers but slows down writes on that table, because every insert/update/delete has to also update every index. A table with ten indexes "just in case" is a table with slow writes for no measured benefit. Index the columns you actually filter, sort, or join on — check the query plan, don't guess.

**Sharding** is splitting one logical dataset across multiple physical databases, typically by a shard key (user ID, region, tenant ID). It's how you scale writes past what a single machine can handle. The cost: queries that need data from multiple shards (a global search across all users, for instance) become genuinely harder — you either fan out and merge in the application layer, or you accept that some queries just aren't supported anymore. Pick a shard key that matches your dominant access pattern, because changing it later means a live data migration, which is one of the more painful things you can do to a production system.

## Tradeoffs — SQL vs. NoSQL

This isn't really "SQL is old, NoSQL is scalable" — that framing is outdated and wasn't quite right even when it was popular. The real question is what guarantees and access patterns you need.

- **SQL / relational** gives you strong consistency, transactions, and joins as first-class citizens — pick it when relationships and integrity constraints are core to correctness (financial data, anything with strict foreign-key relationships).
- **NoSQL** (document, key-value, wide-column, graph) trades some of those guarantees for flexibility in schema, horizontal scalability, or a data model that fits the domain better (a graph database for a social graph, a document store for content with wildly varying shape).
- Modern relational databases (Postgres especially) have closed a lot of the gap — JSON columns, horizontal scaling extensions, and good enough throughput for the large majority of applications that think they need NoSQL "for scale" but never actually hit the scale where that matters. Don't pick NoSQL because of a scale you don't have yet.

## Real example

A ride-hailing app's core trip data (driver, rider, fare, timestamps) is a natural fit for a normalized relational schema — trips relate to users, payments relate to trips, and you genuinely need transactional guarantees around fare calculation and payment status. But the live location pings from drivers — high write volume, short-lived, no need for joins, no need for strong consistency beyond "give me the latest one" — are a much better fit for a key-value or time-series store, sharded by driver or region, that can absorb a firehose of writes cheaply.

This is a common real-world pattern: it's rarely one database for the whole system. It's the right storage engine for each access pattern, chosen deliberately rather than defaulting to whatever the team used last time.

## 5-line summary

- Database design decisions compound quietly — a bad schema doesn't fail loudly until the table is big enough to hurt.
- Normalize for correctness, denormalize deliberately on proven hot read paths — don't default to either extreme.
- Every index speeds up reads and slows down writes; index what you actually query, not everything that might someday be queried.
- Shard only once a single instance is the real bottleneck, and choose the shard key around your dominant access pattern — changing it later is painful.
- SQL vs. NoSQL is a question of what guarantees and access patterns you need, not which one is newer.
