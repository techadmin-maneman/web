-- What a count reads at a place: every item it holds any of, below zero as well, so a count can put a negative
-- balance right. stock_balances_by_place, which reads only those above zero, is dropped once no deployed code names it.
CREATE INDEX stock_balances_counted ON stock_balances (place, consumable_code) WHERE quantity <> 0;
