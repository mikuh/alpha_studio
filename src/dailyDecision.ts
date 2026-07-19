import { scheduleLocalStoreCommit } from './localStore';

export const DAILY_DECISION_STATE_KEY = 'alpha-studio.daily-decision.v1';
export const DAILY_DECISION_CHANGED_EVENT = 'alpha-studio:daily-decision-changed';
export const OPEN_DAILY_DECISION_EVENT = 'alpha-studio:open-daily-decision';
export const JOINT_RESEARCH_EVIDENCE_SCHEMA = 'alpha.joint_research_evidence.v1';
export const JOINT_RESEARCH_SCHEMA = 'alpha.joint_research.v1';
export const RECOMMENDATION_RISK_SCHEMA = 'alpha.recommendation_risk.v1';

export type JointResearchStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JointResearchPhase = 'analyst_research' | 'pm_synthesis';
export type RecommendationStatus =
  | 'draft'
  | 'risk_stale'
  | 'risk_ready'
  | 'confirmed'
  | 'deferred'
  | 'rejected'
  | 'source_outdated';
export type RecommendationAction = 'watch' | 'candidate' | 'add_candidate' | 'reduce_candidate' | 'avoid';
export type RecommendationPriority = 'high' | 'medium' | 'low';
export type AiRiskConclusion = 'acceptable' | 'caution' | 'avoid' | 'insufficient_data';

export const RECOMMENDATION_ACTION_LABELS: Record<RecommendationAction, string> = {
  watch: '关注',
  candidate: '纳入候选',
  add_candidate: '增配候选',
  reduce_candidate: '减配候选',
  avoid: '回避',
};

export const RECOMMENDATION_PRIORITY_LABELS: Record<RecommendationPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export const AI_RISK_LABELS: Record<AiRiskConclusion, string> = {
  acceptable: '可接受',
  caution: '谨慎',
  avoid: '建议回避',
  insufficient_data: '数据不足',
};

export interface JointResearchSelection {
  themeId: string;
  themeName: string;
  stockCodes: string[];
  stockNames: string[];
}

export interface JointResearchConclusion {
  summary: string;
  action: RecommendationAction;
  priority: RecommendationPriority;
  mainlineView: string;
  riskView: string;
  pmView: string;
  disagreements: string[];
  thesis: string[];
  counterArguments: string[];
  triggers: string[];
  invalidations: string[];
  suggestedWeight: string;
  priceRange: string;
  reviewAt: string;
  riskConclusion: AiRiskConclusion;
  riskFindings: string[];
  riskMitigations: string[];
}

export interface JointResearchEvidence {
  mainlineView: string;
  riskView: string;
  mainlineFindings: string[];
  riskFindings: string[];
  disagreements: string[];
  dataGaps: string[];
}

export interface JointResearchRun {
  id: string;
  schema: typeof JOINT_RESEARCH_SCHEMA;
  reportId: string;
  reportContentHash: string;
  conversationId: string;
  sourceMessageId?: string;
  selection: JointResearchSelection;
  status: JointResearchStatus;
  phase?: JointResearchPhase;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  evidence?: JointResearchEvidence;
  evidenceSourceMessageId?: string;
  evidenceRepairAttempt?: number;
  evidenceRequestedAt?: string;
  synthesisAttempt?: number;
  synthesisRequestedAt?: string;
  conclusion?: JointResearchConclusion;
  error?: string;
}

