# Settings, and where each lives

Written by `npm run settings` (scripts/lib/settings-doc.ts) from where each is kept; a test fails while it is out of date. To change one, change it where the table says.

## Worker vars

In `wrangler.jsonc`, read at startup and checked by the startup guard (`src/config/settings.ts`). Only what differs by environment, or is a vendor's ID, belongs here.

| Var | Local | Staging | Production |
| --- | --- | --- | --- |
| `ACCESS_OPS_AUD` | — | `c291b99aae607b12ae256176566169e7a50dcfa839ef0834ad807563353dcee4` | `aeb0323bfcacdaac2935265df92982ac031e2175fa6b111878d11dabd6de3773` |
| `ACCESS_PROVIDER` | `stub` | `cloudflare` | `cloudflare` |
| `ANALYTICS_PROVIDER` | `stub` | `none` | `none` |
| `BOOKS_BILL_CONSUMABLES_ACCOUNT` | — | `4242595000000034057` | `4242595000000034057` |
| `BOOKS_BILL_HAIR_SYSTEMS_ACCOUNT` | — | `4242595000000000567` | `4242595000000000567` |
| `BOOKS_GSTIN` | — | — | — |
| `BOOKS_GST_STATE` | — | — | — |
| `BOOKS_ITEM_PUSH` | `false` | `true` | `false` |
| `BOOKS_PROVIDER` | `stub` | `zoho` | `none` |
| `BOOKS_REFUND_ACCOUNT_ID` | — | `4242595000000352005` | — |
| `BOOKS_SAC` | — | — | — |
| `CRM_PROVIDER` | `stub` | `zoho` | `zoho` |
| `ENVIRONMENT` | `local` | `staging` | `production` |
| `GEOCODE_PROVIDER` | `stub` | `google` | `none` |
| `IMAGE_PROVIDER` | `stub` | `youcam` | `youcam` |
| `MESSAGING_ENABLED` | `true` | `true` | `false` |
| `MESSAGING_PROVIDER` | `stub` | `evolution` | `evolution` |
| `PAYMENTS_PROVIDER` | `stub` | `none` | `none` |
| `RAZORPAY_KEY_ID` | — | `rzp_test_Tf1Bf3ElRK6uNQ` | — |
| `REFERRER_NAME_ON_INVITE` | `true` | `true` | `true` |
| `RENDER_DAILY_CEILING` | `20` | `20` | `40` |
| `RESULT_READ_DAILY_CEILING` | `400` | `400` | `800` |
| `RESULT_RETENTION_DAYS` | `3` | `3` | `14` |
| `ROUTES_PROVIDER` | `stub` | `none` | `none` |
| `SELF_SERVE_BOOKING` | `true` | `false` | `false` |
| `SELF_SERVE_CONSULTATIONS` | `true` | `true` | `true` |
| `SERVICE_TOKEN_ACTS_AS` | — | `test-operator@maneman.in` | — |
| `SMS_PROVIDER` | `stub` | `none` | `none` |
| `STAFF_BOOTSTRAP_ADMINS` | `ops@localhost` | `tech@maneman.in,adwate@gmail.com` | `tech@maneman.in,adwate@gmail.com` |
| `TRYON_REFS_URL` | `http://localhost:4321/refs/v1` | `https://maneman.in/refs/v1` | `https://maneman.in/refs/v1` |
| `TURNSTILE_ACCEPT_TEST_TOKEN` | `true` | `true` | `false` |
| `UPLOAD_DAILY_CEILING` | `40` | `40` | `80` |
| `ZOHO_BOOKS_ACCOUNTS_HOST` | — | `accounts.zoho.in` | — |
| `ZOHO_BOOKS_API_HOST` | — | `www.zohoapis.in` | — |
| `ZOHO_BOOKS_ORG_ID` | — | `60088931635` | — |

## Secrets

Set with `wrangler secret put` in each environment (docs/provisioning.md); never in the repository. Locally in `.dev.vars`.

- `ALERT_WEBHOOK_URL`
- `ANALYTICS_CLIENT_KEY`
- `BACKUP_PUBLIC_KEY`
- `EVOLUTION_API_KEY`
- `EVOLUTION_API_URL`
- `EVOLUTION_INSTANCE_NAME`
- `EVOLUTION_WEBHOOK_TOKEN`
- `GOOGLE_MAPS_API_KEY`
- `HEARTBEAT_URL`
- `IP_HASH_SALT`
- `LEAD_WEBHOOK_URL`
- `MESSAGING_ALLOWLIST`
- `MSG91_AUTH_KEY`
- `MSG91_INTEGRATED_NUMBER`
- `MSG91_SMS_TEMPLATE_ID`
- `MSG91_WEBHOOK_TOKEN`
- `OTP_PEPPER`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `RESULT_SIGNING_KEY`
- `SENTRY_DSN`
- `TURNSTILE_SECRET`
- `URGENT_WEBHOOK_URL`
- `YOUCAM_API_KEY`
- `ZOHO_ACCOUNTS_HOST`
- `ZOHO_API_HOST`
- `ZOHO_BOOKS_CLIENT_ID`
- `ZOHO_BOOKS_CLIENT_SECRET`
- `ZOHO_BOOKS_REFRESH_TOKEN`
- `ZOHO_CLIENT_ID`
- `ZOHO_CLIENT_SECRET`
- `ZOHO_LAR_ID`
- `ZOHO_REFRESH_TOKEN`

