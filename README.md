# dsh-our-free-model-composer-credits

[`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的**衍生插件**：在 DSH（DeepSeek Harness）**会话头部**常驻一枚**积分胶囊**，一眼看到当前渠道的账号余额，点开面板即可**秒切优先账号**。

![积分胶囊](icon.svg)

> 命名规范：本插件属于 `dsh-our-free-model` 生态，一切对外标识统一以 `dsh-our-free-model-` 开头。

## ⚠️ 强制前置条件：必须先装 `dsh-our-free-model`

**这不是可选依赖，是硬性安装前提。** 本插件自己**不联网、不持凭证、不读任何账号数据**——它显示的所有积分、账号列表、切号动作，全部来自 [`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model) 内嵌的 `channel-pack` 提供的 RPC。

所以：

| 前置状态 | 结果 |
| --- | --- |
| ✅ 已装 `dsh-our-free-model` | 胶囊正常显示余额，面板可列账号、可切号 |
| ❌ 未装 `dsh-our-free-model` | 胶囊只显示 `—`，点开是空面板。**插件不报错、不崩，但等于没用** |

**安装顺序不能反**：先装 `dsh-our-free-model` 并至少登录一个渠道账号，再装本插件。

```bash
# 第一步（强制前置）：装 dsh-our-free-model，并至少登录一个渠道账号
pnpm add dsh-our-free-model
# 或按官方 Release 安装最新版：
# https://github.com/Ebony-Vinyl/dsh-our-free-model/releases/latest

# 第二步（本插件）
pnpm add github:liushQAQ/dsh-our-free-model-composer-credits
```

> **版本建议**：本插件依赖的 `usage.badge` / `account.list` / `credits.balances` / `account.reorder` / `provider.status` 这几个 RPC 由 `dsh-our-free-model` 内嵌的 `channel-pack` 提供，**2.0.0 起才有**（含 npm 上的 2.1.0）。因此 1.x 的老版本装了也没用；建议直接用最新的 2.5.x。

> 为什么不做成内置依赖：`dsh-our-free-model` 是带签名更新、自带数据目录的宿主级插件，装法（npm / 官方 tarball / managed 安装 / 应用内升级）随分发方式不同，硬写进 `dependencies` 会与用户已有的安装方式打架。因此本插件只声明它是**运行时前置**，不代为安装。

## ⚠️ WorkBuddy 双渠道已移除（官方封禁，存在封号风险）

`dsh-our-free-model` **2.5.8 起不再提供 WorkBuddy 渠道**，本插件自 `v1.0.3` 起同步移除了 `buddy`（WorkBuddy 国内版）与 `workbuddy`（WorkBuddy 国际版）两个渠道：胶囊不再显示它们的积分，渠道切换器里也不会再出现这两项。

**上游为什么没了**：WorkBuddy 侧把「非官方客户端经代理调用」判定为未授权渠道，请求在服务端就被拦截：

| 渠道 | 上游报错 |
| --- | --- |
| 国内版 `buddy` | `Illegal API invocation from an unapproved channel`（请求被拦截，请重新发送） |
| 国际版 `workbuddy` | `request illegal`（某一时刻起全模型 100% 失败） |

社区试过改 system prompt、改 agent 身份、补 `X-Conversation-*` 请求头等绕法，**均无法稳定恢复**；上游作者因此在整个 `dsh-our-free-model`（插件端 + 独立端）移除了这两个 provider，渠道数由 13 降为 11。

**风险提示**：WorkBuddy 官方不允许第三方平台代理其额度。**继续用旧版本（≤ 2.5.7）强行调用，有导致 WorkBuddy 账号被封禁的风险**。本插件不再提供这两个渠道的任何入口，也不建议回退旧版恢复它们。

历史账号与凭据仍由 `dsh-our-free-model` 保留（上游承诺「保留历史账号、凭据及用户数据」，不做删除迁移），只是不再有调用入口——所以回退到旧版理论上仍能看到它们，但这正是**不建议**做的事。

## 它解决什么

`dsh-our-free-model` 的积分只在「设置 → 插件 → Channel Pack」里能看到，会话框里没有读数；而 `dsh-connect-workbuddy` / `dsh-connect-trae` 各自带一个胶囊，功能重复。本插件取代它们，在**会话头部按钮区**放一枚极轻量的胶囊（**不放进输入框**，避免压缩原生按钮）。

第二个问题：不同平台经常有同名模型（多家都叫 `DeepSeek-V4.1-Flash`），模型选择器里只显示模型原名，分不出这条请求要发给哪个平台。本插件的宿主半体会给各渠道的模型名加上平台前缀，显示成 `LobsterAI · DeepSeek-V4.1-Flash · x0.05` 这种形式。

## 功能

- **常驻读数**：形如 `● Raccoon 7,160`（渠道短名 · 余额）。每 5 分钟自动刷新一次。
- **点击开面板**：一行一账号 + 余额，点行即切号。
  - 切号 = 把该账号排到 `account.reorder` 的**首位**，即改写 channel-pack 的自动选号 / 限流换号优先级。
- **渠道可切换**：面板顶部列出所有还有账号的渠道，点击即切；选择记在 `localStorage`，跨会话保留。
- **不伪造数字**：读不到余额的行显示 `—`，**绝不显示 0**。
- **模型名带平台前缀**：宿主半体在模型目录的读取出口（`llm.listModels` / `llm.resolveModelInfo`）给上述 12 个渠道的模型名加上平台前缀，同名模型一眼可辨。只改 `name` 这一个显示字段，`id` / 路由 / 上下文元数据都不动；不属于渠道包的 provider 原样透传。

### 支持的渠道（12 个）

`codearts` · `lobsterai` · `qoder` · `qodercn` · `trae` · `cline` · `loomy` · `raccoon` · `minimax` · `zcode` · `gemini` · `opencode`

