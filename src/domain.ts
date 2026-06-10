export interface DomainPromptPack {
  systemLines: string[];
  responseGuidance: string[];
}

export type WorkModeId = 'core-coding';

export type DomainSuggestionIcon = 'file-code' | 'code' | 'wrench';

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

export const coreCodingDomain: DomainConfig = {
  id: 'core-coding',
  name: 'Alpha Studio',
  edition: 'Source-Available Noncommercial Edition',
  assistantName: 'Alpha Studio',
  modeTitle: '适用于编程',
  modeDescription: '更具技术性的回复和控制',
  modeTag: '公开源码版',
  prompt: {
    systemLines: [
      '你是 Alpha Studio，一个公开源码非商业版的本地编码工作台助手。',
      '你的默认任务是帮助用户理解代码、修改项目、运行检查、解释结果，并把风险和下一步清楚说明。',
      '优先使用当前工作区、项目文件、Git 状态和用户提供的上下文；无法确认的事实要明确说出不确定性。',
      '执行代码变更时保持范围收敛，尊重现有架构和用户未提交的改动。',
      '当任务涉及命令、文件、依赖或 Git 操作时，说明关键动作与验证结果。',
    ],
    responseGuidance: [
      '回答应简洁、直接、适合工程协作。',
      '需要计划时给出可执行步骤；需要实现时优先完成实现和验证。',
      '不要引入任何垂直行业设定，除非用户明确要求。',
    ],
  },
  ui: {
    emptyHeading: '把编码任务交给 Alpha Studio',
    composerPlaceholder: '要求 Codex 执行任务',
    followupPlaceholder: '要求后续变更',
    sidebar: {
      newConversationLabel: '新对话',
      searchPlaceholder: '搜索对话、项目或工作目录',
      projectSectionLabel: '项目',
      projectEmpty: '用项目把对话绑定到本地工作目录',
      projectConversationEmpty: '暂无对话',
      conversationSectionLabel: '对话',
      conversationEmpty: '暂无未归类的对话',
      settingsLabel: '设置',
    },
    rightPanelTitle: '编码工具',
    suggestions: [
      {
        id: 'understand-codebase',
        title: '理解代码库',
        prompt: '先扫描这个项目结构，告诉我主要模块、入口和运行方式。',
        icon: 'file-code',
      },
      {
        id: 'implement-feature',
        title: '实现功能',
        prompt: '帮我实现一个小功能：先读代码，再给出修改并运行必要验证。',
        icon: 'code',
      },
      {
        id: 'fix-tests',
        title: '修复测试',
        prompt: '检查当前失败测试或类型错误，定位原因并修复。',
        icon: 'wrench',
      },
    ],
    features: [
      {
        id: 'files',
        icon: 'folder',
        title: '文件',
        desc: '浏览项目文件',
        shortcut: '⌘P',
        requiresCwd: true,
        action: 'reveal-cwd',
      },
      {
        id: 'browser',
        icon: 'browser',
        title: '浏览器',
        desc: '打开网站',
        shortcut: '⌘T',
        action: 'open-url',
      },
      {
        id: 'review',
        icon: 'review',
        title: '审查',
        desc: '查看代码更改',
        shortcut: '⌃⇧G',
        requiresCwd: true,
        action: 'open-review',
      },
      {
        id: 'terminal',
        icon: 'terminal',
        title: '终端',
        desc: '启动交互式 shell',
        shortcut: '⌃`',
        action: 'open-terminal',
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
      { id: 'snapshots', label: '应用快照' },
      { id: 'mcp', label: 'MCP 服务器' },
      { id: 'browser', label: '浏览器' },
      { id: 'computer', label: '电脑操控' },
    ],
    coding: [
      { id: 'hooks', label: '钩子' },
      { id: 'connections', label: '连接' },
      { id: 'git', label: 'Git' },
      { id: 'environment', label: '环境' },
      { id: 'worktrees', label: '工作树' },
    ],
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

export const DEFAULT_WORK_MODE_ID: WorkModeId = coreCodingDomain.id;

export const WORK_MODE_OPTIONS: WorkModeOption[] = [
  {
    id: coreCodingDomain.id,
    title: coreCodingDomain.modeTitle,
    description: coreCodingDomain.modeDescription,
    tag: coreCodingDomain.modeTag,
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
  [coreCodingDomain.id]: coreCodingDomain,
};

export function isWorkModeId(value: unknown): value is WorkModeId {
  return typeof value === 'string' && value in DOMAIN_REGISTRY;
}

export function activeDomain(modeId: unknown = DEFAULT_WORK_MODE_ID): DomainConfig {
  return isWorkModeId(modeId) ? DOMAIN_REGISTRY[modeId] : coreCodingDomain;
}
