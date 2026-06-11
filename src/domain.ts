export interface DomainPromptPack {
  systemLines: string[];
  responseGuidance: string[];
}

export type WorkModeId = 'brand-system';

export type DomainSuggestionIcon = 'folder' | 'sparkles' | 'wrench';

export type DomainFeatureIcon = 'folder' | 'browser' | 'review' | 'terminal';

export type DomainFeatureAction = 'reveal-cwd' | 'open-url' | 'open-review' | 'open-terminal';

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

export const brandSystemDomain: DomainConfig = {
  id: 'brand-system',
  name: 'Incuboot',
  edition: 'Brand Intelligence Edition',
  assistantName: 'Incuboot',
  modeTitle: '智能品牌系统',
  modeDescription: '围绕品牌目录组织资料、资产、策略和对话',
  modeTag: '品牌工作台',
  prompt: {
    systemLines: [
      '你是 Incuboot，一个面向智能品牌系统的本地品牌工作台助手。',
      '你的默认任务是帮助用户梳理品牌资料、分析素材、生成品牌策略与内容、沉淀品牌目录，并把依据和下一步清楚说明。',
      '优先使用当前品牌目录、已附加文件、历史对话和用户提供的上下文；无法确认的事实要明确说出不确定性。',
      '执行文件变更时保持范围收敛，尊重现有目录结构和用户未保存的内容。',
      '当任务涉及命令、文件、依赖或联网操作时，说明关键动作与验证结果。',
    ],
    responseGuidance: [
      '回答应简洁、直接、适合品牌协作。',
      '需要计划时给出可执行步骤；需要产出时优先给出可直接使用或可落地修改的内容。',
      '不要默认进入编程、代码审查或软件项目语境，除非用户明确要求。',
    ],
  },
  ui: {
    emptyHeading: '把品牌系统交给 Incuboot',
    composerPlaceholder: '描述品牌任务、上传素材或选择品牌目录',
    followupPlaceholder: '继续优化品牌资料、策略或内容',
    sidebar: {
      newConversationLabel: '新对话',
      searchPlaceholder: '搜索对话、品牌或品牌目录',
      projectSectionLabel: '品牌',
      projectEmpty: '用品牌目录把对话、素材和资料放在一起',
      projectConversationEmpty: '暂无品牌对话',
      conversationSectionLabel: '未归类对话',
      conversationEmpty: '暂无未归类的对话',
      settingsLabel: '设置',
    },
    rightPanelTitle: '品牌工具',
    suggestions: [
      {
        id: 'organize-brand-folder',
        title: '梳理品牌资料',
        prompt: '先扫描这个品牌目录，整理品牌定位、视觉资产、内容素材和待补充信息。',
        icon: 'folder',
      },
      {
        id: 'brand-audit',
        title: '品牌体检',
        prompt: '分析这个品牌目前的定位、受众、语气和视觉一致性，给我一个可执行的优化清单。',
        icon: 'sparkles',
      },
      {
        id: 'draft-brand-content',
        title: '生成内容',
        prompt: '基于当前品牌资料，生成一组适合官网、社媒和提案使用的品牌文案。',
        icon: 'wrench',
      },
    ],
    features: [
      {
        id: 'files',
        icon: 'folder',
        title: '品牌目录',
        desc: '打开品牌文件夹',
        shortcut: '⌘P',
        requiresCwd: true,
        action: 'reveal-cwd',
      },
      {
        id: 'browser',
        icon: 'browser',
        title: '参考网页',
        desc: '打开品牌参考链接',
        shortcut: '⌘T',
        action: 'open-url',
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

export const DEFAULT_WORK_MODE_ID: WorkModeId = brandSystemDomain.id;

export const WORK_MODE_OPTIONS: WorkModeOption[] = [
  {
    id: brandSystemDomain.id,
    title: brandSystemDomain.modeTitle,
    description: brandSystemDomain.modeDescription,
    tag: brandSystemDomain.modeTag,
    available: true,
  },
  {
    id: 'vertical-packs',
    title: '更多品牌能力',
    description: '行业品牌包接入后会在这里出现',
    tag: '即将推出',
    available: false,
  },
];

export const DOMAIN_REGISTRY: Record<WorkModeId, DomainConfig> = {
  [brandSystemDomain.id]: brandSystemDomain,
};

export function isWorkModeId(value: unknown): value is WorkModeId {
  return typeof value === 'string' && value in DOMAIN_REGISTRY;
}

export function activeDomain(modeId: unknown = DEFAULT_WORK_MODE_ID): DomainConfig {
  return isWorkModeId(modeId) ? DOMAIN_REGISTRY[modeId] : brandSystemDomain;
}
