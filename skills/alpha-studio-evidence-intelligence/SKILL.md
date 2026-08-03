---
name: alpha-studio-evidence-intelligence
description: Build point-in-time-correct, source-traceable A-share research evidence records with facts separated from interpretations. Use when verifying a company, theme, catalyst, risk, financial claim, policy event, or disputed market narrative; when preparing evidence for a company Thesis; or when an Alpha Studio workflow needs auditable `alpha.evidence.v1` JSON.
---

# Alpha Studio Evidence Intelligence

Turn research claims into reusable evidence rather than another narrative report.

## Workflow

1. Define the claim, covered securities, and decision time. Do not broaden the question silently.
2. Search primary, time-stamped sources first: exchange filings, company announcements, regulator or ministry releases, official statistics, then reputable secondary reporting.
3. Record `occurredAt`, `publishedAt`, `ingestedAt`, and `earliestTradableAt` separately. Never use information before it was tradable.
4. Separate literal source-supported `facts` from analyst `interpretations`. Record material conflicts in `contradictions` instead of averaging them away.
5. Assign source kind, authority, confidence, and quality flags using [source-policy.md](references/source-policy.md).
6. Emit a concise human summary followed by exactly one fenced JSON object using schema `alpha.evidence.v1`.
7. Run `python scripts/validate_evidence.py <record.json>` when the JSON is written to a file. Fix every validation error before handoff.

## Output Contract

Return one object with:

- `schema`: `alpha.evidence.v1`
- `records`: non-empty evidence records
- each record: `id`, `subjectCodes`, `eventType`, four timestamps, `source`, `facts`, `interpretations`, `contradictions`, `qualityFlags`, `confidence`, and `contentHash`
- `source`: `title`, `url`, `kind`, `authority`

Use stable IDs and content hashes when updating an already-known item. Omit unsupported precision; do not invent URLs, dates, quotations, prices, or financial values.

## Alpha Studio Integration

Treat the Evidence Center as the shared upstream layer. Company Thesis records should cite evidence IDs. Daily theme, intraday monitor, and report review may reuse evidence, but must preserve the original information timestamps and source URL.
