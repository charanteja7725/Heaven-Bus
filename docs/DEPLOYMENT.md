# HEAVEN-BUS deployment handoff

Repository: https://github.com/charanteja7725/Heaven-Bus

The Render web service has been created at https://heaven-bus-api.onrender.com.
Manage it at https://dashboard.render.com/web/srv-dav3sc8jo6nc73fd1280.

## Connect MongoDB

1. Use a dedicated MongoDB Atlas cluster and database user with access to `heaven_bus`.
2. Permit this Render service's outbound addresses in Atlas Network Access. Find the addresses in the service's Connect menu. Avoid sharing a production database with other applications.
3. In Render Environment, add the complete Atlas connection string as `MONGODB_URI`. Keep it out of GitHub and chat. `MONGODB_DB=heaven_bus` is already configured.
4. Save and deploy. The service will create indexes and seed 14 days of example schedules because `SEED_DEMO=true`.
5. Open `/api/health/ready`. It must return HTTP 200 with `database: connected` before accepting bookings. HTTP 503 means setup is still incomplete; `/api/health/live` alone does not establish database readiness.

## Deploy the Vercel frontend

Import the existing Heaven-Bus GitHub repository at https://vercel.com/new.

- Framework: Vite.
- Root directory: repository root.
- Build command: `npm run build`.
- Output directory: `dist`.
- Node.js: 22 or newer.
- Environment variable: `VITE_API_URL=https://heaven-bus-api.onrender.com`.

The production frontend also defaults to the existing Render origin, so it cannot accidentally send booking requests to the static frontend when this variable is omitted. Local development uses the Vite proxy.

After deployment, set Render `FRONTEND_URL` to the exact Vercel origin, without a trailing slash. Save and deploy. Multiple approved origins can be comma-separated. A preview domain is not automatically approved.

Vercel deployment was not created by the connected deployment tool: that operation returned `Tool deploy_to_vercel not found`. An authenticated CLI or dashboard import is still required.

## First administrator

Register your account through the frontend. From a trusted local checkout with the same Atlas configuration, run `npm run admin -- your@email.com`. The script promotes an existing account; it does not create a publicly known administrator password. Sign in again and open Operations.

## Payment modes

The configured `PAYMENT_MODE=sandbox` completes the entire booking flow without charging money. Razorpay Test Mode requires `PAYMENT_MODE=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`. The production startup rejects live Razorpay keys for this demonstration project. Set a signed webhook at `/api/webhooks/razorpay` and automatic capture in the provider's test settings.

Real provider checkout has not been exercised with merchant credentials. Test it with the provider's supported test instruments before presenting it as verified. Sandbox confirmation, expiry, duplicate processing and refunds are covered by automated integration tests.

## Operational recovery

- A held seat becomes available based on its database deadline even if cleanup is delayed. Never delete seat inventory to release a hold.
- The API publishes committed invalidations through Socket.IO. Clients refetch on reconnect and poll as a fallback.
- If a captured payment cannot obtain every seat, its transaction creates a durable refund obligation instead of a booking.
- Recovery rotates through recent payment orders, including confirmed ones, and processes signed webhook records. Orders older than seven days require provider reconciliation by an administrator.
- Unknown refund submissions are checked against the provider. They are never blindly submitted again. Review unresolved `UNKNOWN` records in Operations and the provider dashboard.
- One API instance is supported. Free Render services can sleep; use always-on compute for a time-sensitive public service. Add shared socket delivery and separate workers before horizontal scaling.

## Release check

The GitHub Actions workflow builds TypeScript, runs MongoDB integration tests, and runs Chromium browser tests. Screenshots and traces are available in the `browser-verification` artifact. After both hosts and Atlas are connected, repeat a browser booking and reload its ticket, test two simultaneous viewers, open Ask Jarvis, and verify passenger access cannot enter Operations.
