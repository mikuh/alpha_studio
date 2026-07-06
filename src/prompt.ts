import { coworkerById } from './coworkers';
import { activeDomain, type DomainConfig } from './domain';
import type { CoworkerSelection, ReviewRequest, SkillSelection } from './types';

export interface PromptOptions {
  planMode?: boolean;
  pursueGoal?: boolean;
  selectedSkill?: SkillSelection | null;
  coworkers?: CoworkerSelection[] | null;
}

// Builds the orchestration protocol injected when the user summons one or
// more AI coworkers. The main agent always stays the dispatcher: it spawns
// the matching sub-agents (defined in CODEX_HOME/agents/<id>.toml), assigns
// each a sub-task, waits for the results, and merges them into one reply.
export function buildCoworkerOrchestrationLines(coworkers: CoworkerSelection[]): string[] {
  const roster = coworkers.map((coworker) => {
    const profile = coworkerById(coworker.id);
    const duty = profile ? profile.description : '';
    return `- agent \`${coworker.id}\`(${coworker.no} ${coworker.name}${duty ? `,职责:${duty}` : ''})`;
  });
  const hasPmDeputy = coworkers.some((coworker) => coworker.id === 'pm_deputy');
  const lines = [
    '用户为本次任务召集了以下 AI 同事(它们已在 agents 目录中定义为可 spawn 的 sub-agent):',
    ...roster,
    '协作规则:',
    '- 你是调度者(主 agent),不要亲自替同事完成研究;必须使用 spawn agent 工具启动上面列出的每一位同事的 sub-agent(按 agent 名称精确匹配),把与其职责匹配的子任务分派给它。',
    coworkers.length > 1
      ? '- 多位同事的子任务应并行 spawn;等全部同事返回结果后,再汇总输出一份联合结论,联合结论按同事分小节呈现,每个小节以「编号 + 姓名」署名,最后给出综合判断。'
      : '- 等该同事返回结果后,转述其交付物并以「编号 + 姓名」署名,再补充你作为调度者的简短结论。',
  ];
  if (hasPmDeputy) {
    lines.push('- ⑧ 基金经理副官在场:最终汇总部分由它的口吻执笔,给出带立场的综合判断(「我会怎么做、为什么」)。');
  }
  lines.push('- 如果当前环境不支持 spawn agent 工具,则退化为:你在同一回复中依次扮演每位同事,产出同样按署名小节组织的结论,并说明是在单会话内模拟的协作。');
  return lines;
}

export function buildCodingInstructions(
  options: PromptOptions = {},
  domain: DomainConfig = activeDomain(),
): string {
  const modeLines: string[] = [];
  if (options.planMode) {
    modeLines.push(
      '当前处于「计划模式」：先只读地调研资料与上下文，输出分步骤的可执行计划，并在获得用户确认前不要修改文件或运行有副作用的操作。',
    );
  }
  if (options.pursueGoal) {
    modeLines.push(
      '当前开启「追求目标」：持续自主推进，直到任务目标达成或确实被外部因素阻塞；每完成一步说明进展、验证结果与下一步。',
    );
  }
  if (options.selectedSkill) {
    const skill = options.selectedSkill;
    modeLines.push(
      `当前指定 Skill：${skill.title} (${skill.id})。必须优先使用这个 Skill 的说明、工作流和工具路线来完成任务；如果任务明显不适合该 Skill，先简短说明原因，再用最合适的方式继续。`,
    );
    if (skill.id === 'imagegen') {
      modeLines.push(
        '图片生成展示要求：在对话中简短说明正在生成或处理的关键步骤；最终必须把每张生成图片用可渲染的 Markdown 图片语法 `![说明](绝对路径或URL)` 或明确的本地绝对路径/URL 展示出来，并说明保存位置。不要只回复“已生成”；如果没有实际得到图片文件、URL 或可展示结果，必须说明未完成和原因。',
      );
    }
  }
  if (options.coworkers && options.coworkers.length) {
    modeLines.push(...buildCoworkerOrchestrationLines(options.coworkers));
  }

  return [
    ...domain.prompt.systemLines,
    ...(modeLines.length ? ['', ...modeLines] : []),
    '',
    '自动化与提醒：',
    '- Alpha Studio 会在发送给模型前直接处理简单的提醒和周期任务；如果你仍收到自动化请求，说明它需要澄清或超出了客户端自动识别范围。',
    '- 不要声称可以调用 `automation_update`，也不要自行通过 shell、crontab、launchd、osascript、本地文件、后台脚本或系统通知来实现自动化；除非用户明确要求本机系统级方案。',
    '- 对复杂自动化，请用简短中文列出建议配置（标题、频率、任务内容、运行环境）并请用户到左侧「自动化」页创建或补充缺失信息。',
    '',
    '回答要求：',
    ...domain.prompt.responseGuidance.map((line) => `- ${line}`),
  ].join('\n');
}

