-- The schema the nightly reporting copy writes (docs/decisions/0146-the-nightly-analytics-copy.md), in the analytics
-- project's Postgres on Supabase. The API writes as analytics_writer, which may read and write these tables and
-- nothing else; Zoho Analytics reads as zoho_reader, through the reporting views. On Supabase both roles log in,
-- with passwords set there; elsewhere they are made here, without a login. Applied by npm run warehouse:migrate.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_writer') THEN
    CREATE ROLE analytics_writer NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'zoho_reader') THEN
    CREATE ROLE zoho_reader NOLOGIN;
  END IF;
END $$;

CREATE SCHEMA analytics;

-- Who may see which places' figures, from the console's staff grants: Zoho's row-level sharing reads it.

CREATE TABLE analytics.access (
  email text NOT NULL,
  department text NOT NULL,
  level text NOT NULL,
  geography text NOT NULL,
  place text NOT NULL DEFAULT ''::text,
  CONSTRAINT access_pkey PRIMARY KEY (email, department, geography, place)
);

-- The shared tables a dashboard slices by. A client is a key, an HMAC of our ID, never a name or a number.

CREATE TABLE analytics.dim_area (
  area_key text NOT NULL,
  area text NOT NULL,
  city text NOT NULL,
  served boolean NOT NULL,
  CONSTRAINT dim_area_pkey PRIMARY KEY (area_key)
);

CREATE TABLE analytics.dim_campaign (
  campaign_key text NOT NULL,
  channel text NOT NULL,
  source text,
  medium text,
  campaign text,
  city text,
  CONSTRAINT dim_campaign_pkey PRIMARY KEY (campaign_key)
);

CREATE TABLE analytics.dim_channel (
  channel text NOT NULL,
  channel_group text NOT NULL,
  sort integer NOT NULL,
  CONSTRAINT dim_channel_pkey PRIMARY KEY (channel)
);

CREATE TABLE analytics.dim_city (
  city text NOT NULL,
  zone text,
  served boolean NOT NULL,
  active boolean NOT NULL,
  CONSTRAINT dim_city_pkey PRIMARY KEY (city)
);

CREATE TABLE analytics.dim_client (
  client_key text NOT NULL,
  first_lead_date date,
  first_fit_date date,
  cohort_month date,
  first_fit_city text,
  channel text NOT NULL,
  campaign_key text,
  referred boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT dim_client_pkey PRIMARY KEY (client_key)
);

CREATE TABLE analytics.dim_date (
  day date NOT NULL,
  week_start date NOT NULL,
  month_start date NOT NULL,
  quarter text NOT NULL,
  financial_year text NOT NULL,
  weekday smallint NOT NULL,
  weekday_name text NOT NULL,
  CONSTRAINT dim_date_pkey PRIMARY KEY (day)
);

CREATE TABLE analytics.dim_item (
  item_code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  unit_cost numeric(12,2),
  CONSTRAINT dim_item_pkey PRIMARY KEY (item_code)
);

CREATE TABLE analytics.dim_service (
  service_key text NOT NULL,
  kind text NOT NULL,
  tier text NOT NULL,
  name text NOT NULL,
  minutes integer NOT NULL,
  half_slots integer NOT NULL,
  CONSTRAINT dim_service_pkey PRIMARY KEY (service_key)
);

CREATE TABLE analytics.dim_stock_place (
  place_key text NOT NULL,
  kind text NOT NULL,
  city text,
  technician_key text,
  CONSTRAINT dim_stock_place_pkey PRIMARY KEY (place_key)
);

CREATE TABLE analytics.dim_technician (
  technician_key text NOT NULL,
  name text NOT NULL,
  city text,
  active boolean NOT NULL,
  first_day date,
  last_day date,
  CONSTRAINT dim_technician_pkey PRIMARY KEY (technician_key)
);

-- A row for each thing that happened, or each day or month of it. updated_at moves only when a row's values change,
-- so Zoho fetches only what changed.

CREATE TABLE analytics.fact_capacity (
  day date NOT NULL,
  technician_key text NOT NULL,
  city text,
  half_slots_open integer NOT NULL,
  half_slots_taken integer NOT NULL,
  on_leave boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_capacity_pkey PRIMARY KEY (day, technician_key)
);

CREATE TABLE analytics.fact_care (
  case_key text NOT NULL,
  kind text NOT NULL,
  city text,
  task_group text,
  opened_date date NOT NULL,
  closed_date date,
  closed_without_doing boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_care_pkey PRIMARY KEY (case_key)
);

CREATE TABLE analytics.fact_client_month (
  month date NOT NULL,
  client_key text NOT NULL,
  city text,
  channel text,
  cohort_month date,
  state text NOT NULL,
  visits integer NOT NULL DEFAULT 0,
  revenue numeric(12,2) NOT NULL DEFAULT 0,
  margin numeric(12,2),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_client_month_pkey PRIMARY KEY (month, client_key)
);

