-- ============================================================================
-- CIMB Niaga People Experience (PX) - Microsoft SQL Server schema
-- Database: PeopleExperiencePX        Applied by: server/db/sqlStorage.js (init) / migrate.js
--
-- Idempotent: every table is created only if it does not exist yet, so it is safe to run on
-- every boot. Batches are separated by lines containing only GO.
--
-- Design notes (see docs/08_DATABASE_SCHEMA_AND_MIGRATION.md):
--  * No `weights` table: px_metrics.weight is the single source of truth.
--  * Targets live ONLY in px_metric_targets (the JSON store duplicated them on the metric).
--  * Survey respondents are normalized: respondent_type + respondent_id/name/email +
--    org_unit_1/org_unit_2 replace the nip / participant_id / candidate_id (and
--    directorate / university / applied_position, division / major / recruitment_channel)
--    alias columns of the JSON store. sqlStorage.js re-derives the legacy field names on read.
--  * Operational drilldown records are split into 5 purpose-built tables.
--  * Event photos/videos stay on disk (server/uploads); only their path + metadata + AI
--    transcript live here (px_media.file_path).
--  * Parameter tables (journeys / checkpoints / metrics) deliberately have no foreign keys
--    between them: the app lets an admin delete a journey/checkpoint without touching the
--    metrics that point to it (same behaviour as the JSON store).
-- ============================================================================

-- ---------------------------------------------------------------- parameters
IF OBJECT_ID(N'dbo.px_journeys', N'U') IS NULL
CREATE TABLE dbo.px_journeys (
  journey_id     INT            NOT NULL CONSTRAINT PK_px_journeys PRIMARY KEY,
  journey_code   NVARCHAR(50)   NOT NULL,
  journey_name   NVARCHAR(200)  NOT NULL,
  tagline        NVARCHAR(500)  NOT NULL CONSTRAINT DF_px_journeys_tagline DEFAULT (N''),
  color          NVARCHAR(20)   NOT NULL CONSTRAINT DF_px_journeys_color DEFAULT (N'#ED1C24'),
  icon           NVARCHAR(50)   NOT NULL CONSTRAINT DF_px_journeys_icon DEFAULT (N'Users'),
  display_order  INT            NOT NULL CONSTRAINT DF_px_journeys_order DEFAULT (0)
);
GO

IF OBJECT_ID(N'dbo.px_checkpoints', N'U') IS NULL
CREATE TABLE dbo.px_checkpoints (
  checkpoint_id    INT            NOT NULL CONSTRAINT PK_px_checkpoints PRIMARY KEY,
  journey_id       INT            NOT NULL,
  checkpoint_name  NVARCHAR(300)  NOT NULL,
  experience_owner NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_checkpoints_owner DEFAULT (N'People Experience Team')
);
GO

IF OBJECT_ID(N'dbo.px_metrics', N'U') IS NULL
CREATE TABLE dbo.px_metrics (
  metric_id              INT            NOT NULL CONSTRAINT PK_px_metrics PRIMARY KEY,
  journey_id             INT            NOT NULL,
  checkpoint_id          INT            NOT NULL,
  metric_name            NVARCHAR(500)  NOT NULL,
  metric_type            VARCHAR(20)    NOT NULL,            -- SURVEY | OUTCOME
  scale_type             VARCHAR(30)    NOT NULL,            -- RATING_5 | PERCENTAGE | NUMERIC | ...
  source_of_data         NVARCHAR(300)  NOT NULL CONSTRAINT DF_px_metrics_src DEFAULT (N''),
  experience_owner       NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_metrics_owner DEFAULT (N''),
  raw_value              FLOAT          NOT NULL CONSTRAINT DF_px_metrics_raw DEFAULT (0),
  normalized_score       FLOAT          NOT NULL CONSTRAINT DF_px_metrics_norm DEFAULT (0),
  weight                 FLOAT          NOT NULL CONSTRAINT DF_px_metrics_weight DEFAULT (1),
  is_indicative          BIT            NOT NULL CONSTRAINT DF_px_metrics_ind DEFAULT (0),
  is_employee_metric     BIT            NOT NULL CONSTRAINT DF_px_metrics_emp DEFAULT (1),
  target_audience        VARCHAR(30)    NOT NULL CONSTRAINT DF_px_metrics_aud DEFAULT ('EMPLOYEE'),
  underlying_questions   NVARCHAR(MAX)  NULL,                -- JSON array of strings
  update_frequency       VARCHAR(20)    NOT NULL CONSTRAINT DF_px_metrics_freq DEFAULT ('MONTHLY'),
  requires_manual_upload BIT            NOT NULL CONSTRAINT DF_px_metrics_upl DEFAULT (0),
  upload_deadline_day    INT            NOT NULL CONSTRAINT DF_px_metrics_dd DEFAULT (25),
  upload_deadline_month  INT            NOT NULL CONSTRAINT DF_px_metrics_dm DEFAULT (11),
  pic_name               NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_metrics_pic DEFAULT (N''),
  pic_email              NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_metrics_pice DEFAULT (N''),
  last_data_date         DATE           NULL,                -- OUTCOME metrics: last HR-system ingestion
  notes                  NVARCHAR(MAX)  NULL,
  unit                   NVARCHAR(30)   NULL,                -- display unit of the actual value ('%', '/ 5', 'pax', ...); NULL = not set yet (filled at boot)
  survey_source          VARCHAR(10)    NULL CONSTRAINT CK_px_metrics_survey_source CHECK (survey_source IN ('SYSTEM', 'ESS'))
                                                             -- SURVEY metrics only: SYSTEM (other system/form) | ESS (Employee Sentiment Survey); OUTCOME = NULL
);
GO

