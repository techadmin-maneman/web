-- Hair systems in stock (docs/decisions/0156-hair-systems-in-stock.md): a stock code for each product, base size, colour,
-- grey and density kept, counted in pieces in the consumables' ledger. Its consumables row holds its name, cost and
-- levels, so transfers, counts, losses and low stock take it as any consumable; this row holds its spec, which no two
-- share, matched exactly against a client's hair profile.
CREATE TABLE hair_systems (
  code TEXT PRIMARY KEY REFERENCES consumables (code),
  -- The tier of the first-fit service it is sold as, as the hair profile names a product.
  product TEXT NOT NULL,
  -- In inches, to one decimal, as the hair profile records the base.
  base_width_in REAL NOT NULL CHECK (base_width_in > 0),
  base_length_in REAL NOT NULL CHECK (base_length_in > 0),
  -- The suppliers' colour code, #1B written 1B (src/policy/hair-profile.ts).
  colour TEXT NOT NULL,
  grey_percent INTEGER NOT NULL CHECK (grey_percent BETWEEN 0 AND 100),
  density_percent INTEGER NOT NULL CHECK (density_percent > 0),
  UNIQUE (product, base_width_in, base_length_in, colour, grey_percent, density_percent)
);
