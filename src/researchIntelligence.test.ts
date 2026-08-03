import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMPANY_THESES_KEY,
  EVIDENCE_RECORDS_KEY,
  ingestCompanyThesisResult,
  ingestEvidenceResult,
  loadCompanyTheses,
  loadEvidenceRecords,
} from './researchIntelligence';

function fenced(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

function thesis(id: string, version: number, previousVersionId?: string) {
  return {
    id,
    company: { code: '600519.XSHG', name: '贵州茅台' },
    asOf: `2026-08-0${version}T08:00:00Z`,
    dataCutoff: `2026-08-0${version}T07:00:00Z`,
    status: version === 1 ? 'building' : 'strengthened',
    version,
    previousVersionId,
    coreThesis: ['核心逻辑'],
    keyMetrics: [],
    valuationAssumptions: [],
    catalysts: [],
    risks: ['需求不及预期'],
    disconfirmingEvidence: [],
    invalidationConditions: ['收入连续两个季度低于阈值'],
    evidenceIds: ['evidence-1'],
    changeSummary: [version === 1 ? '建立覆盖' : '新增证据增强'],
    nextReviewAt: '2026-09-01T08:00:00Z',
  };
}

describe('research intelligence ingestion', () => {
  beforeEach(() => {
    window.localStorage.removeItem(EVIDENCE_RECORDS_KEY);
    window.localStorage.removeItem(COMPANY_THESES_KEY);
  });

  it('stores valid point-in-time evidence and rejects hash-changing overwrite', () => {
    const record = {
      id: 'evidence-1', subjectCodes: ['600519.XSHG'], eventType: 'filing',
      occurredAt: '2026-08-01T00:00:00Z', publishedAt: '2026-08-01T01:00:00Z',
      ingestedAt: '2026-08-01T02:00:00Z', earliestTradableAt: '2026-08-01T02:00:00Z',
      source: { title: '公告', url: 'https://example.com/filing', kind: 'filing', authority: 'primary' },
      facts: ['公司发布公告'], interpretations: [], contradictions: [], qualityFlags: ['primary_source'],
      confidence: 0.95, contentHash: 'hash-1',
    };
    expect(ingestEvidenceResult(fenced({ schema: 'alpha.evidence.v1', records: [record] }))).toMatchObject({ ok: true, added: 1 });
    expect(loadEvidenceRecords()).toHaveLength(1);
    expect(ingestEvidenceResult(fenced({ schema: 'alpha.evidence.v1', records: [{ ...record, contentHash: 'hash-2' }] })).ok).toBe(false);
    expect(loadEvidenceRecords()[0].contentHash).toBe('hash-1');
  });

  it('keeps an append-only company Thesis version chain', () => {
    expect(ingestCompanyThesisResult(fenced({ schema: 'alpha.company_thesis.v1', theses: [thesis('thesis-1', 1)] })).ok).toBe(true);
    expect(ingestCompanyThesisResult(fenced({ schema: 'alpha.company_thesis.v1', theses: [thesis('thesis-3', 3, 'thesis-1')] })).ok).toBe(false);
    expect(ingestCompanyThesisResult(fenced({ schema: 'alpha.company_thesis.v1', theses: [thesis('thesis-2', 2, 'thesis-1')] })).ok).toBe(true);
    expect(loadCompanyTheses().map((item) => item.version).sort()).toEqual([1, 2]);
  });
});