CREATE TABLE analytics.fact_credit (
  entry_key text NOT NULL,
  entry_date date NOT NULL,
  client_key text,
  city text,
  kind text NOT NULL,
  visits integer NOT NULL,
  value numeric(12,2),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_credit_pkey PRIMARY KEY (entry_key)
);

CREATE TABLE analytics.fact_lead (
  lead_key text NOT NULL,
  lead_date date NOT NULL,
  client_key text,
  city text,
  area_key text,
  channel text NOT NULL,
  campaign_key text,
  landing_page text,
  source text,
  consultation_booked_date date,
  consultation_done_date date,
  first_fit_paid_date date,
  first_fit_done_date date,
  lost_reason text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_lead_pkey PRIMARY KEY (lead_key)
);

CREATE TABLE analytics.fact_message_day (
  day date NOT NULL,
  kind text NOT NULL,
  sent integer NOT NULL DEFAULT 0,
  delivered integer NOT NULL DEFAULT 0,
  read integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_message_day_pkey PRIMARY KEY (day, kind)
);

CREATE TABLE analytics.fact_payment (
  payment_key text NOT NULL,
  payment_date date NOT NULL,
  client_key text,
  city text,
  visit_key text,
  kind text NOT NULL,
  tier text,
  method text,
  amount numeric(12,2) NOT NULL,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  gst numeric(12,2) NOT NULL DEFAULT 0,
  refunded numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_payment_pkey PRIMARY KEY (payment_key)
);

CREATE TABLE analytics.fact_piece (
  piece_key text NOT NULL,
  fitted_date date,
  due_date date,
  client_key text,
  technician_key text,
  city text,
  base text,
  lot text,
  failed_date date,
  failure_reason text,
  replacement_booked boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_piece_pkey PRIMARY KEY (piece_key)
);

CREATE TABLE analytics.fact_spend (
  spend_key text NOT NULL,
  day date NOT NULL,
  city text,
  channel text NOT NULL,
  campaign_key text,
  amount numeric(12,2) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_spend_pkey PRIMARY KEY (spend_key)
);

CREATE TABLE analytics.fact_stock_movement (
  movement_key text NOT NULL,
  movement_date date NOT NULL,
  place_key text NOT NULL,
  item_code text NOT NULL,
  kind text NOT NULL,
  quantity numeric(12,2) NOT NULL,
  value numeric(12,2),
  visit_key text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_stock_movement_pkey PRIMARY KEY (movement_key)
);

CREATE TABLE analytics.fact_stock_week (
  week_start date NOT NULL,
  place_key text NOT NULL,
  item_code text NOT NULL,
  on_hand numeric(12,2) NOT NULL,
  value numeric(12,2),
  used numeric(12,2) NOT NULL DEFAULT 0,
  expected numeric(12,2) NOT NULL DEFAULT 0,
  alerts integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_stock_week_pkey PRIMARY KEY (week_start, place_key, item_code)
);

CREATE TABLE analytics.fact_target (
  month date NOT NULL,
  city text NOT NULL,
  measure text NOT NULL,
  target numeric(14,2) NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_target_pkey PRIMARY KEY (month, city, measure)
);

CREATE TABLE analytics.fact_visit (
  visit_key text NOT NULL,
  visit_date date NOT NULL,
  client_key text,
  city text,
  technician_key text,
  service_key text,
  kind text NOT NULL,
  tier text,
  booked_on date,
  booking_window text,
  state text NOT NULL,
  outcome text,
  is_done boolean NOT NULL DEFAULT false,
  is_on_time boolean,
  checkin_failed boolean NOT NULL DEFAULT false,
  checkin_waived boolean NOT NULL DEFAULT false,
  minutes integer,
  partial_reason text,
  moves integer NOT NULL DEFAULT 0,
  is_no_show boolean NOT NULL DEFAULT false,
  no_show_charge numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT fact_visit_pkey PRIMARY KEY (visit_key)
);

-- A night's rows, staged as JSON before they are swapped in, and each night's run, which every dashboard shows the
-- time of.

CREATE TABLE analytics.load_rows (
  run_id text NOT NULL,
  table_name text NOT NULL,
  key text NOT NULL,
  "row" jsonb NOT NULL,
  CONSTRAINT load_rows_pkey PRIMARY KEY (run_id, table_name, key)
);

CREATE TABLE analytics.load_run (
  run_id bigserial NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  source text NOT NULL,
  rows_written integer,
  rows_changed integer,
  totals_checked boolean,
  database_bytes bigint,
  notes text,
  CONSTRAINT load_run_pkey PRIMARY KEY (run_id)
);

-- The writer works the copy; the reader reads it, the staged rows and the runs included. A table a later migration
-- adds is granted alike.
GRANT USAGE ON SCHEMA analytics TO analytics_writer, zoho_reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA analytics TO analytics_writer;
GRANT SELECT, USAGE ON ALL SEQUENCES IN SCHEMA analytics TO analytics_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO zoho_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO analytics_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT, USAGE ON SEQUENCES TO analytics_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO zoho_reader;
