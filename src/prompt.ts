import { coworkerById } from './coworkers';
import { activeDomain, type DomainConfig } from './domain';
import type { CoworkerSelection, ReviewRequest, SkillSelection } from './types';

export interface PromptOptions {
  planMode?: boolean;
  pursueGoal?: boolean;
  selectedSkill?: SkillSelection | null;
  nativeSkillInput?: boolean;
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
  const multi = coworkers.length > 1;
  const hasPmDeputy = coworkers.some((coworker) => coworker.id === 'pm_deputy');
  const lines = [
    '用户为本次任务召集了以下 AI 同事(它们已在 agents 目录中定义为可 spawn 的 sub-agent):',
    ...roster,
    '协作规则:',
    '- 你是调度者(主 agent),不要亲自替同事完成研究;必须使用 spawn agent 工具启动上面列出的每一位同事的 sub-agent(按 agent 名称精确匹配),把与其职责匹配的子任务分派给它。',
    // Root cause of the "garbled" transcript: multiple sub-agents streaming
    // long prose concurrently gets flattened into one text block. Fix it at the
    // source by giving every sub-agent a file outlet and keeping the chat text
    // block owned by the dispatcher alone.
    '- 关键(避免多代理并发把正文冲乱):每位被 spawn 的同事只做两件事——(1)把自己的完整署名意见写入一个独立文件;(2)向你(调度者)返回一段简短的结构化要点。子代理在聊天区最多只回一行状态(例如「① 市场策略官:已完成」),严禁在聊天区输出长篇分析、逐字草稿或思考过程,否则多位同事同时输出会把最终成稿冲成乱码。',
    '- 落盘约定:先在当前工作目录建立本次协作目录 `./coworker-notes/<任务或模板简称>-<YYYY-MM-DD>/`;每位同事把意见写到该目录下 `<agent-id>.md`;你把最终整合《纪要》写到该目录下 `<纪要名>-<YYYY-MM-DD>.md`。',
    '- 最终纪要必须是独立于同事署名文件的用户可读成稿;不得把 `compliance.md`、`research_plan.md`、`shared_inputs.md` 或任一单个同事文件当作最终《纪要》交付。合规文件只能作为来源、归档和表达口径素材。',
  ];
  if (multi) {
    lines.push(
      '- 多位同事的子任务应并行 spawn;等同事返回要点并写完各自文件后,你必须读取这些文件,再合成一份最终《纪要》。最终《纪要》先给综合判断和行动清单,再保留必要的同事署名意见或归档摘要。',
      '- 若某些同事文件缺失或只生成了合规/计划/共享输入文件,也要基于已有输入生成最终《纪要》,并在「完成核对」中标注缺失的同事、缺口和后续补充项;不能只停在合规归档或研究计划。',
    );
  } else {
    lines.push(
      '- 等该同事返回要点并写完文件后,你读取其文件,转述其交付物并以「编号 + 姓名」署名,再补充你作为调度者的简短结论。',
    );
  }
  lines.push(
    '- 唯一长文出口:整个对话里只有你(调度者)输出这份最终《纪要》长文;其余同事一律不在聊天区写长文,以保证正文不被并发输出打断或串行错乱。',
    '- 最终答复必须是面向用户的干净成稿:不要把技能说明全文、工具日志、检索过程、spawn 过程、sub-agent 原始输出或半句草稿粘贴进正文;先收集各同事文件里的要点,再一次性整合。',
    '- 完成闸门:任一同事返回“已完成”只代表子任务完成,绝不代表本轮用户任务完成。你必须等待所有已启动同事结束,读取已有产物,然后由你输出最终整合答复;严禁把“⑦风险控制官:已完成”等状态行作为最后一句并结束本轮。',
    '- 结构化协议优先:如果用户任务指定了 JSON schema、固定 runId/reportId 或机器可读字段,最终答复正文必须直接包含合格 JSON 代码块。JSON 不能只写入文件、不能只返回路径,也不能被 TODO、文件落盘或纪要格式替代;发送前必须逐项检查 schema 与必填字段。',
    '- 最终成稿必须让用户直接读懂结论、机会、风险和下一步动作;归档、合规、来源和缺口只能作为正文后部或附录,不得替代结论与行动清单。',
    '- 如果用户导入的是协作模板,优先遵守模板中的输出结构;除非用户明确要求正式报告/HTML/PDF,不要自动扩展成多页正式报告。',
    '- 对复杂协作任务,先在最终答复开头给出「本次 TODO」清单,再按 TODO 顺序整合各同事结论;结尾用「完成核对」逐项标注已完成/未完成和缺口,防止偏离主任务。',
    '- 交付方式:先在聊天区给出①一句话结论 + 行动清单摘要、②最终《纪要》文件的路径,再附上完整《纪要》正文供直接阅读;若当前为只读沙箱、无法写文件,则说明无法落盘,并把完整《纪要》直接输出在聊天区。',
  );
  if (hasPmDeputy) {
    lines.push('- ⑧ 基金经理副官在场:最终汇总部分由它的口吻执笔,给出带立场的综合判断(「我会怎么做、为什么」)。');
  }
  lines.push('- 如果当前环境不支持 spawn agent 工具,则退化为:你在同一回复中依次扮演每位同事(串行,一位写完再写下一位,避免交叉输出),产出同样按署名小节组织的结论,并说明是在单会话内模拟的协作;仍按上面的要求给出干净《纪要》并落盘为文件(若可写)。');
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
    if (options.nativeSkillInput) {
      modeLines.push(
        `当前指定 Skill：${skill.title} (${skill.id}) 已作为 GPT 原生 skill input 传入；按本地引擎载入的 SKILL.md、工具规则和依赖说明执行。若引擎未能提供该 Skill 的说明，简短说明原因，再用最合适的方式继续。`,
      );
    } else {
      modeLines.push(
        `当前指定 Skill：${skill.title} (${skill.id})。必须优先使用这个 Skill 的说明、工作流和工具路线来完成任务；如果任务明显不适合该 Skill，先简短说明原因，再用最合适的方式继续。`,
      );
    }
    if (skill.id === 'alpha-studio-daily-theme-research') {
      modeLines.push(
        'Alpha Studio 盘前主题协议：这个 Skill 的研究规则、报告结构、输出深度、评分、连续跟踪、产业链真实性、执行闸门和校验要求必须与 `neostream-daily-theme-research` 保持一致；仅将名称/品牌/Logo 替换为 Alpha Studio / Alpha Studio Research。',
        '默认生成正式日报而不是简版。除非用户明确要求快报或 9:25 集合竞价确认，报告必须包含 `今日执行闸门`、`今日资金进攻路径`、`今日进攻概率`、`情绪指标仪表盘`、`隔夜全球线索`、`全球线索到A股题材映射`、`上一期主题连续跟踪`、`题材分级与生命周期`、`题材持续时间与持有复核`、`龙头 / 中军 / 趋势核心 / 补涨矩阵`、`来源与风险提示`。',
        '角色矩阵默认不要拆成 `ROLE MATRIX I/II`。使用一张五列紧凑表：`题材 / 角色 / 标的 / 角色逻辑 / 确认/失效`；不要添加 `持有复核`、`今日处理` 等列，相关内容放在表后 callout 或单独 `角色限制` 表。',
        '自动入库是完成条件：必须在 HTML/PDF 同目录静默生成完整的 `alpha.premarket_theme.v2` 文件 `.alpha-studio-tracking.json`，且在文件成功生成并自检前不得宣称报告完成。不要在最终回复中展示、链接或解释这个内部 JSON；最终回复只交付用户可读的 HTML/PDF。',
        '`.alpha-studio-tracking.json` 是投研工作台的唯一自动入库数据源，HTML 只负责阅读，客户端不得依赖 HTML 的字段位置或表格结构。JSON 必须包含全局 `executionGate`、`capitalAttackPath`、`marketSentiment`、`previousContinuity`、`risks`、`sourceNotes`，以及每个主题的结论、生命周期、资金类型、概率、观察权重、持有窗口、只做/不做、失效、风险、证券代码、角色、真实性和完整 `triggerSpecs`；不得用“未给出/待确认/待验证”占位。',
      );
    }
    if (skill.id === 'imagegen') {
      modeLines.push(
        '图片生成任务完成闸门：必须实际调用图片生成工具并等待它返回可展示的图片结果后才能结束；读取 `SKILL.md`、只发起生成调用或只回复“已生成”都不算完成。成功图片会由 Alpha Studio 从工具结果中直接渲染，生成成功后无需额外复述；如果工具明确失败且无法重试，必须说明未完成和原因。',
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
