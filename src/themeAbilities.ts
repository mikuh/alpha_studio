import type { Conversation, SkillSelection } from './types';
import {
  ALPHA_STUDIO_DAILY_THEME_SKILL_ID,
  ALPHA_STUDIO_DAILY_THEME_SKILL_TITLE,
  loadPremarketThemeRuns,
} from './themeResearch';

export const ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_ID = 'alpha-studio-intraday-monitor';
export const ALPHA_STUDIO_INTRADAY_MONITOR_SKILL_TITLE = 'Alpha Studio 盘中监控';
export const ALPHA_STUDIO_REPORT_REVIEW_SKILL_ID = 'alpha-studio-report-review';
export const ALPHA_STUDIO_REPORT_REVIEW_SKILL_TITLE = 'Alpha Studio 日报复盘';

export const INTRADAY_MONITOR_CARD_PROMPT =
  '创建盘中监控定时任务：每隔 10 分钟使用 alpha-studio-intraday-monitor，基于今日生成的报告检查盘中触发条件、升级条件和失效条件，仅在 A 股工作日 9:25–11:30、13:00–15:00 运行。';

export const REPORT_REVIEW_CARD_PROMPT =
  '使用 alpha-studio-report-review 复盘今日生成的报告，对照实际行情、盘中触发和失效情况，完成偏差归因与次日调整。';

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
