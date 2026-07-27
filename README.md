# GovernAI

GovernAI is a live, standard-driven RAG chatbot assessment application. It performs bounded endpoint checks, maps the observed evidence to selected framework-referenced checks, streams progress to the UI, and generates one report per selected standard plus an OWASP LLM appendix.

GovernAI is a readiness and gap-screening tool. It does not issue an official certification or legal determination.

## Documentation

- [Complete technical documentation](./TECHNICAL_DOCUMENTATION.md)
- [Original backend-flow design document](./RAG-Governance-Backend-Flow.md)

## Development

Requirements: Node.js 22.13 or later.

```powershell
npm install
npm run dev
npm test
node_modules\.bin\tsc.cmd --noEmit
```

## Runtime APIs

- `GET /api/catalog`
- `POST /api/assessments`
- `POST /api/assessments/stream`

The UI uses the SSE streaming API for live progress, timings, ordered logs, source lineage, detailed errors, retry, and final execution summary.

## Data and credentials

- Assessment state is not persisted; D1 is not enabled.
- Credentials are sent only to the active target request and are not included in logs or reports.
- `.env.example` includes an optional future `OPENAI_API_KEY`; the current assessment engine does not call OpenAI directly.