export interface ResearchRecommendation {
  id: string;
  reportId: string;
  reportContentHash: string;
  conversationId: string;
  sourceMessageId?: string;
  jointResearchRunId: string;
  themeId: string;
  themeName: string;
  stockCodes: string[];
  stockNames: string[];
  action: RecommendationAction;
  priority: RecommendationPriority;
  suggestedWeight: string;
  priceRange: string;
  reviewAt: string;
  thesis: string[];
  counterArguments: string[];
  triggers: string[];
  invalidations: string[];
  dataCutoff: string;
  userNote: string;
  version: number;
  status: RecommendationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AiRiskAssessment {
  id: string;
  schema: typeof RECOMMENDATION_RISK_SCHEMA;
  recommendationId: string;
  recommendationVersion: number;
  conversationId: string;
  conclusion: AiRiskConclusion;
  summary: string;
  findings: string[];
  mitigations: string[];
  dataGaps: string[];
  assessedAt: string;
}

export type RecommendationEventType =
  | 'created'
  | 'edited'
  | 'risk_created'
  | 'risk_stale'
  | 'confirmed'
  | 'deferred'
  | 'rejected'
  | 'source_outdated';

export interface RecommendationEvent {
  id: string;
  recommendationId: string;
  type: RecommendationEventType;
  createdAt: string;
  note?: string;
  payload?: unknown;
}

export interface DailyDecisionState {
  jointResearchRuns: JointResearchRun[];
  recommendations: ResearchRecommendation[];
  riskAssessments: AiRiskAssessment[];
  recommendationEvents: RecommendationEvent[];
}

export interface ParsedJointResearchResult {
  ok: boolean;
  runId?: string;
  reportId?: string;
  conclusion?: JointResearchConclusion;
  error?: string;
}

export interface ParsedJointResearchEvidence {
  ok: boolean;
  runId?: string;
  reportId?: string;
  evidence?: JointResearchEvidence;
  error?: string;
}

export interface ParsedRiskResult {
  ok: boolean;
  assessment?: Omit<AiRiskAssessment, 'id' | 'assessedAt'>;
  error?: string;
}

const EMPTY_STATE: DailyDecisionState = {
  jointResearchRuns: [],
  recommendations: [],
  riskAssessments: [],
  recommendationEvents: [],
};

export function createDecisionId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadDailyDecisionState(): DailyDecisionState {
  if (typeof window === 'undefined') return { ...EMPTY_STATE };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DAILY_DECISION_STATE_KEY) || '{}') as Partial<DailyDecisionState>;
    return normalizeDailyDecisionState(parsed);
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function hydrateDailyDecisionState(value: unknown): DailyDecisionState {
  const next = normalizeDailyDecisionState(value && typeof value === 'object' ? value as Partial<DailyDecisionState> : {});
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DAILY_DECISION_STATE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(DAILY_DECISION_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

export function saveDailyDecisionState(
  state: DailyDecisionState,
  audit?: { action: string; entityId?: string; payload?: unknown },
): DailyDecisionState {
  const next = normalizeDailyDecisionState(state);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DAILY_DECISION_STATE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(DAILY_DECISION_CHANGED_EVENT, { detail: next }));
  }
  scheduleLocalStoreCommit('daily-decision', {
    jointResearchRuns: next.jointResearchRuns,
    researchRecommendations: next.recommendations,
    aiRiskAssessments: next.riskAssessments,
    recommendationEvents: next.recommendationEvents,
    audit: audit ? { domain: 'daily_decision', ...audit } : undefined,
  });
  return next;
}

export function beginJointResearch(input: Omit<JointResearchRun, 'schema' | 'status' | 'phase' | 'createdAt' | 'updatedAt'>): JointResearchRun {
  const now = new Date().toISOString();
  const run: JointResearchRun = { ...input, schema: JOINT_RESEARCH_SCHEMA, status: 'pending', phase: 'analyst_research', createdAt: now, updatedAt: now };
  const state = loadDailyDecisionState();
  saveDailyDecisionState(
    { ...state, jointResearchRuns: [run, ...state.jointResearchRuns.filter((item) => item.id !== run.id)] },
    { action: 'joint_research.started', entityId: run.id, payload: { reportId: run.reportId, selection: run.selection } },
  );
  return run;
}

export function parseJointResearchEvidence(text: string): ParsedJointResearchEvidence {
  for (const candidate of jsonCandidates(text)) {
    try {
      const raw = JSON.parse(candidate) as Record<string, unknown>;
      if (raw.schema !== JOINT_RESEARCH_EVIDENCE_SCHEMA) continue;
      const runId = textValue(raw.runId || raw.run_id);
      const reportId = textValue(raw.reportId || raw.report_id);
      if (!runId || !reportId) return { ok: false, error: '①⑦研究证据包缺少 runId 或 reportId。' };
      const mainlineView = textValue(raw.mainlineView || raw.mainline_view);
      const riskView = textValue(raw.riskView || raw.risk_view);
      const requiredArrays = [raw.mainlineFindings || raw.mainline_findings, raw.riskFindings || raw.risk_findings, raw.disagreements, raw.dataGaps || raw.data_gaps];
      if (!mainlineView || !riskView || requiredArrays.some((value) => !Array.isArray(value))) {
        return { ok: false, error: '①⑦研究证据包缺少必要的观点或数组字段。' };
      }
      return {
        ok: true,
        runId,
        reportId,
        evidence: {
          mainlineView,
          riskView,
          mainlineFindings: stringList(raw.mainlineFindings || raw.mainline_findings),
          riskFindings: stringList(raw.riskFindings || raw.risk_findings),
          disagreements: stringList(raw.disagreements),
          dataGaps: stringList(raw.dataGaps || raw.data_gaps),
        },
      };
    } catch {
      // Keep looking for the declared evidence schema.
    }
  }
  return { ok: false, error: `最近回复中没有找到 ${JOINT_RESEARCH_EVIDENCE_SCHEMA} JSON。` };
}

