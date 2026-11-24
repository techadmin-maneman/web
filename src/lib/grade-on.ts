// A technician's pay grade on a day (docs/decisions/0311-dated-technician-grades.md): the last grade they were given
// from that day or before. Every reader of a grade reads it so, never technicians.pay_grade_id, which is kept only
// for the release before.

/** In SQL, the grade in force for the technician `technician` on the India date `day`, both SQL expressions. */
export const gradeOnSql = (technician: string, day: string): string =>
  `(SELECT tg.grade_id FROM technician_grades tg WHERE tg.technician_id = ${technician} AND tg.effective_from <= ${day}
    ORDER BY tg.effective_from DESC LIMIT 1)`;
