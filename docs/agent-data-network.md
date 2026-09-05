# Agent 数据访问网络转发

保留原版 Codex CLI、原有工具、提示词和数据源 URL。客户端在每次 Agent 运行时启动一个带临时认证的本地 HTTP 代理，通过 CLI 的 `shell_environment_policy.set` 把代理变量传给工具子进程。没有新增 MCP 或数据读取工具，也不修改用户的全局代理或持久化 Codex 配置。

## 行为

- 工具仍然执行原来的 curl、Python Requests、HTTP(S) Git 等命令。支持代理环境变量的请求先在本机连接目标。
- 首次 HTTPS 连接先做一次正常校验证书的 TLS 握手探测，识别 TCP 可连但 TLS/SNI 失败的网络。探测不发送 HTTP 请求；成功后连接相同 IP，原工具与目标重新建立自己的端到端 TLS。成功探测在当前运行内缓存两分钟。
- DNS、TCP 建连或首次 TLS 探测失败时，客户端用现有设备授权向后端建立 WSS 隧道，由服务器连接目标。服务器线路成功后，在当前运行内优先使用两分钟；服务器线路失效时重新尝试直连。
- 路线在发送原请求之前确定。一旦开始传输原始字节，就不会自动重连或重放；HTTP 401、403、429 等响应原样返回，不据此换出口。读写语义继续由原工具和 CLI 的授权策略控制。
- 原始 HTTP 请求转换为标准代理转发格式；HTTPS CONNECT 中的 TLS 字节原样传输，服务器不会解密 HTTPS，也不需要安装根证书。
- 本地和内网连接保持直连。远程隧道只允许公网地址的 80/443 端口，服务端重新解析并验证所有 DNS 地址，再直接连接验证后的 IP，防止 DNS 重绑定。不会把设备令牌转发给数据源。
- 继承的 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 或 Codex 配置文件中显式的工具代理优先使用。NO_PROXY 的现有值会保留；本地地址和本服务域名加入绕过列表。
- 任务结束/停止时关闭本地代理并取消活动连接。成功切换服务端时在任务活动中显示“外部数据连接已切换至服务端”。

## 覆盖范围

覆盖遵从 HTTP(S) 代理环境变量的 Agent 工具子进程。Python Requests、curl 等可直接使用；支持 `NODE_USE_ENV_PROXY` 的 Node.js 运行时会启用相应支持。旧版 Node、自行关闭环境代理的库、原始 TCP/UDP、SSH 和远端执行的工具不保证覆盖。

模型请求、供应商侧 web search、独立 MCP 服务和应用浏览器不经此代理。CLI 沙箱或网络权限继续生效；本功能不会扩大其权限。

每条服务器隧道最多传输 64 MiB，最长五分钟，空闲一分钟关闭；每设备最多四条并行服务器隧道、每分钟建立六十条，单实例最多三十二条。超大下载应继续使用适合该数据源的原有下载方式。

## 部署

1. 同时构建并发布后端和桌面客户端。后端新增 `GET /api/client/agent-network/tunnel` WebSocket 路由，复用现有签名设备令牌及设备租约校验，无数据库迁移。
2. 外部 API 地址需要 HTTPS，前置代理须允许 WebSocket Upgrade。项目的 Caddy `/api/*` 反向代理沿用即可；其他负载均衡器也需支持 WebSocket。
3. 服务端需要自身能够连接目标公网数据源。隧道使用直接 TCP 出口，不读取服务器上的 HTTP_PROXY 环境变量。
4. `AGENT_DATA_RELAY_ENABLED=true` 默认开启；设为 `false` 可关闭服务器隧道。未激活客户端、非 HTTPS 的远程服务地址或本地代理启动失败时，客户端保留原有网络行为。

旧后端缺少路由时，本机可达的数据源仍然直连；只有需要转发的连接会提示代理错误，其中包含后端 HTTP 状态。已存在的网络代理保持优先，所以验证本功能时应使用没有预设代理的工具环境。

## 验证

```sh
cargo test --manifest-path crates/agent-network/Cargo.toml
cargo test --manifest-path backend/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
npx vitest run src/codexBridge.test.ts src/license.test.ts
npx tsc -b
```

自动测试覆盖原 HTTP 请求及 CONNECT 字节保留、代理凭据隔离、连接失败切换、内网直连、任务结束清理、隧道二进制及 TCP 半关闭、公网地址验证、设备鉴权和限额。另已通过项目锁定 CLI 的 `command/exec` 验证 `shell_environment_policy.set` 在原生子进程生效。

真实外网验收应在无代理网络中分别运行原有 HTTP、HTTPS 数据读取命令，并观察不可达数据源切换后的结果；服务端能否访问具体网站仍取决于部署网络及数据源自身策略。

参考：[Codex 配置](https://developers.openai.com/codex/config-reference)、[Node.js 环境代理](https://nodejs.org/api/http.html#built-in-proxy-support)。
