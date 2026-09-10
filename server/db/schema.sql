-- ==========================================================
-- CIMB Niaga People Experience (PX) Integrated System
-- Microsoft SQL Server Database Schema (T-SQL DDL)
-- ==========================================================

-- 1. PERIOD MASTER
CREATE TABLE px_periods (
    period_id INT IDENTITY(1,1) PRIMARY KEY,
    period_code VARCHAR(20) NOT NULL UNIQUE, -- e.g. '2024-Q1', '2024-ANNUAL'
    period_name NVARCHAR(100) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BIT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE()
);

-- 2. JOURNEYS & CHECKPOINTS
CREATE TABLE px_journeys (
    journey_id INT PRIMARY KEY, -- 1: Arrival, 2: Connect, 3: Belong, 4: Contribute, 5: Depart
    journey_code VARCHAR(20) NOT NULL UNIQUE,
    journey_name NVARCHAR(50) NOT NULL,
    tagline NVARCHAR(255),
    color VARCHAR(10) DEFAULT '#ED1C24',
    icon VARCHAR(30) DEFAULT 'Users',
    display_order INT NOT NULL
);

CREATE TABLE px_checkpoints (
    checkpoint_id INT IDENTITY(1,1) PRIMARY KEY,
    journey_id INT NOT NULL FOREIGN KEY REFERENCES px_journeys(journey_id),
    checkpoint_name NVARCHAR(100) NOT NULL,
    experience_owner NVARCHAR(100),
    created_at DATETIME DEFAULT GETDATE()
);

-- 3. METRICS MASTER & CONFIGURATION
CREATE TABLE px_metrics (
    metric_id INT IDENTITY(1,1) PRIMARY KEY,
    checkpoint_id INT NOT NULL FOREIGN KEY REFERENCES px_checkpoints(checkpoint_id),
    metric_name NVARCHAR(150) NOT NULL,
    metric_type VARCHAR(20) NOT NULL CHECK (metric_type IN ('SURVEY', 'OUTCOME')),
    scale_type VARCHAR(20) NOT NULL CHECK (scale_type IN ('RATING_5', 'PERCENTAGE', 'QUOTA_COUNT', 'NUMERIC')),
    source_of_data NVARCHAR(100),
    experience_owner NVARCHAR(100),
    default_target_value DECIMAL(10,2) NOT NULL,
    target_display NVARCHAR(50),
    min_alert_threshold DECIMAL(10,2) NOT NULL,
    is_indicative BIT DEFAULT 0,
    is_active BIT DEFAULT 1
);

-- 4. DYNAMIC WEIGHTS PER PERIOD
CREATE TABLE px_metric_weights (
    weight_id INT IDENTITY(1,1) PRIMARY KEY,
    period_id INT NOT NULL FOREIGN KEY REFERENCES px_periods(period_id),
    metric_id INT NOT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    weight_percentage DECIMAL(5,2) NOT NULL DEFAULT 1.00,
    updated_by NVARCHAR(100),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_Period_Metric_Weight UNIQUE (period_id, metric_id)
);

-- 5. RECORDED METRIC SCORES (PER PERIOD)
CREATE TABLE px_metric_scores (
    score_id INT IDENTITY(1,1) PRIMARY KEY,
    period_id INT NOT NULL FOREIGN KEY REFERENCES px_periods(period_id),
    metric_id INT NOT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    raw_value DECIMAL(10,2),
    normalized_score DECIMAL(5,2),
    data_source_type VARCHAR(20) CHECK (data_source_type IN ('AUTO_SYNC', 'MANUAL_INPUT', 'EVENT_AUTO')),
    is_indicative BIT DEFAULT 0,
    notes NVARCHAR(MAX),
    submitted_by NVARCHAR(100),
    updated_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_Period_Metric_Score UNIQUE (period_id, metric_id)
);

-- 6. EVENT MANAGEMENT (SIGNATURE PROGRAMS)
CREATE TABLE px_events (
    event_id VARCHAR(64) PRIMARY KEY,
    period_id INT NULL FOREIGN KEY REFERENCES px_periods(period_id),
    event_name NVARCHAR(200) NOT NULL,
    program_category VARCHAR(50) NOT NULL, -- 'Perspektif', 'D&I', 'Young', 'EVD', 'Other'
    event_date DATETIME NOT NULL,
    event_type VARCHAR(20) CHECK (event_type IN ('HYBRID', 'OFFLINE', 'ONLINE')),
    location NVARCHAR(200),
    target_participants INT DEFAULT 500,
    pre_event_code VARCHAR(50) NOT NULL UNIQUE,
    post_event_code VARCHAR(50) NOT NULL UNIQUE,
    is_attendance_open BIT DEFAULT 1,
    is_feedback_open BIT DEFAULT 1,
    created_by NVARCHAR(100),
    created_at DATETIME DEFAULT GETDATE()
);

-- 7. EVENT ATTENDANCE (VALIDASI NIP & EMAIL)
CREATE TABLE px_event_attendances (
    attendance_id INT IDENTITY(1,1) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL FOREIGN KEY REFERENCES px_events(event_id),
    nip VARCHAR(30) NOT NULL,
    employee_name NVARCHAR(150) NOT NULL,
    cimb_email NVARCHAR(150) NOT NULL,
    directorate NVARCHAR(100),
    division NVARCHAR(100),
    attendance_timestamp DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_Event_NIP UNIQUE (event_id, nip)
);

