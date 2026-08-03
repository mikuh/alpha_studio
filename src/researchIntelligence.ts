import { loadLocalStoreSnapshot, scheduleLocalStoreCommit } from './localStore';

export const EVIDENCE_SCHEMA = 'alpha.evidence.v1';
export const COMPANY_THESIS_SCHEMA = 'alpha.company_thesis.v1';
export const EVIDENCE_RECORDS_KEY = 'alpha-studio.evidence-records.v1';
export const COMPANY_THESES_KEY = 'alpha-studio.company-theses.v1';
export const EVIDENCE_CHANGED_EVENT = 'alpha:evidence-changed';
export const COMPANY_THESES_CHANGED_EVENT = 'alpha:company-theses-changed';

export interface EvidenceSource {
  title: string;
  url: string;
  kind: string;
  authority: string;
}

export interface EvidenceRecord {
  id: string;
  subjectCodes: string[];
  eventType: string;
  occurredAt: string;
  publishedAt: string;
  ingestedAt: string;
  earliestTradableAt: string;
  source: EvidenceSource;
  facts: string[];
  interpretations: string[];
  contradictions: string[];
  qualityFlags: string[];
  confidence: number;
  contentHash: string;
  conversationId?: string;
  messageId?: string;
}

export type ThesisStatus = 'building' | 'strengthened' | 'unchanged' | 'weakened' | 'invalidated' | 'archived';
export type ThesisItem = string | Record<string, unknown>;

export interface CompanyThesisRecord {
  id: string;
  company: { code: string; name: string };
  asOf: string;
  dataCutoff: string;
  status: ThesisStatus;
  version: number;
  previousVersionId?: string;
  coreThesis: ThesisItem[];
  keyMetrics: ThesisItem[];
  valuationAssumptions: ThesisItem[];
  catalysts: ThesisItem[];
  risks: ThesisItem[];
  disconfirmingEvidence: ThesisItem[];
  invalidationConditions: ThesisItem[];
  evidenceIds: string[];
  changeSummary: ThesisItem[];
  nextReviewAt: string;
  conversationId?: string;
  messageId?: string;
}

export interface IntelligenceIngestResult {
  ok: boolean;
  added: number;
  error?: string;
}

function loadArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function saveArray<T>(key: string, value: T[]): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
}

function items(value: unknown): ThesisItem[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' || (item !== null && typeof item === 'object'))
    ? value as ThesisItem[]
    : null;
}

function jsonCandidates(text: string): unknown[] {
  const candidates: unknown[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try {
      candidates.push(JSON.parse(match[1]));
    } catch {
      // Continue to the next fenced object.
    }
  }
  return candidates;
}

function normalizeEvidence(value: unknown, conversationId?: string, messageId?: string): EvidenceRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const sourceRaw = raw.source;
  if (!sourceRaw || typeof sourceRaw !== 'object') return null;
  const source = sourceRaw as Record<string, unknown>;
  const subjectCodes = strings(raw.subjectCodes);
  const facts = strings(raw.facts);
  const interpretations = strings(raw.interpretations);
  const contradictions = strings(raw.contradictions);
  const qualityFlags = strings(raw.qualityFlags);
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : Number.NaN;
  if (
    typeof raw.id !== 'string' || !raw.id
    || typeof raw.eventType !== 'string' || !raw.eventType
    || typeof raw.contentHash !== 'string' || !raw.contentHash
    || !validIso(raw.occurredAt) || !validIso(raw.publishedAt) || !validIso(raw.ingestedAt) || !validIso(raw.earliestTradableAt)
    || Date.parse(raw.earliestTradableAt) < Date.parse(raw.publishedAt)
    || !subjectCodes || !facts?.length || !interpretations || !contradictions || !qualityFlags
    || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
    || !['title', 'url', 'kind', 'authority'].every((field) => typeof source[field] === 'string' && source[field])
  ) return null;
  return {
    id: raw.id,
    subjectCodes: subjectCodes.map((code) => code.trim().toUpperCase()).filter(Boolean),
    eventType: raw.eventType,
    occurredAt: raw.occurredAt,
    publishedAt: raw.publishedAt,
    ingestedAt: raw.ingestedAt,
    earliestTradableAt: raw.earliestTradableAt,
    source: { title: source.title as string, url: source.url as string, kind: source.kind as string, authority: source.authority as string },
    facts,
    interpretations,
    contradictions,
    qualityFlags,
    confidence,
    contentHash: raw.contentHash,
    conversationId,
    messageId,
  };
}

