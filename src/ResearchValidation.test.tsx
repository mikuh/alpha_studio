import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchValidationPanel, TriggerRow } from './ResearchValidation';
import { PREMARKET_THEME_RUNS_KEY, type PremarketThemeTrigger } from './themeResearch';
import { THEME_TRACKING_EVENTS_KEY, type ThemeTrackingEvent } from './themeValidation';

const trigger: PremarketThemeTrigger = {
  id: 'trigger-1',
  label: '中芯国际9:30-9:45维持红盘',
  evaluator: 'quote',
  subjectCode: '688981.XSHG',
  field: 'changePct',
  operator: 'gte',
  threshold: 0,
  windowStart: '09:30',
  windowEnd: '09:45',
  confirmForSeconds: 180,
  dataSource: '东方财富实时行情',
  actionOnTrigger: '继续检查题材宽度',
  actionOnFailure: '主路径降级为观察',
};

describe('TriggerRow', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it('shows missing data instead of not due when a historical report has no recorded event', () => {
    render(<TriggerRow trigger={trigger} historical onOverride={vi.fn()} />);

    expect(screen.getByText('数据不足')).toBeInTheDocument();
    expect(screen.getByText('缺少当日盘中观察记录')).toBeInTheDocument();
    expect(screen.queryByText('未到时点')).not.toBeInTheDocument();
  });

  it('shows an expandable per-stock buy/invalidation decision instead of a passive role table', () => {
    window.localStorage.setItem(PREMARKET_THEME_RUNS_KEY, JSON.stringify([{
      schema: 'alpha.premarket_theme.v2', sourceSchema: 'alpha.premarket_theme.v2', id: 'report-1', contentHash: 'hash-1',
      tradeDate: '2026-07-10', generatedAt: '2026-07-10T01:20:00Z', dataCutoff: '2026-07-10T01:20:00Z', importedAt: '2026-07-10T01:21:00Z',
      reportMode: 'pre_market', title: '盘前日报', executionGate: { state: '触发后轻仓试错', todayOnlyDo: ['只做核心'], todayDoNotDo: ['不追后排'], triggerBeforeAction: ['中军确认'], failureAction: '只观察' },
      capitalAttackPath: { primaryRoute: 'AI算力', backupRoute: '电网', invalidationRoute: '中军转弱', todayAttackProbability: '60%', rationale: '容量确认', actionCondition: '中军与宽度共振' },
      marketSentiment: 'trial', previousContinuity: [{ name: 'AI算力', status: '继续', action: '观察', evidence: '容量延续' }], risks: ['高位拥挤'], sourceNotes: ['东方财富'],
      themes: [{
        id: 'theme-1', rank: 1, name: 'AI算力', grade: 'A', conclusion: '触发后只做核心', lifecycle: 'fermentation', capitalType: 'mixed', attackPath: '中军先行',
        todayAttackProbability: '60%', researchProbability: '65%', observationWeight: '30%', todayOnlyDo: ['核心'], todayDoNotDo: ['后排'], invalidation: '中军跌破关键位', risk: '拥挤', status: 'pending',
        triggerSpecs: [trigger],
        stocks: [{ name: '中芯国际', code: '688981.XSHG', role: '中军', roleRank: 1, authenticity: 'A', triggerIds: ['trigger-1'], entryConditions: ['涨幅与宽度共振'], invalidationConditions: ['放量转负'] }],
      }], reportMarkdown: '',
    }]));
    window.localStorage.setItem(THEME_TRACKING_EVENTS_KEY, JSON.stringify([{
      id: 'event-1', reportId: 'report-1', tradeDate: '2026-07-10', themeId: 'theme-1', triggerId: 'trigger-1',
      status: 'triggered', observedAt: '2026-07-10T01:40:00Z', evidence: '中芯国际 changePct=1.20', source: 'eastmoney', actor: 'rule',
    }]));

    render(<ResearchValidationPanel />);
    const conditionButton = screen.getByRole('button', { name: /买入条件达成/ });
    expect(conditionButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(conditionButton);
    expect(conditionButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('当前动作')).toBeInTheDocument();
    expect(screen.getByText('涨幅与宽度共振')).toBeInTheDocument();
    expect(screen.getByText('放量转负')).toBeInTheDocument();
  });

  it('keeps not due as the initial state for a current report awaiting its observation window', () => {
    render(<TriggerRow trigger={trigger} onOverride={vi.fn()} />);

    expect(screen.getByText('未到时点')).toBeInTheDocument();
    expect(screen.getByText('等待 东方财富实时行情')).toBeInTheDocument();
  });

  it('prefers a recorded historical event over the missing-history fallback', () => {
    const event: ThemeTrackingEvent = {
      id: 'event-1',
      reportId: 'report-1',
      tradeDate: '2026-07-10',
      themeId: 'theme-1',
      triggerId: trigger.id,
      status: 'triggered',
      observedAt: '2026-07-10T01:40:00Z',
      evidence: '中芯国际 changePct=1.20',
      source: 'eastmoney',
      actor: 'rule',
    };

    render(<TriggerRow trigger={trigger} event={event} historical onOverride={vi.fn()} />);

    expect(screen.getByText('已触发')).toBeInTheDocument();
    expect(screen.getByText(event.evidence)).toBeInTheDocument();
  });
});
