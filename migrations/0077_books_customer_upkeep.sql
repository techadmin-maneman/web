-- Migration number: 0077
-- withdrawn: deploy-staging run 37150839152 refused main with it, and it has been applied nowhere.
--
-- It landed (#243) in the same lander round as 0077_consents_shown.sql (#241), so main held two migrations
-- numbered 0077 and its migration check failed. Its statements now run as 0078_books_customer_upkeep.sql.

-- A migration must contain a statement, and this one has nothing left to do.
SELECT 1;