export function ingestJointResearchEvidence(text: string, conversationId: string, sourceMessageId?: string): ParsedJointResearchEvidence {
  const parsed = parseJointResearchEvidence(text);
  if (!parsed.ok || !parsed.runId || !parsed.evidence) return parsed;
  const state = loadDailyDecisionState();
  const run = state.jointResearchRuns.find((item) => item.id === parsed.runId);
  if (!run || run.conversationId !== conversationId) return { ok: false, error: '①⑦研究证据包与当前对话不匹配。' };
  if (parsed.reportId !== run.reportId) return { ok: false, error: '①⑦研究证据包与来源日报版本不匹配。' };
  if (run.status !== 'running' && run.status !== 'pending') return { ok: false, error: '联合研判记录已经结束，忽略迟到的证据包。' };
  if (run.phase !== 'analyst_research') return { ok: false, error: '①⑦研究阶段已经结束，忽略重复证据包。' };
  const now = new Date().toISOString();
  saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((item) => item.id === run.id
      ? { ...item, status: 'running', phase: 'pm_synthesis', evidence: parsed.evidence, evidenceSourceMessageId: sourceMessageId, updatedAt: now, error: undefined }
      : item),
  }, { action: 'joint_research.evidence_completed', entityId: run.id, payload: { reportId: run.reportId } });
  return parsed;
}

export function requestJointResearchEvidenceRepair(runId: string, parseError: string): JointResearchRun | null {
  const state = loadDailyDecisionState();
  const current = state.jointResearchRuns.find((run) => run.id === runId);
  if (!current || !['pending', 'running'].includes(current.status) || current.phase !== 'analyst_research') return null;
  const now = new Date().toISOString();
  const next: JointResearchRun = {
    ...current,
    status: 'running',
    evidenceRepairAttempt: (current.evidenceRepairAttempt ?? 0) + 1,
    evidenceRequestedAt: now,
    updatedAt: now,
    error: undefined,
  };
  saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((run) => run.id === runId ? next : run),
  }, { action: 'joint_research.evidence_repair_requested', entityId: runId, payload: { parseError, attempt: next.evidenceRepairAttempt } });
  return next;
}

export function markJointResearchRunning(runId: string): DailyDecisionState {
  const state = loadDailyDecisionState();
  return saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((run) => run.id === runId && run.status === 'pending'
      ? { ...run, status: 'running', updatedAt: new Date().toISOString() }
      : run),
  }, { action: 'joint_research.running', entityId: runId });
}

export function failJointResearch(runId: string, error: string): DailyDecisionState {
  const state = loadDailyDecisionState();
  return saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((run) => run.id === runId
      ? { ...run, status: 'failed', error, updatedAt: new Date().toISOString() }
      : run),
  }, { action: 'joint_research.failed', entityId: runId, payload: { error } });
}

export function parseJointResearchResult(text: string): ParsedJointResearchResult {
  for (const candidate of jsonCandidates(text)) {
    try {
      const raw = JSON.parse(candidate) as Record<string, unknown>;
      if (raw.schema !== JOINT_RESEARCH_SCHEMA) continue;
      const runId = textValue(raw.runId || raw.run_id);
      const reportId = textValue(raw.reportId || raw.report_id);
      if (!runId || !reportId) return { ok: false, error: '联合研判结果缺少 runId 或 reportId。' };
      if (!['watch', 'candidate', 'add_candidate', 'reduce_candidate', 'avoid'].includes(String(raw.action))) {
        return { ok: false, error: '联合研判结果的 action 无效。' };
      }
      if (!['high', 'medium', 'low'].includes(String(raw.priority))) {
        return { ok: false, error: '联合研判结果的 priority 无效。' };
      }
      if (!['acceptable', 'caution', 'avoid', 'insufficient_data'].includes(String(raw.riskConclusion || raw.risk_conclusion))) {
        return { ok: false, error: '联合研判结果的 riskConclusion 无效。' };
      }
      const requiredTexts = [raw.summary, raw.mainlineView || raw.mainline_view, raw.riskView || raw.risk_view, raw.pmView || raw.pm_view];
      const requiredArrays = [raw.disagreements, raw.thesis, raw.counterArguments || raw.counter_arguments, raw.triggers, raw.invalidations, raw.riskFindings || raw.risk_findings, raw.riskMitigations || raw.risk_mitigations];
      if (requiredTexts.some((value) => !textValue(value)) || requiredArrays.some((value) => !Array.isArray(value))) {
        return { ok: false, error: '联合研判结果缺少必要的结论或数组字段。' };
      }
      const conclusion = normalizeJointConclusion(raw);
      return { ok: true, runId, reportId, conclusion };
    } catch {
      // Keep looking for the declared schema.
    }
  }
  return { ok: false, error: `最近回复中没有找到 ${JOINT_RESEARCH_SCHEMA} JSON。` };
}