## Fixed limits

In `src/config/limits.ts`: the same everywhere. Only a local run may raise one, with a var of the same name.

| Limit | Figure |
| --- | --- |
| `OTP_MOBILE_DAILY_LIMIT` | 5 |
| `OTP_IP_HOURLY_LIMIT` | 10 |
| `OTP_DAILY_CEILING` | 300 |
| `OTP_TECH_DAILY_CEILING` | 100 |
| `LEAD_MOBILE_DAILY_LIMIT` | 15 |
| `LEAD_IP_DAILY_LIMIT` | 100 |
| `TRYON_UPLOAD_IP_HOURLY_LIMIT` | 5 |
| `TRYON_GENERATE_IP_HOURLY_LIMIT` | 5 |
| `TRYON_CLAIM_MOBILE_DAILY_LIMIT` | 3 |
| `RESULT_MESSAGE_MOBILE_DAILY_LIMIT` | 3 |
| `GEOCODE_DAILY_CEILING` | 200 |

## Per-environment constants

In `src/config/environments.ts`: hosts, origins and resource names, which change only with the infrastructure.

| Constant | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | `summer-math-0275.cloudflareaccess.com` |
| `CLIENT_ORIGIN` | `{"local":"http://app.localhost:4322","staging":"https://app-staging.maneman.in","production":"https://app.maneman.in"}` |
| `ENABLED_SURFACES` | `{"local":["public","client","ops","tech"],"staging":["public","client","ops","tech"],"production":["public"]}` |
| `ENVIRONMENTS` | `["local","staging","production"]` |
| `EXPECTED_DATABASE_NAME` | `{"local":"maneman-local","staging":"maneman-staging","production":"maneman-prod"}` |
| `HOSTNAME` | `{"staging":"staging.maneman.in","production":"maneman.in"}` |
| `OPS_ORIGIN` | `{"local":"http://ops.localhost:4323","staging":"https://ops-staging.maneman.in","production":"https://ops.maneman.in"}` |
| `PUBLIC_ORIGIN` | `{"local":"http://localhost:4321","staging":"https://staging.maneman.in","production":"https://maneman.in"}` |
| `REMOTE_ENVIRONMENTS` | `["staging","production"]` |
| `RESOURCE_TOKEN` | `{"local":"local","staging":"staging","production":"prod"}` |
| `SURFACE_HOSTS` | `{"staging":{"public":"staging.maneman.in","client":"app-staging.maneman.in","ops":"ops-staging.maneman.in","tech":"tech-staging.maneman.in"},"production":{"public":"maneman.in","client":"app.maneman.in","ops":"ops.maneman.in","tech":"tech.maneman.in"}}` |
| `SURFACES` | `["public","client","ops","tech"]` |
| `TURNSTILE_HOSTS` | `{"staging":["staging.maneman.in","app-staging.maneman.in"],"production":["maneman.in","www.maneman.in","app.maneman.in"]}` |
| `ZONE_ID` | `d33891be281c088bf3e0e927d7ed20f9` |
| `ZONE_NAME` | `maneman.in` |

## Rules ops set

In the console, Settings · Rules: kept in D1 (`ops_settings`), in force from the next request. The committed figure stands until ops set one (`src/policy/ops-settings.ts`); `daily_ceilings` shows each environment's own figures until then.

