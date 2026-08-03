import type { PremarketThemeRun } from './themeResearch';
import type { ReviewVerdict, ThemeDailyReview } from './themeValidation';

export interface CalibrationObservation {
  reportId: string;
  reviewId: string;
  tradeDate: string;
  themeId: string;
  themeName: string;
  grade: string;
  lifecycle: string;
  probability: number;
  outcome: number;
  forecastField: 'todayAttackProbability' | 'researchProbability';
}

export interface CalibrationBucket {
  label: string;
  lower: number;
  upper: number;
  count: number;
  meanProbability: number;
  meanOutcome: number;
  bias: number;
}

export interface ResearchCalibrationReport {
  sampleCount: number;
  reportCount: number;
  excludedCount: number;
  sampleSufficient: boolean;
  meanProbability: number | null;
  meanOutcome: number | null;
  brierScore: number | null;
  meanAbsoluteError: number | null;
  bias: number | null;
  observations: CalibrationObservation[];
  buckets: CalibrationBucket[];
}

const VERDICT_OUTCOME: Partial<Record<ReviewVerdict, number>> = {
  hit: 1,
  partial: 0.5,
  not_triggered: 0,
  miss: 0,
};

export function parseResearchProbability(value: string): number | null {
  const matches = value.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (!matches.length) return null;
  const mean = matches.reduce((sum, item) => sum + item, 0) / matches.length;
  const normalized = value.includes('%') || mean > 1 ? mean / 100 : mean;
  return normalized >= 0 && normalized <= 1 ? normalized : null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildResearchCalibration(reports: PremarketThemeRun[], reviews: ThemeDailyReview[]): ResearchCalibrationReport {
  const reviewByReport = new Map<string, ThemeDailyReview>();
  for (const review of [...reviews].sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))) {
    if (!reviewByReport.has(review.reportId)) reviewByReport.set(review.reportId, review);
  }
  const observations: CalibrationObservation[] = [];
  let excludedCount = 0;
  for (const report of reports) {
    const review = reviewByReport.get(report.id);
    if (!review) {
      excludedCount += report.themes.length;
      continue;
    }
    for (const theme of report.themes) {
      const todayProbability = parseResearchProbability(theme.todayAttackProbability);
      const researchProbability = parseResearchProbability(theme.researchProbability);
      const probability = todayProbability ?? researchProbability;
      const forecastField = todayProbability !== null ? 'todayAttackProbability' as const : 'researchProbability' as const;
      const outcomes = review.items
        .filter((item) => item.id.startsWith(`${theme.id}:`))
        .flatMap((item) => VERDICT_OUTCOME[item.verdict] === undefined ? [] : [VERDICT_OUTCOME[item.verdict] as number]);
      if (probability === null || !outcomes.length) {
        excludedCount += 1;
        continue;
      }
      observations.push({
        reportId: report.id,
        reviewId: review.id,
        tradeDate: report.tradeDate,
        themeId: theme.id,
        themeName: theme.name,
        grade: theme.grade,
        lifecycle: theme.lifecycle,
        probability,
        outcome: mean(outcomes),
        forecastField,
      });
    }
  }
  const buckets: CalibrationBucket[] = [];
  for (let lower = 0; lower < 1; lower += 0.2) {
    const upper = Number((lower + 0.2).toFixed(1));
    const rows = observations.filter((item) => item.probability >= lower && (upper === 1 ? item.probability <= upper : item.probability < upper));
    if (!rows.length) continue;
    const meanProbability = mean(rows.map((item) => item.probability));
    const meanOutcome = mean(rows.map((item) => item.outcome));
    buckets.push({
      label: `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`,
      lower,
      upper,
      count: rows.length,
      meanProbability,
      meanOutcome,
      bias: meanProbability - meanOutcome,
    });
  }
  const probabilities = observations.map((item) => item.probability);
  const outcomes = observations.map((item) => item.outcome);
  const count = observations.length;
  return {
    sampleCount: count,
    reportCount: new Set(observations.map((item) => item.reportId)).size,
    excludedCount,
    sampleSufficient: count >= 20,
    meanProbability: count ? mean(probabilities) : null,
    meanOutcome: count ? mean(outcomes) : null,
    brierScore: count ? mean(observations.map((item) => (item.probability - item.outcome) ** 2)) : null,
    meanAbsoluteError: count ? mean(observations.map((item) => Math.abs(item.probability - item.outcome))) : null,
    bias: count ? mean(probabilities) - mean(outcomes) : null,
    observations,
    buckets,
  };
}
