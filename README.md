# GovernAI

GovernAI is a live, standard-driven RAG chatbot assessment application. It performs bounded endpoint checks, maps the observed evidence to selected framework-referenced checks, streams progress to the UI, and generates one report per selected standard plus an OWASP LLM appendix.

GovernAI is a readiness and gap-screening tool. It does not issue an official certification or legal determination.

## Documentation

- [Complete technical documentation](./TECHNICAL_DOCUMENTATION.md)
- [Versioned framework-pack model and pilot inventory](./FRAMEWORK_PACKS.md)
- [Original backend-flow design document](./RAG-Governance-Backend-Flow.md)

## Development

Requirements: Node.js 22.13 or later.

```powershell
npm install
npm run dev
npm test
node_modules\.bin\tsc.cmd --noEmit
```

## Deployment — Azure Container Apps

The build targets Cloudflare Workers but emits a plain fetch handler with no `cloudflare:`
imports, so it also runs under Node. `server/node.mjs` supplies the three bindings the Workers
runtime would otherwise provide (`ASSETS`, `IMAGES`, `ExecutionContext`) and streams response
bodies, which the SSE run screen depends on.

Live demo: <https://governai.icyrock-1ac8c583.centralindia.azurecontainerapps.io>

| Resource | Value |
| --- | --- |
| Resource group | `rg-governai-demo` (centralindia) |
| Container registry | `acrgovernaidemo.azurecr.io` (Basic) |
| Environment | `cae-governai-demo` |
| Container app | `governai` — port 8080, external ingress, 1.0 CPU / 2.0 Gi |
| Replicas | **min = 0 / max = 1** — scales to zero when idle |

Build and release a new revision:

```bash
az acr build -r acrgovernaidemo -t governai:latest --platform linux/amd64 .
```

```bash
az containerapp update -g rg-governai-demo -n governai --image acrgovernaidemo.azurecr.io/governai:latest
```

### Sleeping it between demos

The app is set to **min 0 / max 1**, so it scales to zero and costs nothing to run while
asleep. There is nothing to start — the next request to the URL wakes it automatically. Idle
cost is the container registry alone, about $5/month.

Measured on 30 July 2026 against the live app:

| | Measured |
| --- | --- |
| Time from last request to 0 replicas | **300 s** — exactly the `cooldownPeriod` |
| Cold request that wakes it (`GET /`) | **23.1 s**, HTTP 200 |
| Requests once warm (`GET /api/catalog`) | 0.12–0.15 s |

23 seconds is mostly the registry pulling the 413 MB image, so it is a floor, not jitter.
**Pre-warm before any demo where someone else is watching the screen** — a cold click looks
like a broken link.

To keep it warm for a demo (no cold start on the first click):

```bash
az containerapp update -g rg-governai-demo -n governai --min-replicas 1
```

To let it sleep again afterwards:

```bash
az containerapp update -g rg-governai-demo -n governai --min-replicas 0
```

**What sleeping costs you, functionally:** monitor state lives in the server process
(`lib/monitor-store.ts`), so scaling to zero clears armed monitors and cycle history. Armed
monitoring only survives at `--min-replicas 1`. A report run is unaffected — it completes
within one request.

Deployment notes:

- **`max-replicas` must stay 1.** Monitor state and in-flight assessments live in the server
  process; a second replica would answer half the polls from an empty store. Horizontal
  scaling needs shared state first.
- `.dockerignore` excludes `.env`, but not `.openai/` or `build/` — `vite.config.ts` imports
  from both at build time.
- The runtime stage installs only `sharp`. `dist/server/vinext-externals.json` is empty, so
  every other dependency is bundled into `index.js`; installing them anyway added 446 MB.
- The registry uses its admin user because granting `AcrPull` to a managed identity needs
  Owner or User Access Administrator. Switch to managed identity when that is available, then
  `az acr update -n acrgovernaidemo --admin-enabled false`.
- No environment variables carry credentials. Target credentials are entered per run in the UI
  and never persisted.

## Runtime APIs

- `GET /api/catalog`
- `POST /api/assessments`
- `POST /api/assessments/stream`

The UI uses the SSE streaming API for live progress, timings, ordered logs, source lineage, detailed errors, retry, and final execution summary.

## Data and credentials

- Assessment state is not persisted; D1 is not enabled.
- Credentials are sent only to the active target request and are not included in logs or reports.
- `.env.example` includes an optional future `OPENAI_API_KEY`; the current assessment engine does not call OpenAI directly.
