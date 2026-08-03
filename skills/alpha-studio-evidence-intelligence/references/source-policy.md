# Evidence source policy

## Priority

1. Exchange, regulator, ministry, court, official statistics, or company filing.
2. Company investor-relations material whose publication time is verifiable.
3. Licensed data vendor or reputable news report that links or clearly identifies the primary source.
4. Analyst commentary, transcript, social media, or market rumor only as a claim to verify.

## Time fields

- `occurredAt`: when the underlying event happened.
- `publishedAt`: when the source first became public.
- `ingestedAt`: when Alpha Studio obtained the item.
- `earliestTradableAt`: first A-share session/time at which a strategy could act on it.

All values use ISO 8601. If a precise time is unknown, use the least precise defensible value and add `timestamp_imprecise`.

## Quality flags

Use: `primary_source`, `secondary_source`, `timestamp_imprecise`, `machine_extracted`, `conflicting_sources`, `paywalled`, `rumor_unverified`, `translation`, `future_leakage_risk`, or `stale`.

`confidence` rates how directly the facts are supported, not how likely the investment conclusion is.