-- Databases created before v2.25.0 have no `unit` column: add it (NULL), init() then fills it from the seed.
IF COL_LENGTH(N'dbo.px_metrics', N'unit') IS NULL
ALTER TABLE dbo.px_metrics ADD unit NVARCHAR(30) NULL;
GO

-- Databases created before v2.29.0 have no `survey_source` column: add it (NULL), init() then fills only the NULLs
-- (SURVEY metric whose source_of_data mentions ESS -> 'ESS', other SURVEY -> 'SYSTEM'); an admin's value is never overwritten.
IF COL_LENGTH(N'dbo.px_metrics', N'survey_source') IS NULL
ALTER TABLE dbo.px_metrics ADD survey_source VARCHAR(10) NULL CONSTRAINT CK_px_metrics_survey_source CHECK (survey_source IN ('SYSTEM', 'ESS'));
GO

IF OBJECT_ID(N'dbo.px_metric_targets', N'U') IS NULL
CREATE TABLE dbo.px_metric_targets (
  metric_id       INT            NOT NULL CONSTRAINT PK_px_metric_targets PRIMARY KEY,
  target_value    FLOAT          NOT NULL,
  target_display  NVARCHAR(100)  NOT NULL CONSTRAINT DF_px_targets_disp DEFAULT (N''),
  min_threshold   FLOAT          NOT NULL CONSTRAINT DF_px_targets_min DEFAULT (75)   -- always a 0-100 percentage
);
GO

IF OBJECT_ID(N'dbo.px_action_library', N'U') IS NULL
CREATE TABLE dbo.px_action_library (
  action_id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_action_library PRIMARY KEY,
  metric_id             INT            NOT NULL,
  checkpoint_id         INT            NULL,
  gap_condition         NVARCHAR(500)  NOT NULL CONSTRAINT DF_px_action_gap DEFAULT (N''),
  recommended_action    NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_action_rec DEFAULT (N''),
  suggested_initiatives NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_action_sug DEFAULT (N'')
);
GO

IF OBJECT_ID(N'dbo.px_directorates', N'U') IS NULL
CREATE TABLE dbo.px_directorates (
  directorate_id    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_directorates PRIMARY KEY,
  directorate_name  NVARCHAR(200) NOT NULL CONSTRAINT UQ_px_directorates_name UNIQUE
);
GO

IF OBJECT_ID(N'dbo.px_divisions', N'U') IS NULL
CREATE TABLE dbo.px_divisions (
  division_id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_divisions PRIMARY KEY,
  directorate_id  INT            NOT NULL
    CONSTRAINT FK_px_divisions_directorate FOREIGN KEY REFERENCES dbo.px_directorates(directorate_id) ON DELETE CASCADE,
  division_name   NVARCHAR(200)  NOT NULL,
  CONSTRAINT UQ_px_divisions UNIQUE (directorate_id, division_name)
);
GO

-- ---------------------------------------------------------------- survey questions
IF OBJECT_ID(N'dbo.px_master_survey_questions', N'U') IS NULL
CREATE TABLE dbo.px_master_survey_questions (
  row_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_master_questions PRIMARY KEY,
  question_id    INT            NOT NULL,
  question_text  NVARCHAR(MAX)  NOT NULL,
  question_type  VARCHAR(30)    NOT NULL,
  display_order  INT            NOT NULL CONSTRAINT DF_px_mq_order DEFAULT (0),
  is_default     BIT            NOT NULL CONSTRAINT DF_px_mq_def DEFAULT (0),
  extra_json     NVARCHAR(MAX)  NULL            -- any additional fields a question carries
);
GO

