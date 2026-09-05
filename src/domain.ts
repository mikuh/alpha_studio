import { INTRADAY_MONITOR_CARD_PROMPT, REPORT_REVIEW_CARD_PROMPT } from './themeAbilities';

export const ALPHA_STUDIO_FACTOR_MINING_SKILL_ID = 'alpha-studio-a-share-factor-mining';
export const FACTOR_MINING_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_FACTOR_MINING_SKILL_ID} 深度分析可用的行情、财务和成交数据，自动生成候选、批量计算、验证集筛选、去冗余并搜索组合，给出 Top 单因子、Top 组合和交易研究配置`;
export const ALPHA_STUDIO_MAINLINE_TREND_SKILL_ID = 'alpha-studio-mainline-trend-research';
export const MAINLINE_TREND_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_MAINLINE_TREND_SKILL_ID} 生成今日产业主线趋势早报，按政策、定向信贷/产业投入、长线机构资金与自适应海外景气识别主升共振，过滤单因子脉冲，并给出主线重仓权限、最大证据缺口及升级/失效条件`;
export const ALPHA_STUDIO_EVIDENCE_INTELLIGENCE_SKILL_ID = 'alpha-studio-evidence-intelligence';
export const EVIDENCE_INTELLIGENCE_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_EVIDENCE_INTELLIGENCE_SKILL_ID} 核验一条公司、行业、政策或市场研究命题，优先检索一手时点来源，分离事实与推断，保留冲突和质量标记，并输出可追溯的 alpha.evidence.v1 证据记录`;
export const ALPHA_STUDIO_COMPANY_THESIS_SKILL_ID = 'alpha-studio-company-thesis-tracker';
export const COMPANY_THESIS_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_COMPANY_THESIS_SKILL_ID} 为指定 A 股公司创建或更新可证伪的投资 Thesis，维护核心逻辑、关键指标、估值假设、催化、风险和失效条件的版本链；如未提供公司，先询问代码或名称`;
export const ALPHA_STUDIO_RESEARCH_CALIBRATION_SKILL_ID = 'alpha-studio-research-calibration';
export const RESEARCH_CALIBRATION_CARD_PROMPT =
  `使用 $${ALPHA_STUDIO_RESEARCH_CALIBRATION_SKILL_ID} 对已冻结的研究概率和复盘结果进行校准审计，计算 Brier 分数、可靠性分桶及高估/低估偏差，并给出一条可检验的规则调整建议`;

export interface DomainPromptPack {
  systemLines: string[];
  responseGuidance: string[];
}

export type WorkModeId = 'finance-research';

export type DomainSuggestionIcon =
  | 'report'
  | 'mainline'
  | 'monitor'
  | 'review'
  | 'evidence'
  | 'thesis'
  | 'calibration'
  | 'factor';

export type DomainFeatureIcon = 'browser';

export type DomainFeatureAction = 'open-url';

export interface DomainNavItem {
  id: string;
  label: string;
  badge?: string;
}

export interface DomainSuggestion {
  id: string;
  title: string;
  prompt: string;
  icon: DomainSuggestionIcon;
}

export interface DomainFeature {
  id: string;
  icon: DomainFeatureIcon;
  title: string;
  desc: string;
  shortcut?: string;
  requiresCwd?: boolean;
  action: DomainFeatureAction;
}

export interface DomainWorkspaceUi {
  emptyHeading: string;
  composerPlaceholder: string;
  followupPlaceholder: string;
  sidebar: {
    newConversationLabel: string;
    searchPlaceholder: string;
    pluginsLabel: string;
    automationLabel: string;
    projectSectionLabel: string;
    projectEmpty: string;
    projectConversationEmpty: string;
    conversationSectionLabel: string;
    conversationEmpty: string;
    settingsLabel: string;
  };
  rightPanelTitle: string;
  suggestions: DomainSuggestion[];
  features: DomainFeature[];
}

export interface DomainConfig {
  id: WorkModeId;
  name: string;
  edition: string;
  assistantName: string;
  modeTitle: string;
  modeDescription: string;
  modeTag: string;
  prompt: DomainPromptPack;
  ui: DomainWorkspaceUi;
  navigation: {
    personal: DomainNavItem[];
    integrations: DomainNavItem[];
    coding: DomainNavItem[];
    archived: DomainNavItem[];
  };
}

