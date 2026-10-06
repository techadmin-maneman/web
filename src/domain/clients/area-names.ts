// An area's name, as clients read it. serviceable_pincodes.area starts as the shortest of its pincode's post offices
// ("Masjid Moth" for Greater Kailash II, "RAKNPA"), which nobody living there would call it, so clients are shown it
// only once ops have renamed it in Settings · Service area, which sets area_named_by.

/** In SQL, over the serviceable_pincodes row `table`: the name ops gave the area, or null until they give one. */
export const namedArea = (table: string): string =>
  `CASE WHEN ${table}.area_named_by IS NULL THEN NULL ELSE ${table}.area END`;
