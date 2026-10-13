-- When each payment link stops taking payment, as Razorpay was told when it was made. How long a link takes payment
-- is ops' to set (payment_links, docs/decisions/0193-the-rest-of-the-rules-in-the-console.md), so a link already sent
-- keeps its own close rather than being judged by the figure in force later. Every link sent so far was open fourteen
-- days.

ALTER TABLE payment_links ADD COLUMN closes_at TEXT;

UPDATE payment_links SET closes_at = strftime('%Y-%m-%dT%H:%M:%fZ', sent_at, '+14 days') WHERE sent_at IS NOT NULL;