export const financeResearchDomain: DomainConfig = {
  id: 'finance-research',
  name: 'Alpha Studio',
  edition: 'Finance Research Edition',
  assistantName: 'Alpha Studio',
  modeTitle: '金融投研',
  modeDescription: '聚焦市场、行业、公司、组合与风险分析',
  modeTag: '金融版',
  prompt: {
    systemLines: [
      '你是 Alpha Studio，一个金融投研工作台助手。',
      '你的默认任务是帮助用户进行市场观察、行业研究、公司分析、组合复盘、风险提示和材料整理。',
      '优先使用用户提供的资料、可见上下文和明确来源；无法确认的事实要说明不确定性和需要补充的数据。',
      '涉及行情、估值、交易、监管或投资判断时，说明数据时点、关键假设、风险因素，并避免把研究观点表述为确定性收益承诺。',
      '回答应区分事实、推断和建议，必要时给出后续尽调清单。',
    ],
    responseGuidance: [
      '回答应简洁、可追溯，适合投研协作。',
      '优先给出结论、关键依据、风险和下一步行动。',
      '不要提供个性化投资建议；如需判断，明确前提、时点和不确定性。',
    ],
  },
  ui: {
    emptyHeading: '今天想研究什么？',
    composerPlaceholder: '询问投研问题，或录入实盘持仓与买卖记录',
    followupPlaceholder: '继续追问投研问题',
    sidebar: {
      newConversationLabel: '新对话',
      searchPlaceholder: '搜索对话、研究主题或资料目录',
      pluginsLabel: '技能',
      automationLabel: '自动化',
      projectSectionLabel: '研究主题',
      projectEmpty: '用研究主题归档相关对话和资料目录',
      projectConversationEmpty: '暂无对话',
      conversationSectionLabel: '对话',
      conversationEmpty: '暂无未归类的对话',
      settingsLabel: '设置',
    },
    rightPanelTitle: '投研侧栏',
    suggestions: [
      {
        id: 'daily-report',
        title: '生成今日报告',
        prompt: '使用 $alpha-studio-daily-theme-research 生成今日的报告',
        icon: 'report',
      },
      {
        id: 'mainline-trend-report',
        title: '产业主线早报',
        prompt: MAINLINE_TREND_CARD_PROMPT,
        icon: 'mainline',
      },
      {
        id: 'intraday-monitor',
        title: '盘中监控',
        prompt: INTRADAY_MONITOR_CARD_PROMPT,
        icon: 'monitor',
      },
      {
        id: 'evening-review',
        title: '晚间复盘',
        prompt: REPORT_REVIEW_CARD_PROMPT,
        icon: 'review',
      },
      {
        id: 'evidence-intelligence',
        title: '核验研究证据',
        prompt: EVIDENCE_INTELLIGENCE_CARD_PROMPT,
        icon: 'evidence',
      },
      {
        id: 'company-thesis',
        title: '公司 Thesis',
        prompt: COMPANY_THESIS_CARD_PROMPT,
        icon: 'thesis',
      },
      {
        id: 'research-calibration',
        title: '研究校准',
        prompt: RESEARCH_CALIBRATION_CARD_PROMPT,
        icon: 'calibration',
      },
      {
        id: 'factor-mining',
        title: '挖掘量化因子',
        prompt: FACTOR_MINING_CARD_PROMPT,
        icon: 'factor',
      },
    ],
    features: [
      {
        id: 'browser',
        icon: 'browser',
        title: '浏览器',
        desc: '打开行情、公告或研究资料',
        shortcut: '⌘T',
        action: 'open-url',
      },
    ],
  },
  navigation: {
    personal: [
      { id: 'general', label: '显示偏好' },
      { id: 'report-branding', label: '报告品牌' },
      { id: 'profile', label: '账户与授权' },
      { id: 'runtime', label: 'Harness' },
      { id: 'usage', label: '使用情况和计费' },
    ],
    integrations: [],
    coding: [],
    archived: [{ id: 'archived', label: '已归档对话' }],
  },
};

export interface WorkModeOption {
  id: string;
  title: string;
  description: string;
  tag: string;
  available: boolean;
}

export const DEFAULT_WORK_MODE_ID: WorkModeId = financeResearchDomain.id;

export const WORK_MODE_OPTIONS: WorkModeOption[] = [
  {
    id: financeResearchDomain.id,
    title: financeResearchDomain.modeTitle,
    description: financeResearchDomain.modeDescription,
    tag: financeResearchDomain.modeTag,
    available: true,
  },
  {
    id: 'vertical-packs',
    title: '更多垂直领域',
    description: '商业领域包接入后会在这里出现',
    tag: '即将推出',
    available: false,
  },
];

export const DOMAIN_REGISTRY: Record<WorkModeId, DomainConfig> = {
  [financeResearchDomain.id]: financeResearchDomain,
};

export function isWorkModeId(value: unknown): value is WorkModeId {
  return typeof value === 'string' && value in DOMAIN_REGISTRY;
}

export function activeDomain(modeId: unknown = DEFAULT_WORK_MODE_ID): DomainConfig {
  return isWorkModeId(modeId) ? DOMAIN_REGISTRY[modeId] : financeResearchDomain;
}