-- 8. SURVEY QUESTIONS & RESPONSES
CREATE TABLE px_master_survey_questions (
    question_id INT IDENTITY(1,1) PRIMARY KEY,
    question_text NVARCHAR(500) NOT NULL,
    question_type VARCHAR(20) CHECK (question_type IN ('RATING_5', 'TEXT_VERBATIM', 'MULTIPLE_CHOICE')),
    display_order INT NOT NULL,
    is_default BIT DEFAULT 1
);

CREATE TABLE px_event_survey_questions (
    event_question_id INT IDENTITY(1,1) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL FOREIGN KEY REFERENCES px_events(event_id),
    source_question_id INT NULL FOREIGN KEY REFERENCES px_master_survey_questions(question_id),
    question_text NVARCHAR(500) NOT NULL,
    question_type VARCHAR(20) CHECK (question_type IN ('RATING_5', 'TEXT_VERBATIM', 'MULTIPLE_CHOICE')),
    display_order INT NOT NULL,
    is_mandatory BIT DEFAULT 1
);

CREATE TABLE px_event_survey_responses (
    response_id INT IDENTITY(1,1) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL FOREIGN KEY REFERENCES px_events(event_id),
    nip VARCHAR(30) NOT NULL,
    ratings_json NVARCHAR(MAX), -- JSON string of question_id: rating
    verbatim_text NVARCHAR(MAX),
    submitted_at DATETIME DEFAULT GETDATE(),
    CONSTRAINT UQ_Event_Survey_NIP UNIQUE (event_id, nip)
);

-- 9. EVENT MEDIA GALLERY
CREATE TABLE px_event_media (
    media_id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL FOREIGN KEY REFERENCES px_events(event_id),
    file_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    file_type VARCHAR(20) CHECK (file_type IN ('IMAGE', 'VIDEO')),
    caption NVARCHAR(500),
    ai_generated_description NVARCHAR(MAX),
    highlight_order INT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE()
);

-- 10. ACTION RECOMMENDATION LIBRARY & ALERTS (SLIDE 10)
CREATE TABLE px_action_library (
    action_id INT IDENTITY(1,1) PRIMARY KEY,
    metric_id INT NOT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    checkpoint_id INT NOT NULL FOREIGN KEY REFERENCES px_checkpoints(checkpoint_id),
    gap_condition NVARCHAR(200) NOT NULL,
    recommended_action NVARCHAR(MAX) NOT NULL,
    suggested_initiatives NVARCHAR(MAX),
    created_at DATETIME DEFAULT GETDATE()
);

CREATE TABLE px_dashboard_alerts (
    alert_id INT IDENTITY(1,1) PRIMARY KEY,
    period_id INT NULL FOREIGN KEY REFERENCES px_periods(period_id),
    metric_id INT NOT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    current_score DECIMAL(5,2) NOT NULL,
    target_score DECIMAL(5,2) NOT NULL,
    alert_level VARCHAR(20) CHECK (alert_level IN ('CRITICAL', 'WARNING', 'INFO')),
    ai_summary_narrative NVARCHAR(MAX),
    recommended_action NVARCHAR(MAX),
    is_acknowledged BIT DEFAULT 0,
    created_at DATETIME DEFAULT GETDATE()
);

-- 11. PPT TEMPLATE REPOSITORY
CREATE TABLE px_ppt_templates (
    template_id INT IDENTITY(1,1) PRIMARY KEY,
    template_name NVARCHAR(100) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    color_palette NVARCHAR(100) DEFAULT 'CIMB_OFFICIAL',
    is_active BIT DEFAULT 1,
    uploaded_at DATETIME DEFAULT GETDATE()
);

-- 12. MANUAL SURVEY UPLOAD BATCHES
CREATE TABLE px_survey_manual_uploads (
    upload_id VARCHAR(50) PRIMARY KEY,
    period_id INT NULL FOREIGN KEY REFERENCES px_periods(period_id),
    metric_id INT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    file_name NVARCHAR(255) NOT NULL,
    total_rows INT NOT NULL,
    valid_rows INT NOT NULL,
    invalid_rows INT NOT NULL,
    calculated_avg_score DECIMAL(5,2) NOT NULL,
    uploaded_by NVARCHAR(100) DEFAULT 'HR Admin',
    uploaded_at DATETIME DEFAULT GETDATE()
);

-- 13. MANUAL SURVEY UPLOADED INDIVIDUAL RESPONSES
CREATE TABLE px_survey_uploaded_responses (
    response_id BIGINT IDENTITY(1,1) PRIMARY KEY,
    upload_id VARCHAR(50) NOT NULL FOREIGN KEY REFERENCES px_survey_manual_uploads(upload_id),
    metric_id INT NOT NULL FOREIGN KEY REFERENCES px_metrics(metric_id),
    nip VARCHAR(20) NOT NULL,
    employee_name NVARCHAR(150),
    cimb_email NVARCHAR(150),
    directorate NVARCHAR(100),
    division NVARCHAR(100),
    rating_score DECIMAL(5,2) NOT NULL,
    verbatim_feedback NVARCHAR(MAX),
    survey_date DATE,
    created_at DATETIME DEFAULT GETDATE()
);
