import type { Conversation, SkillSelection } from './types';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
  loadPremarketThemeRuns,
} from './themeResearch';
import { loadThemeBacktestRuns, loadThemeTrackingEvents } from './themeValidation';

export const ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID = 'alpha-studio-intraday-monitor';
export const ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE = 'Alpha Studio 盘中监控';
export const ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID = 'alpha-studio-report-review';
export const ALPHA_STUDIO_REPORT_REVIEW_SKILL_TITLE = 'Alpha Studio 日报复盘';

export const INTRADAY_MONITOR_CARD_PROMPT =
  `创建盘中监控定时任务：每隔 10 分钟使用 $${ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID}，基于今日生成的报告检查盘中触发条件、升级条件和失效条件，仅在 A 股工作日 9:25–11:30、13:00–15:00 运行。`;

export const REPORT_REVIEW_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID} 复盘今日生成的报告，对照实际行情、盘中触发和失效情况，完成偏差归因与次日调整。`;

export function inferThemeAbilitySkill(prompt: string): SkillSelection | null {
  if (prompt.includes(ALPHA_STUDIO_DAILY_THEME_SKILL_ID)) {
    return {
      id: ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
      title: ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
      description: '生成可自动进入日报跟踪的结构化主题研究。',
    };
  }
  if (prompt.includes(ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID)) {
    return {
      id: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID,
      title: ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE,
      description: '基于今日报告持续检查盘中触发、升级与失效条件。',
    };
  }
  if (prompt.includes(ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID)) {
    return {
      id: ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID,
      title: ALPHA_STUDIO_REPORT_REVIEW_SKILL_TITLE,
      description: '复盘今日报告的预测、触发表现、偏差原因与次日调整。',
    };
  }
  return null;
}

export function addThemeAbilityContext(
  prompt: string,
  skillId: string | undefined,
  conversations: Conversation[],
  now = Date.now(),
): string {
  if (isThemeBacktestRequest(prompt)) {
    return addThemeBacktestContext(prompt);
  }
  if (skillId !== ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID && skillId !== ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID) {
    return prompt;
  }

  const report = latestDailyReport(conversations, now);
  const structuredReport = loadPremarketThemeRuns().find((item) => {
    const generatedAt = Date.parse(item.generatedAt);
    return Number.isFinite(generatedAt) && shanghaiDay(generatedAt) === shanghaiDay(now);
  });
  const monitorHistory = skillId === ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID
    ? latestMonitorOutputs(conversations, now)
    : [];
  const lines = [
    prompt,
    '',
    '<alpha_studio_ability_context>',
    '以下内容由 Alpha Studio 客户端从本地对话中提取，只作为本次监控/复盘的基线证据。',
    report
      ? `\n[今日基线报告]\n来源对话：${report.conversationTitle}\n生成时间：${new Date(report.timestamp).toLocaleString('zh-CN', { hour12: false })}${report.filePaths.length ? `\n报告文件：${report.filePaths.join('、')}` : ''}${report.text ? `\n\n${report.text}` : ''}`
      : '\n[今日基线报告]\n未找到今日生成的研究报告。不要自行生成替代报告。',
    structuredReport
      ? `\n[结构化报告标识]\nreportId: ${structuredReport.id}\nreportContentHash: ${structuredReport.contentHash}\ntriggerIds: ${structuredReport.themes.flatMap((theme) => theme.triggerSpecs.map((trigger) => `${theme.id}/${trigger.id}`)).join('、')}`
      : '\n[结构化报告标识]\n未匹配到跟踪库快照，不得伪造 reportId 或 triggerId。',
    ...(monitorHistory.length
      ? ['\n[今日盘中监控记录]', ...monitorHistory.map((item, index) => `\n#${index + 1} ${item}`)]
      : skillId === ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID
        ? ['\n[今日盘中监控记录]\n未找到可用的盘中监控结果。']
        : []),
    '</alpha_studio_ability_context>',
  ];
  return lines.join('\n');
}

export function isThemeBacktestRequest(prompt: string): boolean {
  return /(?:回测|历史检验|策略检验|backtest)/i.test(prompt)
    && /(?:日报|报告|题材|主题|龙头|中军|趋势核心|补涨|角色矩阵)/i.test(prompt);
}

