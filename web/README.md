# OPTW Route Optimizer — Web App

An interactive, production-ready web front end for the project's Orienteering
Problem with Time Windows (OPTW) reinforcement-learning model. It turns the
original `run_pipeline.py` CLI/matplotlib tool (greedy search, beam search,
and a click-to-route "GPS-style" live rerouting mode) into a Next.js
application deployable on Vercel.

## Contents

- [Architecture](#architecture)
- [Folder structure](#folder-structure)
- [Technology stack](#technology-stack)
- [How inference works (no Python at runtime)](#how-inference-works-no-python-at-runtime)
- [Development setup](#development-setup)
- [Database setup](#database-setup)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Production build](#production-build)
- [Vercel deployment](#vercel-deployment)
- [Updating the model](#updating-the-model)
- [Key architectural decisions](#key-architectural-decisions)
- [Known limitations / future work](#known-limitations--future-work)

## Architecture

Layered, MVC-style backend inside Next.js Route Handlers:

```
Route Handler (controller)  ->  Service (business logic)  ->  Repository (data access)  ->  Postgres
        app/api/**/route.ts     lib/services/*.impl.ts          lib/repositories/*.ts
```

- **Controllers** (`app/api/**/route.ts`) only parse/validate the request (Zod) and shape the HTTP response. No business logic lives here.
- **Services** define a contract (`*.service.ts`, an interface) and an implementation (`*.service.impl.ts`). `run.service` orchestrates a run's lifecycle; `optimizer.service` runs greedy/beam search / live-recommendation over the model; `inference.service` owns the ONNX session.
- **Repositories** (`lib/repositories/run.repository.ts`) are the only code that touches the database, via Drizzle ORM.
- **DTOs** (`lib/dto/*.ts`) are Zod schemas that validate every request body/query and double as the TypeScript types.
- **Domain errors** (`lib/errors/domain-error.ts`) are thrown by services and mapped centrally (`handle-route-error.ts`) to clean HTTP responses — internal exceptions never leak a message or stack trace to the client.

## Folder structure

```
web/
  src/
    app/
      page.tsx                 New Run form
      runs/[id]/page.tsx        Interactive routing session (server component, DB read) + RunSession (client)
      history/page.tsx          Run history data table
      training/page.tsx         Training metrics dashboard
      api/runs/...              Route handlers (controllers)
    components/
      run/run-session.tsx        Client-side interactive session (map + controls + live state)
      map/route-map.tsx          SVG route map (click-to-route, recommended path overlay)
      forms/new-run-form.tsx     Accessible, validated run-configuration form
      data-table/runs-table.tsx  Sortable/filterable/paginated run history table
      charts/training-metrics-chart.tsx
      layout/                    Sidebar/mobile nav, theme toggle
      ui/                        shadcn/ui primitives
    lib/
      env/optw-environment.ts    TypeScript port of env.py (the OPTW simulator)
      env/serialization.ts       Environment <-> JSON snapshot (for DB persistence)
      services/                  optimizer + inference + run services (contracts + impls)
      dto/run.dto.ts              Zod request/response schemas
      errors/                     Domain errors + centralized handler
      repositories/run.repository.ts
      api-client.ts                Typed fetch wrapper used by client components
    db/
      schema.ts                   Drizzle table definitions
      client.ts                   Lazy Neon/Drizzle client
  model/
    optw_model.onnx               Exported model (see "Updating the model")
  drizzle/                        Generated SQL migrations
  drizzle.config.ts
```

The original Python project (`env.py`, `model.py`, `train.py`, `run_pipeline.py`,
`optw_model.pth`) stays at the repo root, unchanged — it's the offline
training pipeline. `model/export_to_onnx.py` and `model/verify_onnx_parity.py`
(also at the repo root, one level up from `web/`) are the one-off bridge
between it and this app.

## Technology stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Vercel-native, Route Handlers double as the API layer, Server Components fetch data with no client-side waterfall |
| Language | TypeScript (strict) | Whole stack, including the ported simulation engine, is type-checked |
| Model inference | `onnxruntime-node` | Runs the exported model directly inside a Node.js Route Handler — no separate Python service to host |
| Database | Neon Postgres (`@neondatabase/serverless`) | HTTP-based driver designed for serverless/edge; no connection pooling to manage |
| ORM | Drizzle | Typed, lightweight, no heavy runtime — fits serverless cold starts |
| Validation | Zod | Single source of truth for request/response shapes and TS types |
| UI | Tailwind CSS + shadcn/ui (base-ui primitives) | Accessible-by-default components, no framework lock-in |
| Charts | Recharts | Training metrics dashboard |
| Client state | TanStack Query | Server-state caching/invalidation for the history table and run mutations |
| Theming | next-themes | System/light/dark, no flash-of-wrong-theme |
| Tests | Vitest | Unit tests for the environment port + a real end-to-end ONNX inference test |

## How inference works (no Python at runtime)

PyTorch cannot run inside a Vercel serverless function (the `torch` package
alone exceeds the deployment size limit). Instead:

1. `model/export_to_onnx.py` (run once, from the repo root, with the project's
   `rl_env` virtualenv) exports `optw_model.pth` to `web/model/optw_model.onnx`.
   It wraps one full decision step — the LSTM cell update *and* the masked
   pointing-network forward pass — as a single ONNX graph, since the two are
   always invoked back-to-back at inference time.
2. `model/verify_onnx_parity.py` runs a greedy rollout through both the
   PyTorch model and the ONNX export on the same seeded instance and asserts
   the chosen path and reward match exactly.
3. `src/lib/env/optw-environment.ts` is a line-for-line TypeScript port of
   `env.py` (state features, admissibility/adjacency masks, time-decay
   rewards, optional hazard/forecast dynamics) — verified against `env.py`'s
   logic and covered by unit tests.
4. `src/lib/services/optimizer.service.impl.ts` ports `run_pipeline.py`'s
   `greedy_search` / `beam_search` / live-recommendation loop, calling the
   ONNX session once per decision point via `inference.service.ts`.
5. `src/lib/services/optimizer.integration.test.ts` loads the real ONNX model
   under `onnxruntime-node` and runs full greedy/beam rollouts, asserting
   valid, terminating routes — this is the guarantee that the TS port and the
   exported model actually agree with each other at runtime.

Because a serverless invocation can't hold state in memory between requests,
each run's full environment + decoder (LSTM/attention memory) state is
snapshotted to JSON and persisted on the `runs` row after every step, then
restored at the start of the next request (`lib/env/serialization.ts`,
`lib/services/decoder-state-serialization.ts`).

## Development setup

Requires Node.js 20+.

```bash
cd web
npm install
cp .env.example .env.local   # then fill in DATABASE_URL, see below
npm run dev
```

Visit `http://localhost:3000`. The **New Run** and **Training Metrics** pages
work without a database; **Run History** and starting/stepping a run need
`DATABASE_URL` set and migrated (below).

## Database setup

1. Create a free serverless Postgres database at [neon.tech](https://neon.tech).
2. Copy its connection string into `web/.env.local` as `DATABASE_URL`.
3. Apply the schema:
   ```bash
   npm run db:push
   ```
   (or `npm run db:generate && npm run db:migrate` to go through versioned
   SQL migration files in `drizzle/` instead of pushing the schema directly).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes (for run persistence/history) | Neon Postgres connection string. Never exposed to the client — only read in server-side code (`src/db/client.ts`). |

No other secrets are needed — there's no authentication provider and no
third-party API keys in this app.

## Testing

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run test        # vitest: environment-port unit tests + a real ONNX inference test
```

The test suite includes `src/lib/services/optimizer.integration.test.ts`,
which loads the actual exported ONNX model and runs full greedy/beam-search
rollouts — a genuine end-to-end check of the TypeScript port against the
trained model, independent of the database.

## Production build

```bash
npm run build
npm run start
```

`next build` type-checks the whole project and statically prerenders the
pages that don't depend on live data (`/`, `/training`); `/history` and
`/runs/[id]` are marked `force-dynamic` since they read the database.

## Vercel deployment

This repo has the Next.js app in a `web/` subdirectory, so:

1. In the Vercel project's **Settings → General → Root Directory**, set it to `web`.
2. **Settings → Environment Variables**: add `DATABASE_URL` (Production and Preview).
3. Push to the connected Git branch, or run `vercel deploy` from `web/`.
4. After the first deploy, run `npm run db:push` (or apply `drizzle/*.sql`) against the same `DATABASE_URL` to create the tables.

No other configuration is required:
- All API routes run on the Node.js runtime (`export const runtime = "nodejs"`), since `onnxruntime-node`'s native addon isn't Edge-compatible.
- `next.config.ts` explicitly includes `model/**` in the output file trace for the `/api/runs/**` routes, so the ONNX file ships with the deployed function.
- No long-running processes: every request is a self-contained inference + (optional) DB round trip.

## Updating the model

After re-training (`python train.py` at the repo root, producing a new
`optw_model.pth`):

```bash
# from the repo root, using the project's rl_env virtualenv
./rl_env/Scripts/python.exe model/export_to_onnx.py
./rl_env/Scripts/python.exe model/verify_onnx_parity.py   # confirms parity before you ship it
```

Then commit the updated `web/model/optw_model.onnx`.

## Key architectural decisions

- **ONNX + TypeScript port over a separate Python service**: keeps the whole app on one Vercel deployment with no external infra to operate. The trade-off is the one-time cost of porting `env.py`'s simulation logic, mitigated by the parity check against PyTorch and the ONNX integration test.
- **Full environment/decoder state snapshotted per run row**, not kept in server memory: required for correctness under Vercel's stateless serverless model — any request can land on any instance.
- **No authentication**: the original CLI tool has no concept of users; the web app preserves that (open by default). Add it later if this needs to be a private/multi-tenant product.
- **Neon + Drizzle over Prisma**: lighter runtime and faster cold starts, which matters for a function that also has to load an ONNX session.

## Known limitations / future work

- No auth/rate limiting yet — fine for an internal/demo tool, but add both before exposing this publicly at scale.
- The forecast/hazard event feature (`enableForecastEvents`) is implemented and tested but not exercised by the integration test suite beyond the base path.
- Run events (`run_events` table) are logged for future replay/audit tooling but the UI doesn't yet have a replay view — only the live session and the summary in History.
