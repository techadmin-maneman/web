-- Migration number: 0085
-- A check-in that passed is the row of the job event it landed as: written in the event's own batch, once however
-- often the phone sends it, and only once the event lands. A no-show's wait runs only from a check-in whose event is
-- still standing. A check-in that failed the geofence lands no event, and names none.
--
-- Each check-in already recorded is linked to the event it landed as, by the technician and the time the event
-- carries; where the phone sent it more than once, the first row is linked and the rest are not. The Worker already
-- deployed writes no link, and the code it ships with reads only linked rows.

ALTER TABLE checkins ADD COLUMN job_event_id TEXT REFERENCES job_events (id);

UPDATE checkins SET job_event_id = (
  SELECT e.id FROM job_events e
  WHERE e.appointment_id = checkins.appointment_id AND e.technician_id = checkins.technician_id
    AND e.kind = 'check_in' AND json_extract(e.body, '$.at') = checkins.at
  ORDER BY e.superseded, e.received_at, e.rowid LIMIT 1)
WHERE passed = 1 AND rowid = (
  SELECT MIN(c.rowid) FROM checkins c
  WHERE c.appointment_id = checkins.appointment_id AND c.technician_id = checkins.technician_id
    AND c.passed = 1 AND c.at = checkins.at);

CREATE UNIQUE INDEX checkins_one_per_job_event ON checkins (job_event_id) WHERE job_event_id IS NOT NULL;
