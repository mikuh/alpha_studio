# Alpha Studio：OpenAI / ChatGPT / Codex 商业使用边界核查

> 核查日期：2026-08-04（Asia/Shanghai）  
> 范围：`research_plan.md` 子问题 2；仅采用 OpenAI 官方来源。  
> 方法：OpenAI 官方文档 MCP + 5 次限定官方域名的网页搜索。  
> 说明：以下是平台条款与产品规则核查，不是法律意见；涉及定制合同、经销资格或特殊地区许可时，应以 OpenAI 的书面确认为准。

## 一、结论摘要

1. **当前不能把 OpenAI API、ChatGPT 或 Codex 作为面向中国大陆用户的正式在线能力直接上线。** OpenAI 的 API 与 ChatGPT 支持地区页面都明确写明：在清单外“访问或提供访问”可能导致账号被封禁或停用。中国大陆不在当前两份清单中；香港、澳门也未列出，台湾列出。该规则按访问地区表述，不是按用户国籍表述。
2. **“共享 ChatGPT/Codex 企业账号池”或“共享个人订阅账号池”不可上线。** OpenAI 禁止多人共享账号/登录凭据，商业协议还明确禁止转售或出租对客户账号及终端用户账号的访问；每个终端用户账号只能由一个终端用户使用。
3. **不能把 ChatGPT/Codex 登录态、`auth.json`、session token 或 API key 发给客户，或由多个客户轮用。** OpenAI 明确禁止账号共享，也禁止买卖或转移 API key；官方安全指引要求 API key 留在自己的后端，不能部署到浏览器或移动端。
4. **合规的标准产品化路径是 OpenAI API，而不是把 ChatGPT 订阅“转成 API”。** OpenAI 商业协议明确允许客户把 API 集成进自己的应用并将应用提供给终端用户；“终端用户”可包括客户。但这项授权不等于可以把 OpenAI 账号、席位或凭据直接转售给客户。
5. **ChatGPT/Codex 订阅与 API 是两套权限、计费和组织体系。** ChatGPT 登录是订阅访问；API key 是按量访问，按标准 API 价格另行计费。ChatGPT Enterprise workspace 成员资格不会自动授予 API Platform organization 资格。
6. **因此，对 Alpha Studio 的直接含义是：** 如果目标用户位于中国大陆，OpenAI 线路本身是上线阻断项；即便未来只服务支持地区，也必须删除共享账号池/凭据中转设计，改为 Alpha Studio 自有后端调用正式 API，或要求客户在其自有、合规的 API 组织和部署环境中运行。若要向外部客户销售 ChatGPT/Codex 席位或账号访问，必须先取得 OpenAI 明确的书面经销/转售授权，不能依赖标准条款自行开展。

## 二、逐项规则与判断

### 1. API 与 ChatGPT 支持地区

**官方规则**