> 已排除 WorkBuddy 国内版 `buddy` 与国际版 `workbuddy`（原因见上方「WorkBuddy 双渠道已移除」一节）。

## 依赖

**强制前置**：宿主必须已安装 [`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model)（见上方「强制前置条件」一节），它内嵌的 `channel-pack` 提供全部 RPC。

未安装时胶囊只显示 `—`，不报错、不影响输入框其它控件。

## 安装

> ⚠️ **本插件没有发布到 npm。** `npm i dsh-our-free-model-composer-credits` 会失败（E404）。装法只有走 GitHub 源。

在你的 DSH Profile 目录（如 `~/.dsh/profiles/desktop`）下执行：

```bash
# pnpm
pnpm add github:liushQAQ/dsh-our-free-model-composer-credits

# 或 npm
npm i github:liushQAQ/dsh-our-free-model-composer-credits
```

也可以直接用 Release 里的 tarball：

```bash
pnpm add https://github.com/liushQAQ/dsh-our-free-model-composer-credits/releases/latest/download/dsh-our-free-model-composer-credits.tgz
```

装完后在 `dsh.profile.bundles` 里加入 `dsh-our-free-model-composer-credits` 并重启 / 重载 profile。

## 数据来源

全部读数与操作都走 `channel-pack` 的 RPC（端点 `/api/channel-pack`）：

| RPC | 用途 |
| --- | --- |
| `usage.badge` | 胶囊读数（宿主侧 120s TTL 缓存，比逐账号直读上游便宜得多） |
| `account.list` | 面板的账号行 |
| `credits.balances` | 逐账号余额（打开面板时才抓，避免按账号数放大上游读） |
| `provider.status` | 挑出「还有账号」的渠道做 chips |
| `account.reorder` | **秒切账号**：把目标账号排到首位 |

客户端通过宿主 `connection` 服务的 `rpc.call(connection.rpc, '/api', 'channel-pack', { method, payload }, signal)` 调用。`connection` 是**机会式读取**：拿不到就降级显示，绝不让整个插槽崩掉。

## 设计约束

- 不 `require` 任何 `@deepseek-ai/dsh-client-ui-*` 包；控件自写、样式自持。
- 只用 `--dsw-alias-*` 主题 token，不写死颜色，浅色 / 深色自动跟随。
- 工厂无副作用；样式与字典都在 `apply()` 里用 `ctx.effect` 注册并返回清理函数。
- 面板走 `ReactDOM.createPortal` 进 `document.body`（仍属 React 树），不 append 第二个应用。
- 挂载点：`conversation.session.header.actions`（会话头部按钮区，与「智能体团队」「创造模式」并排）。
- **不占用会话框**：本插件任何版本都不得 `inject` `conversation.input.*` 系列 slot——那是原生按钮的地盘，挤进去会把「+ / 语音 / 权限 / 模型 / 发送」压窄甚至压没。

## 变更记录

### v1.2.0 — 2026-10-23

- **破坏性位置变更：胶囊从输入框工具行迁到会话头部**。
  `SLOT` 由 `conversation.input.left` 改为 `conversation.session.header.actions`。
  原因：旧位置与宿主原生按钮同处一行，窄屏（430pt）下积分胶囊挤占 104px，
  把官方模型选择器压到 **5px 宽**、标签宽 0，用户完全看不见模型按钮。
  新位置在会话标题行右侧，与「智能体团队」「创造模式」并排，原生按钮拿到完整宽度。
- **面板方向自适应**：`useAnchorRect` 补 `height`，面板按锚点位置判断——
  锚点在上半屏向下展开、在下半屏向上展开。旧版恒定向上展开，迁到顶栏后面板会飞出屏幕。
- **规范来源**：`PLUGIN_LAYOUT_RULES.md`（插件永不占用会话框、永不压缩原生按钮）。
  后续任何改动都必须遵守，禁止再 `inject` 任何 `conversation.input.*` slot。

### v1.1.0 — 2026-10-22

- **新增：模型名显示平台前缀**。宿主半体（`index.js`，此前为空实现）改为 `inject = ['llm']`，在 `llm.listModels` / `llm.resolveModelInfo` 两个读取出口把渠道包的模型名改写成 `<平台> · <原名>`，解决「不同平台同名模型分不出归属」的问题。
  - 前缀表覆盖 12 个在用渠道（另保留 `buddy` / `workbuddy` 两条映射，供旧版本或回滚时正确显示）。
  - 只改 `name` 字段，`id` / `provider` / 上下文与工具元数据零改动，不影响路由与请求组装。
  - 幂等：用 `Symbol.for(...)` 标记在 `llm` 实例上，热重载不会重复包装；非渠道 provider 原样透传。
- 升级后需重启 DSH 才会生效（模型目录在启动时装配）。

### v1.0.3 — 2026-10-22

- **移除 WorkBuddy 国内版（`buddy`）/ 国际版（`workbuddy`）两个渠道**：上游 `dsh-our-free-model` 2.5.8 已整体移除这两个 provider（官方封禁非授权渠道调用），本插件的渠道表同步由 14 项精简为 12 项，胶囊与渠道切换器不再出现 WorkBuddy。
- README 新增「WorkBuddy 双渠道已移除（官方封禁，存在封号风险）」说明与支持的 12 个渠道清单。
- 余下行为不变：读数、面板、点行秒切、`—` 降级与全部 RPC 契约均未改动。

### v1.0.2 — 2026-10-21

- README / `description` / locale 文案明确写入「必须先装 `dsh-our-free-model`」这一强制前置条件。

### v1.0.1 — 2026-10-20

- 插件按 `dsh-our-free-model-` 前缀规范改名。

## License

MIT
