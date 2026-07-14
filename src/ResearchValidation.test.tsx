import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TriggerRow } from './ResearchValidation';
import type { PremarketThemeTrigger } from './themeResearch';
import type { ThemeTrackingEvent } from './themeValidation';

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
  afterEach(cleanup);

  it('shows missing data instead of not due when a historical report has no recorded event', () => {
    render(<TriggerRow trigger={trigger} historical onOverride={vi.fn()} />);

    expect(screen.getByText('数据不足')).toBeInTheDocument();
    expect(screen.getByText('缺少当日盘中观察记录')).toBeInTheDocument();
    expect(screen.queryByText('未到时点')).not.toBeInTheDocument();
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
