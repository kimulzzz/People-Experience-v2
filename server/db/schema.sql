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
  notes                  NVARCHAR(MAX)  NULL
);
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

IF OBJECT_ID(N'dbo.px_custom_survey_questions', N'U') IS NULL
CREATE TABLE dbo.px_custom_survey_questions (       -- Admin-edited question set per SURVEY metric
  metric_id       INT            NOT NULL CONSTRAINT PK_px_custom_questions PRIMARY KEY,
  questions_json  NVARCHAR(MAX)  NOT NULL
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
