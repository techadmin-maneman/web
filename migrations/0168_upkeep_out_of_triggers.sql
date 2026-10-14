-- Migration number: 0168
-- A visit's derived state is kept by the code that writes it (visitUpkeep), so the nineteen triggers that kept it go.
-- contract: docs/decisions/0199-derived-state-in-the-domain.md

DROP TRIGGER appointments_board_added;
DROP TRIGGER appointments_board_changed;
DROP TRIGGER appointments_board_taken_out;
DROP TRIGGER appointments_consultation_booked_added;
DROP TRIGGER appointments_consultation_booked_changed;
DROP TRIGGER appointments_consultation_booked_taken_out;
DROP TRIGGER appointments_first_fit_books_one_visit_added;
DROP TRIGGER appointments_first_fit_books_one_visit_changed;
DROP TRIGGER appointments_followed_up_added;
DROP TRIGGER appointments_followed_up_changed;
DROP TRIGGER appointments_followed_up_taken_out;
DROP TRIGGER appointments_last_visits_added;
DROP TRIGGER appointments_last_visits_changed;
DROP TRIGGER appointments_last_visits_taken_out;
DROP TRIGGER appointments_replacement_booked_added;
DROP TRIGGER appointments_replacement_booked_changed;
DROP TRIGGER appointments_replacement_booked_taken_out;
DROP TRIGGER people_client_by_visit;
DROP TRIGGER people_client_by_visit_given;