export function ingestJointResearchResult(text: string, conversationId: string, sourceMessageId?: string): ParsedJointResearchResult {
  const parsed = parseJointResearchResult(text);
  if (!parsed.ok || !parsed.runId || !parsed.conclusion) return parsed;
  const state = loadDailyDecisionState();
  const run = state.jointResearchRuns.find((item) => item.id === parsed.runId);
  if (!run || run.conversationId !== conversationId) return { ok: false, error: '联合研判结果与当前对话不匹配。' };
  if (parsed.reportId !== run.reportId) return { ok: false, error: '联合研判结果与来源日报版本不匹配。' };
  if (run.status !== 'running' && run.status !== 'pending') return { ok: false, error: '联合研判记录已经结束，忽略迟到结果。' };
  if (run.phase !== 'pm_synthesis') return { ok: false, error: '①⑦研究阶段尚未完成，不能提前写入⑧号综合结论。' };
  const now = new Date().toISOString();
  saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((item) => item.id === run.id
      ? { ...item, sourceMessageId, status: 'completed', conclusion: parsed.conclusion, completedAt: now, updatedAt: now, error: undefined }
      : item),
  }, { action: 'joint_research.completed', entityId: run.id, payload: { reportId: run.reportId } });
  return parsed;
}

export function requestJointResearchSynthesis(runId: string, parseError: string): JointResearchRun | null {
  const state = loadDailyDecisionState();
  const current = state.jointResearchRuns.find((run) => run.id === runId);
  if (!current || !['pending', 'running'].includes(current.status) || current.phase !== 'pm_synthesis') return null;
  const now = new Date().toISOString();
  const next: JointResearchRun = {
    ...current,
    status: 'running',
    synthesisAttempt: (current.synthesisAttempt ?? 0) + 1,
    synthesisRequestedAt: now,
    updatedAt: now,
    error: undefined,
  };
  saveDailyDecisionState({
    ...state,
    jointResearchRuns: state.jointResearchRuns.map((run) => run.id === runId ? next : run),
  }, { action: 'joint_research.synthesis_requested', entityId: runId, payload: { parseError, attempt: next.synthesisAttempt } });
  return next;
}

