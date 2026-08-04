# Alpha Studio OpenAI 账号代持模式补充核查

> 核查日期：2026-08-04（Asia/Shanghai）  
> 范围：根据用户澄清，严格区分“多人共享账号池”与“每位用户一个账号但由不同主体持有或保管”的模式。  
> 来源：仅 OpenAI 官方条款、帮助中心及 Codex 官方文档；本轮使用 4 次官方域名检索。  
> 说明：本文件用于收窄前一份规则结论，不构成法律意见；定制订单、授权经销或托管安排应由 OpenAI 书面确认。

## 一、对原结论的明确收窄与撤回

需要撤回过宽的表述是：**“只要 Alpha 参与账号配置或一个客户对应一个账号，也一律属于共享账号池。”** 这个结论不准确。

严格区分后：

- **一位真实用户独占一个自己的账号，并自行向 OpenAI 签约/付费，通过 OpenAI 官方登录流程登录，Alpha 不接收也不控制凭据，不属于账号共享。**
- **企业组织在自己的 ChatGPT Enterprise workspace 内，为本组织员工分配具名、单人使用的席位，也不属于账号共享。** 这是 OpenAI 官方文档描述的正常企业成员管理方式。
- **一账号对应一人只能排除“多人共用”这一项风险，不能自动排除凭据共享、账号访问转售/出租、注册信息不准确或地区限制。** 因此 B、C 模式仍需分别审查。
- 前一份报告中关于中国大陆等不支持地区、API 与 ChatGPT/Codex 订阅分离、以及 API key 不应暴露给客户的结论不因本次澄清而改变。

## 二、四种模式的严格判断

| 模式 | 是否属于多人共享 | 是否可能构成转售/出租 | 凭据控制风险 | 当前结论 |
|---|---:|---:|---:|---|
| **A. 客户自有账号、自行签约付费、直接官方登录，Alpha 不见也不控制凭据** | 否 | 通常否 | 低 | 账号规则层面可接受，但必须满足地区限制，且只能使用 OpenAI 对该客户端正式支持的登录方式 |
| **B. 客户自己的账号，但密码/session/token/`auth.json` 由 Alpha 托管** | 若始终单人使用，则不是“多人共用” | 不一定；取决于收费和服务实质 | 高 | 不能因为 1:1 就视为已合规；普通密码/session 代管应停止，官方委托 token 仅能在文档规定的可信企业自动化边界内使用 |
| **C. Alpha 购买或创建订阅账号，再 1:1 提供给外部付费客户** | 若严格单人使用，则不是“多人共用” | 是，存在直接且重大的转售/出租风险 | 高 | 标准条款下不应上线；除非 Alpha 已取得 OpenAI 明确书面经销/转售授权 |
| **D. 企业组织为自身员工分配具名席位** | 否 | 否 | 可通过 SSO/SCIM/MFA 管理 | OpenAI 官方支持的正常模式；每席位必须单人、成员应是组织持续协作团队的一部分，并受地区限制 |

以下逐项展开。

### A. 客户自有账号、自行签约付费、直接官方登录，Alpha 不见凭据

**判断：不属于共享，也通常不属于 Alpha 转售 OpenAI 账号访问。**

成立条件应同时包括：

1. 客户本人或客户公司是实际账号/订单主体，向 OpenAI 直接接受适用条款并直接付费；如果通过经销商采购，应是 OpenAI 订单所承认的正式 reseller 渠道。
2. 账号使用者就是账号所对应的真实、单一终端用户。
3. 登录发生在 OpenAI 官方页面或 OpenAI 对该客户端明确支持的登录流程中。
4. 密码、MFA、恢复邮箱、session cookie、OAuth/access token、Codex `auth.json` 均不进入 Alpha 后端、客服系统、数据库、日志或 Alpha 可控制的远程主机。
5. Alpha 收取的是自己的软件或技术服务费，而不是未经授权地向客户销售 OpenAI 账号、席位或订阅访问。

[OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989)明确说一个账号可以由账号本人在多台设备上使用。因此，“客户本人在自己的设备上使用自己的账号”不因多设备而成为共享。

[Codex Authentication](https://learn.chatgpt.com/docs/auth)明确支持 ChatGPT desktop app、Codex CLI 和 IDE extension 通过浏览器完成 `Sign in with ChatGPT`；浏览器把凭据返回给 Codex。由此可以确认：**用户在自己控制的设备上通过官方 Codex 登录流程使用自己的订阅，是官方支持的模式。**

但需要一个重要边界：公开文档只明确列出 OpenAI 官方 ChatGPT/Codex 客户端及其官方流程，并未给予所有第三方应用一个通用的“使用 ChatGPT 订阅登录并消费订阅额度”的 OAuth 权利。因此：

- 如果 Alpha 只是启动或集成本机官方 Codex CLI/IDE extension，凭据始终留在用户设备或客户完全控制的环境内，账号共享风险较低。
- 如果 Alpha 自己实现一个第三方客户端，让 ChatGPT 登录 token 返回 Alpha 后端，或者 Alpha 服务器代表客户持续消费其订阅额度，即使登录页是官方页面，也已经不再满足本文件定义的 A，应归入 B。
- 不能仅用“Alpha 员工看不到明文”判断无代管；只要 token 落在 Alpha 能运维、备份、复制或调用的基础设施上，Alpha 就具有技术控制，应按 B 处理。

### B. 客户自己的账号，但凭据由 Alpha 托管

**判断：严格 1:1 时不一定属于多人共享，但仍有独立的凭据共享/账号可用性风险。**

[个人服务 Terms of Use](https://openai.com/policies/terms-of-use/)要求用户不得共享账号凭据，也不得让其他人使用自己的账号。客户把密码、MFA、session cookie 或可持续刷新 token 交给 Alpha，使 Alpha 可以代表客户登录或调用，至少与这一规则存在直接冲突风险；“只有该客户一个人使用输出”不能消除 Alpha 对账号的实际控制。

[Codex Authentication](https://learn.chatgpt.com/docs/auth)说明：

- Codex 会把登录凭据缓存在本地 `auth.json` 或操作系统凭据存储中；
- `auth.json` 含 access token，应像密码一样保护，不应在聊天、工单等渠道共享；
- ChatGPT Enterprise 可由管理员授权具名成员创建 Codex access token，但用途限定为可信、非交互的本地工作流、脚本、调度器和私有 CI runner；一般 OpenAI API 调用仍应使用 Platform API key；
- 官方还明确提示不要把 Codex execution 暴露在不可信或公共环境中。

因此 B 应继续细分：

| B 的实现 | 结论 |
|---|---|
| Alpha 收集客户密码、MFA、恢复邮箱、session cookie 或 `auth.json` | 不应上线；属于高风险凭据代管，且与个人账号不得共享凭据/让他人使用的规则直接冲突 |
| 客户在 Alpha 控制的云主机上完成登录，token 之后由 Alpha 运维或自动调用 | 仍按 Alpha 托管处理，不能因密码页面由客户亲自输入而归入 A |
| 客户 Enterprise 管理员按官方机制生成 Codex access token，放在客户控制的可信私有 runner | 官方文档明确支持；不是普通账号共享，但用途必须留在企业可信自动化边界内 |
| Enterprise access token 放在 Alpha 多租户 SaaS、公网执行器或可被 Alpha 任意调用的基础设施 | 官方公开材料不足以确认允许；不应上线，除非 OpenAI 对该托管架构书面确认 |
| 客户自有 Platform API key 留在客户自己的环境，由 Alpha 软件本地调用 | 凭据不由 Alpha 托管；更接近 A，但仍受 API 支持地区、API key 安全与客户 API 合同约束 |

如果 Alpha 希望提供“代运维”服务，建议采用客户控制的环境、客户控制的 secret store、可撤销的最小权限官方 token，以及客户组织自己的审计；不要接管个人账号密码或恢复要素。

### C. Alpha 购买或创建订阅账号，再 1:1 提供给外部付费客户

**判断：1:1 排除了多人共用，但没有排除账号访问转售/出租；标准条款下仍不应上线。**

适用的官方依据有两层：

1. [个人 Terms of Use](https://openai.com/policies/terms-of-use/)要求注册信息准确完整，禁止共享账号凭据或把账号提供给其他人，并禁止出租、出售或分发 OpenAI 服务。
2. [OpenAI Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)第 3.1 条明确规定商业客户不得转售或出租其 Account 或任何 End User Account 的访问；第 3.2 条要求每个 End User Account 只供单一 End User 使用。

这两条是并列要求：

- “每账号仅一个客户”满足的是单一 End User 要求；
- “Alpha 先购买/创建，再把访问作为付费服务交付给外部客户”仍可能命中不得转售/出租账号访问的要求。

所以 C 不能再被称为“共享账号池”，更准确的名称应是 **“1:1 外部账号代购/代持与访问转售模式”**。其主要问题是转售/出租和账号主体真实性，而不是并发共享。

以下变化会决定它是否已经退出 C：

- 如果客户使用自己的邮箱/企业域名，自己接受 OpenAI 条款，自己控制 MFA 与恢复方式，并直接向 OpenAI 付款，Alpha 只提供软件与配置帮助，则回到 A。
- 如果 Alpha 只是代客户付款，但 OpenAI 订单、账号主体、条款接受方和持续控制方均为客户，公开条款未给出足够细节判断，应取得 OpenAI 对代付/采购代理结构的书面确认。
- 如果 Alpha 是 OpenAI 正式授权 reseller，且客户通过 OpenAI 认可的 reseller Order Form 购买，则应以该正式经销合同为准。[Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)确实承认“通过 reseller 购买”的 Order Form，但这不等于任何普通客户都自动拥有经销权。
- 如果 Alpha 是订阅/账号主体，客户只是向 Alpha 付费后取得使用权，无论是否 1:1，仍属于高风险 C。

### D. 企业组织为自身员工分配具名席位

**判断：这是 OpenAI 官方支持的正常企业使用模式，不属于账号共享或对外转售。**

[Managing members, seat types, roles and access in ChatGPT Enterprise](https://help.openai.com/en/articles/8266401-managing-members-seat-types-roles-and-access-in-chatgpt-enterprise)说明：

- Enterprise workspace 是组织自己的环境，管理员可以按邮箱邀请成员，通过 CSV 或 SCIM 配置成员；
- 可以给成员分配 ChatGPT seat 或 Codex seat；
- 被邀请者应是团队中预期持续协作的成员；滥用席位可能导致 workspace 停用或账号暂停。

[Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)同时要求每个 End User Account 只配置、注册并供一个 End User 使用，并允许 Customer Affiliates 在同一组织账号下使用，客户对其行为负责。

D 的上线条件是：

1. 席位分配给本组织真实、具名员工，而不是外部付费客户的匿名库存。
2. 一个席位只由一个人使用，不轮换登录、不共享密码。
3. 使用公司邮箱、SSO/SCIM、MFA、离职回收和管理员审计来管理身份生命周期。
4. 若包含关联公司、长期顾问或承包商，按订单与 Services Agreement 的 End User/Affiliate 边界核对；不要把普通外部客户包装成“员工/团队成员”。
5. 组织和终端用户均满足 OpenAI 支持地区要求。

## 三、地区限制对 A–D 全部独立生效

账号是谁购买、是否 1:1、Alpha 是否看见密码，都不能改变地区限制。

[OpenAI Services Agreement](https://cdn.openai.com/osa/openai-services-agreement.pdf)第 16.12 条比帮助中心措辞更明确：Customer 和 End Users 不得在 Supported Countries and Territories 之外访问或提供对 Services 的访问，违反可导致暂停服务。

[API 支持地区](https://developers.openai.com/api/docs/supported-countries)与[ChatGPT 支持地区](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)当前均未列出中国大陆、香港或澳门；台湾列出。由此：

- 中国大陆用户持有自己的账号并自行登录，仍不能因属于 A 就绕过地区限制。
- Alpha 为中国大陆客户 1:1 代持账号，仍不能因不是共享就绕过地区限制。
- 中国大陆企业给位于中国大陆的员工分配 Enterprise 具名席位，仍受地区限制。
- 海外服务器、海外付款方式或海外账号注册信息不能改变终端用户实际位于不支持地区这一事实。
- 如果中国企业的实际终端用户位于支持地区，应按其真实访问地和订单主体具体核对，不能只凭企业国籍判断。

因此，面向中国大陆终端用户的 OpenAI/ChatGPT/Codex 正式线上能力仍是 **P0 阻断项**；除非 OpenAI 对具体客户、地区和架构作出书面许可。

## 四、对 Alpha Studio 的收窄版整改建议

### 可以保留或采用

1. 客户自有账号、客户直接向 OpenAI 签约付费、客户本人通过官方客户端/官方 Codex 登录流程在自己的设备上登录。
2. Alpha 只在客户设备上启动或集成官方 Codex CLI/IDE extension，不读取、不上传、不备份凭据。
3. 企业客户在自己的 Enterprise workspace 内，通过 SSO/SCIM 给自身员工分配具名席位。
4. 对程序化产品能力，优先使用正式 OpenAI API；API 组织、计费和地区要求与 ChatGPT 订阅分开处理。

### 必须停止或在上线前改造

1. Alpha 收集或保管客户密码、MFA、恢复邮箱、cookie、session token、`auth.json`。
2. token 虽由客户在官方页面生成或登录产生，但最终保存在 Alpha 可控制的多租户服务器。
3. Alpha 购买/创建 ChatGPT/Codex 订阅账号，再作为付费套餐 1:1 交付外部客户。
4. 把 Enterprise 成员席位用作外部客户库存或频繁换人轮转。
5. 向中国大陆、香港或澳门终端用户开放任何 OpenAI API、ChatGPT 或 Codex 访问线路。

### 需要 OpenAI 书面确认后才能采用

1. Alpha 作为采购代理代客户支付订阅，但客户是实际账号、订单和条款主体。
2. Alpha 托管客户 Enterprise Codex access token 并在 Alpha 基础设施运行专用私有 runner。
3. Alpha 向外部客户销售具名 ChatGPT/Codex 席位或账号访问。
4. Alpha 以第三方客户端身份使用 ChatGPT 订阅 OAuth/token，而不是调用官方 Codex 客户端或正式 API。
5. 任何面向不支持地区的特殊访问架构。

## 五、核心官方来源

1. [OpenAI Terms of Use（2026-01-01 生效）](https://openai.com/policies/terms-of-use/)
2. [OpenAI Services Agreement（页面标识 v.010126）](https://cdn.openai.com/osa/openai-services-agreement.pdf)
3. [OpenAI Account Sharing Policy](https://help.openai.com/en/articles/10471989)
4. [Codex Authentication](https://learn.chatgpt.com/docs/auth)
5. [Managing members, seat types, roles and access in ChatGPT Enterprise](https://help.openai.com/en/articles/8266401-managing-members-seat-types-roles-and-access-in-chatgpt-enterprise)
6. [OpenAI API Supported Countries and Territories](https://developers.openai.com/api/docs/supported-countries)
7. [ChatGPT Supported Countries](https://help.openai.com/en/articles/7947663-chatgpt-supported-countries)

## 六、一句话结论

**“每客户一账号”确实不等于共享账号池：A、D 本身可以不是共享；B 的核心风险是 Alpha 实际控制客户凭据，C 的核心风险是 1:1 仍可能构成账号访问转售/出租；而中国大陆等不支持地区限制对 A–D 全部继续生效。**
