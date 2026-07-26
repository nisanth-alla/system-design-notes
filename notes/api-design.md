# API Design

## What it is

API design is the contract between a service and everyone who calls it — the shape of requests and responses, what changes are allowed later without breaking existing callers, and how errors are communicated. It matters more than it looks like it should, because an API is one of the few things in software that you can't just refactor freely once it has external callers — someone else's code depends on the exact shape you shipped.

## When to use it

Every service with a caller outside its own process needs deliberate API design — the rigor scales with how many callers you have and how hard they'd be to coordinate a breaking change with. An internal API called by one team you sit next to can be looser than a public API with thousands of third-party integrations who will never all upgrade at once.

- Reach for REST when the domain maps naturally to resources (users, orders, products) and you want wide client compatibility, caching via HTTP semantics, and a well-understood mental model for consumers.
- Reach for RPC-style APIs (gRPC, etc.) when you control both client and server, need strong typing and codegen across languages, and care more about performance (binary protocol, HTTP/2 multiplexing) than about REST's resource conventions.
- Reach for GraphQL when clients have genuinely varied data needs and you want to avoid either over-fetching or maintaining dozens of bespoke REST endpoints — at the cost of more complexity on the server (query cost analysis, N+1 problems) and losing some of HTTP's built-in caching.

## Versioning, pagination, error contracts

**Versioning** exists because "never break existing clients" and "keep improving the API" are in tension, and versioning is how you resolve it without freezing the API forever. Common approaches: a version in the URL (`/v2/orders`), a version header, or additive-only evolution (only ever add optional fields, never remove or repurpose existing ones, so old clients keep working without needing a version bump at all). The additive-only approach is underused and often the simplest — most "breaking changes" are actually avoidable if you commit to never removing or changing the meaning of a field once shipped.

**Pagination** matters the moment a collection can grow without bound — return everything at once and eventually that response is enormous, slow, and fragile to build. Offset-based pagination (`?page=3&limit=20`) is simple but breaks under concurrent writes — items shift between pages if the underlying data changes while someone's paging through it. Cursor-based pagination (`?cursor=abc123`) is more robust for this exact reason: the cursor is an opaque pointer to "after this specific item," so it's stable even if rows are inserted or deleted elsewhere in the set. Cursor-based costs a bit more implementation complexity; it's worth it for any collection with meaningful write volume.

**Error contracts** are what turns "the API returned an error" into something a client can actually act on programmatically, rather than just log and give up on. A good error response has a machine-readable code (`INSUFFICIENT_FUNDS`, not just a 400), a human-readable message for logs and debugging, and enough structure that a client can decide whether to retry, prompt the user, or fail permanently. The HTTP status code alone is rarely enough signal — a 400 covers a huge range of "you did something wrong" cases that a client needs to be able to tell apart.

## Tradeoffs

- Strict versioning gives clients a stable contract to build against, but every version you support is a version you have to keep running, testing, and reasoning about — version sprawl is a real maintenance tax that shows up a year later.
- Cursor-based pagination is more robust than offset-based, but harder to implement "jump to page 7" style UI on top of, since cursors are inherently sequential.
- Rich, structured error contracts take more upfront design work than "just return a 500 with a message," but they're what let client teams build real error handling instead of string-matching your error messages (which will break the next time you tweak the wording).
- REST's resource model is intuitive and cache-friendly but can force awkward endpoints for actions that aren't naturally CRUD (`POST /orders/123/cancel` vs. modeling cancellation as a resource update) — there's no universally clean answer here, just a judgment call to make consistently across your API.

## Real example

A payments API that returns `{"error": "something went wrong"}` with a 400 status is nearly unusable for the client — is it a validation error the user can fix, a card decline, a rate limit, or a server bug? Compare that to `{"error": {"code": "CARD_DECLINED", "message": "The card was declined by the issuer.", "retryable": false}}` — now the client knows exactly what to show the user and knows not to blindly retry with the same card. That `retryable` field alone can prevent a client from accidentally hammering a payment processor with retries that will never succeed.

On pagination: a social feed API using offset-based pagination will show users duplicate or skipped posts if new posts are inserted while they're scrolling — a real, frequently-reported bug in systems that reach for the simpler approach without thinking about write volume. Cursor-based pagination avoids this because each cursor points to a specific item, not a shifting numeric position.

## 5-line summary

- An API is a contract you can't casually refactor once external callers depend on it — design it like one from the start.
- Prefer additive-only evolution over frequent breaking versions; version only when you truly can't avoid it.
- Use cursor-based pagination for any collection with real write volume — offset-based breaks under concurrent inserts/deletes.
- Give errors a machine-readable code and enough structure for clients to act on programmatically, not just a status code and a string.
- Choose REST, RPC, or GraphQL based on your actual access patterns and client diversity, not by default or by trend.