function normalizeThesis(value: unknown, conversationId?: string, messageId?: string): CompanyThesisRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const companyRaw = raw.company;
  if (!companyRaw || typeof companyRaw !== 'object') return null;
  const company = companyRaw as Record<string, unknown>;
  const status = raw.status as ThesisStatus;
  const allowed = new Set<ThesisStatus>(['building', 'strengthened', 'unchanged', 'weakened', 'invalidated', 'archived']);
  const coreThesis = items(raw.coreThesis);
  const keyMetrics = items(raw.keyMetrics);
  const valuationAssumptions = items(raw.valuationAssumptions);
  const catalysts = items(raw.catalysts);
  const risks = items(raw.risks);
  const disconfirmingEvidence = items(raw.disconfirmingEvidence);
  const invalidationConditions = items(raw.invalidationConditions);
  const evidenceIds = strings(raw.evidenceIds);
  const changeSummary = items(raw.changeSummary);
  if (
    typeof raw.id !== 'string' || !raw.id
    || typeof company.code !== 'string' || !company.code || typeof company.name !== 'string' || !company.name
    || !validIso(raw.asOf) || !validIso(raw.dataCutoff) || !validIso(raw.nextReviewAt)
    || !allowed.has(status) || !Number.isInteger(raw.version) || (raw.version as number) < 1
    || !coreThesis?.length || !keyMetrics || !valuationAssumptions || !catalysts || !risks?.length
    || !disconfirmingEvidence || !invalidationConditions?.length || !evidenceIds || !changeSummary?.length
  ) return null;
  return {
    id: raw.id,
    company: { code: company.code.trim().toUpperCase(), name: company.name },
    asOf: raw.asOf,
    dataCutoff: raw.dataCutoff,
    status,
    version: raw.version as number,
    previousVersionId: typeof raw.previousVersionId === 'string' && raw.previousVersionId ? raw.previousVersionId : undefined,
    coreThesis,
    keyMetrics,
    valuationAssumptions,
    catalysts,
    risks,
    disconfirmingEvidence,
    invalidationConditions,
    evidenceIds,
    changeSummary,
    nextReviewAt: raw.nextReviewAt,
    conversationId,
    messageId,
  };
}

export function loadEvidenceRecords(): EvidenceRecord[] {
  return loadArray<EvidenceRecord>(EVIDENCE_RECORDS_KEY);
}

export function saveEvidenceRecords(records: EvidenceRecord[]): EvidenceRecord[] {
  const next = [...records].sort((left, right) => right.publishedAt.localeCompare(left.publishedAt)).slice(0, 2_000);
  saveArray(EVIDENCE_RECORDS_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVIDENCE_CHANGED_EVENT, { detail: next }));
  scheduleLocalStoreCommit('research-evidence', {
    evidenceRecords: next,
    audit: { domain: 'research_intelligence', action: 'evidence.persist', payload: { count: next.length } },
  });
  return next;
}

export function loadCompanyTheses(): CompanyThesisRecord[] {
  return loadArray<CompanyThesisRecord>(COMPANY_THESES_KEY);
}

export function saveCompanyTheses(theses: CompanyThesisRecord[]): CompanyThesisRecord[] {
  const next = [...theses].sort((left, right) => right.asOf.localeCompare(left.asOf)).slice(0, 1_000);
  saveArray(COMPANY_THESES_KEY, next);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(COMPANY_THESES_CHANGED_EVENT, { detail: next }));
  scheduleLocalStoreCommit('company-theses', {
    companyTheses: next,
    audit: { domain: 'research_intelligence', action: 'theses.persist', payload: { count: next.length } },
  });
  return next;
}