IF OBJECT_ID(N'dbo.px_survey_questions', N'U') IS NULL
CREATE TABLE dbo.px_survey_questions (              -- the question set of every SURVEY metric (one row per question)
  question_row           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_survey_questions PRIMARY KEY,
  metric_id              INT            NOT NULL,
  display_order          INT            NOT NULL,
  question_key           NVARCHAR(100)  NOT NULL,          -- key used inside ratings_json of the responses
  label                  NVARCHAR(300)  NOT NULL CONSTRAINT DF_px_sq_label DEFAULT (N''),
  question_text          NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_sq_text DEFAULT (N''),
  question_type          VARCHAR(20)    NOT NULL,          -- SCALE_1_5 | SCALE_1_10 | YES_NO | FREE_TEXT
  mandatory              BIT            NOT NULL CONSTRAINT DF_px_sq_mand DEFAULT (0),
  dimension              NVARCHAR(200)  NULL,              -- ESS dimension
  visible_based_on       NVARCHAR(200)  NULL,
  required_based_on      NVARCHAR(200)  NULL,
  percent_favorable      FLOAT          NULL,              -- ESS official distribution (optional)
  percent_neutral        FLOAT          NULL,
  percent_unfavorable    FLOAT          NULL,
  extra_json             NVARCHAR(MAX)  NULL,              -- any other field a question carries
  is_customized          BIT            NOT NULL CONSTRAINT DF_px_sq_cust DEFAULT (0),  -- 0 = default set, 1 = edited by an admin
  CONSTRAINT UQ_px_sq_metric_key UNIQUE (metric_id, question_key)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_sq_metric' AND object_id = OBJECT_ID(N'dbo.px_survey_questions'))
  CREATE INDEX IX_px_sq_metric ON dbo.px_survey_questions(metric_id, display_order);
GO
-- v2.22.1: replaced by px_survey_questions (it was always empty - defaults were served from code)
IF OBJECT_ID(N'dbo.px_custom_survey_questions', N'U') IS NOT NULL DROP TABLE dbo.px_custom_survey_questions;
GO

-- ---------------------------------------------------------------- reminder e-mail sender ("Setting Email" menu)
IF OBJECT_ID(N'dbo.px_email_settings', N'U') IS NULL
CREATE TABLE dbo.px_email_settings (                -- exactly one row (setting_id = 1)
  setting_id          INT            NOT NULL CONSTRAINT PK_px_email_settings PRIMARY KEY CONSTRAINT CK_px_email_single CHECK (setting_id = 1),
  enabled             BIT            NOT NULL CONSTRAINT DF_px_email_enabled DEFAULT (0),
  provider            VARCHAR(20)    NOT NULL CONSTRAINT DF_px_email_provider DEFAULT ('GMAIL'),   -- GMAIL | SMTP
  smtp_host           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_email_host DEFAULT (N'smtp.gmail.com'),
  smtp_port           INT            NOT NULL CONSTRAINT DF_px_email_port DEFAULT (465),
  smtp_secure         BIT            NOT NULL CONSTRAINT DF_px_email_secure DEFAULT (1),
  smtp_user           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_email_user DEFAULT (N''),
  smtp_password_enc   NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_email_pass DEFAULT (N''),            -- AES-256-GCM, never plain text
  from_name           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_email_fname DEFAULT (N'People Experience CIMB Niaga'),
  from_email          NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_email_from DEFAULT (N''),
  updated_at          DATETIME2(3)   NOT NULL CONSTRAINT DF_px_email_ts DEFAULT (SYSUTCDATETIME())
);
GO

-- ---------------------------------------------------------------- upload-reminder log (what was emailed to which PIC)
IF OBJECT_ID(N'dbo.px_reminder_log', N'U') IS NULL
CREATE TABLE dbo.px_reminder_log (
  log_id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_reminder_log PRIMARY KEY,
  metric_id        INT            NOT NULL,
  expected_period  NVARCHAR(20)   NOT NULL,          -- the period that had no data: '2026-09' (monthly) or '2026' (annual)
  sent_on          DATE           NOT NULL,          -- the run date the reminder belongs to
  attempted_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_px_remlog_ts DEFAULT (SYSUTCDATETIME()),
  status           VARCHAR(10)    NOT NULL,          -- SENT | FAILED
  pic_email        NVARCHAR(200)  NOT NULL,
  error_message    NVARCHAR(500)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_remlog_metric' AND object_id = OBJECT_ID(N'dbo.px_reminder_log'))
  CREATE INDEX IX_px_remlog_metric ON dbo.px_reminder_log(metric_id, expected_period, sent_on);
GO

-- ---------------------------------------------------------------- application settings
IF OBJECT_ID(N'dbo.px_app_settings', N'U') IS NULL
CREATE TABLE dbo.px_app_settings (                  -- small admin-managed values shown in the UI (targets, dropdown options)
  setting_key    NVARCHAR(100)  NOT NULL CONSTRAINT PK_px_app_settings PRIMARY KEY,
  setting_value  NVARCHAR(MAX)  NOT NULL,            -- JSON
  description    NVARCHAR(300)  NOT NULL CONSTRAINT DF_px_settings_desc DEFAULT (N''),
  updated_at     DATETIME2(3)   NOT NULL CONSTRAINT DF_px_settings_ts DEFAULT (SYSUTCDATETIME())
);
GO

-- ---------------------------------------------------------------- signature events
IF OBJECT_ID(N'dbo.px_events', N'U') IS NULL
CREATE TABLE dbo.px_events (
  event_seq            INT IDENTITY(1,1) NOT NULL,                       -- insertion order
  event_id             NVARCHAR(64)   NOT NULL CONSTRAINT PK_px_events PRIMARY KEY,
  event_name           NVARCHAR(300)  NOT NULL,
  program_category     NVARCHAR(100)  NOT NULL CONSTRAINT DF_px_events_cat DEFAULT (N'Perspektif'),
  event_date           NVARCHAR(40)   NOT NULL,                          -- kept exactly as entered in the form
  event_type           VARCHAR(20)    NOT NULL CONSTRAINT DF_px_events_type DEFAULT ('HYBRID'),
  location             NVARCHAR(300)  NOT NULL CONSTRAINT DF_px_events_loc DEFAULT (N''),
  target_participants  INT            NOT NULL CONSTRAINT DF_px_events_target DEFAULT (500),
  pre_event_code       NVARCHAR(100)  NOT NULL,
  post_event_code      NVARCHAR(100)  NOT NULL,
  is_attendance_open   BIT            NOT NULL CONSTRAINT DF_px_events_ao DEFAULT (1),
  is_feedback_open     BIT            NOT NULL CONSTRAINT DF_px_events_fo DEFAULT (1),
  created_by           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_events_by DEFAULT (N'HR PX Team')
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_events_seq' AND object_id = OBJECT_ID(N'dbo.px_events'))
  CREATE UNIQUE INDEX IX_px_events_seq ON dbo.px_events(event_seq);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_events_pre' AND object_id = OBJECT_ID(N'dbo.px_events'))
  CREATE INDEX IX_px_events_pre ON dbo.px_events(pre_event_code);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_events_post' AND object_id = OBJECT_ID(N'dbo.px_events'))
  CREATE INDEX IX_px_events_post ON dbo.px_events(post_event_code);
GO

IF OBJECT_ID(N'dbo.px_event_questions', N'U') IS NULL
CREATE TABLE dbo.px_event_questions (               -- per-event snapshot copy of the questions
  row_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_event_questions PRIMARY KEY,
  event_id       NVARCHAR(64)   NOT NULL
    CONSTRAINT FK_px_event_questions_event FOREIGN KEY REFERENCES dbo.px_events(event_id) ON DELETE CASCADE,
  question_id    INT            NOT NULL,
  question_text  NVARCHAR(MAX)  NOT NULL,
  question_type  VARCHAR(30)    NOT NULL,
  display_order  INT            NOT NULL CONSTRAINT DF_px_eq_order DEFAULT (0),
  is_default     BIT            NOT NULL CONSTRAINT DF_px_eq_def DEFAULT (0),
  extra_json     NVARCHAR(MAX)  NULL
);
GO

IF OBJECT_ID(N'dbo.px_attendances', N'U') IS NULL
CREATE TABLE dbo.px_attendances (
  attendance_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_attendances PRIMARY KEY,
  event_id              NVARCHAR(64)   NOT NULL
    CONSTRAINT FK_px_attendances_event FOREIGN KEY REFERENCES dbo.px_events(event_id) ON DELETE CASCADE,
  nip                   NVARCHAR(50)   NOT NULL,                         -- employee ID: unique per event
  employee_name         NVARCHAR(200)  NOT NULL,
  cimb_email            NVARCHAR(200)  NOT NULL,
  directorate           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_att_dir DEFAULT (N'General'),
  division              NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_att_div DEFAULT (N'General'),
  attendance_timestamp  DATETIME2(3)   NOT NULL CONSTRAINT DF_px_att_ts DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT UQ_px_attendances_event_nip UNIQUE (event_id, nip)
);
GO

IF OBJECT_ID(N'dbo.px_feedback_responses', N'U') IS NULL
CREATE TABLE dbo.px_feedback_responses (
  response_id   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_feedback PRIMARY KEY,
  event_id      NVARCHAR(64)   NOT NULL
    CONSTRAINT FK_px_feedback_event FOREIGN KEY REFERENCES dbo.px_events(event_id) ON DELETE CASCADE,
  nip           NVARCHAR(50)   NOT NULL,
  ratings_json  NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_fb_ratings DEFAULT (N'{}'),   -- { question_key: score }
  verbatim      NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_fb_verb DEFAULT (N''),
  submitted_at  DATETIME2(3)   NOT NULL CONSTRAINT DF_px_fb_ts DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT UQ_px_feedback_event_nip UNIQUE (event_id, nip)
);
GO

IF OBJECT_ID(N'dbo.px_media', N'U') IS NULL
CREATE TABLE dbo.px_media (                          -- photos & videos: the FILE stays on disk, only its path is stored
  media_seq                 INT IDENTITY(1,1) NOT NULL,
  media_id                  NVARCHAR(64)   NOT NULL CONSTRAINT PK_px_media PRIMARY KEY,
  event_id                  NVARCHAR(64)   NOT NULL
    CONSTRAINT FK_px_media_event FOREIGN KEY REFERENCES dbo.px_events(event_id) ON DELETE CASCADE,
  file_name                 NVARCHAR(500)  NOT NULL,
  file_path                 NVARCHAR(500)  NOT NULL,                     -- e.g. /uploads/media-123.mp4
  file_type                 VARCHAR(10)    NOT NULL CONSTRAINT DF_px_media_type DEFAULT ('IMAGE'),
  caption                   NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_media_cap DEFAULT (N''),
  ai_generated_description  NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_media_ai DEFAULT (N''),
  highlight_order           INT            NOT NULL CONSTRAINT DF_px_media_order DEFAULT (1),
  created_at                DATETIME2(3)   NOT NULL CONSTRAINT DF_px_media_ts DEFAULT (SYSUTCDATETIME()),
  transcript_status         VARCHAR(20)    NULL,                         -- PROCESSING | DONE | FAILED (videos only)
  transcript_error          NVARCHAR(MAX)  NULL,
  transcript                NVARCHAR(MAX)  NULL,
  transcript_segments       NVARCHAR(MAX)  NULL,                         -- JSON array
  transcript_language       VARCHAR(10)    NULL,
  duration_seconds          FLOAT          NULL
);
GO
-- v2.28.0: AI summary of a video's transcript. Databases created earlier get the columns here (NULL = no summary yet).
IF COL_LENGTH(N'dbo.px_media', N'summary') IS NULL ALTER TABLE dbo.px_media ADD summary NVARCHAR(MAX) NULL;
IF COL_LENGTH(N'dbo.px_media', N'summary_points') IS NULL ALTER TABLE dbo.px_media ADD summary_points NVARCHAR(MAX) NULL;  -- JSON array of key points
IF COL_LENGTH(N'dbo.px_media', N'summary_status') IS NULL ALTER TABLE dbo.px_media ADD summary_status VARCHAR(20) NULL;  -- PROCESSING | DONE | FAILED | INSUFFICIENT (NULL = none)
IF COL_LENGTH(N'dbo.px_media', N'summary_source') IS NULL ALTER TABLE dbo.px_media ADD summary_source VARCHAR(10) NULL;  -- AI | RULE
IF COL_LENGTH(N'dbo.px_media', N'summary_model') IS NULL ALTER TABLE dbo.px_media ADD summary_model VARCHAR(60) NULL;
IF COL_LENGTH(N'dbo.px_media', N'summary_language') IS NULL ALTER TABLE dbo.px_media ADD summary_language VARCHAR(10) NULL;
IF COL_LENGTH(N'dbo.px_media', N'summary_generated_at') IS NULL ALTER TABLE dbo.px_media ADD summary_generated_at DATETIME2(3) NULL;
IF COL_LENGTH(N'dbo.px_media', N'summary_error') IS NULL ALTER TABLE dbo.px_media ADD summary_error NVARCHAR(500) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_media_seq' AND object_id = OBJECT_ID(N'dbo.px_media'))
  CREATE UNIQUE INDEX IX_px_media_seq ON dbo.px_media(media_seq);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_media_event' AND object_id = OBJECT_ID(N'dbo.px_media'))
  CREATE INDEX IX_px_media_event ON dbo.px_media(event_id);
GO

-- ---------------------------------------------------------------- survey uploads & responses
IF OBJECT_ID(N'dbo.px_survey_uploads', N'U') IS NULL
CREATE TABLE dbo.px_survey_uploads (
  upload_seq            INT IDENTITY(1,1) NOT NULL,
  upload_id             NVARCHAR(64)   NOT NULL CONSTRAINT PK_px_survey_uploads PRIMARY KEY,
  metric_id             INT            NULL,
  file_name             NVARCHAR(500)  NOT NULL,
  total_rows            INT            NOT NULL CONSTRAINT DF_px_up_tot DEFAULT (0),
  valid_rows            INT            NOT NULL CONSTRAINT DF_px_up_val DEFAULT (0),
  invalid_rows          INT            NOT NULL CONSTRAINT DF_px_up_inv DEFAULT (0),
  calculated_avg_score  FLOAT          NULL,
  uploaded_by           NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_up_by DEFAULT (N'HR Admin'),
  uploaded_at           DATETIME2(3)   NOT NULL CONSTRAINT DF_px_up_at DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_uploads_seq' AND object_id = OBJECT_ID(N'dbo.px_survey_uploads'))
  CREATE UNIQUE INDEX IX_px_uploads_seq ON dbo.px_survey_uploads(upload_seq);
GO

IF OBJECT_ID(N'dbo.px_survey_uploaded_responses', N'U') IS NULL
CREATE TABLE dbo.px_survey_uploaded_responses (
  response_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_survey_responses PRIMARY KEY,
  upload_id           NVARCHAR(64)   NOT NULL,
  metric_id           INT            NOT NULL,
  respondent_type     VARCHAR(20)    NOT NULL,                  -- EMPLOYEE | CAMPUS_STUDENT | JOB_CANDIDATE
  respondent_id       NVARCHAR(100)  NOT NULL,                  -- NIP / participant ID / candidate ID
  respondent_name     NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_resp_name DEFAULT (N''),
  respondent_email    NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_resp_mail DEFAULT (N''),
  org_unit_1          NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_resp_o1 DEFAULT (N'General'),   -- directorate | university | applied position
  org_unit_2          NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_resp_o2 DEFAULT (N'General'),   -- division | major | recruitment channel
  ratings_json        NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_resp_rat DEFAULT (N'{}'),
  rating_score        FLOAT          NULL,
  verbatim_feedback   NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_resp_verb DEFAULT (N''),
  survey_date         DATE           NOT NULL,
  source              VARCHAR(40)    NOT NULL CONSTRAINT DF_px_resp_src DEFAULT ('MANUAL_UPLOAD'),
  created_at          DATETIME2(3)   NOT NULL CONSTRAINT DF_px_resp_ts DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_resp_metric_date' AND object_id = OBJECT_ID(N'dbo.px_survey_uploaded_responses'))
  CREATE INDEX IX_px_resp_metric_date ON dbo.px_survey_uploaded_responses(metric_id, survey_date) INCLUDE (rating_score, org_unit_1, org_unit_2);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_resp_org' AND object_id = OBJECT_ID(N'dbo.px_survey_uploaded_responses'))
  CREATE INDEX IX_px_resp_org ON dbo.px_survey_uploaded_responses(org_unit_1, org_unit_2);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_resp_upload' AND object_id = OBJECT_ID(N'dbo.px_survey_uploaded_responses'))
  CREATE INDEX IX_px_resp_upload ON dbo.px_survey_uploaded_responses(upload_id);
GO

-- ESS result summaries (v2.32.0): an ESS metric's data is the uploaded ESS summary .xlsx, one row per org unit
-- (the Bankwide row has directorate NULL) per metric and period. A re-upload of the same metric + period replaces
-- the rows; the upload itself stays in px_survey_uploads (history) and its original file in server/data/ess-uploads.
-- Scores are percentages 0-100. questions_json = [{ "label": <question text from the file>, "score": <0-100 | null> }].
IF OBJECT_ID(N'dbo.px_ess_results', N'U') IS NULL
CREATE TABLE dbo.px_ess_results (
  ess_result_id   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_ess_results PRIMARY KEY,
  upload_id       NVARCHAR(64)   NOT NULL,
  metric_id       INT            NOT NULL,
  survey_year     SMALLINT       NOT NULL,
  survey_month    TINYINT        NOT NULL CONSTRAINT CK_px_ess_month CHECK (survey_month BETWEEN 1 AND 12),
  org_level       VARCHAR(12)    NOT NULL CONSTRAINT CK_px_ess_level CHECK (org_level IN ('BANKWIDE', 'DIRECTORATE')),
  directorate     NVARCHAR(200)  NULL,
  participation   INT            NOT NULL CONSTRAINT CK_px_ess_part CHECK (participation >= 0),
  index_score     DECIMAL(7,4)   NOT NULL CONSTRAINT CK_px_ess_index CHECK (index_score BETWEEN 0 AND 100),
  questions_json  NVARCHAR(MAX)  NOT NULL CONSTRAINT DF_px_ess_q DEFAULT (N'[]'),
  created_at      DATETIME2(3)   NOT NULL CONSTRAINT DF_px_ess_ts DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT CK_px_ess_dir CHECK ((org_level = 'BANKWIDE' AND directorate IS NULL) OR (org_level = 'DIRECTORATE' AND directorate IS NOT NULL)),
  -- one Bankwide row (directorate NULL: SQL Server allows a single NULL per key) and one row per directorate per period
  CONSTRAINT UQ_px_ess_results UNIQUE (metric_id, survey_year, survey_month, org_level, directorate)
);
GO

-- Exit Interview (v2.38.0): one row per employee exit from the "Termination Report" .xlsx (Admin upload) plus a
-- Directorate (and optional Division) column. Key = (nik, effective_date): a re-upload of the same exit UPDATES the row.
-- source: UPLOAD (Admin upload), TEMPLATE_IMPORT (scripts/import-exit-template.js, dummy directorate + surrogate NIK),
-- SEED_DUMMY (generated demo rows; a month only gets them while it has no row at all, and real rows of a month replace them).
-- career_scores_json = the 15 career statements (1-6, null = not answered) or NULL when none was answered.
IF OBJECT_ID(N'dbo.px_exit_interview_uploads', N'U') IS NULL
CREATE TABLE dbo.px_exit_interview_uploads (
  upload_id           NVARCHAR(64)   NOT NULL CONSTRAINT PK_px_exit_uploads PRIMARY KEY,
  file_name           NVARCHAR(260)  NOT NULL CONSTRAINT DF_px_exit_up_file DEFAULT (N''),
  source              VARCHAR(20)    NOT NULL CONSTRAINT CK_px_exit_up_src CHECK (source IN ('UPLOAD', 'TEMPLATE_IMPORT', 'SEED_DUMMY')),
  total_rows          INT            NOT NULL CONSTRAINT DF_px_exit_up_total DEFAULT (0),
  inserted_rows       INT            NOT NULL CONSTRAINT DF_px_exit_up_ins DEFAULT (0),
  updated_rows        INT            NOT NULL CONSTRAINT DF_px_exit_up_upd DEFAULT (0),
  removed_dummy_rows  INT            NOT NULL CONSTRAINT DF_px_exit_up_dummy DEFAULT (0),
  period_from         DATE           NULL,
  period_to           DATE           NULL,
  uploaded_by         NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_exit_up_by DEFAULT (N'HR Admin'),
  uploaded_at         DATETIME2(3)   NOT NULL CONSTRAINT DF_px_exit_up_ts DEFAULT (SYSUTCDATETIME())
);
GO
IF OBJECT_ID(N'dbo.px_exit_interviews', N'U') IS NULL
CREATE TABLE dbo.px_exit_interviews (
  exit_id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_exit_interviews PRIMARY KEY,
  upload_id              NVARCHAR(64)   NOT NULL,
  nik                    NVARCHAR(50)   NOT NULL,
  employee_name          NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_exit_name DEFAULT (N''),
  effective_date         DATE           NOT NULL,
  leaving_reason         NVARCHAR(100)  NULL,
  leaving_reason_detail  NVARCHAR(100)  NULL,
  grade                  NVARCHAR(20)   NULL,
  score_factor           NVARCHAR(20)   NULL,
  directorate            NVARCHAR(200)  NOT NULL,
  division               NVARCHAR(200)  NULL,
  destination_industry   NVARCHAR(500)  NULL,     -- column H as answered
  new_company            NVARCHAR(500)  NULL,     -- column I as answered
  new_company_std        NVARCHAR(500)  NULL,     -- column I standardized with the alias table at import time
  new_position           NVARCHAR(500)  NULL,
  pull_factors           NVARCHAR(MAX)  NULL,     -- K (multi-select, " | " separated)
  improve_factors        NVARCHAR(MAX)  NULL,     -- L
  new_company_offers     NVARCHAR(MAX)  NULL,     -- M
  internal_factors       NVARCHAR(MAX)  NULL,     -- N
  career_scores_json     NVARCHAR(400)  NULL,     -- O..AC
  alumni_network         VARCHAR(3)     NULL CONSTRAINT CK_px_exit_alumni CHECK (alumni_network IN ('Yes', 'No')),
  privacy_consent        VARCHAR(3)     NULL CONSTRAINT CK_px_exit_privacy CHECK (privacy_consent IN ('Yes', 'No')),
  recommend              VARCHAR(3)     NULL CONSTRAINT CK_px_exit_recommend CHECK (recommend IN ('Yes', 'No')),
  suggestions            NVARCHAR(MAX)  NULL,     -- AG
  source                 VARCHAR(20)    NOT NULL CONSTRAINT CK_px_exit_src CHECK (source IN ('UPLOAD', 'TEMPLATE_IMPORT', 'SEED_DUMMY')),
  created_at             DATETIME2(3)   NOT NULL CONSTRAINT DF_px_exit_ts DEFAULT (SYSUTCDATETIME()),
  updated_at             DATETIME2(3)   NULL,
  CONSTRAINT UQ_px_exit_nik_date UNIQUE (nik, effective_date)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_exit_date' AND object_id = OBJECT_ID(N'dbo.px_exit_interviews'))
  CREATE INDEX IX_px_exit_date ON dbo.px_exit_interviews(effective_date);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_px_exit_dir' AND object_id = OBJECT_ID(N'dbo.px_exit_interviews'))
  CREATE INDEX IX_px_exit_dir ON dbo.px_exit_interviews(directorate, division);
GO

IF OBJECT_ID(N'dbo.px_acknowledged_alerts', N'U') IS NULL
CREATE TABLE dbo.px_acknowledged_alerts (
  metric_id        INT           NOT NULL CONSTRAINT PK_px_ack_alerts PRIMARY KEY,
  acknowledged_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_px_ack_ts DEFAULT (SYSUTCDATETIME())
);
GO

-- ---------------------------------------------------------------- OUTCOME metric drilldown tables
IF OBJECT_ID(N'dbo.px_recruitment_sla_by_unit', N'U') IS NULL        -- metric 1 (seeded data's metric)
CREATE TABLE dbo.px_recruitment_sla_by_unit (
  record_id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_rec_sla PRIMARY KEY,
  metric_id         INT            NOT NULL,
  unit              NVARCHAR(200)  NOT NULL,
  target_headcount  INT            NOT NULL,
  fulfilled         INT            NOT NULL,
  sla_achievement   NVARCHAR(30)   NOT NULL,
  status            NVARCHAR(50)   NOT NULL
);
GO
IF OBJECT_ID(N'dbo.px_approval_stage_compliance', N'U') IS NULL      -- metric 3
CREATE TABLE dbo.px_approval_stage_compliance (
  record_id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_appr PRIMARY KEY,
  metric_id        INT            NOT NULL,
  stage            NVARCHAR(200)  NOT NULL,
  avg_sla_hours    FLOAT          NOT NULL,
  sla_target_hours FLOAT          NOT NULL,
  compliance       NVARCHAR(30)   NOT NULL
);
GO
IF OBJECT_ID(N'dbo.px_hiring_channel_mix', N'U') IS NULL             -- metric 4
CREATE TABLE dbo.px_hiring_channel_mix (
  record_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_hire_mix PRIMARY KEY,
  metric_id      INT            NOT NULL,
  channel        NVARCHAR(200)  NOT NULL,
  hires_count    INT            NOT NULL,
  percentage     NVARCHAR(30)   NOT NULL,
  quality_score  NVARCHAR(30)   NOT NULL
);
GO
IF OBJECT_ID(N'dbo.px_recognition_categories', N'U') IS NULL         -- metric 14
CREATE TABLE dbo.px_recognition_categories (
  record_id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_recog PRIMARY KEY,
  metric_id        INT            NOT NULL,
  category         NVARCHAR(200)  NOT NULL,
  recipient_count  INT            NOT NULL,
  points_awarded   NVARCHAR(50)   NOT NULL,
  source           NVARCHAR(200)  NOT NULL
);
GO
IF OBJECT_ID(N'dbo.px_attrition_by_tenure', N'U') IS NULL            -- metric 25
CREATE TABLE dbo.px_attrition_by_tenure (
  record_id        INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_attr PRIMARY KEY,
  metric_id        INT            NOT NULL,
  tenure_bracket   NVARCHAR(200)  NOT NULL,
  attrition_count  INT            NOT NULL,
  rate             NVARCHAR(30)   NOT NULL,
  benchmark        NVARCHAR(30)   NOT NULL
);
GO

-- ---------------------------------------------------------------- login accounts (v2.26.0)
-- Local accounts (no AD/LDAP). password_hash = scrypt (salt per user) - never returned by the API.
-- username is the NIP / login name. Two roles: ADMIN (not tied to a directorate) and USER
-- (1 directorate + 1 division, by name like the rest of the app).
IF OBJECT_ID(N'dbo.px_users', N'U') IS NULL
CREATE TABLE dbo.px_users (
  user_id               INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_users PRIMARY KEY,
  username              NVARCHAR(50)   NOT NULL CONSTRAINT UQ_px_users_username UNIQUE,
  full_name             NVARCHAR(200)  NOT NULL,
  email                 NVARCHAR(200)  NOT NULL CONSTRAINT DF_px_users_email DEFAULT (N''),
  password_hash         NVARCHAR(400)  NOT NULL,
  role                  NVARCHAR(20)   NOT NULL CONSTRAINT CK_px_users_role CHECK (role IN (N'ADMIN', N'USER')),
  directorate           NVARCHAR(200)  NULL,
  division              NVARCHAR(200)  NULL,
  is_active             BIT            NOT NULL CONSTRAINT DF_px_users_active DEFAULT (1),
  must_change_password  BIT            NOT NULL CONSTRAINT DF_px_users_mcp DEFAULT (1),
  failed_attempts       INT            NOT NULL CONSTRAINT DF_px_users_failed DEFAULT (0),
  locked_until          DATETIME2(3)   NULL,
  created_at            DATETIME2(3)   NOT NULL CONSTRAINT DF_px_users_created DEFAULT (SYSUTCDATETIME()),
  last_login_at         DATETIME2(3)   NULL,
  is_test_account       BIT            NOT NULL CONSTRAINT DF_px_users_is_test DEFAULT (0)  -- v2.43.0: temporary test-run account (server-side only)
);
GO
-- Databases created before v2.43.0: test-run accounts are marked server-side (regression suite / QC scripts via
-- storage.createUser, or inherited from a test admin) - never through the API.
IF COL_LENGTH(N'dbo.px_users', N'is_test_account') IS NULL
ALTER TABLE dbo.px_users ADD is_test_account BIT NOT NULL CONSTRAINT DF_px_users_is_test DEFAULT (0);
GO
-- Menu access of a USER (v2.49.0): JSON { dashboard, explore, exit_interview, action_library, events, about: true/false }.
-- NULL = the defaults (all on except events). An ADMIN always has every menu (column ignored). Rules in menuAccess.js.
IF COL_LENGTH(N'dbo.px_users', N'menu_access') IS NULL
ALTER TABLE dbo.px_users ADD menu_access NVARCHAR(400) NULL;
GO
-- Data scope of a USER (v2.27.0): any number of directorates; division NULL = every division of that
-- directorate, otherwise one row per allowed division. UNIQUE treats the single NULL as a value, so
-- "all divisions" can appear once per directorate. px_users.directorate / division are LEGACY (v2.26.0
-- single scope): migrated into this table at boot and no longer written.
IF OBJECT_ID(N'dbo.px_user_scopes', N'U') IS NULL
CREATE TABLE dbo.px_user_scopes (
  scope_id     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_user_scopes PRIMARY KEY,
  user_id      INT           NOT NULL CONSTRAINT FK_px_user_scopes_user REFERENCES dbo.px_users(user_id) ON DELETE CASCADE,
  directorate  NVARCHAR(200) NOT NULL,
  division     NVARCHAR(200) NULL,
  CONSTRAINT UQ_px_user_scopes UNIQUE (user_id, directorate, division)
);
GO
IF OBJECT_ID(N'dbo.px_sessions', N'U') IS NULL
CREATE TABLE dbo.px_sessions (                     -- only the SHA-256 of the cookie token is stored
  token_hash   CHAR(64)      NOT NULL CONSTRAINT PK_px_sessions PRIMARY KEY,
  user_id      INT           NOT NULL CONSTRAINT FK_px_sessions_user REFERENCES dbo.px_users(user_id) ON DELETE CASCADE,
  expires_at   DATETIME2(3)  NOT NULL,
  created_at   DATETIME2(3)  NOT NULL CONSTRAINT DF_px_sessions_created DEFAULT (SYSUTCDATETIME()),
  last_activity_at DATETIME2(3) NULL CONSTRAINT DF_px_sessions_activity DEFAULT (SYSUTCDATETIME())  -- v2.44.0: last REAL user activity (login / POST /api/auth/activity)
);
GO
-- Databases created before v2.44.0: existing sessions keep NULL, which is read as created_at (idle sign-out).
IF COL_LENGTH(N'dbo.px_sessions', N'last_activity_at') IS NULL
ALTER TABLE dbo.px_sessions ADD last_activity_at DATETIME2(3) NULL CONSTRAINT DF_px_sessions_activity DEFAULT (SYSUTCDATETIME());
GO
IF OBJECT_ID(N'dbo.px_audit_log', N'U') IS NULL
CREATE TABLE dbo.px_audit_log (                    -- login / user-management trail; never holds secrets
  audit_id     BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_px_audit_log PRIMARY KEY,
  occurred_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_px_audit_ts DEFAULT (SYSUTCDATETIME()),
  user_id      INT           NULL,
  username     NVARCHAR(100) NULL,
  action       NVARCHAR(50)  NOT NULL,
  target       NVARCHAR(200) NULL,
  ip           NVARCHAR(64)  NULL,
  is_test      BIT           NOT NULL CONSTRAINT DF_px_audit_is_test DEFAULT (0)  -- v2.43.0: written by/about a test-run account (hidden by default, never deleted)
);
GO
-- Databases created before v2.43.0: the column is added with 0 and init() marks the old test-run rows once.
IF COL_LENGTH(N'dbo.px_audit_log', N'is_test') IS NULL
ALTER TABLE dbo.px_audit_log ADD is_test BIT NOT NULL CONSTRAINT DF_px_audit_is_test DEFAULT (0);
GO