| Rule | Title | Unit | Committed figure |
| --- | --- | --- | --- |
| `checkin_radius_m` | Check-in radius | metres | `200` |
| `no_show_wait_min` | No-show wait | minutes | `{"consultation":15,"service":15,"replacement":15,"first_fit":15}` |
| `change_notice_hours` | Free to move or cancel until | hours before the window | `24` |
| `late_change_charge` | Late move or cancel charge | a choice | `{"consultation":"nothing","first_fit":"late_fee","replacement":"late_fee","service":"visit"}` |
| `no_show_charge` | No-show charge | a choice | `{"consultation":"nothing","first_fit":"late_fee","replacement":"late_fee","service":"visit"}` |
| `no_show_waiver` | No-show waiver | a choice | `{"payment":"refunded","credit":"returned"}` |
| `address_unlock_hour` | Address unlock | hour of the day, in India | `18` |
| `reminder_hour` | Reminder time | hour of the day, in India | `18` |
| `phone_clock` | Phone clock limits | minutes | `{"before_start":60,"held_offline":24}` |
| `task_sla_hours` | Task deadlines | hours | `{"untold_move":4,"move_unanswered":4,"visit_left_open":24,"unassigned_visit":24,"recall_call":24,"unanswered_chat":24,"city_matter":24,"remedy_approval":24,"leave_conflict":48,"address_to_confirm":48,"consultation_request":48,"first_fit_to_book":48,"replacement_order":48,"stock_at_risk":48,"at_risk_client":48,"partial_visit":48,"referral_review":48,"no_show_decision":48,"no_show_dispute":48,"number_change":48,"erasure_request":720,"grievance":720,"draft_invoice":48,"payment_owed":48,"upi_due":12,"payment_to_refund":24}` |
| `task_lapse_days` | Tasks lapse after | days | `60` |
| `piece_cycle_days` | Replacement cycle | days | `{"default":180}` |
| `payment_hold` | Payment hold | minutes | `{"countdown":10,"grace":2}` |
| `dispute_window_days` | Dispute window | days | `30` |
| `technician_work` | Technician figures | days | `{"period":90,"over_by":15}` |
| `booking_days` | Booking and next visits | days | `{"first_fit_lead":0,"service_cadence":30,"reminder_before_due":7,"at_risk_after_due":7,"first_fit_to_book":7,"horizon":45,"invoice_prompt":14,"replacement_order_lead":30}` |
| `referral_reward` | Referral reward | service visits | `{"referrer_visits":3,"friend_visits":3,"valid_days":365}` |
| `care_hours` | Customer Care hours | hour of the day, in India | `{"opens":9,"closes":21,"first_reply":60,"answered_by":10}` |
| `remedy_limit` | Remedies without approval | service visits | `{"visits":1,"days":90}` |
| `lost_after_days` | Lost after | days | `90` |
| `payment_links` | Payment links | hours | `{"holds_hours":24,"closes_before_hours":2,"pay_within_days":14}` |
| `arrival_notice_min` | Arrival message | minutes | `10` |
| `move_proposal_hours` | Move proposals | hours | `48` |
| `credit_reminder_days` | Free visit reminders | days | `{"first":30,"last":7}` |
| `check_in_days` | Check-ins after a fit | days | `{"first":2,"second":21}` |
| `referral_monthly_cap` | Referral review above | fits a month | `5` |
| `tryon_look_days` | Try-on looks | days | `30` |
| `stock_watch` | Stock alerts | days | `{"expiry_warning_days":30,"demand_days":28,"transfer_overdue_days":7}` |
| `stock_usage` | Usage flags | days | `{"days":28,"over_percent":20,"min_visits":5,"write_offs":3}` |
| `stock_quality` | Quality figures | days | `{"failure_days":365,"pace_days":28}` |
| `cycle_counts` | Cycle counts | days | `{"weekly":7,"monthly":30,"quarterly":90,"recount_above_percent":5}` |
| `kit_check` | Tomorrow's kits | hour of the day, in India | `{"from_hour":17,"one_visit_range":5,"top_up_weekday":0}` |
| `scorecard_days` | Supplier scorecard | days | `365` |
| `po_second_approval_above_rupees` | Second approver above | rupees | `0` |
| `po_rupees_to_one` | Rupees to one, for approvals | rupees | `{"default":0}` |
| `custom_order_grace_days` | Custom order grace | days | `7` |
| `planning_period_days` | Planning period | days | `7` |
| `planning_horizon_periods` | Forecast horizon | periods | `12` |
| `forecast_assumptions` | Forecast assumptions | days | `{"baseline_periods":8,"learning_days":180,"enough_to_learn":10,"due_booking_percent":80,"consultation_fit_percent":50,"consultation_to_fit_days":14}` |
| `daily_ceilings` | Daily ceilings | a day | `{"upload":80,"render":40,"result_read":800,"login_code":300,"tech_code":100,"form_code":300,"geocode":200,"route":1000,"route_map":300}` |

## Dated tables

In D1, each row from a day on, so a document already issued keeps what was true then (docs/decisions/0061-ops-editable-inputs.md).

| Table | Holds | Changed in the console under |
| --- | --- | --- |
| `price_book` | Each product's price, from a day on | Prices |
| `city_prices` | A city's own price for a product, from a day on | Cities |
| `services` | The services sold, and the Books item each is invoiced on | Prices |
| `serviceable_pincodes` | The pincodes served, and each one's city | Areas |
| `slot_times` | The booking windows' times, from a day on | none yet: a migration |
| `visit_blackouts` | The days closed everywhere | Settings · Blackouts |
| `city_blackouts` | The days one city alone is closed, for a local holiday | Settings · Blackouts |
| `checklist_items` | The job sheet's checklist, in the technician's and the client's words | Settings · Job sheet |
| `partial_reasons` | Why a visit is left partly done | Settings · Job sheet |
| `lost_reasons` | Why a lead is lost | Settings · Job sheet |
| `word_versions` | The words the site and the apps show, as ops edit them | Words |