function addThemeBacktestContext(prompt: string): string {
  const reports = loadPremarketThemeRuns()
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate) || left.generatedAt.localeCompare(right.generatedAt))
    .slice(-120);
  const reportIds = new Set(reports.map((report) => report.id));
  const latestEvents = new Map<string, ReturnType<typeof loadThemeTrackingEvents>[number]>();
  for (const event of loadThemeTrackingEvents()
    .filter((item) => reportIds.has(item.reportId))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt))) {
    latestEvents.set(`${event.reportId}:${event.triggerId}`, event);
  }
  const payload = {
    reportCount: reports.length,
    tradeDateRange: reports.length ? [reports[0].tradeDate, reports[reports.length - 1].tradeDate] : [],
    reports: reports.map((report) => ({
      id: report.id,
      contentHash: report.contentHash,
      tradeDate: report.tradeDate,
      generatedAt: report.generatedAt,
      dataCutoff: report.dataCutoff,
      reportMode: report.reportMode,
      executionGate: report.executionGate.state,
      primaryRoute: report.capitalAttackPath.primaryRoute,
      themes: report.themes.map((theme) => ({
        id: theme.id,
        rank: theme.rank,
        name: theme.name,
        grade: theme.grade,
        lifecycle: theme.lifecycle,
        todayAttackProbability: theme.todayAttackProbability,
        triggerIds: theme.triggerSpecs.map((trigger) => trigger.id),
        stocks: theme.stocks.map((stock) => ({
          code: stock.code,
          name: stock.name,
          role: stock.role,
          roleRank: stock.roleRank,
          triggerIds: stock.triggerIds || [],
          entryConditions: stock.entryConditions || [],
          invalidationConditions: stock.invalidationConditions || [],
        })),
      })),
    })),
    latestTriggerEvents: Array.from(latestEvents.values()).map((event) => ({
      reportId: event.reportId,
      themeId: event.themeId,
      triggerId: event.triggerId,
      status: event.status,
      observedAt: event.observedAt,
      marketPrice: event.marketPrice,
      evidence: event.evidence,
      source: event.source,
    })),
    savedBacktests: loadThemeBacktestRuns().slice(0, 12).map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      dataSource: run.dataSource,
      config: run.config,
      metrics: run.metrics,
      exclusions: run.exclusions.length,
    })),
  };
  return [
    prompt,
    '',
    '<alpha_studio_theme_backtest_context>',
    '以下是 Alpha Studio 本地按日留档的不可变日报索引、当日触发事件终态和既有回测摘要。',
    '回测必须使用事前可得信息：盘前/9:25 报告可进入开盘策略；盘中/盘后报告不得倒灌到当日开盘。没有历史行情时应先取得可信数据，不得用当前价或虚构样本代替。',
    '请明确样本范围、角色选择、进出场时点、停牌/涨跌停/一手制、复权、滑点、佣金、印花税、基准、排除样本和数据版本。',
    JSON.stringify(payload),
    '</alpha_studio_theme_backtest_context>',
  ].join('\n');
}

interface DailyReportEvidence {
  conversationTitle: string;
  timestamp: number;
  text: string;
  filePaths: string[];
}

function latestDailyReport(conversations: Conversation[], now: number): DailyReportEvidence | null {
  const today = shanghaiDay(now);
  const candidates: DailyReportEvidence[] = [];
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== 'assistant' || shanghaiDay(message.timestamp) !== today) continue;
      const text = message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.content)
        .join('\n\n')
        .trim();
      const filePaths = message.blocks
        .filter((block) => block.type === 'file_result')
        .flatMap((block) => block.files)
        .filter((file) => /(报告|日报|研究|report)/i.test(file.name) || /\.(md|html|pdf)$/i.test(file.path))
        .map((file) => file.path);
      const looksLikeDailyReport =
        (text.includes('今日执行闸门') && text.includes('今日资金进攻路径')) ||
        text.includes('alpha.premarket_theme.v1') ||
        text.includes('alpha.premarket_theme.v2') ||
        filePaths.length > 0;
      if (!looksLikeDailyReport) continue;
      candidates.push({
        conversationTitle: conversation.title,
        timestamp: message.timestamp,
        text: text.slice(0, 60_000),
        filePaths: Array.from(new Set(filePaths)),
      });
    }
  }
  return candidates.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

function latestMonitorOutputs(conversations: Conversation[], now: number): string[] {
  const today = shanghaiDay(now);
  const outputs: Array<{ timestamp: number; text: string }> = [];
  for (const conversation of conversations) {
    const hasMonitorTurn = conversation.messages.some(
      (message) => message.role === 'user' && message.blocks.some(
        (block) => block.type === 'text' && block.content.includes(ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID),
      ),
    );
    if (!hasMonitorTurn) continue;
    for (const message of conversation.messages) {
      if (message.role !== 'assistant' || shanghaiDay(message.timestamp) !== today) continue;
      const text = message.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.content)
        .join('\n\n')
        .trim();
      if (!text || text.includes('已在 Alpha Studio 自动化任务列表中创建')) continue;
      outputs.push({ timestamp: message.timestamp, text: text.slice(0, 8_000) });
    }
  }
  return outputs
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 6)
    .map((item) => `${new Date(item.timestamp).toLocaleString('zh-CN', { hour12: false })}\n${item.text}`);
}

function shanghaiDay(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}
