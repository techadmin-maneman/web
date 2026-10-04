-- Migration number: 0090
-- The clients consulted and not fitted since: no first fit, service or replacement done after their last
-- consultation. The Tasks board's First fit to book reads only these, however many clients have been fitted. The
-- code already deployed reads none of it.

CREATE INDEX last_visits_unfitted ON last_visits (consulted_start)
  WHERE visit_start IS NULL OR visit_start < consulted_start;
