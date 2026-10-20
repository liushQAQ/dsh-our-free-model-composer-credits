# dsh-our-free-model-composer-credits

[`dsh-our-free-model`](https://github.com/Ebony-Vinyl/dsh-our-free-model) 的**衍生插件**：在 DSH（DeepSeek Harness）对话输入框常驻一枚**积分胶囊**，一眼看到当前渠道的账号余额，点开面板即可**秒切优先账号**。

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

## 它解决什么

`dsh-our-free-model` 的积分只在「设置 → 插件 → Channel Pack」里能看到，输入框没有读数；而 `dsh-connect-workbuddy` / `dsh-connect-trae` 各自带一个胶囊，功能重复。本插件取代它们，在输入框工具行左侧放一枚极轻量的胶囊。

## 功能

- **常驻读数**：形如 `● Raccoon 7,160`（渠道短名 · 余额）。每 5 分钟自动刷新一次。
- **点击开面板**：一行一账号 + 余额，点行即切号。
  - 切号 = 把该账号排到 `account.reorder` 的**首位**，即改写 channel-pack 的自动选号 / 限流换号优先级。
- **渠道可切换**：面板顶部列出所有还有账号的渠道，点击即切；选择记在 `localStorage`，跨会话保留。
- **不伪造数字**：读不到余额的行显示 `—`，**绝不显示 0**。

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
- 挂载点：`conversation.input.left`（会话级 list 插槽，输入框工具行左侧的紧凑控件位）。

## License

MIT
