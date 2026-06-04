export interface DomainPromptPack {
  systemLines: string[];
  responseGuidance: string[];
}

export interface DomainNavItem {
  id: string;
  label: string;
  badge?: string;
}

export interface DomainConfig {
  id: string;
  name: string;
  edition: string;
  assistantName: string;
  prompt: DomainPromptPack;
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
  navigation: {
    personal: [
      { id: 'general', label: '常规' },
      { id: 'profile', label: '个人资料' },
      { id: 'appearance', label: '外观' },
      { id: 'config', label: '配置' },
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

export function activeDomain(): DomainConfig {
  return coreCodingDomain;
}
