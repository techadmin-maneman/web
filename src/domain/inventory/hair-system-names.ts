// A hair system is named for the first fit it is sold as, then its spec (./hair-systems.ts): renaming the package
// renames its hair systems with it, the new name in front of the spec they keep.

/**
 * The rename of a package's hair systems from its first fit's name as it stands to `to`: it reads that name, so it
 * goes in the batch before the first fit's own rename.
 */
export const renamedHairSystems = (db: D1Database, tier: string, to: string, at: Date): D1PreparedStatement =>
  db
    .prepare(
      `UPDATE consumables
       SET name = ?2 || substr(name, length((SELECT name FROM services WHERE kind = 'first_fit' AND tier = ?1)) + 1),
         updated_at = ?3
       WHERE code IN (SELECT code FROM hair_systems WHERE product = ?1)
         AND name LIKE (SELECT name FROM services WHERE kind = 'first_fit' AND tier = ?1) || ' · %'`,
    )
    .bind(tier, to, at.toISOString());