export function ingestEvidenceResult(text: string, conversationId?: string, messageId?: string): IntelligenceIngestResult {
  for (const value of jsonCandidates(text)) {
    if (!value || typeof value !== 'object') continue;
    const raw = value as Record<string, unknown>;
    if (raw.schema !== EVIDENCE_SCHEMA || !Array.isArray(raw.records)) continue;
    const parsed = raw.records.map((record) => normalizeEvidence(record, conversationId, messageId));
    if (parsed.some((record) => !record)) return { ok: false, added: 0, error: '证据 JSON 存在无效字段、空事实或时点倒置。' };
    const current = loadEvidenceRecords();
    const byId = new Map(current.map((record) => [record.id, record]));
    let added = 0;
    for (const record of parsed as EvidenceRecord[]) {
      const existing = byId.get(record.id);
      if (existing && existing.contentHash !== record.contentHash) {
        return { ok: false, added: 0, error: `证据 ${record.id} 已存在但内容哈希不同，拒绝覆盖历史。` };
      }
      if (!existing) added += 1;
      byId.set(record.id, existing ?? record);
    }
    saveEvidenceRecords([...byId.values()]);
    return { ok: true, added };
  }
  return { ok: false, added: 0, error: `未找到 ${EVIDENCE_SCHEMA} JSON。` };
}

export function ingestCompanyThesisResult(text: string, conversationId?: string, messageId?: string): IntelligenceIngestResult {
  for (const value of jsonCandidates(text)) {
    if (!value || typeof value !== 'object') continue;
    const raw = value as Record<string, unknown>;
    if (raw.schema !== COMPANY_THESIS_SCHEMA || !Array.isArray(raw.theses)) continue;
    const parsed = raw.theses.map((thesis) => normalizeThesis(thesis, conversationId, messageId));
    if (parsed.some((thesis) => !thesis)) return { ok: false, added: 0, error: 'Thesis JSON 缺少核心逻辑、风险、失效条件或版本字段。' };
    const current = loadCompanyTheses();
    const byId = new Map(current.map((thesis) => [thesis.id, thesis]));
    for (const thesis of parsed as CompanyThesisRecord[]) {
      const existing = byId.get(thesis.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(thesis)) {
        return { ok: false, added: 0, error: `Thesis ${thesis.id} 已存在，拒绝覆盖历史版本。` };
      }
      const latest = current
        .filter((item) => item.company.code === thesis.company.code && item.id !== thesis.id)
        .sort((left, right) => right.version - left.version)[0];
      if (latest && (thesis.version !== latest.version + 1 || thesis.previousVersionId !== latest.id)) {
        return { ok: false, added: 0, error: `${thesis.company.name} 新版本必须为 v${latest.version + 1}，previousVersionId 必须指向 ${latest.id}。` };
      }
      byId.set(thesis.id, existing ?? thesis);
    }
    const added = [...byId.keys()].filter((id) => !current.some((item) => item.id === id)).length;
    saveCompanyTheses([...byId.values()]);
    return { ok: true, added };
  }
  return { ok: false, added: 0, error: `未找到 ${COMPANY_THESIS_SCHEMA} JSON。` };
}

export async function hydrateResearchIntelligenceFromLocalStore(): Promise<void> {
  const snapshot = await loadLocalStoreSnapshot();
  if (!snapshot) return;
  if (snapshot.evidenceRecords?.length) saveArray(EVIDENCE_RECORDS_KEY, snapshot.evidenceRecords);
  if (snapshot.companyTheses?.length) saveArray(COMPANY_THESES_KEY, snapshot.companyTheses);
}

export function thesisItemText(value: ThesisItem): string {
  if (typeof value === 'string') return value;
  const preferred = ['summary', 'label', 'metric', 'name', 'condition', 'value'];
  const parts = preferred.flatMap((key) => typeof value[key] === 'string' || typeof value[key] === 'number' ? [String(value[key])] : []);
  return parts.length ? parts.join(' · ') : JSON.stringify(value);
}
