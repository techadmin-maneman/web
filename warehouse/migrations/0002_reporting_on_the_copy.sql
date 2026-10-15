-- Zoho Analytics reads the reporting views, never a table, so what they point at can change under it. Until
-- production carries real activity they read a labelled sample schema, made by hand for building the dashboards,
-- which is not in these files. This points them at the copy, and is applied the night production first carries
-- activity (docs/go-live.md), not before.

CREATE SCHEMA IF NOT EXISTS reporting;
GRANT USAGE ON SCHEMA reporting TO zoho_reader;

DROP VIEW IF EXISTS reporting.access;
CREATE VIEW reporting.access AS SELECT * FROM analytics.access;
DROP VIEW IF EXISTS reporting.dim_area;
CREATE VIEW reporting.dim_area AS SELECT * FROM analytics.dim_area;
DROP VIEW IF EXISTS reporting.dim_campaign;
CREATE VIEW reporting.dim_campaign AS SELECT * FROM analytics.dim_campaign;
DROP VIEW IF EXISTS reporting.dim_channel;
CREATE VIEW reporting.dim_channel AS SELECT * FROM analytics.dim_channel;
DROP VIEW IF EXISTS reporting.dim_city;
CREATE VIEW reporting.dim_city AS SELECT * FROM analytics.dim_city;
DROP VIEW IF EXISTS reporting.dim_client;
CREATE VIEW reporting.dim_client AS SELECT * FROM analytics.dim_client;
DROP VIEW IF EXISTS reporting.dim_date;
CREATE VIEW reporting.dim_date AS SELECT * FROM analytics.dim_date;
DROP VIEW IF EXISTS reporting.dim_item;
CREATE VIEW reporting.dim_item AS SELECT * FROM analytics.dim_item;
DROP VIEW IF EXISTS reporting.dim_service;
CREATE VIEW reporting.dim_service AS SELECT * FROM analytics.dim_service;
DROP VIEW IF EXISTS reporting.dim_stock_place;
CREATE VIEW reporting.dim_stock_place AS SELECT * FROM analytics.dim_stock_place;
DROP VIEW IF EXISTS reporting.dim_technician;
CREATE VIEW reporting.dim_technician AS SELECT * FROM analytics.dim_technician;
DROP VIEW IF EXISTS reporting.fact_capacity;
CREATE VIEW reporting.fact_capacity AS SELECT * FROM analytics.fact_capacity;
DROP VIEW IF EXISTS reporting.fact_care;
CREATE VIEW reporting.fact_care AS SELECT * FROM analytics.fact_care;
DROP VIEW IF EXISTS reporting.fact_client_month;
CREATE VIEW reporting.fact_client_month AS SELECT * FROM analytics.fact_client_month;
DROP VIEW IF EXISTS reporting.fact_credit;
CREATE VIEW reporting.fact_credit AS SELECT * FROM analytics.fact_credit;
DROP VIEW IF EXISTS reporting.fact_lead;
CREATE VIEW reporting.fact_lead AS SELECT * FROM analytics.fact_lead;
DROP VIEW IF EXISTS reporting.fact_message_day;
CREATE VIEW reporting.fact_message_day AS SELECT * FROM analytics.fact_message_day;
DROP VIEW IF EXISTS reporting.fact_payment;
CREATE VIEW reporting.fact_payment AS SELECT * FROM analytics.fact_payment;
DROP VIEW IF EXISTS reporting.fact_piece;
CREATE VIEW reporting.fact_piece AS SELECT * FROM analytics.fact_piece;
DROP VIEW IF EXISTS reporting.fact_spend;
CREATE VIEW reporting.fact_spend AS SELECT * FROM analytics.fact_spend;
DROP VIEW IF EXISTS reporting.fact_stock_movement;
CREATE VIEW reporting.fact_stock_movement AS SELECT * FROM analytics.fact_stock_movement;
DROP VIEW IF EXISTS reporting.fact_stock_week;
CREATE VIEW reporting.fact_stock_week AS SELECT * FROM analytics.fact_stock_week;
DROP VIEW IF EXISTS reporting.fact_target;
CREATE VIEW reporting.fact_target AS SELECT * FROM analytics.fact_target;
DROP VIEW IF EXISTS reporting.fact_visit;
CREATE VIEW reporting.fact_visit AS SELECT * FROM analytics.fact_visit;
DROP VIEW IF EXISTS reporting.load_run;
CREATE VIEW reporting.load_run AS SELECT * FROM analytics.load_run;

GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO zoho_reader;
