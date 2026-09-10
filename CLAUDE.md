# CIMB Niaga People Experience (PX) Integrated System

This is a working duplicate of the original "People Experience" project, set up for
continued development inside Claude Code. It is a full-stack app measuring employee
experience ("Kejar Mimpi" framework: 70% Survey Index + 30% Outcome Index).

## Stack

- **Frontend**: React 19 + Vite 8 + Tailwind CSS v4, Recharts, Lucide icons — `src/`
- **Backend**: Node.js + Express 5 REST API — `server/server.js`
- **Storage**: Local JSON file store (`server/data/store.json`) by default; can connect
  to MS SQL Server via `mssql` if `DB_SERVER` env var is set (see `server/db/`)
- **Reporting**: PPTXgenJS (PowerPoint export), QR code generation, CSV import/export

## Running locally

```bash
npm install
npm run dev    # runs backend (port 5000) + vite frontend (port 3000) concurrently
```

Frontend proxies `/api`, `/uploads`, `/exports` to `http://localhost:5000` (see
`vite.config.mjs`). Backend defaults to port 5000 (`server/server.js`); do not let an
inherited `PORT` env var collide with the frontend's port 3000.

Other scripts: `npm run server` (backend only), `npm run client` (frontend only),
`npm run build` (production build), `npm run preview`, `node tests/regressionTest.js`
(34-case regression suite, see `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`).

## Documentation map (`docs/`)

Read these before making non-trivial changes — they are the source of truth for the
domain model, not just descriptive:

| File | Covers |
|---|---|
| `README.md` | Index of all docs |
| `01_PE_BRAINS_AND_MATHEMATICAL_MODEL.md` | 5 employee journeys, 17 checkpoints, 27 metrics, scoring formula (70% Survey + 30% Outcome), normalization, alert thresholds |
| `02_DATA_DICTIONARY_AND_METRICS_CATALOG.md` | 7 Outcome metrics vs 20 Survey metrics, CSV column dictionary, 4 answer-scale types, 15 standard questions |
| `03_SYSTEM_ARCHITECTURE_AND_DATA_FLOW.md` | Client-server architecture, DFDs, survey data lifecycle, on-premise/security constraints |
| `04_BACKEND_API_AND_SERVICES_SPECIFICATION.md` | REST endpoints, service engines (`calculationEngine`, `surveyImportService`, `surveyTemplateService`, `surveyEvidenceService`, `pptGenerator`), storage layer |
| `05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md` | React component tree, state management, modal orchestration, public check-in/feedback forms |
| `06_ADMIN_OPERATIONS_AND_USER_GUIDE.md` | Admin survey template setup, CSV template/evidence downloads, signature event management, PPT report generation |
| `07_TESTING_AND_QUALITY_ASSURANCE.md` | Regression test suite (34 cases) |
| `SURVEY_IMPORT_GUIDE.md` | CSV survey import format and rules |

## Compliance constraints (do not violate)

1. **100% on-premise** — no computation or storage may be sent to third-party/cloud
   services outside the internal infrastructure.
2. **NIP (employee ID) is the primary key** for survey respondents — must stay unique
   and validated to prevent duplicate/manipulated entries.
3. **Audit trail** — every survey result must produce an evidence CSV log (timestamp,
   respondent identity, per-question answers, verbatim comments).

## Notes

- This folder was duplicated from the original project on 2026-09-10 (`node_modules`,
  `dist`, and build artifacts excluded, git history re-initialized here).
- `.claude/launch.json` for previewing this app in the Browser pane lives in the
  parent folder (`People Experience/.claude/launch.json`) and explicitly sets
  `PORT=5000` for the backend to avoid clashing with Vite's port 3000.
