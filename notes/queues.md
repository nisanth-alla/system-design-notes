# Queues

## What it is

A queue is a buffer between a producer and a consumer that lets them run at different speeds, at different times, or on different machines without either one blocking on the other. The producer drops a message in and moves on; the consumer picks it up whenever it's ready.

The core thing a queue buys you is decoupling — in time (consumer doesn't have to be up right now), in speed (producer can burst, consumer drains steadily), and in failure domain (a crashed consumer doesn't take the producer down with it).

## When to use it

Reach for a queue when:

- The work can happen asynchronously — the caller doesn't need the result immediately to keep going (e.g., "send a confirmation email" doesn't need to block the checkout response).
- You need to smooth out bursty traffic — a queue lets you accept requests fast and process them at a sustainable rate instead of falling over under load.
- You're connecting services that shouldn't need to know about each other's uptime or scaling characteristics.
- You need to fan work out to multiple workers, or fan events out to multiple independent consumers.

Don't reach for a queue when:

- The caller genuinely needs a synchronous answer (a queue turns "wait for the response" into "poll for the response," which is worse if you actually need it now).
- You're using it to paper over a slow downstream system instead of fixing the downstream system — a queue can hide a capacity problem until it becomes a multi-hour backlog.
- The added operational complexity (another system to run, monitor, and reason about) isn't worth it for what is, honestly, just a function call.

## Delivery guarantees

This is the part that actually matters when you're designing around a queue — most production bugs involving queues come from assuming a stronger guarantee than the one you actually have.

- **At-most-once**: message is delivered zero or one times. If something fails mid-delivery, the message is just gone. Fast and simple, but you lose data on failure. Fine for things like metrics or logs where an occasional drop doesn't matter.
- **At-least-once**: message is delivered one or more times — the queue will redeliver if it doesn't get an acknowledgment in time. This is the most common guarantee (SQS, Kafka with manual offset commits, RabbitMQ with acks all work this way by default). The catch: your consumer **will** see duplicates eventually, so it needs to be idempotent (see [retries-and-idempotency.md](retries-and-idempotency.md)).
- **Exactly-once**: message is processed exactly one time, no duplicates, no drops. This sounds like what everyone wants, but true exactly-once delivery across a network is extremely expensive to guarantee and most systems that claim it are really doing at-least-once delivery plus idempotent processing under the hood. Treat "exactly-once" claims with healthy skepticism and ask what's actually happening at the boundary.

In practice: design for at-least-once delivery and idempotent consumers. It's a more honest default than chasing exactly-once, and it tends to be what you get anyway.

## Backpressure

A queue without limits just moves the problem — instead of your service falling over, the queue grows unbounded until *it* falls over, usually at a worse time and with less visibility.

Things worth having from day one:

- **Bounded queue depth** with an explicit policy for what happens when it's full (reject new work, shed the oldest, block the producer).
- **Consumer scaling that's actually wired to queue depth**, not just CPU — a queue can be backing up while consumer CPU looks idle if the work is I/O bound.
- **Dead-letter queues** for messages that fail processing repeatedly, so one poison message doesn't block the whole queue or get retried forever.
- **Visibility into queue age**, not just queue length — 10 messages that are 3 seconds old is fine; 10 messages that are 3 hours old means something downstream is stuck.

## Real example

An e-commerce order pipeline is the textbook case. When a customer places an order, the checkout API needs to confirm the order fast — it shouldn't block on inventory reservation, warehouse notification, email confirmation, and fraud scoring all happening synchronously. Instead, the API writes the order and drops an "order placed" event on a queue. Independent consumers pick it up: one reserves inventory, one notifies the warehouse, one sends the email, one runs fraud checks — each scaling and failing independently, and each retryable without the customer ever noticing a hiccup.

The failure mode people don't plan for: what happens when the fraud-check consumer starts failing for an hour? With a dead-letter queue and alerting on DLQ depth, you find out immediately and reprocess later. Without one, either those messages are silently lost or they retry forever and drown out new work.

## 5-line summary

- Queues decouple producers and consumers in time, speed, and failure domain.
- Use them for async work, bursty traffic, and fan-out — not as a workaround for a slow downstream service.
- Assume at-least-once delivery by default; that means your consumers must be idempotent.
- "Exactly-once" is usually at-least-once plus idempotency in disguise — ask what's really happening.
- Always design backpressure and dead-letter handling up front, not after the first incident.
