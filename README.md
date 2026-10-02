# HEAVEN-BUS

A bus booking application for PS-07, Bus Seat Vanishing Act. React + TypeScript frontend for Vercel; Express + Socket.IO backend for Render; MongoDB Atlas inventory and transactional booking state.

## Features

- Passenger route search, live seat map, fixed five-minute holds, up to six seats, family mixed-gender seating, passenger details, checkout, history, printable tickets, confirmed-ticket cancellation with time-based refunds, and passenger-powered live journey tracking from origin to destination. Confirmed travellers can explicitly opt in to share phone GPS during the journey; fresh reports are aggregated into one bus position and individual raw locations are never returned to other passengers.
- Admin operations dashboard: bookings, active holds, searchable scheduled trips, create departure, refunds and payment exceptions. Live journey location is passenger-powered rather than driver/admin-controlled.
- Ask Jarvis: conversational route search with follow-up context, dates, budget and evening filters, hold/refund guidance, optional browser voice input, and issue-specific support contacts. Critical booking facts remain deterministic and database-backed. For local development, Jarvis can also use a laptop-hosted Ollama model for free-form HEAVEN-BUS questions; Ollama never owns seat, payment, refund or inventory decisions.
- Journey-day email reminders: checkout collects a notification email, confirmed bookings retain it, and a background worker sends the passenger a same-day reminder and live-tracking link when a Resend sender is configured.
- Clearly labelled sandbox payment mode, plus Razorpay checkout, server verification, signed webhook inbox, recovery and compensating refunds.

This is a demonstration platform. Schedules are seeded examples and tickets are not valid for travel. Sandbox payment mode never charges money. Razorpay must be configured with **test keys** for this project.

## Run locally

Use Node.js 22 or newer and a MongoDB replica set (Atlas is supported). Transactions do not work with a standalone MongoDB process.

```bash
npm ci
cp .env.example .env
# Set MONGODB_URI and a random JWT_SECRET of at least 32 characters.
npm run seed
npm run dev:api
# In another terminal:
npm run dev
```

The frontend is at localhost:5173 and the API at localhost:4000. For a disposable local demonstration with a real MongoDB test replica set, `npx tsx tests/local-demo.ts` starts MongoDB and the API. This requires an environment that permits mongod and downloads its binary. Its administrator account is local-only and is never created by the production server.

Register an account, then promote the intended administrator:

```bash
npm run admin -- your@email.com
```

## Local Ollama for Ask Jarvis

Ollama is optional and intended for the local HEAVEN-BUS demo. The server calls Ollama on `http://127.0.0.1:11434` by default. Live inventory, booking state, payments, refunds, support numbers and account-specific status continue to use deterministic server/database logic.

```bash
# Ollama desktop app should already be installed and running.
ollama list

# If no model is installed, a lightweight option is:
ollama pull llama3.2:1b

# Detect an installed model, verify Ollama, and create ignored .env.ollama:
npm run ollama:setup

# Start HEAVEN-BUS:
npm run dev:api
npm run dev
```

When a free-form Jarvis reply comes from the local model, the chat displays **Local AI · Ollama**. If Ollama is stopped or times out, Jarvis falls back to its deterministic HEAVEN-BUS help instead of failing the booking app.

## Environment

| Variable                | Where         | Purpose                                               |
| ----------------------- | ------------- | ----------------------------------------------------- |
| MONGODB_URI             | Render secret | Atlas connection string with database credentials     |
| MONGODB_DB              | Render        | Dedicated database, default heaven_bus                |
| JWT_SECRET              | Render secret | Random signing secret, minimum 32 characters          |
| FRONTEND_URL            | Render        | Exact frontend origin; comma-separated list supported |
| PAYMENT_MODE            | Render        | sandbox or razorpay                                   |
| SEED_DEMO               | Render        | true seeds upcoming 14-day demo schedules on startup  |
| RAZORPAY_KEY_ID         | Render        | Provider test key ID                                  |
| RAZORPAY_KEY_SECRET     | Render secret | Provider test key secret                              |
| RAZORPAY_WEBHOOK_SECRET | Render secret | Verify raw signed webhook bodies                      |
| VITE_API_URL            | Vercel        | Render API origin, without /api suffix                |
| RESEND_API_KEY           | Render secret | Resend API key for journey-day reminder email         |
| JOURNEY_EMAIL_FROM       | Render        | Verified sender, e.g. HEAVEN-BUS <journeys@domain>    |
| PUBLIC_APP_URL           | Render        | Public Vercel origin used in email tracking links     |
| OLLAMA_ENABLED           | Local         | true enables local Ollama free-form Jarvis answers    |
| OLLAMA_URL               | Local         | Ollama API origin, default http://127.0.0.1:11434     |
| OLLAMA_MODEL             | Local         | Installed Ollama model used by Jarvis                  |
| OLLAMA_TIMEOUT_MS        | Local         | Local model request timeout, default 20000 ms          |

## Deploy

1. Render: connect this repository. Build `npm ci && npx tsc -p tsconfig.server.json`; start `npm start`; region Singapore. `render.yaml` contains the equivalent Blueprint. Set MongoDB, signing secret and frontend origin. Public health endpoints are `/api/health/live` and `/api/health/ready`.
2. Vercel: import this repository with Vite preset and repository root. Build `npm run build`; output `dist`. Set `VITE_API_URL` to the Render origin. `vercel.json` provides SPA routing.
3. Put the resulting Vercel origin in Render `FRONTEND_URL`. Use exact origins, not wildcard credentials.
4. Atlas: create a dedicated database user and permit the Render service's published outbound IP ranges. Use an Atlas deployment supporting replica-set transactions. Keep credentials out of source control.
5. With Razorpay Test Mode, subscribe the webhook `/api/webhooks/razorpay` to relevant payment events and configure the matching webhook secret. Enable automatic capture in the provider dashboard. Without captured status, the system never confirms a ticket.
6. For real journey-day email delivery, create a Resend API key, verify the sender used by `JOURNEY_EMAIL_FROM`, and set `PUBLIC_APP_URL` to the Vercel app. Without those email variables, bookings and reminder status are still stored but no external email is falsely marked as sent.

