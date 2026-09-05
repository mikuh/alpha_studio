import { beforeEach, describe, expect, it } from 'vitest';
import { buildQuoteMap, loadResearchState, researchAccountSummary } from './research';
import {
  PREMARKET_THEME_RUNS_KEY,
  PREMARKET_THEME_SCHEMA,
  PREMARKET_THEME_SCHEMA_V1,
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  automaticPremarketThemeImportError,
  buildPremarketThemePrompt,
  extractLegacyPremarketThemeDraft,
  loadPremarketThemeRuns,
  parsePremarketThemeResult,
  savePremarketThemeRun,
  stableThemeContentHash,
  type PremarketThemeRun,
} from './themeResearch';

function validThemeJson(overrides: Record<string, unknown> = {}) {
  return {
    schema: PREMARKET_THEME_SCHEMA,
    generatedAt: '2026-07-07T00:30:00.000Z',
    reportMode: 'pre_market',
    title: '盘前主题研究',
    executionGate: {
      state: '触发后轻仓试错',
      todayOnlyDo: ['只做主线核心'],
      todayDoNotDo: ['不追缩量高开'],
      triggerBeforeAction: ['指数放量站上均线'],
      failureAction: '触发失败则只观察',
    },
    capitalAttackPath: {
      primaryRoute: 'AI算力中军先行',
      backupRoute: '半导体设备趋势核心',
      invalidationRoute: '中军低开低走且宽度回落',
      todayAttackProbability: '62%',
      rationale: '海外算力线索和本地容量股同时确认。',
      actionCondition: '9:45 前宽度扩散且中军承接。',
    },
    marketSentiment: 'trial + 情绪试探修复',
    previousContinuity: [
      { name: 'AI算力', status: '继续', action: '保留观察', evidence: '成交额延续' },
    ],
    themes: [
      {
        id: 'theme-ai-compute',
        name: 'AI算力',
        grade: 'S',
        conclusion: '主线延续但等待确认',
        lifecycle: 'fermentation',
        capitalType: 'mixed',
        attackPath: '中军先行',
        todayAttackProbability: '62%',
        researchProbability: '70%',
        observationWeight: '高',
        holdingWindow: {
          elapsedTradingDays: '2日',
          estimatedRemainingWindow: '1-5个交易日，模型估计',
          defaultProtocol: '收盘趋势与次日竞价复核。',
          extensionConditions: ['中军和宽度继续确认'],
          exitConditions: ['中军低开低走'],
        },
        todayOnlyDo: ['核心标的回踩承接'],
        todayDoNotDo: ['追高后排'],
        triggers: ['中际旭创放量突破'],
        invalidation: '放量跌破五日线',
        risk: '高位拥挤',
        stocks: [{ name: '中际旭创', code: '300308.XSHE', role: '趋势核心', authenticity: 'A' }],
      },
    ],
    risks: ['海外消息扰动'],
    sourceNotes: ['来源需在报告正文列明'],
    ...overrides,
  };
}

function validReply(json: Record<string, unknown> = validThemeJson()) {
  return `\`\`\`json
${JSON.stringify(json, null, 2)}
\`\`\`

# 盘前主题研究

## 今日执行闸门
今日只做核心确认；今日不做后排追高。

## 今日资金进攻路径
今日进攻概率：62%。主路径为 AI算力中军先行，备选路径为半导体设备趋势核心，失效路径为中军低开低走且宽度回落。

## 情绪指标仪表盘
情绪为 trial。

## 隔夜全球线索
海外算力链偏强。

## 全球线索到A股题材映射
映射到 AI 算力容量股。

## 上一期主题连续跟踪
AI算力：继续。

## 题材分级与生命周期
AI算力：S，研究概率 70%，观察权重 高。

## 题材持续时间与持有复核
预计剩余窗口：1-5个交易日，模型估计。

## 龙头 / 中军 / 趋势核心 / 补涨矩阵
| 题材 | 角色 | 标的 | 确认/失效 |
| --- | --- | --- | --- |
| AI算力 | 趋势核心 | 中际旭创（A） | 放量突破/跌破五日线 |

## 风险提示
本报告为公开信息整理和模型化研究，不构成证券投资咨询。`;
}

