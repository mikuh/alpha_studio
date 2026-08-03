import { describe, expect, it } from 'vitest';
import { buildResearchCalibration, parseResearchProbability } from './researchCalibration';
import type { PremarketThemeRun } from './themeResearch';
import type { ThemeDailyReview } from './themeValidation';

describe('research calibration', () => {
  it('parses percent ranges and decimal probabilities', () => {
    expect(parseResearchProbability('60%-70%')).toBeCloseTo(0.65);
    expect(parseResearchProbability('0.42')).toBeCloseTo(0.42);
    expect(parseResearchProbability('未给出')).toBeNull();
  });

  it('matches immutable report themes with reviewed trigger outcomes', () => {
    const reports = [{
      id: 'report-1',
      themes: [{ id: 'theme-1', name: '算力', grade: 'A', lifecycle: 'fermentation', todayAttackProbability: '70%', researchProbability: '80%' }],
    }] as PremarketThemeRun[];
    const reviews = [{
      id: 'review-1', reportId: 'report-1', generatedAt: '2026-08-01T08:00:00Z',
      items: [
        { id: 'theme-1:t1', verdict: 'hit' },
        { id: 'theme-1:t2', verdict: 'partial' },
        { id: 'theme-1:t3', verdict: 'data_missing' },
      ],
    }] as ThemeDailyReview[];
    const report = buildResearchCalibration(reports, reviews);
    expect(report.sampleCount).toBe(1);
    expect(report.observations[0].outcome).toBe(0.75);
    expect(report.brierScore).toBeCloseTo(0.0025);
    expect(report.excludedCount).toBe(0);
  });
});