No database credential means the API remains reachable for health checks but reports `setup_required` and rejects booking operations. It never silently swaps MongoDB for browser or memory storage.

The free Render tier may sleep, delay recovery, and lose socket connections. Deadlines remain database-enforced. Use always-on compute for strict latency targets. This implementation starts with one API instance; recovery runs in-process with durable MongoDB records. Add shared socket fan-out, distributed rate limits and isolated workers before scaling horizontally. Do not deploy multiple web instances with the current notification dispatcher.

## Consistency design

Permanent inventory rows have a unique `(tripId, seatId)` index. Seat acquisition is a conditional update inside a MongoDB transaction. Reads calculate effective expiry; new acquisitions can claim expired holds without waiting for the cleanup worker or TTL deletion. A single user can have only one active hold, enforced by a partial unique index. Changing seats retains the deadline.

The transaction atomically updates all seats in a basket. Releasing an old hold matches its immutable hold ID, so it cannot release a later customer's allocation. Payment initiation freezes the basket. Confirmation checks captured payment amount/currency, current ownership and expiry, then writes seats, booking, payment, hold status and notification outbox together. Retries reuse recorded effects. Provider calls execute outside database transactions.

Captured payments that lose ownership or expiry checks produce one durable refund obligation. Webhook event IDs and payment IDs prevent duplicate effects. A second distinct captured payment is refunded. Unknown order creation is reconciled by provider receipt before exposing any order. Unknown refund submissions are reconciled by obligation metadata and never blindly resubmitted; unresolved outcomes are retained in the operations dashboard for manual provider review.

Seat events are invalidations: after a committed outbox notification, clients fetch an authoritative snapshot. Polling every five seconds and reconnect/focus refresh recover lost events. No socket message grants ownership. Browser clocks only display the countdown.

## Tests

```bash
npm run build
npm test
npx playwright install chromium
npx playwright test
```

Integration tests use a real disposable MongoDB replica set. They cover 500 contenders, group rollback, worker-independent expiry, stale release, duplicate confirmations, late payments, refunds, amount mismatch and authorization. Browser tests cover passenger booking, ticket reload, Jarvis, admin creation and mobile overflow. GitHub Actions runs the same build and tests on Ubuntu. See the Actions results for verified execution; adding a test does not establish that it passed.

## Performance testing with Apache JMeter

HEAVEN-BUS includes non-functional load/performance testing under `performance/heaven-bus.jmx`. The runner starts an isolated local API using the showcase Atlas database, executes JMeter in non-GUI mode, generates an HTML dashboard, calculates response-time percentiles/throughput/error rate, and applies pass/fail thresholds.

```bash
# Very small pre-demo sanity check
npm run test:performance:quick

# Standard evaluator/demo run
npm run test:performance

# Heavier local stress profile
npm run test:performance:stress

# Open the generated JMeter HTML dashboard
npm run test:performance:report

# Inspect the plan visually in JMeter
npm run test:performance:gui
```

Default acceptance thresholds are **error rate ≤ 1%**, **overall P95 ≤ 2500 ms**, and **average response time ≤ 1500 ms**. Override them for an explicit environment using `PERF_MAX_ERROR_PCT`, `PERF_MAX_P95_MS`, and `PERF_MAX_AVG_MS`.

Generated artifacts are intentionally ignored by Git:

- `performance/report/index.html` — JMeter charts/dashboard.
- `performance/summary.json` — machine-readable measurements and threshold results.
- `performance/results/*.jtl` — raw JMeter samples.

The quick/standard/stress profiles exercise health throughput and database-backed public route search without load-testing the deployed Render service.

## API overview

Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
Inventory: `GET /api/trips`, `GET /api/trips/:id`, `GET /api/trips/:id/seats`.
Reservations: `POST /api/holds` (Idempotency-Key required), `GET /api/holds/current`, `GET/DELETE /api/holds/:id`.
Payment: `POST /api/holds/:id/payment`, `POST /api/holds/:id/sandbox-pay`, `POST /api/holds/:id/verify`, `POST /api/webhooks/razorpay`.
History: `GET /api/bookings`, `GET /api/bookings/:id`. Live journey: `GET /api/bookings/:id/tracking`, `POST /api/bookings/:id/location`, `DELETE /api/bookings/:id/location`.
Support: `GET /api/support`. Assistant: `POST /api/jarvis`. Cancellation: `POST /api/bookings/:id/cancel`. Operations: `GET /api/admin/overview`, `POST /api/admin/trips`, `POST /api/admin/trips/:id/stop`, `POST /api/admin/trips/:id/resume`, `DELETE /api/admin/trips/:id`.

## Scope

Full-route seated trips, INR, IST display, fixed five-minute holds, live GPS journey tracking, journey-day email reminders, and confirmed-ticket cancellation (100% refund ≥24h, 50% from 6–24h, closed <6h). No operator integration, sleeper/segment inventory or real-money launch. Access tokens use sessionStorage and expire after eight hours. Add stronger session management, email verification, abuse controls, retention rules, external observability and operational support before a commercial launch.