export function buildCodingPrompt(
  userPrompt: string,
  options: PromptOptions = {},
  domain: DomainConfig = activeDomain(),
): string {
  return [
    buildCodingInstructions(options, domain),
    '',
    '用户任务：',
    userPrompt,
  ].join('\n');
}

// Describes which diff a review turn should inspect and how to obtain it. Mirrors
// Codex's /review presets (uncommitted / base branch / commit / custom).
function reviewTargetLines(request: ReviewRequest): string[] {
  switch (request.kind) {
    case 'base':
      return [
        `审查目标：当前分支相对基础分支 \`${request.target}\` 的全部改动（用于开 PR 前的预审）。`,
        `运行 \`git diff ${request.target}...HEAD\` 获取改动，必要时用 \`git log ${request.target}..HEAD\` 了解提交序列。`,
      ];
    case 'commit':
      return [
        `审查目标：提交 \`${request.target}\`${request.commitSubject ? `（${request.commitSubject}）` : ''} 引入的改动。`,
        `运行 \`git show ${request.target}\` 查看该提交的完整改动。`,
      ];
    case 'uncommitted':
    default:
      return [
        '审查目标：工作区中所有未提交的改动（已暂存、未暂存、未跟踪的新文件）。',
        '运行 `git status`、`git diff`（未暂存）、`git diff --cached`（已暂存）查看改动；用 `git status --porcelain` 找出未跟踪文件并逐个阅读。',
      ];
  }
}

// Builds the reviewer prompt. The reviewer runs read-only, finds prioritized
// issues, and must end with a fenced ```json block the UI parses into cards.
export function buildReviewPrompt(request: ReviewRequest): string {
  const lines: string[] = [
    '你现在是一个严谨的资深代码审查员（code reviewer）。请只读地审查下面指定的改动，不要修改任何文件，也不要运行有副作用的命令。',
    '',
    ...reviewTargetLines(request),
  ];

  if (request.instructions && request.instructions.trim()) {
    lines.push('', `额外审查重点（用户指定）：${request.instructions.trim()}`);
  }

  lines.push(
    '',
    '审查时重点关注：',
    '- Bug 与逻辑错误（包括边界条件、空值、并发、错误处理）',
    '- 安全漏洞（注入、越权、密钥泄露、未校验输入）',
    '- 性能问题与明显的资源浪费',
    '- 可维护性问题（命名混乱、重复、违反约定、缺少必要测试）',
    '- 仅当风格问题严重影响可读性时才指出',
    '',
    '对每个问题给出可执行的修改建议，并尽量定位到具体文件与行号。',
    '',
    '输出格式要求（务必严格遵守）：',
    '1. 先用简体中文写一段简短的整体结论（2-4 句），说明改动是否可以合入以及主要风险。',
    '2. 然后在回答的最后输出且只输出一个 ```json 代码块，内容是如下结构的 JSON 对象（不要在代码块外再放 JSON）：',
    '```json',
    '{',
    '  "verdict": "correct | incorrect",',
    '  "summary": "一句话总体结论",',
    '  "findings": [',
    '    {',
    '      "priority": "P0 | P1 | P2 | P3",',
    '      "title": "简短的问题标题（祈使句，≤40字）",',
    '      "body": "为什么这是问题，以及建议怎么改",',
    '      "file": "相对工作目录的文件路径",',
    '      "lineStart": 12,',
    '      "lineEnd": 18,',
    '      "confidence": 0.0,',
    '      "suggestion": "可选：建议替换的代码片段"',
    '    }',
    '  ]',
    '}',
    '```',
    '说明：verdict 为 "correct" 表示没有阻断性问题、可以合入；"incorrect" 表示存在必须解决的问题。priority 从 P0（严重/阻断）到 P3（可选优化）。confidence 取 0~1。若没有发现任何问题，findings 返回空数组 [] 且 verdict 为 "correct"。file/lineStart/lineEnd/suggestion 不确定时可省略对应字段。',
  );

  return lines.join('\n');
}
