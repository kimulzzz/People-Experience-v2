# CIMB Niaga People Experience (PX) Integrated System

This is a working duplicate of the original "People Experience" project, set up for
continued development inside Claude Code. It is a full-stack app measuring employee
experience ("Kejar Mimpi" framework: 70% Survey Index + 30% Outcome Index).

## Stack

- **Frontend**: React 19 + Vite 8 + Tailwind CSS v4, Recharts, Lucide icons — `src/`
- **Backend**: Node.js + Express 5 REST API — `server/server.js`
- **Storage**: two interchangeable backends behind the `server/db/storage.js` dispatcher,
  chosen by `STORAGE_BACKEND` in `.env`: `sql` = local **Microsoft SQL Server** (`PeopleExperiencePX`,
  active since v2.22.0) or `json` = `server/data/store.json` (default if unset; the rollback path).
  All storage calls are async (`await storage.x()`). See `docs/08`
- **Reporting**: PPTXgenJS (PowerPoint export), QR code generation, CSV import/export
- **Local AI**: Ollama (`localAiService.js`) for dynamic narratives (Score Deficit Alerts,
  Event Summaries) — always has a deterministic rule-based fallback, never required
- **Email**: `nodemailer` (`reminderService.js`) for Survey Upload Reminder emails to PICs. The sender
  account is configured in the **Setting Email** menu and stored in SQL Server (`px_email_settings`, password
  AES-256-GCM encrypted, never returned by the API); legacy `SMTP_*` env vars are only a fallback. On-premise
  SMTP is the target; Gmail was enabled only temporarily at the user's request (cloud — conflicts with the
  100% on-premise rule); gracefully no-ops (logs only) when unconfigured

## Custom subagents (`.claude/agents/`)

- **`auditor`** — read-only agent that scans `server/services/*.js` and `server/server.js` for
  hardcoded values that should instead come from `server/db/storage.js`/`store.json` (the app's
  database) or the real server clock, as distinct from `server/db/seedData.js`'s intentionally
  static seed/demo data. Run it periodically after touching `calculationEngine.js`,
  `alertEngine.js`, or `seedData.js`. See `.claude/agents/auditor.md` for its full brief and
  `CHANGELOG.md` **[2.12.0]** for its first run's findings (all fixed).

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
(127-case regression suite, see `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`; `npm run db:migrate` / `npm run db:export` for SQL Server, see `docs/08`).

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
| `07_TESTING_AND_QUALITY_ASSURANCE.md` | Regression test suite (127 cases) |
| `08_DATABASE_SCHEMA_AND_MIGRATION.md` | SQL Server schema (25 `px_*` tables), JSON→SQL migration, rollback |
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
  `dist`, and build artifacts excluded, git history re-initialized here). It was later
  moved from the OneDrive-synced `Documents\Project\` path to `C:\Project\People
  Experience v2` on 2026-09-10 to stop Vite's dev-server HMR from full-reload looping
  (unrelated to OneDrive itself — see git history / session notes for the investigation).
- `.claude/launch.json` for previewing this app in the Browser pane lives inside this
  project folder and sets `PORT=5000` for the backend to avoid clashing with Vite's
  port 3000. `vite.config.mjs` currently sets `server.hmr = false` (hot-reload disabled)
  as a workaround for an unresolved full-reload loop encountered in this environment —
  code changes require a manual browser refresh (F5) to appear; re-enable only after
  root-causing the loop.
- **v2.9.1** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §4):
  Parameter Admin Edit-button bug fixed (form opened off-screen when the metrics table was
  scrolled), removed the `#` prefix from metric numbering app-wide, color-coded the
  Dashboard journey metric mini-pills by status (green/amber/red), and unified the
  Explore Metrics "Actions & Evidence" button colors to a neutral **Slate** tone
  (`bg-slate-100`/`text-slate-700`) — deliberately kept separate from the
  green/amber/red status palette so it doesn't clash with status meaning.
- **v2.9.2** (2026-09-18, see `CHANGELOG.md`): Dashboard journey metric mini-pills now show
  `<id> - <metric name>` (hyphen separator) instead of `<id> <metric name>` for readability.
