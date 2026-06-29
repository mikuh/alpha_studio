export interface DomainPromptPack {
  systemLines: string[];
  responseGuidance: string[];
}

export type WorkModeId = 'finance-research';

export type DomainSuggestionIcon = 'market' | 'research' | 'risk';

export type DomainFeatureIcon = 'browser' | 'chat';

export type DomainFeatureAction = 'open-url' | 'open-side-chat';

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
    emptyHeading: '把投研问题交给 Alpha Studio',
    composerPlaceholder: '询问市场、行业、公司或组合问题',
    followupPlaceholder: '继续追问投研问题',
    sidebar: {
      newConversationLabel: '新对话',
      searchPlaceholder: '搜索对话、研究主题或资料目录',
      pluginsLabel: '能力',
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
        id: 'market-move',
        title: '分析市场异动',
        prompt: '帮我梳理今天市场主要异动、可能驱动因素和需要继续跟踪的信号。',
        icon: 'market',
      },
      {
        id: 'company-research',
        title: '整理公司研究',
        prompt: '基于我提供的材料，整理一家公司基本面、催化剂、风险和待验证问题。',
        icon: 'research',
      },
      {
        id: 'portfolio-risk',
        title: '评估组合风险',
        prompt: '帮我复盘一个持仓组合的行业暴露、主要风险和后续观察指标。',
        icon: 'risk',
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
      {
        id: 'side-chat',
        icon: 'chat',
        title: '侧边聊天',
        desc: '保留当前上下文继续追问',
        shortcut: '⌥⌘S',
        action: 'open-side-chat',
      },
    ],
  },
  navigation: {
    personal: [
      { id: 'general', label: '常规' },
      { id: 'profile', label: '个人资料' },
      { id: 'appearance', label: '外观' },
      { id: 'config', label: '配置' },
      { id: 'models', label: '模型' },
      { id: 'personalization', label: '个性化' },
      { id: 'keyboard', label: '键盘快捷键' },
      { id: 'usage', label: '使用情况和计费' },
    ],
    integrations: [
      { id: 'snapshots', label: '资料快照' },
      { id: 'mcp', label: '能力' },
      { id: 'browser', label: '浏览器' },
      { id: 'computer', label: '电脑操控' },
    ],
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
