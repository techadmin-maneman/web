-- Migration number: 0077
--
-- A payment link carries the reference its payment will have, "MM-2026-0841",
-- which the client reads on Razorpay's page. Links and payments number from
-- one series a year. A link written before this has none, and keeps the
-- visit's ID as its reference at Razorpay. The code already deployed reads
-- none of the new columns.

ALTER TABLE payment_links ADD COLUMN reference TEXT;
ALTER TABLE payment_links ADD COLUMN reference_year INTEGER;
ALTER TABLE payment_links ADD COLUMN reference_number INTEGER;

-- The next number of a year is read across payments and links.
CREATE UNIQUE INDEX payment_links_reference_number ON payment_links (reference_year, reference_number);

-- Razorpay's word that a link is paid names it by its reference.
CREATE UNIQUE INDEX payment_links_reference ON payment_links (reference);