export function createRecommendationFromRun(run: JointResearchRun, dataCutoff: string): ResearchRecommendation | null {
  if (run.status !== 'completed' || !run.conclusion) return null;
  const state = loadDailyDecisionState();
  const existing = state.recommendations.find((item) => item.jointResearchRunId === run.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const recommendation: ResearchRecommendation = {
    id: createDecisionId('rec'),
    reportId: run.reportId,
    reportContentHash: run.reportContentHash,
    conversationId: run.conversationId,
    sourceMessageId: run.sourceMessageId,
    jointResearchRunId: run.id,
    themeId: run.selection.themeId,
    themeName: run.selection.themeName,
    stockCodes: run.selection.stockCodes,
    stockNames: run.selection.stockNames,
    action: run.conclusion.action,
    priority: run.conclusion.priority,
    suggestedWeight: run.conclusion.suggestedWeight,
    priceRange: run.conclusion.priceRange,
    reviewAt: run.conclusion.reviewAt,
    thesis: run.conclusion.thesis,
    counterArguments: run.conclusion.counterArguments,
    triggers: run.conclusion.triggers,
    invalidations: run.conclusion.invalidations,
    dataCutoff,
    userNote: '',
    version: 1,
    status: 'risk_ready',
    createdAt: now,
    updatedAt: now,
  };
  const risk: AiRiskAssessment = {
    id: createDecisionId('risk'),
    schema: RECOMMENDATION_RISK_SCHEMA,
    recommendationId: recommendation.id,
    recommendationVersion: 1,
    conversationId: run.conversationId,
    conclusion: run.conclusion.riskConclusion,
    summary: run.conclusion.riskView,
    findings: run.conclusion.riskFindings,
    mitigations: run.conclusion.riskMitigations,
    dataGaps: [],
    assessedAt: now,
  };
  const event = recommendationEvent(recommendation.id, 'created', undefined, { version: 1 });
  saveDailyDecisionState({
    ...state,
    recommendations: [recommendation, ...state.recommendations],
    riskAssessments: [risk, ...state.riskAssessments],
    recommendationEvents: [event, recommendationEvent(recommendation.id, 'risk_created', undefined, { riskId: risk.id }), ...state.recommendationEvents],
  }, { action: 'recommendation.created', entityId: recommendation.id, payload: { runId: run.id } });
  return recommendation;
}

const MATERIAL_FIELDS: Array<keyof ResearchRecommendation> = [
  'themeId', 'themeName', 'stockCodes', 'stockNames', 'action', 'priority', 'suggestedWeight',
  'priceRange', 'reviewAt', 'thesis', 'counterArguments', 'triggers', 'invalidations',
];

export function updateRecommendation(
  recommendationId: string,
  patch: Partial<ResearchRecommendation>,
): ResearchRecommendation | null {
  const state = loadDailyDecisionState();
  const current = state.recommendations.find((item) => item.id === recommendationId);
  if (!current) return null;
  const material = MATERIAL_FIELDS.some((field) => field in patch && JSON.stringify(patch[field]) !== JSON.stringify(current[field]));
  const next: ResearchRecommendation = {
    ...current,
    ...patch,
    id: current.id,
    version: material ? current.version + 1 : current.version,
    status: material ? 'risk_stale' : patch.status ?? current.status,
    updatedAt: new Date().toISOString(),
  };
  const events = [recommendationEvent(current.id, 'edited', undefined, {
    fromVersion: current.version,
    toVersion: next.version,
    before: recommendationSummary(current),
    after: recommendationSummary(next),
  })];
  if (material) events.unshift(recommendationEvent(current.id, 'risk_stale', '关键字段已修改，需要重新执行 AI 风险评估。'));
  saveDailyDecisionState({
    ...state,
    recommendations: state.recommendations.map((item) => item.id === current.id ? next : item),
    recommendationEvents: [...events, ...state.recommendationEvents],
  }, { action: 'recommendation.edited', entityId: current.id, payload: { material, version: next.version } });
  return next;
}

export function parseRiskAssessmentResult(text: string): ParsedRiskResult {
  for (const candidate of jsonCandidates(text)) {
    try {
      const raw = JSON.parse(candidate) as Record<string, unknown>;
      if (raw.schema !== RECOMMENDATION_RISK_SCHEMA) continue;
      const recommendationId = textValue(raw.recommendationId || raw.recommendation_id);
      const recommendationVersion = numberValue(raw.recommendationVersion || raw.recommendation_version);
      const conversationId = textValue(raw.conversationId || raw.conversation_id);
      if (!recommendationId || !recommendationVersion || !conversationId) {
        return { ok: false, error: '风险评估结果缺少建议编号、版本或对话编号。' };
      }
      if (!['acceptable', 'caution', 'avoid', 'insufficient_data'].includes(String(raw.conclusion))) {
        return { ok: false, error: '风险评估结论无效。' };
      }
      if (!textValue(raw.summary) || !Array.isArray(raw.findings) || !Array.isArray(raw.mitigations) || !Array.isArray(raw.dataGaps || raw.data_gaps)) {
        return { ok: false, error: '风险评估结果缺少摘要或明细数组。' };
      }
      const conclusion = normalizeRiskConclusion(raw.conclusion);
      return {
        ok: true,
        assessment: {
          schema: RECOMMENDATION_RISK_SCHEMA,
          recommendationId,
          recommendationVersion,
          conversationId,
          conclusion,
          summary: textValue(raw.summary),
          findings: stringList(raw.findings),
          mitigations: stringList(raw.mitigations),
          dataGaps: stringList(raw.dataGaps || raw.data_gaps),
        },
      };
    } catch {
      // Keep looking for the declared schema.
    }
  }
  return { ok: false, error: `最近回复中没有找到 ${RECOMMENDATION_RISK_SCHEMA} JSON。` };
}

export function ingestRiskAssessmentResult(text: string, conversationId: string): ParsedRiskResult {
  const parsed = parseRiskAssessmentResult(text);
  if (!parsed.ok || !parsed.assessment) return parsed;
  const state = loadDailyDecisionState();
  const recommendation = state.recommendations.find((item) => item.id === parsed.assessment?.recommendationId);
  if (!recommendation || recommendation.conversationId !== conversationId) return { ok: false, error: '风险评估与当前对话不匹配。' };
  if (recommendation.version !== parsed.assessment.recommendationVersion) return { ok: false, error: '风险评估对应的建议版本已经过期。' };
  const risk: AiRiskAssessment = { ...parsed.assessment, id: createDecisionId('risk'), assessedAt: new Date().toISOString() };
  saveDailyDecisionState({
    ...state,
    recommendations: state.recommendations.map((item) => item.id === recommendation.id
      ? { ...item, status: 'risk_ready', updatedAt: risk.assessedAt }
      : item),
    riskAssessments: [risk, ...state.riskAssessments],
    recommendationEvents: [recommendationEvent(recommendation.id, 'risk_created', undefined, { riskId: risk.id, version: risk.recommendationVersion }), ...state.recommendationEvents],
  }, { action: 'recommendation.risk_assessed', entityId: recommendation.id, payload: { conclusion: risk.conclusion } });
  return parsed;
}

export function currentRiskAssessment(state: DailyDecisionState, recommendation: ResearchRecommendation): AiRiskAssessment | null {
  return state.riskAssessments.find((item) => item.recommendationId === recommendation.id && item.recommendationVersion === recommendation.version) ?? null;
}

export function decideRecommendation(
  recommendationId: string,
  decision: 'confirmed' | 'deferred' | 'rejected',
  input: { note?: string; reviewAt?: string; acknowledged?: boolean },
): { ok: boolean; error?: string; recommendation?: ResearchRecommendation } {
  const state = loadDailyDecisionState();
  const current = state.recommendations.find((item) => item.id === recommendationId);
  if (!current) return { ok: false, error: '没有找到建议卡。' };
  const risk = currentRiskAssessment(state, current);
  const note = input.note?.trim() ?? '';
  if (decision === 'confirmed') {
    if (current.status !== 'risk_ready' || !risk) return { ok: false, error: '请先完成当前版本的 AI 风险评估。' };
    if (!input.acknowledged) return { ok: false, error: '请确认该建议仅供研究，后续需要人工执行。' };
    if ((risk.conclusion === 'avoid' || risk.conclusion === 'insufficient_data') && !note) {
      return { ok: false, error: '当前 AI 风险结论需要填写人工确认理由。' };
    }
  }
  if (decision === 'deferred' && !input.reviewAt?.trim()) return { ok: false, error: '暂缓建议必须设置下次复核时间。' };
  if (decision === 'rejected' && !note) return { ok: false, error: '否决建议必须填写原因。' };
  const now = new Date().toISOString();
  const next: ResearchRecommendation = {
    ...current,
    status: decision,
    userNote: note || current.userNote,
    reviewAt: decision === 'deferred' ? input.reviewAt!.trim() : current.reviewAt,
    updatedAt: now,
  };
  saveDailyDecisionState({
    ...state,
    recommendations: state.recommendations.map((item) => item.id === current.id ? next : item),
    recommendationEvents: [recommendationEvent(current.id, decision, note, { reviewAt: next.reviewAt, version: next.version }), ...state.recommendationEvents],
  }, { action: `recommendation.${decision}`, entityId: current.id, payload: { version: current.version, note } });
  return { ok: true, recommendation: next };
}

export function markOutdatedRecommendations(conversationId: string, currentContentHash: string): DailyDecisionState {
  const state = loadDailyDecisionState();
  const outdatedIds = state.recommendations
    .filter((item) => item.conversationId === conversationId && item.reportContentHash !== currentContentHash && !['confirmed', 'deferred', 'rejected', 'source_outdated'].includes(item.status))
    .map((item) => item.id);
  if (!outdatedIds.length) return state;
  const outdated = new Set(outdatedIds);
  return saveDailyDecisionState({
    ...state,
    recommendations: state.recommendations.map((item) => outdated.has(item.id) ? { ...item, status: 'source_outdated', updatedAt: new Date().toISOString() } : item),
    recommendationEvents: [...outdatedIds.map((id) => recommendationEvent(id, 'source_outdated')), ...state.recommendationEvents],
  }, { action: 'recommendation.source_outdated', payload: { conversationId, currentContentHash, count: outdatedIds.length } });
}

export function buildJointResearchPrompt(input: {
  run: JointResearchRun;
  reportContext: unknown;
  researchContext: string;
}): string {
  return [
    '【联合研判第一阶段｜①⑦并行研究】',
    '请只召集①市场策略官和⑦风险控制官并行研究。此阶段不召集⑧、不形成最终建议卡，也不代表真实下单或正式风控通过。',
    '必须等待①和⑦都完成，再由主调度器把两人的观点整理为下面的结构化证据包；任何单个同事的“已完成”都不能结束本阶段。',
    '',
    `联合研判编号：${input.run.id}`,
    `日报编号：${input.run.reportId}`,
    `日报内容哈希：${input.run.reportContentHash}`,
    `研究对象：${input.run.selection.themeName}${input.run.selection.stockNames.length ? ` / ${input.run.selection.stockNames.join('、')}` : ''}`,
    '',
    '[结构化日报上下文]',
    JSON.stringify(input.reportContext, null, 2),
    '',
    '[当前组合与行情上下文]',
    input.researchContext,
    '',
    '请先简要列出①和⑦各自结论，再在回复正文末尾直接输出且只输出一个符合以下字段的 JSON 代码块：',
    JSON.stringify({
      schema: JOINT_RESEARCH_EVIDENCE_SCHEMA,
      runId: input.run.id,
      reportId: input.run.reportId,
      mainlineView: '①的主线地位、生命周期、催化、持续性和证伪判断',
      riskView: '⑦的组合暴露、拥挤、流动性、事件风险和数据缺口判断',
      mainlineFindings: ['①的关键依据'],
      riskFindings: ['风险发现'],
      disagreements: ['①与⑦的分歧；无分歧可为空数组'],
      dataGaps: ['数据缺口；无缺口可为空数组'],
    }, null, 2),
    '',
    `阶段完成闸门：发送前确认正文含有 “${JOINT_RESEARCH_EVIDENCE_SCHEMA}”，且①和⑦的结果均已纳入。不要输出 ${JOINT_RESEARCH_SCHEMA}，客户端将在证据包验收后另行启动⑧号。`,
  ].join('\n');
}

export function buildJointResearchEvidenceRepairPrompt(run: JointResearchRun, parseError: string): string {
  return [
    '【联合研判第一阶段｜证据包自动修复｜无需用户操作】',
    `①⑦研究轮次已经返回，但证据包验收失败：${parseError}`,
    '请只根据本对话上一轮①和⑦已经产生的意见与产物整理证据包，不再 spawn 同事、不继续检索、不创建或修改文件。',
    `runId 必须为 ${run.id}；reportId 必须为 ${run.reportId}。`,
    '在回复正文末尾直接输出以下 JSON 结构；未知内容使用空数组或“数据不足”，不得删除字段：',
    JSON.stringify({
      schema: JOINT_RESEARCH_EVIDENCE_SCHEMA,
      runId: run.id,
      reportId: run.reportId,
      mainlineView: '①的主线判断或数据不足',
      riskView: '⑦的风险判断或数据不足',
      mainlineFindings: [],
      riskFindings: [],
      disagreements: [],
      dataGaps: [],
    }, null, 2),
  ].join('\n');
}

export function buildRiskAssessmentPrompt(recommendation: ResearchRecommendation): string {
  return [
    `请由⑦风险控制官重新评估研究建议 ${recommendation.id} 的当前版本 v${recommendation.version}。`,
    '这里只做 AI 风险复核，不代表正式风控通过，不执行真实交易。',
    '',
    JSON.stringify(recommendation, null, 2),
    '',
    '请先输出简明风险结论，随后输出且只输出一个符合以下字段的 JSON 代码块：',
    JSON.stringify({
      schema: RECOMMENDATION_RISK_SCHEMA,
      recommendationId: recommendation.id,
      recommendationVersion: recommendation.version,
      conversationId: recommendation.conversationId,
      conclusion: 'acceptable | caution | avoid | insufficient_data',
      summary: '风险摘要',
      findings: ['风险发现'],
      mitigations: ['缓释措施'],
      dataGaps: ['数据缺口'],
    }, null, 2),
  ].join('\n');
}

export function buildJointResearchSynthesisPrompt(run: JointResearchRun, parseError?: string): string {
  return [
    parseError ? '【联合研判第二阶段｜⑧结构化修复｜无需用户操作】' : '【联合研判第二阶段｜⑧综合收口｜系统自动发起】',
    parseError
      ? `⑧号上一轮综合结论验收失败：${parseError}`
      : '①市场策略官与⑦风险控制官的并行研究已经全部完成，并通过客户端证据包验收。',
    '本阶段只召集⑧基金经理副官。请基于下面经过验收的①⑦证据包汇总分歧，形成研究动作和建议卡草稿。不得重新启动①或⑦。',
    '',
    '本轮必须先给一段简洁可读的联合结论，然后在回复正文末尾直接输出一个 JSON 代码块。JSON 不得省略、不得只放在附件或文件里，也不能只回复“⑧已完成”。',
    `联合研判编号必须为：${run.id}`,
    `日报编号必须为：${run.reportId}`,
    `研究对象：${run.selection.themeName}${run.selection.stockNames.length ? ` / ${run.selection.stockNames.join('、')}` : ''}`,
    '',
    '[已验收的①⑦证据包]',
    JSON.stringify(run.evidence ?? {
      mainlineView: '数据不足',
      riskView: '数据不足',
      mainlineFindings: [],
      riskFindings: [],
      disagreements: [],
      dataGaps: ['未取得第一阶段证据包'],
    }, null, 2),
    '',
    '严格使用以下结构；所有数组字段都必须保留，未知信息用空数组或“数据不足”，不要删除字段：',
    JSON.stringify({
      schema: JOINT_RESEARCH_SCHEMA,
      runId: run.id,
      reportId: run.reportId,
      summary: '一句话综合结论',
      action: 'watch | candidate | add_candidate | reduce_candidate | avoid',
      priority: 'high | medium | low',
      mainlineView: '①的主线判断',
      riskView: '⑦的AI风险分析',
      pmView: '⑧的综合取舍',
      disagreements: [],
      thesis: [],
      counterArguments: [],
      triggers: [],
      invalidations: [],
      suggestedWeight: '研究/模拟权重或0%',
      priceRange: '观察价格区间或数据不足',
      reviewAt: '复核时间或数据不足',
      riskConclusion: 'acceptable | caution | avoid | insufficient_data',
      riskFindings: [],
      riskMitigations: [],
    }, null, 2),
    '',
    `完成闸门：发送前确认回复正文含有字符串 “${JOINT_RESEARCH_SCHEMA}”，且 runId/reportId 与上面完全一致。`,
  ].join('\n');
}

function normalizeDailyDecisionState(value: Partial<DailyDecisionState>): DailyDecisionState {
  return {
    jointResearchRuns: Array.isArray(value.jointResearchRuns)
      ? value.jointResearchRuns.map((run) => ({ ...run, phase: run.phase ?? 'pm_synthesis' }))
      : [],
    recommendations: Array.isArray(value.recommendations) ? value.recommendations : [],
    riskAssessments: Array.isArray(value.riskAssessments) ? value.riskAssessments : [],
    recommendationEvents: Array.isArray(value.recommendationEvents) ? value.recommendationEvents : [],
  };
}

function normalizeJointConclusion(raw: Record<string, unknown>): JointResearchConclusion {
  return {
    summary: textValue(raw.summary),
    action: normalizeAction(raw.action),
    priority: normalizePriority(raw.priority),
    mainlineView: textValue(raw.mainlineView || raw.mainline_view),
    riskView: textValue(raw.riskView || raw.risk_view),
    pmView: textValue(raw.pmView || raw.pm_view),
    disagreements: stringList(raw.disagreements),
    thesis: stringList(raw.thesis),
    counterArguments: stringList(raw.counterArguments || raw.counter_arguments),
    triggers: stringList(raw.triggers),
    invalidations: stringList(raw.invalidations),
    suggestedWeight: textValue(raw.suggestedWeight || raw.suggested_weight),
    priceRange: textValue(raw.priceRange || raw.price_range),
    reviewAt: textValue(raw.reviewAt || raw.review_at),
    riskConclusion: normalizeRiskConclusion(raw.riskConclusion || raw.risk_conclusion),
    riskFindings: stringList(raw.riskFindings || raw.risk_findings),
    riskMitigations: stringList(raw.riskMitigations || raw.risk_mitigations),
  };
}

function normalizeAction(value: unknown): RecommendationAction {
  return ['watch', 'candidate', 'add_candidate', 'reduce_candidate', 'avoid'].includes(String(value))
    ? value as RecommendationAction
    : 'watch';
}

function normalizePriority(value: unknown): RecommendationPriority {
  return ['high', 'medium', 'low'].includes(String(value)) ? value as RecommendationPriority : 'medium';
}

function normalizeRiskConclusion(value: unknown): AiRiskConclusion {
  return ['acceptable', 'caution', 'avoid', 'insufficient_data'].includes(String(value))
    ? value as AiRiskConclusion
    : 'insufficient_data';
}

function recommendationEvent(
  recommendationId: string,
  type: RecommendationEventType,
  note?: string,
  payload?: unknown,
): RecommendationEvent {
  return { id: createDecisionId('event'), recommendationId, type, createdAt: new Date().toISOString(), note, payload };
}

function recommendationSummary(recommendation: ResearchRecommendation) {
  return {
    themeName: recommendation.themeName,
    stockCodes: recommendation.stockCodes,
    stockNames: recommendation.stockNames,
    action: recommendation.action,
    priority: recommendation.priority,
    suggestedWeight: recommendation.suggestedWeight,
    priceRange: recommendation.priceRange,
    reviewAt: recommendation.reviewAt,
    triggers: recommendation.triggers,
    invalidations: recommendation.invalidations,
    userNote: recommendation.userNote,
    version: recommendation.version,
    status: recommendation.status,
  };
}

function jsonCandidates(text: string): string[] {
  const fenced = Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)).map((match) => match[1].trim());
  const direct = text.trim().startsWith('{') ? [text.trim()] : [];
  return [...fenced, ...direct];
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value).trim();
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return textValue(value) ? [textValue(value)] : [];
  return value.map(textValue).filter(Boolean);
}
