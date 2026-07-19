import { beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_DECISION_STATE_KEY,
  JOINT_RESEARCH_EVIDENCE_SCHEMA,
  JOINT_RESEARCH_SCHEMA,
  RECOMMENDATION_RISK_SCHEMA,
  beginJointResearch,
  buildJointResearchEvidenceRepairPrompt,
  buildJointResearchSynthesisPrompt,
  createRecommendationFromRun,
  decideRecommendation,
  ingestJointResearchEvidence,
  ingestJointResearchResult,
  ingestRiskAssessmentResult,
  loadDailyDecisionState,
  markOutdatedRecommendations,
  parseJointResearchEvidence,
  parseJointResearchResult,
  parseRiskAssessmentResult,
  requestJointResearchEvidenceRepair,
  requestJointResearchSynthesis,
  updateRecommendation,
} from './dailyDecision';

function startRun() {
  return beginJointResearch({
    id: 'joint-1',
    reportId: 'report-1',
    reportContentHash: 'hash-1',
    conversationId: 'conversation-1',
    selection: {
      themeId: 'theme-ai',
      themeName: 'AI算力',
      stockCodes: ['300308.XSHE'],
      stockNames: ['中际旭创'],
    },
  });
}

function jointReply(overrides: Record<string, unknown> = {}) {
  return `联合研判纪要\n\`\`\`json\n${JSON.stringify({
    schema: JOINT_RESEARCH_SCHEMA,
    runId: 'joint-1',
    reportId: 'report-1',
    summary: '等待触发后纳入候选',
    action: 'candidate',
    priority: 'high',
    mainlineView: '主线仍在发酵期',
    riskView: '拥挤度偏高，需控制研究权重',
    pmView: '触发后纳入候选，不追高',
    disagreements: ['持续性仍需量能验证'],
    thesis: ['容量核心承接稳定'],
    counterArguments: ['高位拥挤'],
    triggers: ['放量突破'],
    invalidations: ['跌破五日线'],
    suggestedWeight: '5%',
    priceRange: '120-125',
    reviewAt: '10:30',
    riskConclusion: 'caution',
    riskFindings: ['拥挤度偏高'],
    riskMitigations: ['等待量能确认'],
    ...overrides,
  })}\n\`\`\``;
}

function evidenceReply(overrides: Record<string, unknown> = {}) {
  return `①⑦研究证据包\n\`\`\`json\n${JSON.stringify({
    schema: JOINT_RESEARCH_EVIDENCE_SCHEMA,
    runId: 'joint-1',
    reportId: 'report-1',
    mainlineView: '主线处于发酵期，等待量能确认',
    riskView: '拥挤度偏高，需控制研究权重',
    mainlineFindings: ['容量核心承接稳定'],
    riskFindings: ['高位拥挤'],
    disagreements: ['持续性仍需量能验证'],
    dataGaps: [],
    ...overrides,
  })}\n\`\`\``;
}

function completeEvidence() {
  expect(ingestJointResearchEvidence(evidenceReply(), 'conversation-1', 'message-evidence').ok).toBe(true);
}

