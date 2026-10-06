/** Whether the client `person` names has been fitted: a first fit, or any visit after one, has been done. As SQL. */
export const fittedSql = (person: string): string => `EXISTS (SELECT 1 FROM appointments a
  WHERE a.person_id = ${person} AND a.deleted_at IS NULL
  AND a.window_start IS NOT NULL AND a.window_end IS NOT NULL AND a.status = 'completed'
  AND a.type IN ('first_fit', 'service', 'replacement'))`;

/** Whether the client ?1 has been fitted. */
export const FITTED = fittedSql("?1");