describe('themeResearch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('builds an Alpha Studio prompt with execution gate, continuity, data scope, and account context', () => {
    const state = loadResearchState();
    const quotes = buildQuoteMap(state);
    const summary = researchAccountSummary(state, quotes);
    const previousRun = parsePremarketThemeResult(validReply()).run as PremarketThemeRun;

    const prompt = buildPremarketThemePrompt({
      state,
      summary,
      quotes,
      fullMarketQuotes: Array.from(quotes.values()).slice(0, 5),
      previousRuns: [previousRun],
      generatedAt: new Date('2026-07-07T00:30:00.000Z'),
    });

    expect(prompt).toContain(`${ALPHA_STUDIO_DAILY_THEME_SKILL_ID} skill`);
    expect(prompt).toContain('neostream-daily-theme-research 保持一致');
    expect(prompt).toContain(PREMARKET_THEME_SCHEMA);
    expect(prompt).toContain('capitalAttackPath');
    expect(prompt).toContain('今日资金进攻路径');
    expect(prompt).toContain('默认不要拆成 ROLE MATRIX I/II');
    expect(prompt).toContain('题材 / 角色 / 标的 / 角色逻辑 / 确认/失效');
    expect(prompt).toContain('executionGate');
    expect(prompt).toContain('上一期主题连续跟踪');
    expect(prompt).toContain('数据口径');
    expect(prompt).toContain('不要为了相同字段重复请求东方财富或腾讯');
    expect(prompt).toContain('外部来源不可达时最多做一次有界重试');
    expect(prompt).toContain('不要在任务运行时执行 pip/npm 安装');
    expect(prompt).toContain('持仓');
    expect(prompt).toContain('自选');
  });

  it('parses a valid structured premarket theme result and keeps markdown report text', () => {
    const parsed = parsePremarketThemeResult(validReply());

    expect(parsed.ok).toBe(true);
    expect(parsed.run?.schema).toBe(PREMARKET_THEME_SCHEMA);
    expect(parsed.run?.executionGate.state).toBe('触发后轻仓试错');
    expect(parsed.run?.capitalAttackPath.primaryRoute).toBe('AI算力中军先行');
    expect(parsed.run?.themes[0].todayAttackProbability).toBe('62%');
    expect(parsed.run?.themes[0].holdingWindow?.estimatedRemainingWindow).toContain('模型估计');
    expect(parsed.run?.themes[0].name).toBe('AI算力');
    expect(parsed.run?.themes[0].status).toBe('pending');
    expect(parsed.run?.reportMarkdown).toContain('# 盘前主题研究');
  });

  it('imports richer sidecars emitted by formal reports without losing the workbench contract', () => {
    const base = validThemeJson();
    const parsed = parsePremarketThemeResult(JSON.stringify({
      ...base,
      marketSentiment: { score: 57.8, regime: 'trial', assessment: '指数偏弱，只允许核心试错。' },
      previousContinuity: [{
        name: 'AI算力', currentState: '降级观察', carryoverAction: '无仓不新开', continuityConclusion: '宽度回落',
      }],
      sourceNotes: [{ source: 'Eastmoney', scope: '行情快照', cutoff: '08:25', url: 'https://example.test/quote' }],
      themes: [{
        ...(base.themes as Record<string, unknown>[])[0],
        triggerSpecs: [{
          id: 'ai-core-change', label: '中际旭创涨幅不低于2%', evaluator: 'quote', subject: '300308.XSHE',
          field: 'pctChange', operator: '>=', threshold: 2, confirmForSeconds: 60, dataSource: 'eastmoney',
          actionOnTrigger: '进入二次确认', actionOnFailure: '禁止新开',
        }],
        stocks: [{
          name: '中际旭创', code: '300308.XSHE', role: '趋势核心', roleRank: 1,
          authenticity: '产业链核心', authenticityRating: 'A', triggerIds: ['ai-core-change'],
          entryConditions: ['涨幅与题材宽度共振'], invalidationConditions: ['放量转负'],
        }],
      }],
    }), { requireCompleteReport: false });

    expect(parsed.ok).toBe(true);
    expect(parsed.run?.marketSentiment).toContain('57.8分');
    expect(parsed.run?.previousContinuity[0]).toMatchObject({ status: '降级观察', action: '无仓不新开', evidence: '宽度回落' });
    expect(parsed.run?.sourceNotes[0]).toContain('Eastmoney · 行情快照');
    expect(parsed.run?.themes[0].triggerSpecs[0]).toMatchObject({ subjectCode: '300308.XSHE', field: 'changePct', operator: 'gte' });
    expect(parsed.run?.themes[0].stocks[0]).toMatchObject({ authenticity: 'A', triggerIds: ['ai-core-change'] });
    expect(automaticPremarketThemeImportError(parsed.run!)).toBeNull();
  });

  it('upgrades v1 reports to the v2 tracking model without changing their source schema', () => {
    const parsed = parsePremarketThemeResult(validReply(validThemeJson({ schema: PREMARKET_THEME_SCHEMA_V1 })));
    expect(parsed.ok).toBe(true);
    expect(parsed.run?.schema).toBe(PREMARKET_THEME_SCHEMA);
    expect(parsed.run?.sourceSchema).toBe(PREMARKET_THEME_SCHEMA_V1);
    expect(parsed.run?.themes[0].rank).toBe(1);
    expect(parsed.run?.themes[0].stocks[0].roleRank).toBe(1);
    expect(parsed.run?.themes[0].triggerSpecs[0].evaluator).toBe('ai');
  });

  it('extracts legacy markdown into a confirmation-only tracking draft', () => {
    const draft = extractLegacyPremarketThemeDraft(`
# 2026-07-07 盘前报告
生成时间：2026-07-07 09:10:00
| 题材 | 角色 | 标的 |
| --- | --- | --- |
| AI算力 | 中军 | 浪潮信息(000977)、中科曙光(603019) |
| AI算力 | 龙头 | 新易盛(300502) |
`);
    expect(draft?.themes[0].rank).toBe(1);
    expect(draft?.themes[0].stocks[0]).toMatchObject({ role: '中军', roleRank: 1, code: '000977.XSHE' });
    expect(draft?.themes[0].stocks[1]).toMatchObject({ roleRank: 2, code: '603019.XSHG' });
    expect(draft?.reportMode).toBe('legacy_import');
  });

  it('extracts ranked theme metrics from HTML table text without mistaking execution rows for themes', () => {
    const draft = extractLegacyPremarketThemeDraft(`
Generated: 2026-07-15 10:46 CST
| 项目 | 结论 | 执行含义 |
| 全局状态 | 只观察 | 不主动新开 |
| 今日只做 | 只验证主线核心 | 看容量与宽度 |
| 今日不做 | 四板追高 | 不追后排 |
| 触发再做 | 留待确认 | 午后宽度不降 |
| 失效动作 | 降级 | 核心炸板则退出 |
| 层级 | 资金进攻路径 | 今日进攻概率 | 为什么现在 | 失效路线 |
| 主路径 | 医药双核共振 | 45.1% | 催化与容量确认 | 核心炸板 |
| 备选 | 电网低位启动 | 43.9% | 政策催化 | 中军不确认 |
| 评级 | 主题 | 生命周期 | 资金类型 | 今日进攻概率 | 1–3日研究概率 | 观察权重 | 今日结论 |
| A | 创新药/CRO/医药 | 发酵 | 混合 | 45.1% | 52.0% | 14.3% | 只看不做 |
| 主题 | 已运行 | 预计剩余窗口 | 默认持有协议 | 延长条件 | 缩短/退出条件 |
| 创新药/CRO/医药 | 3日 | 1–6日，模型估计 | 收盘复核 | 宽度延续 | 核心炸板 |
| 题材 | 角色 | 标的 | 角色逻辑 | 确认/失效 |
| 创新药/CRO | 趋势核心 | 昭衍新药（A）603127.SH | 容量核心 | 放量/回落 |
| 时点 | 观察对象 | 确认条件 | 失败动作 |
| 13:00 | 创新药主路径 | 宽度维持 | 降级观察 |
`, 'index');

    expect(draft?.themes.map((theme) => theme.name)).toEqual(['创新药/CRO/医药']);
    expect(draft?.themes[0]).toMatchObject({
      grade: 'A', todayAttackProbability: '45.1%', researchProbability: '52.0%', observationWeight: '14.3%',
    });
    expect(draft?.themes[0].stocks[0]).toMatchObject({ code: '603127.XSHG', role: '趋势核心', authenticity: 'A' });
    expect(draft?.capitalAttackPath.primaryRoute).toBe('医药双核共振');
    expect(draft?.executionGate.state).toBe('只观察');
  });

  it('hashes semantically identical structured content deterministically', () => {
    expect(stableThemeContentHash({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(stableThemeContentHash({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('rejects results without schema or complete theme cards', () => {
    expect(parsePremarketThemeResult(validReply({ schema: 'wrong.schema' })).ok).toBe(false);
    expect(parsePremarketThemeResult(validReply({ themes: [] })).ok).toBe(false);
  });

  it('rejects complete-report replies that omit Neostream-level mandatory modules', () => {
    const incompleteReply = `\`\`\`json
${JSON.stringify(validThemeJson(), null, 2)}
\`\`\`

# 盘前主题研究

只有简单摘要，没有路径层决策。`;

    const parsed = parsePremarketThemeResult(incompleteReply);

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('今日资金进攻路径');
  });

  it('round-trips local premarket theme runs', () => {
    const run = parsePremarketThemeResult(validReply()).run as PremarketThemeRun;

    savePremarketThemeRun(run);
    const loaded = loadPremarketThemeRuns();

    expect(window.localStorage.getItem(PREMARKET_THEME_RUNS_KEY)).toContain('AI算力');
    expect(loaded).toHaveLength(1);
    expect(loaded[0].themes[0].stocks[0].name).toBe('中际旭创');
  });

  it('keeps multiple report versions with the same declared id when their content hashes differ', () => {
    const run = parsePremarketThemeResult(validReply()).run as PremarketThemeRun;
    savePremarketThemeRun({ ...run, sourceConversationId: 'conversation-1', sourceMessageId: 'message-1' });
    const saved = savePremarketThemeRun({
      ...run,
      generatedAt: '2026-07-07T00:45:00.000Z',
      contentHash: 'new-version-hash',
      sourceConversationId: 'conversation-1',
      sourceMessageId: 'message-2',
    });

    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((item) => item.id)).size).toBe(2);
    expect(saved.every((item) => item.sourceConversationId === 'conversation-1')).toBe(true);
  });

  it('replaces an incomplete legacy draft when the complete same-day sidecar arrives', () => {
    const run = parsePremarketThemeResult(validReply()).run as PremarketThemeRun;
    savePremarketThemeRun({
      ...run,
      id: 'legacy-same-day',
      sourceSchema: PREMARKET_THEME_SCHEMA_V1,
      reportMode: 'legacy_import',
      contentHash: 'legacy-same-day',
    });

    const saved = savePremarketThemeRun(run);

    expect(saved).toHaveLength(1);
    expect(saved[0].sourceSchema).toBe(PREMARKET_THEME_SCHEMA);
    expect(saved[0].reportMode).toBe('pre_market');
  });
});