- [OpenAI API 支持地区](https://developers.openai.com/api/docs/supported-countries)写明：在所列国家和地区之外“访问或提供访问”可能导致账号被封禁或停用。
- [ChatGPT 支持地区](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)使用相同口径，覆盖 ChatGPT 网页和移动端访问。
- 当前完整清单中，中国大陆、香港、澳门均未列出；台湾列出。OpenAI 的[现行服务协议](https://cdn.openai.com/osa/openai-services-agreement.pdf)也把 API 与 ChatGPT 的这两份动态清单定义为“Supported Countries and Territories”（PDF 第 9 页）。

**对 Alpha Studio 的判断**

- 只把网关服务器放在美国、新加坡等支持地区，**不能消除中国大陆终端用户风险**。官方措辞不仅覆盖“访问”，也覆盖向清单外地区“提供访问”；因此，海外中转或代理转发不能作为合规依据。
- 若 Alpha Studio 面向中国大陆客户开放 OpenAI 模型入口，无论客户是否直接看到 OpenAI 品牌或凭据，都属于高概率落入“向不支持地区提供访问”的情形，应作为 **P0 上线阻断项**。
- 地区规则针对实际访问所在地。中国企业的员工若确实位于支持地区，不能仅因企业国籍断言其访问违规；反过来，位于中国大陆的用户也不能因账号或服务器注册在海外而被视为已满足支持地区要求。
- 正式上线前应按终端用户实际访问地区做 geo-fencing，并默认关闭中国大陆、香港、澳门的 OpenAI 路由。若业务必须覆盖这些地区，应取得 OpenAI 对具体架构和客户地域的书面许可；在收到许可前不能上线该线路。

### 2. 账号共享、凭据共享与账号池

**官方规则**

- [个人服务《Terms of Use》](https://openai.com/policies/terms-of-use/)规定，不得共享账号凭据或把账号提供给他人；还禁止出租、出售或分发 OpenAI 服务。
- [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989)进一步说明，账号仅供创建该账号的个人使用；其他人需要使用 OpenAI 产品时，应各自注册自己的账号。一个人可以在多台设备上使用自己的账号，但这不等于多人可以共用一个账号。
- [现行 OpenAI Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)第 3.1–3.3 条规定：不得在多个用户间共享账号访问凭据或个人登录凭据；不得转售或出租对客户账号或任何终端用户账号的访问；每个终端用户账号只能配置、注册并供一个终端用户使用；不得与第三方买卖或转移 API key。

**对 Alpha Studio 的判断**

- 下列设计均不应上线：
  - 多个客户轮用同一个 ChatGPT Plus/Pro/Business/Enterprise/Codex 登录；
  - Alpha Studio 保存一批 ChatGPT/Codex 登录凭据并按请求调度；
  - 把账号、cookie、session token、Codex `auth.json` 或远程已登录环境交给客户使用；
  - 按月向客户出租某个 Enterprise/Codex 席位，或把席位访问打包进 Alpha Studio 收费套餐；
  - 通过共享账号池规避单席位、消息、token、速率或其他用量限制。
- 企业账号并不会改变“一账号/一终端用户”的规则。正确的内部企业用法是由 workspace 管理员给**实际、具名、单一的内部终端用户**分配席位；不能把若干席位做成匿名外部客户池。
- 商业协议对“End User”的定义可以包含客户，但标准条款明确授予的外部产品化权利是“把 **API 集成进 Customer Application** 并提供给终端用户”，并没有授予普通客户转售/出租 ChatGPT 或 Codex 账号的权利。若商业模式确实需要向外部客户提供原生席位，必须先取得 OpenAI 书面合同或正式经销授权。

### 3. API key 的正确边界

**官方规则**

- [API Key Safety](https://help.openai.com/en/articles/5112595)明确说 OpenAI 不支持共享 API key，key 应保持私密；不能部署到浏览器或移动端，API 请求应经过自己的后端，key 应存放在与应用分离的安全位置。
- 商业协议还明确禁止从第三方购买、向第三方出售或与第三方转移 API key。

**对 Alpha Studio 的判断**

- Alpha Studio 的桌面端、网页端、安装包、日志、配置导出和客户可见 API 都不得包含平台主 API key。
- “客户把自己的 OpenAI API key 填入 Alpha Studio 云端，由 Alpha Studio 托管使用”的 BYOK 模式也存在明显的凭据转移/共享风险，不应在未得到 OpenAI 书面确认前作为正式方案。
- 对支持地区的正常 SaaS 集成，优先采用：Alpha Studio 自己的商业 API 组织 + 后端密钥管理/KMS + 按项目或环境隔离的 key + 每租户额度、审计和滥用控制。终端客户只调用 Alpha Studio 自己的业务 API，不接触 OpenAI key。
- 若客户坚持使用自有 API 组织，更稳妥的结构是把调用组件部署在客户自有、可信环境内，让 key 始终由客户控制且不传给 Alpha Studio；但客户和用户所在地仍须属于 OpenAI 支持地区。

### 4. 可以把 API 能力提供给第三方客户，但不能把账号能力提供给第三方客户

**官方规则**

- [OpenAI Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)第 2.2 条明确允许使用 OpenAI API 将服务集成进客户自己的应用，并把该客户应用提供给终端用户。
- 同一协议对 `Customer Application` 的定义是“集成 OpenAI API 的客户应用、产品或服务”，对 `End User` 的定义包括客户公司的员工、顾问、客户、代理等获授权使用者。
- 该权利同时受到支持地区、OpenAI Policies、适用法律、用量限制、账号和 API key 限制等约束；违反协议或政策时 OpenAI 可限制或暂停服务。

**边界结论**

| 模式 | 标准条款下的结论 | 主要条件/问题 |
|---|---|---|
| Alpha Studio 后端调用正式 OpenAI API，将结果作为自有产品功能给终端用户 | 原则上允许 | 终端用户必须在支持地区；key 不外泄；遵守政策和适用法律 |
| 将 ChatGPT Plus/Pro 账号交给客户 | 不允许 | 个人账号不得共享或向他人提供；不得出租/出售服务 |
| 将 Business/Enterprise/Codex 账号或席位组成外部客户池 | 不允许按标准条款自行开展 | 登录不得多人共享；终端用户账号只能单人使用；不得转售/出租账号访问 |
| 向外部客户销售具名 ChatGPT/Codex 席位 | 不能仅凭标准条款认定允许 | 需要 OpenAI 书面经销/转售安排或针对该模式的书面许可 |
| 让客户在桌面端填写 Alpha Studio 的主 API key | 不允许 | 客户端暴露和共享 key 均违反官方安全要求 |
| 让位于中国大陆的客户通过海外网关访问 OpenAI | 不应上线 | “在清单外提供访问”可能导致封禁/停用 |

### 5. ChatGPT、Codex 订阅与 API 的区别

**官方规则**

- [Codex Authentication](https://learn.chatgpt.com/codex/auth)明确区分两种登录：`Sign in with ChatGPT` 是订阅访问；`Sign in with an API key` 是按量访问。API key 模式按标准 API 价格计费，而不是消耗 ChatGPT 计划内 credits；部分依赖 ChatGPT workspace 或云服务的功能在 API key 模式不可用。
- [Codex Pricing](https://learn.chatgpt.com/docs/pricing)也把 ChatGPT 个人/Business/Enterprise 计划和 `API Key` 作为不同方案：API key 适合 CI 等共享自动化环境，按 API token 计费，但不包含 Codex cloud、GitHub code review、Slack 等 ChatGPT 云端能力。
- [What is ChatGPT Enterprise?](https://help.openai.com/en/articles/8265053-what-is-chatgpt-enterprise)明确说 ChatGPT Enterprise workspace 与 API Platform organization 是两套独立成员体系；拥有 Enterprise workspace 席位不会自动获得 API Platform 访问。
- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)说明 Codex 可包含在相应 ChatGPT 计划中，并受对应的 ChatGPT Terms of Use 或企业在线服务协议约束。

**对 Alpha Studio 的判断**

- 不能把 ChatGPT/Codex 订阅的“包含用量”当作 Alpha Studio 模型网关的批发 token，也不能用用户登录 session 模拟 API。
- 对客户提供程序化模型能力，应计入正式 API 组织的按量成本、配额与速率限制；ChatGPT 席位预算与 API 预算必须在产品计费、成本核算和权限模型中完全分开。
- 如果 Alpha Studio 使用 Codex CLI/SDK 做内部自动化，官方文档建议 API key 用于 CI/CD 等可信环境，并明确提示不要把 Codex execution 暴露在不可信或公共环境中。客户可触发的公共 Codex 执行器必须另做安全隔离，而且不能借此绕过账号与地区规则。

## 三、建议的上线分级

### P0：上线阻断项

1. 中国大陆、香港、澳门用户可触达任何 OpenAI API、ChatGPT 或 Codex 路由。
2. 任何共享 ChatGPT/Codex 账号池、cookie/session token 池、`auth.json` 池或多人共用席位。
3. 任何向客户下发 OpenAI API key，或把主 key 写入桌面端/浏览器/移动端的实现。
4. 把 ChatGPT/Codex 订阅登录态当作模型网关后端，向客户转售其用量或能力。
5. 对外收费提供 ChatGPT/Codex 原生账号或席位，但没有 OpenAI 的明确书面经销/转售授权。

### P1：上线前必须完成（仅针对支持地区）

1. 使用 Alpha Studio 自有、合同主体一致的 OpenAI API 组织和正式 API；密钥只在后端/KMS 中保存。
2. 加入终端用户实际地区校验、IP/账户异常检测与 OpenAI 路由 geo-fencing，不能只检查服务器出口地址。
3. 给每个租户建立用量、速率、预算、滥用与审计隔离；不通过账号轮换规避限制。
4. 产品协议中向终端用户传导 OpenAI Usage Policies、禁止用途、输出准确性提示与必要同意，并保留暂停违规用户的能力。
5. 将 ChatGPT/Codex 席位、ChatGPT credits 与 API token 成本拆成不同的 entitlement、计费科目和配置项。
6. 如果计划让外部客户成为 Enterprise/Codex 具名席位用户，先把完整业务模式提交 OpenAI Sales/Legal，获得写入订单或协议的明确许可。

### P2：可后续优化

1. 定期自动复核两份支持地区清单和 Services Agreement 版本；地区清单会动态更新。
2. 增加 key 轮换、IP allowlist、最小权限 project key、异常费用告警和泄漏应急流程。
3. 在 UI 中清楚标注当前请求走 ChatGPT/Codex 订阅还是 API，避免用户误以为 ChatGPT 订阅包含 API 用量。

## 四、官方来源清单

1. [OpenAI API — Supported countries and territories](https://developers.openai.com/api/docs/supported-countries)
2. [ChatGPT Supported Countries](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)
3. [OpenAI Services Agreement（现行 PDF，页面标识 v.010126）](https://cdn.openai.com/osa/openai-services-agreement.pdf)
4. [OpenAI Terms of Use](https://openai.com/policies/terms-of-use/)
5. [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989)
6. [Best Practices for API Key Safety](https://help.openai.com/en/articles/5112595)
7. [Codex Authentication](https://learn.chatgpt.com/codex/auth)
8. [Codex Pricing and feature availability](https://learn.chatgpt.com/docs/pricing)
9. [What is ChatGPT Enterprise?](https://help.openai.com/en/articles/8265053-what-is-chatgpt-enterprise)
10. [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)

## 五、证据限制

- OpenAI 的支持地区清单、产品计划和企业条款可能随时更新。本文件只反映 2026-08-04 核查时可见的官方规则。
- 官方公开材料未授予普通 API/Enterprise 客户一般性的 ChatGPT/Codex 席位转售权；但无法通过公开材料排除 OpenAI 对特定合作伙伴另行签署经销协议的可能。对外席位业务必须以 OpenAI 书面合同为准。
- “海外服务器转发给中国大陆用户仍属于在不支持地区提供访问”是依据官方“accessing or offering access”措辞作出的直接产品合规判断；如 Alpha Studio 要采用特殊跨境架构，应让 OpenAI 书面确认该具体架构，而不是依赖技术中转推定合规。