- **v2.10.0** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §5):
  Score Deficit Alerts now get a dynamic `narrative_summary` from local Ollama (rule-based
  fallback when offline); the Performance Trend chart's seed data auto-extends through the
  current calendar month (was flat/projected from April onward) and `computeMonthlyTrends`'
  Outcome Index no longer flatlines; every metric gained an `update_frequency` parameter
  (**Bulanan**/**Tahunan** — "Frekuensi Update Data", 11 ESS metrics default to Tahunan); and
  SURVEY metrics gained manual-upload reminder settings (`requires_manual_upload`,
  `upload_deadline_day`/`_month`, `pic_name`, `pic_email`) with a new `reminderService.js` that
  emails overdue/due-soon PICs (daily auto-check + `POST /api/admin/upload-reminders/send`,
  on-premise SMTP only, safe no-op when `SMTP_HOST` is unset).
- **v2.11.0** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §6):
  `computeMonthlyTrends()` now respects the Dashboard's YTD/MTD toggle instead of always
  returning the same standalone-per-month series — `mode=YTD` (default) computes a cumulative
  Jan..month running average (converging to the scorecard's YTD figure), `mode=MTD` keeps the
  standalone-per-month values. `GET /api/metrics/trends` gained a `?mode=` query param;
  `TrendChart.jsx` gained a `trendMode` prop and shows a different badge/description per mode.
  Known pre-existing limitation (not fixed here): the trend endpoint's `survey_index` uses a
  simple cross-metric average, not `calculatePEIndex()`'s per-metric weighted normalization, so
  it can read differently from the main scorecard.
- **v2.11.1** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §7):
  Fixed the exact limitation noted above — user reported the Dashboard scorecard showing 83.19%
  while the Trend chart showed ~59% for the same period. `computeMonthlyTrends()` now calls
  `calculatePEIndex()` once per month (an internal `{ skipTrends: true }` option on
  `calculatePEIndex(filterInput, options)` prevents infinite recursion, since that function
  normally computes trends itself) instead of pooling raw `rating_score` values — so trend
  points use the exact same per-metric weighted normalization as the scorecard and now match
  it exactly for the current period. `storage.applyResponseFilters()` gained an `endMonth`
  param (YTD-mode only) to bound cumulative queries to "Jan..this month" without touching the
  existing full-year YTD behavior when `endMonth` is omitted. Outcome Index is intentionally
  flat across months in the output — OUTCOME metrics are a current HR-system snapshot in this
  app's data model, not a monthly time-series, so that's correct/expected, not a bug.
- **v2.12.0** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §8):
  Trend chart's actual-data cutoff now correctly stops at the last COMPLETE month
  (`today.getMonth() - 1`), not the current in-progress month — e.g. if today is September,
  only Jan-Aug are shown as final, September onward is forecast. Added the `auditor` custom
  subagent and ran it: fixed 5 confirmed findings — moved `calculationEngine.js`'s hardcoded
  `outcomeIngestionDates` map into a real `last_data_date` metric field (seeded via
  `OUTCOME_INGESTION_DATES` in `seedData.js`, admin-editable), replaced ~12 hardcoded `'2026'`
  year defaults with a `CURRENT_YEAR` constant derived from `new Date().getFullYear()` in both
  `calculationEngine.js` and `server.js`, made `computeMonthlyTrends()`'s `monthCodes` and
  actual/forecast cutoff derive from the target year instead of being frozen to 2026, and
  changed `alertEngine.js` to aggregate verbatim feedback across ALL events
  (`storage.getEvents()`) instead of one hardcoded event ID. While writing the regression
  test for the `last_data_date` fix, found `storage.updateMetric()` didn't whitelist that
  field — Admin edits to it were silently dropped; fixed. `tests/regressionTest.js` gained
  Module 21 (4 positive + 4 negative tests) covering all of the above plus bad-input
  robustness (non-existent IDs, garbage period strings, invalid trend mode).
- **v2.13.0** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §9):
  Follow-up to v2.12.0 — user reported the trend chart still showed Sept-Dec (as pale
  "forecast" dots). The forecast branch is now removed entirely from
  `computeMonthlyTrends()`; it returns ONLY points for fully complete months (new
  `getLastCompleteMonth(year)` helper, exported and shared with the `/api/metrics/trends`
  route). Also added a period-range filter: `TrendChart.jsx` now self-fetches from
  `/api/metrics/trends?mode=&directorate=&sub_directorate=&startMonth=&endMonth=` (instead of
  reading the `monthly_trends` embedded in `/api/metrics/calculate`'s response) and renders
  "Dari Bulan"/"Sampai Bulan" dropdowns (default Jan..last-complete-month) with a Reset
  button; `Dashboard.jsx` now passes `directorate`/`subDirectorate`/`year` to it instead of
  `trendData`. `endMonth` is hard-clamped server-side to the last complete month no matter
  what's requested — the UI dropdowns never even offer a later month, but the API enforces it
  too. `tests/regressionTest.js` gained Module 22 (2 positive + 3 negative) and 3 existing
  tests (Modules 2 & 18) were updated since "always 12 months" is no longer a valid assumption.
- **v2.14.0** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md` §10):
  User reported 2025 still looked "hardcoded" (identical numbers regardless of year) and
  wanted the trend period-range filter to work across years. Root cause of the first: no
  survey responses were ever seeded for 2025, so it silently fell back to each metric's
  static `raw_value` default. Fixed by extending `generateInitialSurveyResponses()`
  (`seedData.js`) to generate a full 12-month 2025 dataset using the same generator/variance
  logic as 2026 (merged non-destructively into an existing `store.json`). `computeMonthlyTrends()`
  was rewritten again to accept `startYear`/`startMonth`/`endYear`/`endMonth` independently
  (was single-`year` only) — built via new `clampToCompleteMonth()` + `buildMonthRange()`
  helpers — so a range can now genuinely cross a year boundary (e.g. Nov 2025 s/d Feb 2026);
  YTD mode still resets each January 1st per each point's own year (not one running total
  spanning years). New `storage.getAvailableSurveyYears()` (scans real response dates) backs
  a new `available_years` field on both `/api/metrics/trends` and `/api/metrics/calculate` —
  `TrendChart.jsx`'s range picker gained independent Year+Month selects for start/end (was
  month-only, implicitly tied to one year), and `Header.jsx`'s year dropdown (previously a
  hardcoded `['2026','2025']` array) now reads from that same field via `App.jsx`. Chart title
  and x-axis labels adapt automatically when a range spans multiple years (e.g. "Nov '25").
  `tests/regressionTest.js` gained Module 23 (4 positive + 2 negative).
- **v2.14.1** (2026-09-18, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`):
  User discovered leftover regression-test data visible in the real Signature Program Events
  menu — a fake "Regression Test Event (Audit Fix Check)" event (Module 21's test created one
  every run via `POST /api/events` with no way to delete it) and fake "Test Participant"
  attendance/feedback records piling up on the real `ev-perspektif-2024-q1` event (Module 8's
  test checked in + submitted feedback every run with no cleanup route). Fixed by adding
  `DELETE /api/events/:id`, `DELETE /api/events/:id/attendance/:nip`, and
  `DELETE /api/events/:id/feedback/:nip` (backed by new `storage.deleteEvent()` /
  `deleteAttendance()` / `deleteFeedbackResponse()`), then wrapping both tests in `try/finally`
  so they clean up their own data regardless of assertion outcome. Also fixed a related bug
  found while verifying: `getMetricDetail()`'s `responses.slice(0, 100)` capped by insertion
  order rather than date, silently hiding freshly-uploaded responses once a metric's seed
  volume passed 100 (a side effect of the 2025 dataset added in v2.14.0) — fixed by sorting
  by date descending before capping. One-time cleanup removed 9 leftover events, 27 fake
  attendances/feedbacks, and ~216 leftover CSV-upload test survey responses directly from
  `store.json`. `tests/regressionTest.js` gained Module 24 (2 positive + 3 negative) testing
  the new DELETE endpoints directly. Verified by running the full suite twice in a row
  (81/81 PASS both times) with `ev-perspektif-2024-q1`'s attendance/feedback counts confirmed
  stable (5/3) before and after each run — no more test data leaking into the real event.
- **v2.15.0** (2026-09-22, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`):
  User reported Target (4) and Min Threshold (75) not lining up for metric #2 (CIMB Niaga
  Goes to Campus, RATING_5 scale) in Admin Parameters. Root cause was a real functional bug,
  not just display: `min_threshold` is always stored as a percentage (0-100, matching
  `normalized_score`), but `target_value` is stored in the metric's own native scale (e.g.
  `4.00` on a 1-5 Likert scale) — and the WARNING/CRITICAL/HEALTHY status logic in
  `calculatePEIndex()` and `getMetricDetail()` (`calculationEngine.js`) compared that raw
  target directly against the 0-100 normalized score with no conversion, so WARNING was
  virtually unreachable for any RATING_5/QUOTA_COUNT metric (only CRITICAL vs HEALTHY could
  ever trigger). A related bug in the same code path: `alertEngine.js`'s Score Deficit Alert
  sort order and `localAiService.js`'s "Gap Defisit: X%" narrative both used a `gap` field
  computed as raw-target-minus-normalized-score, which produced nonsensical negative numbers
  for scale-based metrics. Fixed by adding `normalizeTarget(metric, targetConfig)` — mirrors
  `normalizeScore()`'s per-scale-type conversion logic — and using it everywhere target was
  previously compared or subtracted directly against a normalized value. Added
  `target_value_normalized` (0-100) to `/api/metrics/calculate`, `/api/metrics/:id/detail`,
  and (newly) `/api/admin/parameters`. `AdminParametersModal.jsx`'s table now shows Target as
  a percentage (e.g. "80.0%") matching Threshold's unit, with the raw `target_display` as a
  subtitle; the Edit/Add form gained explicit unit labels and a live "≈ X% dari skala penuh"
  hint. Also fixed the Add-Metric form's own latent bug: its `min_threshold` default was
  `4.0` (clearly meant for a 1-5 scale, not the 0-100% the field actually requires) — changed
  to `75.0`. `tests/regressionTest.js` gained Module 25 (4 positive tests).
- **v2.16.0** (2026-09-22, see `CHANGELOG.md` and `docs/07_TESTING_AND_QUALITY_ASSURANCE.md`):
  User asked the `auditor` subagent to check the whole app for remaining hardcoded values,
  wanting everything sourced from the database. Fixed 7 findings (6 from the audit + 1 found
  during manual verification): (1) `App.jsx`/`Header.jsx`/`Dashboard.jsx` still defaulted
  `filterOptions.year` to `'2026'`, which was always sent to the backend and silently
  overrode the backend's already-fixed dynamic `CURRENT_YEAR` — fixed with the same
  `CURRENT_YEAR = String(new Date().getFullYear())` pattern client-side; (2) frozen date
  fallbacks (`'2026-03-20'`/`'2026-03-24'`) in `calculationEngine.js`, `Calculator.jsx`, and
  `MetricDetailModal.jsx` replaced with the real current date; (3) 5 OUTCOME metrics'
  operational drilldown tables (recruitment SLA by unit, approval-stage compliance, hiring
  channel mix, recognition categories) were fully inline arrays in `getMetricDetail()` — moved
  to `seedData.js`'s new `initialOperationalRecords`, stored in `store.json`, read via new
  `storage.getOperationalRecords(metric_id)`; (4) Metric 11's live event-sync normalization
  divided by a hardcoded `500` instead of its own admin-editable `target_value` — an admin
  changing the target via Admin Parameters had zero effect on the live score; (5)
  `total_respondents` fabricated `1250` for ESS metrics with zero real responses (plus a
  frontend `|| 1250` bug that also misfired on a genuine `0`) — now always the real database
  count; (6, found during manual verification, not in the audit report)
  `storage.js`'s `applyResponseFilters()` had 4 more `'2026'` year-default literals, fixed
  with the same `CURRENT_YEAR` constant. Reviewed and left alone as intentional:
  `seedData.js`'s demo dataset itself, the 70/30 Survey/Outcome weighting constant,
  `reminderService.js`'s `REMINDER_LEAD_DAYS = 5` (a genuine app-wide policy knob, not
  per-metric data), CSV template illustrative sample rows, and per-question 90.0/9.0/4.5
  defaults (only used when a question has truly zero responses AND no admin-configured
  `percent_favorable` — an edge case, not data misrepresenting a real result).
  `tests/regressionTest.js` gained Module 26 (3 positive tests). Verified by running the
  full suite twice in a row (88/88 PASS both times) with the Signature Program Events count
  staying at the clean baseline of 2 across both runs.
- **v2.17.0** (2026-09-24, see `CHANGELOG.md` and `docs/05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md`
  §3.8): User asked for a new "Glossary" tab, themed to match the main app, sourced from
  `docs/People_Experience_Glossary_Full_Text.xlsx` (44 terms, 2-column Istilah/Definisi
  format the user prepared). New `GlossaryView.jsx` embeds all 44 terms directly (this is a
  static reference dictionary, not operational data, so no API/database layer needed) grouped
  into 7 categories — Framework & Konsep Inti (14) and Tools & Sistem (3), plus one group per
  Employee Journey (Arrival 4, Connect 8, Belong 7, Contribute 5, Depart 3) — reusing the exact
  journey color palette from `docs/05` §4 (Orange/Amber/Purple/Teal/Magenta) so the tab reads
  as part of the same app, not a bolted-on page. Search box filters by term or definition text
  client-side; category filter chips reuse the exact pill-button pattern from `Calculator.jsx`'s
  Journey filters (solid `backgroundColor` when active, count badge). Wired into `Header.jsx`
  (new nav button, `BookMarked` icon) and `App.jsx` (`activeTab === 'glossary'`). Purely
  frontend/static — no backend changes, so the regression suite stayed at 88/88 PASS.
- **v2.17.1** (2026-09-24, see `CHANGELOG.md` and `docs/05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md`
  §3.3): User asked for an explicit status label next to each metric name in the "5 Employee
  Experience Journeys" section, plus more room for metric names that were getting cut off.
  `Dashboard.jsx`'s journey-card metrics list was a wrapped chip cloud (`flex flex-wrap`) with
  names hard-truncated at `max-w-[120px]` — status was only implied by chip background color,
  no text label. Changed to a stacked full-width row list (`flex flex-col`) so names render in
  full, and added an explicit status icon (`CheckCircle2`/`AlertTriangle`/`AlertCircle`/
  `MinusCircle` for directorate-exempted metrics) plus a text label ("ON TARGET"/"WARNING"/
  "CRITICAL"/"EXEMPTED") next to the score — reusing the exact status-badge pattern already
  used in `Calculator.jsx`'s Explore Metrics table for consistency. Purely frontend — no
  backend changes, regression suite stayed at 88/88 PASS.
- **v2.18.0** (2026-09-24, see `CHANGELOG.md`): User asked for more 2026 dummy data so the
  YTD Performance Trend chart would look nicer. Root cause: every 2026 month used an
  identical static base score with only tiny ±0.12-0.3 variance — since the YTD chart is a
  cumulative running average, this made it nearly flat (82.86%-83.68% across all of
  Jan-Aug). Fixed in `seedData.js`: expanded the dummy respondent pools (employees 8→16,
  campus students 4→6, job candidates 4→6), added a 4th survey date per month (was 3, now
  ~240 responses/month instead of ~228), and added `monthTrendBonusPercent()` — a gentle,
  monotonic score bonus that ramps up through 2026 only (0pp in January to ~+9pp by
  December, applied across the SCALE_1_5/SCALE_1_10/YES_NO generation branches), representing
  PXCWB's intervention programs taking effect over the year. 2025's baseline dataset is
  deliberately left untouched so cross-year comparisons stay stable. Result: YTD PX Index now
  shows a real upward trend (82.81%→84.82% Jan-Aug), MTD shows an even clearer one
  (82.81%→87.04%); Outcome Index stays flat by design (snapshot metric, not a time series —
  see `[2.11.1]`). Since existing `store.json` response rows for dates already covered by the
  old seed logic wouldn't be replaced by the storage layer's additive merge (it only appends
  months not already present), the fix required directly clearing `surveyUploadedResponses`
  (and while at it, ~180 leftover `upl-*` CSV-upload test fixtures from regression Modules
  5/10/12/13 that predated this change) so the server would regenerate the full 2026 dataset
  fresh on next boot. No new regression tests (data-tuning change, not new testable behavior)
  — verified by running the full suite twice in a row (88/88 PASS both times) and confirming
  event/attendance/feedback counts stayed at the clean baseline.

- **v2.19.0** (2026-09-25, see `CHANGELOG.md` and `docs/03_SYSTEM_ARCHITECTURE_AND_DATA_FLOW.md` §4):
  User asked for 3 things: rename the "Glossary" menu to "About"; remove the "Tgl" prefix
  from the "Batas Tanggal Upload" dropdown options in Parameter Admin → Parameter Metric for
  SURVEY metrics; and investigate a "Failed to fetch" notification seen while using the app.
  (1) and (2) were simple label changes in `Header.jsx` and `AdminParametersModal.jsx`
  respectively (component/tab internals like `GlossaryView.jsx` and the `'glossary'` tab key
  were left untouched — only the user-visible label changed). (3) root cause: `npm run dev`
  starts the Express backend (port 5000) and Vite frontend (port 3000) concurrently with no
  readiness handshake, so `TrendChart.jsx`'s `fetchTrend()` — which self-fetches
  `/api/metrics/trends` as soon as the Dashboard mounts — can hit the backend before it
  finishes booting; the browser's `fetch()` then throws a raw `TypeError: Failed to fetch`
  (not an HTTP error response), which was caught and displayed verbatim in the Performance
  Trend card with no retry, so it stayed visible until a manual filter change or page reload.
  `App.jsx`'s initial `/api/directorates` fetch and the 5 parallel fetches in `fetchAllData()`
  had the same unguarded race (silently logged to console instead of shown, but same root
  cause). Fixed with a new `src/utils/fetchWithRetry.js` wrapper (retries up to 4x, 600ms
  apart, on network failure or a 502/503/504 response) applied at all three call sites;
  `TrendChart.jsx`'s error message was also changed from the raw browser error text to a
  clear Indonesian fallback for the rare case retries are exhausted. `tests/regressionTest.js`
  stayed at 88/88 PASS (frontend-only change, no API contract changes).
- **v2.20.0** (2026-10-01, see `CHANGELOG.md` and `docs/05_FRONTEND_UI_AND_COMPONENT_HIERARCHY.md`
  §4.1): User provided 7 new mockup screens (`mockup/`, 2 versions each) and asked for them to
  be analyzed then applied across the whole app, with a git checkpoint first (commit `946e9bc`)
  for easy rollback and a browser review before considering it done. Applied (commit `650b8b3`)
  a red-gradient reskin — pure visual/className changes, no layout or logic changes — to
  `Dashboard.jsx` (hero + journey cards), `Calculator.jsx`/Explore Metrics, `EventManager.jsx`,
  `App.jsx`'s alerts tab (not `ActionLibraryView.jsx`, which turned out to be unused dead code),
  `AdminParametersModal.jsx`, `AdminSurveyQuestionsModal.jsx`, and `Header.jsx`'s nav bar.
  Follow-up #1 (commit `8e8e698`): user reported Explore Metrics needed horizontal scroll,
  clipping the per-row gradient — widened the main container `max-w-7xl` (1280px) →
  `max-w-[1600px]` (verified no-scroll at 1440px/1700px) and refined the row styling to match
  mockup "3. (V.1) ALL JOURNEY SECTION" (left-to-right gradient, bold maroon ID numbers)
  without touching any button or label. Follow-up #2 (commit `c912abb`): user wants a
  user-selectable website accent color — added a "Tema" picker in `Header.jsx` (5 presets,
  localStorage-only, never server-side) backed by 13 new CSS custom properties in
  `src/index.css` (`--theme-*`) that `src/utils/theme.js` derives per-preset from one base hex
  via HSL math, applied across every surface from the reskin above. Journey accent colors,
  delete-button red, and success/error banners deliberately stay un-themed. `tests/regressionTest.js`
  stayed at 88/88 PASS throughout (pure CSS/frontend, no API changes).
- **v2.20.1** (2026-10-11, see `CHANGELOG.md` and `docs/04_BACKEND_API_AND_SERVICES_SPECIFICATION.md` §2.6):
  User reported every slide of a downloaded event PPT (`PX_Report_Perspektif_*.pptx`) had
  content running past the slide edge. Root cause: `pptGenerator.js` used
  `LAYOUT_16x9` (10" x 5.625") while all coordinates are laid out for 13.33" x 7.5" — confirmed
  from the file's `presentation.xml` `sldSz`. Fixed by switching to `LAYOUT_WIDE`; a bounds scan of
  all 6 regenerated slides found 0 out-of-bounds shapes. No LibreOffice here, so text overflow
  *inside* boxes is unverified. Regression suite stayed 88/88 PASS.
- **v2.21.0** (2026-10-11, see `CHANGELOG.md`, `docs/04` §2.6, `docs/05` §3.7a): User asked that photos/videos
  uploaded in Signature Program Events be viewable/playable after upload, and that videos get an AI transcript
  via the local audio/video-to-text API (`POST http://127.0.0.1:8000/transcribe`, `{"source": <local path>,
  "language": "id"}`). Before this, the gallery only showed an icon + filename placeholder. New
  `server/services/transcribeService.js` sends the uploaded file's LOCAL path (video never leaves the machine)
  and runs as a background job (Whisper on CPU took ~60s for a 72s video; uses core `http`, not `fetch`, to avoid
  undici's 5-min header timeout): upload answers immediately with `transcript_status: PROCESSING`, the UI polls
  the event detail every 4s only while something is processing, jobs interrupted by a restart are resumed at
  boot. `storage.js` gained `getMediaById/getAllMedia/updateMedia` (whitelisted fields) and `deleteMedia` now
  returns the removed record so the route can unlink the physical file. Hardening found along the way: media
  uploads previously accepted ANY file type and served it back from `/uploads` (stored XSS via .html) — now only
  `image/*`/`video/*` (415 otherwise) via a dedicated `mediaUpload` multer instance, cap raised to
  `MEDIA_MAX_MB` (default 200). `EventManager.jsx` got `MediaCard`/`MediaLightbox` (inline player, lightbox,
  click-a-transcript-line-to-seek, retry button, graceful "file not available" for seed media whose files don't
  exist). `tests/regressionTest.js` gained Module 27 (6 tests) -> 94/94 PASS. Verified end-to-end with the
  user's test video via the real UI. Known gap left alone: `deleteEvent()` still doesn't remove that event's
  media records/files (pre-existing).

- **v2.22.0** (2026-10-11, see `CHANGELOG.md` and `docs/08_DATABASE_SCHEMA_AND_MIGRATION.md`):
  User asked to install SQL Server locally, move all dashboard data into it (photos/videos stay on
  disk, only their paths + AI transcripts go in SQL Server) and prepare a rollback. Done: SQL Server
  **Express** (Standard is paid-only; 2022 Express installer links are dead → Express 2025 via winget,
  instance `SQLEXPRESS`, TCP 1433, Mixed Mode, `sa` disabled, app login `px_app` = `db_owner` of
  `PeopleExperiencePX` only) installed by `scripts/sqlserver/Setup-SqlServer.ps1` (run elevated; UAC
  can't be clicked by Claude). `server/db/storage.js` is now a dispatcher (`STORAGE_BACKEND=sql|json`)
  over `jsonStorage.js` (old behavior) and the new `sqlStorage.js`; every caller (`server.js` + 8
  services) was converted to `async/await` first and regression-tested on JSON, then SQL. Schema is a
  normalized rewrite (`schema.sql`, 22 tables: no `weights` table, respondent aliases collapsed into
  `respondent_type`+canonical columns re-derived on read, `operationalRecords` split into 5 tables,
  `px_media.file_path` for media). `server/db/migrate.js` loaded the existing `store.json`
  (5,040 responses etc., all counts verified). Rollback = `STORAGE_BACKEND=json`; with new edits kept:
  `npm run db:export -- --replace`; code: tag `pre-sqlserver-v2.21.0`. Verified: 99/99 on SQL (twice)
  and JSON, and 58/58 GET endpoints identical between a SQL and a JSON server on the same data.
  Gotchas: the regression suite dirties whichever backend is active (on SQL, reset with
  `node server/db/migrate.js --reset`); `.env` now holds `STORAGE_BACKEND=sql` + `DB_*` (gitignored);
  `server/data/store.json` is no longer written while on SQL, so it goes stale until exported.

- **v2.22.1** (2026-10-11, see `CHANGELOG.md` [2.22.1], `SQLServerDB.md`, `docs/08` §8): User asked the `auditor`
  subagent to verify that EVERYTHING on the dashboard comes from SQL Server and to move whatever doesn't, and for the
  SQL Server settings to live in a separate .md (`SQLServerDB.md` at the project root). Audit verdict: no server code
  bypasses SQL for operational data; findings fixed: survey question catalogue (was ~730 lines of code in
  `metricQuestionService.js`, `px_custom_survey_questions` was empty) → new `px_survey_questions` table seeded once, read
  only from SQL (code template kept solely for seed + admin "Reset"); respondent org units missing from the directory
  (whole "Digital Banking" directorate + ~15 divisions unreachable by the Header filters) added to
  `initialDirectorates`/`px_directorates`/`px_divisions` via a non-destructive boot top-up; new `px_app_settings`
  (PX target line, event category/type options; `GET /api/settings`, `PUT /api/admin/settings/:key`); public check-in
  form uses directorate/division dropdowns (no more silent "Information Technology" default); Dashboard counts and
  journey icons from the DB; `SEED_DEMO_DATA` flag. Bugs found: Metric 11 drilldown wrong field names, WARNING alerts
  compared against the raw (not normalized) target, Header Sub-Dir dropdown always empty (`d.id` doesn't exist),
  MetricDetailModal ignoring the selected period/directorate. Deliberately NOT changed: hardcoded metric IDs for special
  cases (2/5/7/11/12), CSV importer default fillers, 15 old regression-test upload batches in the data, action library
  coverage. Tests: 108 (Module 29 added), 108/108 on SQL (x2) and JSON. Reminder: the regression suite dirties the
  active backend — on SQL run `node server/db/migrate.js --reset` afterwards.

- **v2.23.0** (2026-10-11, see `CHANGELOG.md` [2.23.0], `docs/06`, `SQLServerDB.md`): User asked to (1) move any remaining
  filter/parameter/survey data to SQL Server, (2) add a menu to configure the email that sends the PIC
  manual-upload reminders, and (3) test it with the user's Gmail — they pasted their Gmail address AND
  password in chat. Claude deliberately did NOT use or store that password (real credential for another
  service; typing credentials is off-limits) — it built the whole feature and the user enters an App Password
  themselves in the menu, then clicks "Kirim Email Test". New: `EmailSettingsModal.jsx` (Header "Setting Email"),
  `px_email_settings`, `emailSettingsService.js`, `secretBox.js` (AES-256-GCM, key `SETTINGS_ENCRYPTION_KEY`
  auto-added to `.env` — back it up with the DB), routes `/api/admin/email-settings[/test]`; `reminderService`
  now builds its transporter per send from the DB. Option catalogs for Parameter Admin / Survey Questions
  (`metric_types`, `scale_types`, `target_audiences`, `update_frequencies`, `question_types`) moved to
  `px_app_settings` (labels editable only — values drive logic). Tests: Module 30 (8 tests, includes a fake
  in-process SMTP server so the full send path is verified without a real account; auto-skips when a real
  config exists) → 116/116 on SQL (x2) and JSON. `migrate --reset` wipes the email settings.

- **v2.24.0** (2026-10-11, see `CHANGELOG.md` [2.24.0], `docs/06`): User asked to verify that the PIC reminder
  emails go out automatically when, by the PIC's deadline day, last month's survey data is missing (deadline 10 +
  Oct → check September; "just check the survey table of that metric for a row dated in September"). The old logic
  did NOT match: it checked the CURRENT month, sent unrequested 5-day "due soon" warnings, used a boot-relative 24h
  timer with no sent-log (duplicates on restart, unreliable timing) and lost reminders when email wasn't configured.
  Rewrote `reminderService.js`: monthly → on/after the deadline day, no `survey_date` in month M-1 for that metric
  (`storage.hasSurveyDataInPeriod`) → email; annual → from the deadline date if no data that year. Scheduler runs at
  boot + every 30 min from `reminder_send_hour` (default 8), dedupe/follow-ups via new `px_reminder_log` +
  `reminder_repeat_days` (default 1, 0 = once). Setting Email modal got the schedule + sent history. Found &
  fixed while testing: deleting a metric left its survey responses (a new metric reusing the max+1 id inherited
  them) → delete now cascades; `secretBox` minted a new SETTINGS_ENCRYPTION_KEY in every process that hadn't
  loaded .env (tests → 9 keys in .env, stored password unreadable) → now reuses the existing key (+
  `password_readable` flag). Verified: 127/127 on SQL (x2) and JSON, plus a no-simulation proof (real clock +
  fake SMTP: scheduler emailed the PIC for "September 2026" by itself). Demo PIC emails are fictional
  @cimbniaga.co.id addresses — replace them before enabling real email.

## Workflow wajib di setiap perubahan (tanpa perlu diminta ulang)

Setelah mengimplementasikan perubahan apa pun (kode, UI, atau konten), SELALU lakukan
langkah-langkah ini sebelum melaporkan pekerjaan selesai — jangan tunggu diminta:

1. **Regression test**: jalankan `node tests/regressionTest.js`. Semua test harus PASS.
   Kalau ada yang gagal karena perubahanmu, perbaiki dulu sebelum lanjut.
2. **Versioning**: naikkan angka versi di `server/server.js` (field `version` pada endpoint
   `/api/health`), dan tambahkan entri baru di `CHANGELOG.md` (format `## [x.y.z] - YYYY-MM-DD`
   yang sudah konsisten dipakai di file ini) menjelaskan apa yang berubah dan mengapa.
3. **Update dokumentasi**: perbarui file `docs/*.md` yang relevan dengan area yang diubah
   (UI/komponen → `docs/05`, API/backend → `docs/04`, perubahan test suite → `docs/07`, dst.),
   dan tambahkan catatan ringkas di section `## Notes` file ini (`CLAUDE.md`) mengikuti pola
   entri versi yang sudah ada di atas.
4. **Restart & verifikasi**: restart dev server (`npm run dev` di port 5000+3000) dan cek
   langsung di Browser pane bahwa perubahan benar-benar tampil sebelum melaporkan selesai.
5. **Link to website**: setiap selesai perubahan, tambahkan tautan link ke website agar bisa langsung buka.
6. **Push ke Github**: setiap selesai perubahan, push otomatis ke Github yang terhubung ke folder project.  

Ini berlaku untuk SEMUA perubahan ke depan, tidak perlu di-state ulang oleh user setiap kali.