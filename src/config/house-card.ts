// The house referral card: the card an invite shows until its referrer makes
// their own, and once they take it down. It is two static files of the site's,
// both written by scripts/build/make-house-card.ts and replaced together when the
// real card is supplied: site/public/images/invite-house.jpg, which previews and
// the API's redirect show, and invite-house.webp, which the invite's page draws.
//
// Chats and browsers cache the card by its address, so every address of it
// carries its version: a new card needs a new version here.
// test/node/site/site-content.test.ts fails if either file changes and this does
// not.

export const HOUSE_CARD_VERSION = 3;
export const HOUSE_CARD = `/images/invite-house.jpg?v=${String(HOUSE_CARD_VERSION)}`;

/**
 * The same card as the invite's page draws it, in WebP at under half the JPEG's bytes: on a phone it is the page's
 * largest paint. Chats' previews keep the JPEG, which every one of them reads.
 */
export const HOUSE_CARD_PAGE = `/images/invite-house.webp?v=${String(HOUSE_CARD_VERSION)}`;
