-- Migration number: 0192
-- Every hair system named as one is made now: the first fit it is sold as, then its spec with each part labelled,
-- "Mane Man Celebrity · 8 × 10 in · #1 · 0% grey · 120% density". Some were named before that, or before their first
-- fit was renamed, and read "Mane Man NatMax 8x10 1, 0% grey, 120%". Data alone: no table changes shape.
UPDATE consumables
SET name = (
  SELECT
    s.name || ' · ' || printf('%g', h.base_width_in) || ' × ' || printf('%g', h.base_length_in) || ' in · #' ||
    h.colour || ' · ' || h.grey_percent || '% grey · ' || h.density_percent || '% density'
  FROM hair_systems h
  JOIN services s ON s.kind = 'first_fit' AND s.tier = h.product
  WHERE h.code = consumables.code
)
WHERE code IN (
  SELECT h.code FROM hair_systems h JOIN services s ON s.kind = 'first_fit' AND s.tier = h.product
);