describe('daily decision loop', () => {
  beforeEach(() => window.localStorage.removeItem(DAILY_DECISION_STATE_KEY));

  it('accepts only the declared, complete joint-research schema', () => {
    expect(parseJointResearchResult(jointReply()).ok).toBe(true);
    expect(parseJointResearchResult(jointReply({ schema: 'alpha.joint_research.v0' })).ok).toBe(false);
    expect(parseJointResearchResult(jointReply({ pmView: '' })).ok).toBe(false);
  });

  it('enforces the ①⑦ evidence barrier before ⑧ synthesis', () => {
    const run = startRun();
    expect(parseJointResearchEvidence(evidenceReply()).ok).toBe(true);
    expect(ingestJointResearchResult(jointReply(), 'conversation-1', 'message-too-early').ok).toBe(false);

    completeEvidence();
    const synthesisRun = loadDailyDecisionState().jointResearchRuns[0];
    const prompt = buildJointResearchSynthesisPrompt(synthesisRun);

    expect(synthesisRun).toMatchObject({ status: 'running', phase: 'pm_synthesis', evidenceSourceMessageId: 'message-evidence' });
    expect(prompt).toContain('第二阶段');
    expect(prompt).toContain('已验收的①⑦证据包');
    expect(prompt).toContain('"runId": "joint-1"');
    expect(prompt).toContain('"reportId": "report-1"');
    expect(run.phase).toBe('analyst_research');
  });

  it('repairs malformed outputs once within their own stage', () => {
    const run = startRun();
    const evidenceParsed = ingestJointResearchEvidence('⑦ 风险控制官：已完成', 'conversation-1', 'message-status');

    expect(evidenceParsed.ok).toBe(false);
    expect(loadDailyDecisionState().jointResearchRuns[0].status).toBe('pending');
    const repairRun = requestJointResearchEvidenceRepair(run.id, evidenceParsed.error || '缺少 JSON')!;
    expect(buildJointResearchEvidenceRepairPrompt(repairRun, evidenceParsed.error || '缺少 JSON')).toContain(JOINT_RESEARCH_EVIDENCE_SCHEMA);

    completeEvidence();
    const synthesisParsed = ingestJointResearchResult('⑧ 基金经理副官：已完成', 'conversation-1', 'message-status-2');
    const synthesisRun = requestJointResearchSynthesis(run.id, synthesisParsed.error || '缺少 JSON')!;
    const prompt = buildJointResearchSynthesisPrompt(synthesisRun, synthesisParsed.error || '缺少 JSON');

    expect(repairRun).toMatchObject({ phase: 'analyst_research', evidenceRepairAttempt: 1 });
    expect(synthesisRun).toMatchObject({ status: 'running', synthesisAttempt: 1 });
    expect(prompt).toContain('⑧结构化修复');
    expect(prompt).toContain(JOINT_RESEARCH_SCHEMA);
  });

  it('creates a recommendation and initial risk assessment from a completed ①⑦⑧ result', () => {
    startRun();
    completeEvidence();
    expect(ingestJointResearchResult(jointReply(), 'conversation-1', 'message-1').ok).toBe(true);
    const completed = loadDailyDecisionState().jointResearchRuns[0];
    const recommendation = createRecommendationFromRun(completed, '2026-07-18T09:15:00+08:00');
    const state = loadDailyDecisionState();

    expect(recommendation).toMatchObject({ action: 'candidate', priority: 'high', status: 'risk_ready', version: 1 });
    expect(state.riskAssessments[0]).toMatchObject({ recommendationId: recommendation?.id, recommendationVersion: 1, conclusion: 'caution' });
  });

  it('stales risk on material edits but not on note-only edits', () => {
    startRun();
    completeEvidence();
    ingestJointResearchResult(jointReply(), 'conversation-1');
    const recommendation = createRecommendationFromRun(loadDailyDecisionState().jointResearchRuns[0], 'cutoff')!;

    const noteOnly = updateRecommendation(recommendation.id, { userNote: '等待竞价确认' });
    expect(noteOnly).toMatchObject({ version: 1, status: 'risk_ready' });

    const material = updateRecommendation(recommendation.id, { priceRange: '118-122' });
    expect(material).toMatchObject({ version: 2, status: 'risk_stale' });
    expect(decideRecommendation(recommendation.id, 'confirmed', { acknowledged: true }).ok).toBe(false);
  });

  it('requires a current risk result and explicit human constraints for decisions', () => {
    startRun();
    completeEvidence();
    ingestJointResearchResult(jointReply(), 'conversation-1');
    const recommendation = createRecommendationFromRun(loadDailyDecisionState().jointResearchRuns[0], 'cutoff')!;
    updateRecommendation(recommendation.id, { suggestedWeight: '3%' });
    const version = loadDailyDecisionState().recommendations[0].version;
    const riskReply = `\`\`\`json\n${JSON.stringify({
      schema: RECOMMENDATION_RISK_SCHEMA,
      recommendationId: recommendation.id,
      recommendationVersion: version,
      conversationId: 'conversation-1',
      conclusion: 'avoid',
      summary: '建议回避',
      findings: ['拥挤度过高'],
      mitigations: [],
      dataGaps: [],
    })}\n\`\`\``;

    expect(parseRiskAssessmentResult(riskReply).ok).toBe(true);
    expect(ingestRiskAssessmentResult(riskReply, 'conversation-1').ok).toBe(true);
    expect(decideRecommendation(recommendation.id, 'confirmed', { acknowledged: true }).error).toContain('理由');
    expect(decideRecommendation(recommendation.id, 'confirmed', { acknowledged: true, note: '人工接受小权重观察风险' }).ok).toBe(true);
    expect(decideRecommendation(recommendation.id, 'deferred', {}).error).toContain('复核时间');
    expect(decideRecommendation(recommendation.id, 'rejected', {}).error).toContain('原因');
  });

  it('marks unconfirmed recommendations from older report hashes as source outdated', () => {
    startRun();
    completeEvidence();
    ingestJointResearchResult(jointReply(), 'conversation-1');
    createRecommendationFromRun(loadDailyDecisionState().jointResearchRuns[0], 'cutoff');

    markOutdatedRecommendations('conversation-1', 'hash-2');
    expect(loadDailyDecisionState().recommendations[0].status).toBe('source_outdated');
  });
});
