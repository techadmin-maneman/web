# 0148. The channel rule

- Status: accepted
- Date: 2026-10-12
- Topic: Platform

## Context

The growth figures split leads, new clients, spend and acquisition cost by channel. The owner ruled that a client keeps the channel of their first lead for life, so cohorts never move between channels. Campaign spend is split by city by a naming rule: each campaign's name starts with its city, or with "national".

## Decision

1. **The channels are the seven the dashboards are built on**: Google Ads, Meta Ads, Referral, Organic search, Direct, Offline and partners, Organic social, each in a group (Paid, Referral, Organic, Direct, Offline).
2. **A lead is a referral or a partner's when the client came through a friend's invite, or a partner's code, before it.** A lead Care save from a chat takes the channel the client told them, asked as "How they found us" (`leads.found_us`). Otherwise a Google click ID or a paid Google tag makes it Google Ads; a paid Meta tag, Meta Ads; a search engine as its source or referrer, Organic search; a social site, or Meta's click ID without a paid tag, Organic social; anything else, Direct.
3. **A client's channel and campaign are their first lead's**, in `dim_client`; a client with no lead on the books came direct.
4. **A campaign is its tag, matched whatever its case or spacing**, with the channel of the first lead that carried it and the city its name starts with, or none.

## Consequences

- A client who does not say how they found us, and came with no tags, is Direct.
- Campaigns not named city-first count as national, and their spend is shared by the cities' leads.
- Tests: `test/node/policy/channels.test.ts`, `test/worker/jobs/analytics-nightly.test.ts`.
