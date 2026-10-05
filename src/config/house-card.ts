// The house referral card: the card an invite shows until its referrer makes
// their own, and once they take it down. It is a static file of the site's
// (site/public/images/invite-house.jpg), replaced at the same path when the owner
// supplies the real card (docs/open-points.md, "The house referral card").
//
// Chats cache a link's preview by its address, so every address of the card
// carries its version, the API's redirect to it as well as the site's pages: a
// new card needs a new version here. test/node/site/site-content.test.ts fails if
// the file changes and this does not.

export const HOUSE_CARD_VERSION = 2;
export const HOUSE_CARD = `/images/invite-house.jpg?v=${String(HOUSE_CARD_VERSION)}`;
