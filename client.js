/**
 * dsh-our-free-model-composer-credits — 输入框「积分胶囊」（浏览器端 / DSH client bundle 形态）
 *
 * 作用：在对话输入框工具行左侧常驻一枚极轻量胶囊
 *   ① 读数 =「渠道短名 · 余额」，数据来自 channel-pack 的 `usage.badge` RPC
 *      （宿主侧 120s TTL 缓存，比逐账号直读上游便宜得多）；
 *   ② 点击胶囊开锚定面板：一行一账号 + 余额，**点行即秒切账号**——把该账号排到
 *      `account.reorder` 的首位，即改写 channel-pack 的自动选号 / 限流换号优先级；
 *   ③ 面板顶部可切换关注的渠道，选择记在 localStorage，跨会话保留。
 *
 * 依赖：宿主需安装 `dsh-our-free-model`（其内嵌 channel-pack 提供全部 RPC）。
 *   没有该插件时胶囊只显示「—」，不报错、不影响其它控件。
 *
 * 规范约束（cordis-plugin-development / practices.md）：
 *   - 不 require 任何 @deepseek-ai/dsh-client-ui-* 包；控件自写、样式自持；
 *   - 只用 --dsw-alias-* 主题 token，不写死颜色；
 *   - 工厂无副作用；样式与字典都在 apply() 里用 ctx.effect 注册并返回清理函数；
 *   - 面板走 ReactDOM.createPortal 进 document.body（仍属 React 树），不 append 第二个应用。
 *
 * 数据来源（硬实证）：
 *   channel-pack 的 RPC 挂在 `/api/channel-pack`，客户端经宿主 connection 服务的
 *   `rpc.call(connection.rpc, '/api', 'channel-pack', { method, payload }, signal)` 调用
 *   （参照实现 `dsh-our-free-model/client.js` 的 useChannelRpc）。
 *   `connection` 是机会式读取：拿不到就降级显示「—」，绝不让整个插槽崩掉。
 */
window.__ModuleLoader__.load({
  id: 'dsh-our-free-model-composer-credits',
  factory(require) {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const React = require('react');
    const ReactDOM = require('react-dom');
    const {
      createElement: h,
      useState,
      useEffect,
      useRef,
      useCallback,
    } = React;

    /** 字典命名空间（独占，避免与宿主命名空间冲突）。 */
    const NS = 'ofmComposerCredits';
    /**
     * 挂载位置：**会话区域 tab 栏右侧**（「对话 / 轨迹 / 系统监控」那一行的右端空白）。
     *
     * 🔴 2026-10-23 老总令（原话）：「任何插件看都不要占用这个会话框位置，
     *   占用了压缩原生按钮空间。提示其他玩家。这是规范纳入 dsh 自建插件要求。」
     *   规范全文见仓库 PLUGIN_LAYOUT_RULES.md（会话框禁占区）。
     *
     * 迁移史：`conversation.input.left`（输入框工具行左侧，挤压原生按钮）
     *   → `conversation.session.header.actions`（标题行，还不是老总要的位置）
     *   → **tab 栏**（本版）。tab 栏由 `conversation.view` 槽的注册项渲染而成，
     *   「轨迹」「系统监控」本身就是插件贡献的，所以这一行天生是插件可用的地盘；
     *   容器带稳定语义属性 `data-conversation-tabs`，用 ReactDOM.createPortal 把胶囊
     *   投进去即可与「系统监控」并排，**电脑端与手机端同一套前端，两端同时生效**，
     *   不需要 App 侧任何定位干预。
     *
     * 本 SLOT 保留为**降级位**：取不到 tab 栏（hero 空态 / DSH 改结构 / 外部页）时，
     *   胶囊退回这里渲染，绝不整块消失。
     */
    const SLOT = 'conversation.session.header.actions';
    /** 样式类前缀，避免与宿主 CSS module 撞名。 */
    const P = 'dcc-';
    /** 胶囊按钮的锚点标记（面板判断「点的是自己」用）。 */
    const ANCHOR_ATTR = 'data-dcc-anchor';
    /** 读数自动刷新间隔（5 分钟，与 dsh-connect-workbuddy 同档）。 */
    const READ_INTERVAL_MS = 300000;
    /** 面板打开期间的逐账号表刷新间隔（1 分钟）。 */
    const PANEL_INTERVAL_MS = 60000;
    /** 关注渠道的持久化键（插件私有前缀，不与 dsh-our-free-model 的键冲突）。 */
    const STORE_KEY = 'ofm.credits.channel';

    /**
     * channel-pack 的十二个账号渠道。`short` 是输入框读数用的紧凑名（读数行与宿主的
     * 权限/agent/模型控件共享空间，必须短），`unit` 决定余额的数字口径。
     *
     * 已移除：`buddy`（WorkBuddy 国内版）与 `workbuddy`（WorkBuddy 国际版）。
     * 上游 `dsh-our-free-model` 2.5.8 起不再注册这两个 provider（发布说明原文：
     * 「移除 WorkBuddy 国内版和国际版渠道入口，保留历史账号、凭据及用户数据」），
     * 保留它们只会让胶囊列出永远读不到余额的空白渠道，故一并从本表删除。
     */
    const CHANNELS = [
      { id: 'codearts', name: 'CodeArts', short: 'CodeArts', unit: 'left' },
      { id: 'lobsterai', name: 'LobsterAI', short: 'Lobster', unit: 'left' },
      { id: 'qoder', name: 'Qoder', short: 'Qoder', unit: 'left' },
      { id: 'qodercn', name: 'Qoder 中国版', short: 'Qoder CN', unit: 'left' },
      { id: 'trae', name: 'TRAE', short: 'TRAE', unit: 'left' },
      { id: 'cline', name: 'Cline', short: 'Cline', unit: 'dollars' },
      { id: 'loomy', name: 'Loomy', short: 'Loomy', unit: 'left' },
      { id: 'raccoon', name: 'Raccoon', short: 'Raccoon', unit: 'left' },
      { id: 'minimax', name: 'MiniMax Code', short: 'MiniMax', unit: 'left' },
      { id: 'zcode', name: 'ZCode', short: 'ZCode', unit: 'tokens' },
      { id: 'gemini', name: 'Gemini', short: 'Gemini', unit: 'quota' },
      { id: 'opencode', name: 'OpenCode', short: 'OpenCode', unit: 'left' },
    ];
    const CHANNEL_IDS = CHANNELS.map(channel => channel.id);

    /**
     * CLI 反代三渠道（2026-10-30 老总令）：id 就是三个反代插件注册的真实
     * provider id（`zcode-cli` / `qodercn-cli` / `wb-cli`），烧的是平台额度，
     * 不是 channel-pack 账号池。id 与 provider 同名，模型选择器选中 CLI 模型时
     * 胶囊经 `channelOfProvider` 直接锁定到对应平台读数。
     *
     * `reader` 决定读数来源：
     * - `wb`：dsh-connect-workbuddy 的只读积分端点（与 wb-cli 读同一份 vault）。
     * - `cli`：本插件宿主半体的 `/api/cli-credits` —— zcode-cli 的凭证只在本机
     *   `~/.zcode` 里，而 channel-pack 池里的 `zcode` 是**另一个账号**，混用会
     *   显示别人的额度。
     * - `channel`：qodercn-cli 的本机登录账号与 channel-pack 的 `qodercn` 池是
     *   同一账号，直接复用 `credits.balances`；读数前先核对登录名，不一致就
     *   报错而不是把池里那个账号的额度冒充给它。
     */
    const CLI_CHANNELS = [
      { id: 'zcode-cli', name: 'ZCode CLI', short: 'ZCode CLI', unit: 'tokens', cli: 'zcode', reader: 'cli' },
      { id: 'qodercn-cli', name: 'Qoder CN CLI', short: 'Qoder CN CLI', unit: 'left', cli: 'qodercn', reader: 'channel' },
      { id: 'wb-cli', name: 'WorkBuddy CLI', short: 'WB CLI', unit: 'left', cli: 'workbuddy', reader: 'wb' },
    ];
    const CLI_CHANNEL_IDS = CLI_CHANNELS.map(channel => channel.id);
    const CHANNEL_BY_ID = new Map(
      [...CHANNELS, ...CLI_CHANNELS].map(channel => [channel.id, channel]),
    );

    /**
     * 模型选择器里的 OFM 路由（正本 `src/adapter.js:36-37`）。它们**不是**渠道 id：
     * 渠道 id 是 channel-pack 的账号维度，OFM 主路由把多来源聚在一条线上。
     * 选中这两条路由时，胶囊显示「上次关注过的渠道」而不是强行绑定某一个。
     */
    const OFM_ROUTES = new Set(['our-free-model', 'our-free-model-region']);

    const DICT = {
      zh: {
        'credits.loading': '查询中…',
        'credits.unavailable': '积分不可用',
        'credits.empty': '该渠道还没有账号',
        'credits.unknown': '—',
        'credits.title': '积分',
        'panel.title': '{channel} 账号',
        'panel.refresh': '刷新',
        'panel.busy': '切换中…',
        'panel.priority': '优先',
        'panel.disabled': '已停用',
        'panel.close': '关闭',
        'panel.empty': '该渠道还没有账号，请到「设置 → 插件 → Our Free Model → 渠道」添加。',
        'panel.emptyCli': '未读到 CLI 反代凭据：请先在对应 CLI 登录，再点刷新。',
        'panel.hint': '点一行即把该账号排到最前（秒切优先账号）。',
        'panel.hintCli': 'CLI 反代通道：只读展示平台额度，刷新即同步。',
        'panel.cliBadge': 'CLI',
        'panel.failed': '操作失败：{reason}',
        'panel.accounts': '{count} 个账号',
      },
      en: {
        'credits.loading': 'Checking…',
        'credits.unavailable': 'Credits unavailable',
        'credits.empty': 'No account on this channel',
        'credits.unknown': '—',
        'credits.title': 'Credits',
        'panel.title': '{channel} accounts',
        'panel.refresh': 'Refresh',
        'panel.busy': 'Switching…',
        'panel.priority': 'First',
        'panel.disabled': 'Disabled',
        'panel.close': 'Close',
        'panel.empty': 'No account on this channel. Add one in Settings → Plugins → Our Free Model → Channels.',
        'panel.emptyCli': 'No CLI credential found — log in with the CLI first, then refresh.',
        'panel.hint': 'Click a row to move that account to the front.',
        'panel.hintCli': 'CLI relay channel: read-only platform quota, refreshed in place.',
        'panel.cliBadge': 'CLI',
        'panel.failed': 'Failed: {reason}',
        'panel.accounts': '{count} accounts',
      },
    };

    const CSS = `
.${P}root { display: inline-flex; align-items: center; }
/* 投进会话区域 tab 栏（对话 / 轨迹 / 系统监控 那一行）时的落位：
   tab 栏是 display:flex; gap:36px; padding-left:8px 的容器，默认 align-items:stretch
   会把 24px 的胶囊拉满整行高度（看起来像一整块），必须 align-self:center 钉住中线；
   flex:none 防窄屏被压缩；margin-left:-14px 把 36px 的 gap 收到 22px，视觉紧挨「系统监控」。
   order:1 —— 老总 2026-10-23 12:28 定序：**积分胶囊在左、提示词优化在右**。
   提示词优化点开会展开「撤回 / 重优」，变长后必须往右边空白长，绝不能盖住别人。

   🔴 top:-4.5px —— 老总 2026-10-23 12:48：「轨迹 系统监控 Loomy 不在一个水平高度」。
      真因（实测）：tab 按钮是 padding: 0 0 9px（底下 9px 给选中态下划线留位），
      所以它的**文字**中心比按钮几何中心高 9/2 = **4.5px**；
      胶囊是整个元素垂直居中的，对齐的是几何中心（实测 tab 文字 cy=58.5，
      胶囊 cy=63）→ 视觉上胶囊偏低 4.5px。
      用 position:relative + top 补偿：不改布局流、不改容器高度、
      不创建 containing block（弹层 portal 到 body，不受影响）。
      若官方改了 tab 的 padding-bottom，这个值要跟着改（= padding-bottom / 2）。 */
[data-conversation-tabs] > .${P}root {
  align-self: center; flex: 0 1 auto; min-width: 34px; margin-left: -14px;
  max-width: 100%; order: 1; position: relative; top: -4.5px;
}
/* 窄屏（390 及以下）三个 tab 已经占 184px，两个胶囊加起来放不下 —— 允许 flex 收缩，
   文字出省略号，绝不越出屏幕、绝不重叠。宽屏 flex-grow:0 + basis:auto → 宽度不变。 */
[data-conversation-tabs] > .${P}root .${P}btn { min-width: 0; overflow: hidden; }
[data-conversation-tabs] > .${P}root .${P}btn > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-conversation-tabs] > .${P}root .${P}dot { flex: none; }
.${P}btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 1; white-space: nowrap;
  cursor: pointer;
}
.${P}btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${P}btn[data-open="true"] { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.${P}dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--dsw-alias-state-success-primary); }
.${P}dot[data-state="idle"] { background: var(--dsw-alias-state-idle-primary); }
.${P}dot[data-state="warn"] { background: var(--dsw-alias-state-warn-primary); }
.${P}dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); }
.${P}value { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.${P}value[data-unknown="true"] { color: var(--dsw-alias-label-secondary); }
.${P}panel {
  position: fixed; z-index: 2147483000;
  width: 306px; max-height: 62vh; display: flex; flex-direction: column;
  border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
  font: inherit; font-size: 12px; overflow: hidden;
  /* iOS：长按列表不会弹文字选择/系统菜单打断滑动 */
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
}
.${P}head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.${P}title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${P}mini {
  height: 22px; padding: 0 8px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
}
.${P}mini:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${P}mini:disabled { opacity: 0.5; cursor: default; }
.${P}chips { display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1); scrollbar-width: thin; }
.${P}chip {
  flex: none; height: 22px; padding: 0 9px; border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px;
  white-space: nowrap; cursor: pointer;
}
.${P}chip:hover { color: var(--dsw-alias-label-primary); }
.${P}chip[data-active="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
/* 🔴 2026-10-30 iOS 真机：胶囊面板「手指滑不动」。
   双层真因：
   ① 列表是 column flex 里的滚动项，WebKit 对 min-height:auto 的收缩处理
      与 Chrome 不一致 —— 内容超出时列表拿不到可滚动视口，必须显式 min-height:0；
   ② iOS App 宿主在 document 上挂了全局边缘手势（边缘 32px 起手的横向判定会
      preventDefault），从面板左侧起手略斜就被判成横向 → 整个手势被吞。
       JS 侧在面板根节点 stopPropagation（TouchGuard），CSS 侧再用 touch-action
       / overscroll 把纵向滚动交给浏览器，双保险。 */
.${P}list {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px 0;
  -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y;
}
.${P}row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer; }
.${P}row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${P}row[data-current="true"] { background: var(--dsw-alias-bg-layer-2); }
.${P}row[data-disabled="true"] { opacity: 0.55; cursor: default; }
.${P}row[data-readonly="true"] { cursor: default; }
.${P}row[data-busy="true"] { opacity: 0.6; cursor: progress; }
.${P}nick { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${P}badge {
  flex: none; font-size: 10px; line-height: 1; padding: 3px 5px; border-radius: 4px;
  border: 1px solid var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary);
}
.${P}badge[data-kind="off"] { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.${P}num { flex: none; font-variant-numeric: tabular-nums; }
.${P}num[data-unknown="true"] { color: var(--dsw-alias-label-secondary); }
.${P}foot { padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.${P}err { color: var(--dsw-alias-state-error-primary); }
.${P}empty { padding: 16px 12px; text-align: center; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
`;

    /* ────────────────────────── 小工具 ────────────────────────── */

    function selectedProviderOf(projection) {
      const provider = (projection?.next ?? projection?.lastUsed)?.provider;
      return typeof provider === 'string' && provider !== '' ? provider : undefined;
    }

    function channelOfProvider(provider) {
      return typeof provider === 'string' && CHANNEL_BY_ID.has(provider) ? provider : undefined;
    }

    function readStoredChannel() {
      try {
        const value = window.localStorage?.getItem(STORE_KEY);
        return typeof value === 'string' && CHANNEL_BY_ID.has(value) ? value : null;
      } catch {
        return null;
      }
    }

    function rememberChannel(id) {
      try {
        window.localStorage?.setItem(STORE_KEY, id);
      } catch {
        /* 存储不可用也不影响本次会话 */
      }
    }

    /** 千分位；非有限数返回 null（UI 必须显示「—」而不是 0）。 */
    function kilo(value) {
      if (!Number.isFinite(value)) return null;
      const rounded = Math.round(value);
      return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    /** token 口径要紧凑（ZCode 的额度是百万级，千分位会撑爆胶囊）。 */
    function compact(value) {
      if (!Number.isFinite(value)) return null;
      const abs = Math.abs(value);
      if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
      if (abs >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
      return String(Math.round(value));
    }

    /** 余额对象 → 显示串；读不到就是 null，绝不伪造 0。 */
    function balanceText(balance, unit) {
      const total = balance?.total;
      if (!Number.isFinite(total)) return null;
      if (unit === 'dollars') return `$${kilo(total)}`;
      if (unit === 'tokens') return compact(total);
      return kilo(total);
    }

    /** WorkBuddy 只读积分端点（dsh-connect-workbuddy 注册在宿主 webServer，同源）。 */
    const WB_CREDITS_URL = '/plugins/dsh-connect-workbuddy/account-credits?region=cn';

    /**
     * CLI 反代渠道读数：统一成 channel-pack 的账号行形状
     * `{ accountId, nickname, balance, error? }`，面板与胶囊共用同一套渲染。
     *
     * ⚠️ 读不到额度时**带 error 字段**（卡片显示原因），绝不给 0 —— 0 是
     * 「额度已用光」的语义，把「读取失败」显示成 0 会让用户误判。
     *
     * @param meta - `CLI_CHANNELS` 里的条目。
     * @param calls - `{rpc, cliRpc}`：channel-pack 与 `/api/cli-credits` 两个通道。
     * @param force - 面板「刷新」：让支持缓存的渠道重抓。
     */
    async function readCliRows(meta, calls, force) {
      if (meta.reader === 'wb') {
        const response = await fetch(WB_CREDITS_URL, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`WorkBuddy 积分端点 HTTP ${response.status}`);
        const value = await response.json();
        return (value?.accounts ?? []).map(account => {
          const credits = account?.credits;
          const known = Number.isFinite(credits);
          return {
            accountId: account?.id ?? 'unknown',
            nickname: account?.accountName ?? account?.id ?? 'WorkBuddy',
            balance: known ? { total: credits } : null,
            ...(known ? {} : { error: '额度读取失败（账号未登录或凭据已过期）' }),
          };
        });
      }
      if (meta.reader === 'cli') {
        const value = await calls.cliRpc('cli.balances', { provider: meta.id }, 90000);
        return value?.accounts ?? [];
      }
      // reader === 'channel'：Qoder CN CLI 与 channel-pack 的 qodercn 池是同一账号，
      // 额度读池；但先核对本机 CLI 的登录名，池里换过账号时绝不张冠李戴。
      const [status, pool] = await Promise.all([
        calls.cliRpc('cli.balances', { provider: meta.id }, 30000).catch(() => null),
        calls.rpc(
          'credits.balances',
          { provider: meta.cli, ...(force ? { force: true } : {}) },
          90000,
        ),
      ]);
      const rows = pool?.accounts ?? [];
      const cliAccount = status?.accounts?.[0];
      if (cliAccount === undefined) return rows;
      if (typeof cliAccount.error === 'string' && cliAccount.error !== '') return [cliAccount];
      const digits = value => String(value ?? '').replace(/\D/g, '');
      const poolName = rows[0]?.nickname;
      if (rows.length === 0) {
        return [{
          accountId: cliAccount.accountId,
          nickname: cliAccount.nickname,
          balance: null,
          error: '渠道池里没有该 Qoder CN 账号，额度请到 Qoder 客户端查看',
        }];
      }
      if (digits(poolName) === '' || digits(poolName) !== digits(cliAccount.nickname)) {
        return [{
          accountId: cliAccount.accountId,
          nickname: cliAccount.nickname,
          balance: null,
          error: `本机 Qoder CN CLI 登录账号（${cliAccount.nickname}）与渠道池账号（${poolName ?? '无'}）不一致，额度请到 Qoder 客户端查看`,
        }];
      }
      return rows;
    }

    /**
     * RPC 通道。与 `vendor/dsh-our-free-model/client.js:4036-4078` 完全同构：
     * `connection` 是机会式读取，拿不到时 available=false，调用抛错，
     * 由调用方降级而不是让插槽崩掉。
     *
     * `endpoint` 是宿主注册的名字：channel-pack 的账号/余额走 `channel-pack`，
     * CLI 反代读数走本插件宿主半体注册的 `cli-credits`。
     */
    function useChannelRpc(ctx, endpoint = 'channel-pack') {
      const ctxRef = useRef(ctx);
      ctxRef.current = ctx;
      const readTransport = useCallback(() => {
        const current = ctxRef.current;
        let connection;
        try {
          connection = current?.connection;
        } catch {
          /* 服务尚未提供 */
        }
        if (connection === undefined || connection === null) {
          try {
            connection = current?.get?.('connection');
          } catch {
            /* 服务尚未提供 */
          }
        }
        try {
          const call = connection?.rpc?.call;
          return typeof call === 'function' ? { connection, call } : null;
        } catch {
          return null;
        }
      }, []);

      const [transport, setTransport] = useState(null);
      useEffect(() => {
        const check = () => {
          const next = readTransport();
          setTransport(previous => {
            if (previous === next) return previous;
            if (
              previous !== null &&
              next !== null &&
              previous.connection === next.connection &&
              previous.call === next.call
            ) {
              return previous;
            }
            return next;
          });
        };
        check();
        const timer = setInterval(check, 500);
        return () => clearInterval(timer);
      }, [readTransport]);

      const rpc = useCallback(
        async (method, payload, timeoutMs = 60000) => {
          const latest = readTransport();
          if (latest === null) throw new Error('no-connection');
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const result = await latest.call.call(
              latest.connection.rpc,
              '/api',
              endpoint,
              { method, payload },
              controller.signal,
            );
            if (result?.ok === true) return result.value;
            if (result?.ok === false) {
              throw new Error(result.error?.message ?? result.error?.code ?? 'rpc-failed');
            }
            return result;
          } finally {
            clearTimeout(timer);
          }
        },
        [endpoint, readTransport],
      );

      return { available: transport !== null, rpc };
    }

    /** 锚定定位：面板贴住胶囊按钮。方向**自适应**——按钮在上半屏向下展开（顶栏停靠），
     *  在下半屏向上展开（万一其他玩家仍把它放回底部区域）。
     *  🔴 2026-10-23：迁到会话头部后必须支持向下展开，否则面板会跑到屏幕外。 */
    function useAnchorRect(open) {
      const ref = useRef(null);
      const [rect, setRect] = useState(null);
      useEffect(() => {
        if (!open) return undefined;
        const update = () => {
          const node = ref.current;
          if (!node) return;
          const box = node.getBoundingClientRect();
          setRect({ left: box.left, top: box.top, width: box.width, height: box.height });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
          window.removeEventListener('resize', update);
          window.removeEventListener('scroll', update, true);
        };
      }, [open]);
      return [ref, rect];
    }

    /**
     * 找到会话区域「对话 / 轨迹 / 系统监控」那一行 tab 栏的容器。
     *
     * 🔴 2026-10-23 12:01 老总纠正（原话）：
     *   「对话 轨迹 系统监控，旁边可以放。**轨迹 系统监控 就是 dsh 插件
     *    （dsh-system-monitor-plugin）生成的啊，不是官方原生按钮**。
     *    所以积分胶囊和提示词插件按钮！也可以做到放这里啊。」
     *
     *   查官方源码 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 确认：
     *     <div role="tablist" data-conversation-tabs="" class={styles.tabs}>
     *       {tabs.map(v => <button role="tab" class={styles.tab}>{v.label}</button>)}
     *     </div>
     *   容器是 `display:flex; gap:36px; padding-left:8px; grid-column:1/-1`，三个 tab
     *   只占左端一小段，**右侧全是空 flex 空间**；tabs 来自 `conversation.view` 槽的
     *   全部注册项（对话=官方、轨迹=官方 ui-trajectory、系统监控=第三方插件），
     *   所以这一行天生就是「官方 + 插件共用」的地盘，插件往里放东西不需要官方 slot。
     *
     * 锚点用 `data-conversation-tabs`（**稳定语义属性**），绝不用 CSS Module 哈希类名
     *   （`ank0OG_tabs` / 旧版 `_727C8a_tabs` 换版即失效）。
     *
     * 取不到时返回 null → 调用方回退到 slot 原位渲染（DSH 升级改掉语义属性时仍可用）。
     */
    const TABLIST_SELECTOR = '[data-conversation-tabs]';
    function useTabBar() {
      const [bar, setBar] = useState(null);
      useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        let alive = true;
        const seek = () => {
          const el = document.querySelector(TABLIST_SELECTOR);
          if (el === null) return false;
          setBar(el);
          return true;
        };
        if (seek()) return undefined;
        // tab 栏只在「有会话且 tabs.length>1」时渲染，出现时机晚于本组件挂载 → 轻量轮询
        const timer = setInterval(() => {
          if (!alive || seek()) clearInterval(timer);
        }, 500);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);
      return bar;
    }

    /* ────────────────────────── 面板 ────────────────────────── */

    function Panel(props) {
      const { t, rpc, cliRpc, channel, rect, onPickChannel, onClose } = props;
      const [accounts, setAccounts] = useState(null);
      const [balances, setBalances] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [busyId, setBusyId] = useState(null);
      const [channels, setChannels] = useState(null);
      const generation = useRef(0);
      const panelRef = useRef(null);

      const meta = CHANNEL_BY_ID.get(channel);
      /** CLI 反代渠道（读平台额度，账号不可切 → 面板只读）。 */
      const cliKey = meta?.cli;

      const load = useCallback(
        async force => {
          const gen = ++generation.current;
          setLoading(true);
          const failures = [];
          if (cliKey !== undefined) {
            try {
              const rows = await readCliRows(meta, { rpc, cliRpc }, force);
              if (gen === generation.current) {
                setAccounts(
                  rows.map(row => ({
                    id: row.accountId,
                    nickname: row.nickname,
                    enabled: true,
                  })),
                );
                setBalances(rows);
              }
            } catch (cause) {
              if (gen === generation.current) {
                setAccounts([]);
                setBalances([]);
              }
              failures.push(String(cause?.message ?? cause));
            }
            if (gen !== generation.current) return;
            setError(failures.length > 0 ? failures[0] : '');
            setLoading(false);
            return;
          }
          try {
            const list = await rpc('account.list', { provider: channel }, 30000);
            if (gen === generation.current) setAccounts(list?.accounts ?? []);
          } catch (cause) {
            if (gen === generation.current) setAccounts([]);
            failures.push(String(cause?.message ?? cause));
          }
          try {
            const value = await rpc(
              'credits.balances',
              { provider: channel, ...(force ? { force: true } : {}) },
              90000,
            );
            if (gen === generation.current) setBalances(value?.accounts ?? []);
          } catch (cause) {
            if (gen === generation.current) setBalances([]);
            failures.push(String(cause?.message ?? cause));
          }
          if (gen !== generation.current) return;
          setError(failures.length > 0 ? failures[0] : '');
          setLoading(false);
        },
        [channel, rpc, cliRpc, cliKey, meta],
      );

      // 打开时立刻抓一次；此后每分钟抓一次（只在面板打开期间，绝不按账号数放大上游读）。
      useEffect(() => {
        void load(false);
        const timer = setInterval(() => void load(false), PANEL_INTERVAL_MS);
        return () => clearInterval(timer);
      }, [load]);

      // 渠道清单：provider.status 一次问完全部渠道，挑出「确实有账号」的给用户切。
      // 🔴 2026-10-24 老总令：OFM 里「已关闭」（closed = 该供应商全部模型被关）
      //   的平台不再显示——胶囊芯片条放不下十来个渠道，关闭的占位只会让
      //   在用的平台滑都滑不到，索性从源头去掉。
      useEffect(() => {
        let cancelled = false;
        void (async () => {
          let base = [channel];
          try {
            const value = await rpc('provider.status', { providers: CHANNEL_IDS }, 20000);
            const statuses = value?.statuses ?? {};
            const alive = CHANNEL_IDS.filter(
              id =>
                (statuses[id]?.accounts?.total ?? 0) > 0 &&
                statuses[id]?.closed !== true,
            );
            if (alive.length > 0) base = alive;
          } catch {
            /* provider.status 不可用就只留当前渠道 */
          }
          // CLI 反代只在宿主确实注册了对应 provider 时出现：没装反代插件的玩家
          // 不该看到三条永远读不到额度的空芯片。
          let cli = [];
          try {
            const value = await cliRpc('cli.channels', {}, 20000);
            const providers = Array.isArray(value?.providers) ? value.providers : [];
            cli = CLI_CHANNEL_IDS.filter(id => providers.includes(id));
          } catch {
            cli = [];
          }
          if (!cancelled) setChannels([...new Set([...base, ...cli])]);
        })();
        return () => {
          cancelled = true;
        };
      }, [rpc, cliRpc, channel]);

      // Esc 收起 + 点击面板外收起（胶囊按钮自己的点击不算「外面」）。
      useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') onClose();
        };
        const onDown = event => {
          const target = event.target;
          if (target?.closest?.(`[${ANCHOR_ATTR}="true"]`) != null) return;
          const node = panelRef.current;
          if (node !== null && !node.contains(target)) onClose();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onDown, true);
        return () => {
          document.removeEventListener('keydown', onKey);
          document.removeEventListener('mousedown', onDown, true);
        };
      }, [onClose]);

      const balanceOf = useCallback(
        accountId => (balances ?? []).find(entry => entry.accountId === accountId)?.balance ?? null,
        [balances],
      );
      const errorOf = useCallback(
        accountId => (balances ?? []).find(entry => entry.accountId === accountId)?.error,
        [balances],
      );

      const switchTo = useCallback(
        async accountId => {
          if (busyId !== null) return;
          const ids = (accounts ?? []).map(account => account.id);
          if (ids.length === 0 || ids[0] === accountId) return;
          const ordered = [accountId, ...ids.filter(id => id !== accountId)];
          setBusyId(accountId);
          setError('');
          try {
            // orderedIds 必须是该 provider 的**全部**账号 id（集合不变、顺序变），
            // 目标置首位即完成「秒切优先账号」。
            await rpc('account.reorder', { provider: channel, orderedIds: ordered }, 30000);
            setAccounts(previous => {
              const byId = new Map((previous ?? []).map(account => [account.id, account]));
              return ordered.map(id => byId.get(id)).filter(Boolean);
            });
            await load(true);
          } catch (cause) {
            setError(String(cause?.message ?? cause));
            await load(false);
          } finally {
            setBusyId(null);
          }
        },
        [accounts, busyId, channel, rpc, load],
      );

      const width = 306;
      const style =
        rect === null
          ? { left: 12, bottom: 12 }
          : (function () {
              const vw = window.innerWidth || 0;
              const vh = window.innerHeight || 0;
              const left = Math.max(8, Math.min(rect.left, vw - width - 8));
              // 锚点在上半屏 → 向下展开（会话头部停靠）；下半屏 → 向上展开（底部输入行）。
              if (rect.top < vh / 2) {
                const h = rect.height || 28;
                return { left, top: Math.max(8, rect.top + h + 6) };
              }
              return { left, bottom: Math.max(8, vh - rect.top + 6) };
            })();

      const rows = accounts ?? [];
      const unit = meta?.unit ?? 'left';

      return h(
        'div',
        {
          ref: panelRef,
          className: `${P}panel`,
          style,
          role: 'dialog',
          'aria-label': t('panel.title', { channel: meta?.name ?? channel }),
          // iOS App 宿主的边缘手势挂在 document 冒泡段，判定横向就 preventDefault；
          // 面板内（列表纵向滚 / 芯片横滑）触摸一律就地截停，宿主收不到就不会吞手势。
          onTouchStart: event => event.stopPropagation(),
          onTouchMove: event => event.stopPropagation(),
          onTouchEnd: event => event.stopPropagation(),
        },
        h(
          'div',
          { className: `${P}head` },
          h('span', { className: `${P}title` }, t('panel.title', { channel: meta?.name ?? channel })),
          h(
            'button',
            {
              type: 'button',
              className: `${P}mini`,
              disabled: loading,
              onClick: () => void load(true),
            },
            loading ? t('panel.busy') : t('panel.refresh'),
          ),
          h('button', { type: 'button', className: `${P}mini`, onClick: onClose }, t('panel.close')),
        ),
        channels !== null && channels.length > 1
          ? h(
              'div',
              {
                className: `${P}chips`,
                // 🔴 2026-10-24 老总：芯片条超出 306px 的面板后「左右滑动不了」——
                //   真因是 PC 端鼠标滚轮只滚垂直方向，水平方向（overflow-x:auto）
                //   永远不动，尾部渠道被裁掉就再也够不着。这里把滚轮的垂直增量
                //   换算成 scrollLeft 横滚；触屏端本身可横滑，不受影响。
                onWheel: event => {
                  if (event.deltaY === 0) return;
                  event.preventDefault();
                  const node = event.currentTarget;
                  node.scrollLeft += event.deltaY;
                },
              },
              channels.map(id =>
                h(
                  'button',
                  {
                    key: id,
                    type: 'button',
                    className: `${P}chip`,
                    'data-active': id === channel ? 'true' : 'false',
                    onClick: () => onPickChannel(id),
                  },
                  CHANNEL_BY_ID.get(id)?.short ?? id,
                ),
              ),
            )
          : null,
        rows.length === 0
          ? h('div', { className: `${P}empty` }, t(cliKey !== undefined ? 'panel.emptyCli' : 'panel.empty'))
          : h(
              'div',
              { className: `${P}list` },
              rows.map((account, index) => {
                const text = balanceText(balanceOf(account.id), unit);
                const failure = errorOf(account.id);
                const disabled = account.enabled === false;
                return h(
                  'div',
                  {
                    key: account.id,
                    className: `${P}row`,
                    'data-current': index === 0 && cliKey === undefined ? 'true' : 'false',
                    'data-disabled': disabled ? 'true' : 'false',
                    'data-readonly': cliKey !== undefined ? 'true' : 'false',
                    'data-busy': busyId === account.id ? 'true' : 'false',
                    title: typeof failure === 'string' ? failure : undefined,
                    onClick: () => {
                      if (!disabled && cliKey === undefined) void switchTo(account.id);
                    },
                  },
                  h(
                    'span',
                    { className: `${P}nick` },
                    account.nickname ?? account.accountName ?? account.id,
                  ),
                  index === 0 && cliKey === undefined
                    ? h('span', { className: `${P}badge` }, t('panel.priority'))
                    : null,
                  disabled
                    ? h('span', { className: `${P}badge`, 'data-kind': 'off' }, t('panel.disabled'))
                    : null,
                  cliKey !== undefined
                    ? h('span', { className: `${P}badge`, 'data-kind': 'off' }, t('panel.cliBadge'))
                    : null,
                  h(
                    'span',
                    { className: `${P}num`, 'data-unknown': text === null ? 'true' : 'false' },
                    text ?? (failure !== undefined ? t('credits.unavailable') : t('credits.unknown')),
                  ),
                );
              }),
            ),
        h(
          'div',
          { className: `${P}foot` },
          error !== ''
            ? h('div', { className: `${P}err` }, t('panel.failed', { reason: error }))
            : t(cliKey !== undefined ? 'panel.hintCli' : 'panel.hint'),
          rows.length > 0 ? h('div', null, t('panel.accounts', { count: String(rows.length) })) : null,
        ),
      );
    }

    /* ────────────────────────── 胶囊 ────────────────────────── */

    function Capsule(props) {
      const { t, hostCtx, useProjection } = props;
      const projection = useProjection === undefined ? undefined : useProjection('modelSelection');
      const provider = selectedProviderOf(projection);
      const { available, rpc } = useChannelRpc(hostCtx);
      const { rpc: cliRpc } = useChannelRpc(hostCtx, 'cli-credits');

      const [channel, setChannel] = useState(() => readStoredChannel());
      const [snapshot, setSnapshot] = useState(null);
      const [reading, setReading] = useState(false);
      const [open, setOpen] = useState(false);
      const [anchorRef, rect] = useAnchorRect(open);
      // 目标：会话区域 tab 栏（对话 / 轨迹 / 系统监控 那一行）右侧空白处。
      const tabBar = useTabBar();
      const generation = useRef(0);
      const resolved = useRef(false);

      // ① 选中某个渠道自己的模型 → 直接锁定该渠道（并记住）。
      useEffect(() => {
        const direct = channelOfProvider(provider);
        if (direct === undefined) return;
        rememberChannel(direct);
        resolved.current = true;
        setChannel(direct);
      }, [provider]);

      // ② 选中 OFM 主路由（或其它 provider）→ 用记住的渠道；都没有就问一次
      //    provider.status，挑第一个确实有账号的渠道，避免胶囊开天窗。
      useEffect(() => {
        if (resolved.current) return undefined;
        const stored = readStoredChannel();
        if (stored !== null) {
          resolved.current = true;
          setChannel(stored);
          return undefined;
        }
        let cancelled = false;
        void (async () => {
          try {
            const value = await rpc('provider.status', { providers: CHANNEL_IDS }, 20000);
            if (cancelled || resolved.current) return;
            const statuses = value?.statuses ?? {};
            const alive = CHANNEL_IDS.filter(id => (statuses[id]?.accounts?.total ?? 0) > 0);
            const picked = alive[0] ?? CHANNEL_IDS[0];
            rememberChannel(picked);
            resolved.current = true;
            setChannel(picked);
          } catch {
            if (cancelled || resolved.current) return;
            resolved.current = true;
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [provider, rpc]);

      const read = useCallback(
        async force => {
          if (channel === null || !available) return;
          const gen = ++generation.current;
          setReading(true);
          try {
            const meta = CHANNEL_BY_ID.get(channel);
            const rows =
              meta?.cli !== undefined
                ? await readCliRows(meta, { rpc, cliRpc }, force)
                : (
                    await rpc(
                      'usage.badge',
                      { provider: channel, ...(force ? { force: true } : {}) },
                      90000,
                    )
                  )?.accounts ?? [];
            if (gen !== generation.current) return;
            const known = rows.some(row => Number.isFinite(row.balance?.total));
            setSnapshot({
              total: rows.reduce(
                (sum, row) => sum + (Number.isFinite(row.balance?.total) ? row.balance.total : 0),
                0,
              ),
              known,
              count: rows.length,
              failed:
                rows.some(row => row.error !== undefined) ||
                rows.some(row => !Number.isFinite(row.balance?.total)),
              error: '',
            });
          } catch (cause) {
            if (gen !== generation.current) return;
            setSnapshot(previous => ({
              ...(previous ?? { total: 0, known: false, count: 0 }),
              error: String(cause?.message ?? cause),
            }));
          } finally {
            if (gen === generation.current) setReading(false);
          }
        },
        [channel, available, rpc, cliRpc],
      );

      useEffect(() => {
        if (channel === null || !available) return undefined;
        void read(false);
        const timer = setInterval(() => void read(false), READ_INTERVAL_MS);
        return () => clearInterval(timer);
      }, [channel, available, read]);

      // 面板里换了渠道：记住它，并让读数立刻重抓。
      const onPickChannel = useCallback(id => {
        rememberChannel(id);
        resolved.current = true;
        setSnapshot(null);
        setChannel(id);
      }, []);

      const meta = channel === null ? null : CHANNEL_BY_ID.get(channel);
      const unit = meta?.unit ?? 'left';
      const value = snapshot?.known === true ? balanceText({ total: snapshot.total }, unit) : null;
      const state =
        snapshot === null
          ? 'idle'
          : snapshot.error !== ''
            ? 'error'
            : snapshot.known !== true
              ? 'idle'
              : snapshot.failed === true
                ? 'warn'
                : 'success';

      const readout = !available
        ? t('credits.unavailable')
        : reading && snapshot === null
          ? t('credits.loading')
          : (value ?? (snapshot?.count === 0 ? t('credits.empty') : t('credits.unknown')));

      const label = `${meta?.short ?? t('credits.title')} · ${readout}`;

      const capsule = h(
        'div',
        { className: `${P}root`, 'data-dcc-intabs': tabBar === null ? '0' : '1' },
        h(
          'button',
          {
            ref: anchorRef,
            type: 'button',
            className: `${P}btn`,
            [ANCHOR_ATTR]: 'true',
            'data-open': open ? 'true' : 'false',
            title: `${t('credits.title')}：${label}`,
            onClick: event => {
              event.stopPropagation();
              setOpen(previous => !previous);
            },
          },
          h('span', { className: `${P}dot`, 'data-state': state }),
          h('span', null, meta?.short ?? t('credits.title')),
          h('span', { className: `${P}value`, 'data-unknown': value === null ? 'true' : 'false' }, readout),
        ),
      );

      // 胶囊本体投到 tab 栏（与「系统监控」并排）；面板仍 portal 到 body 做浮层。
      // 取不到 tab 栏（hero 空态 / DSH 改结构 / 外部页）→ 原位渲染，绝不整块消失。
      const capsuleNode =
        tabBar === null ? capsule : ReactDOM.createPortal(capsule, tabBar);

      const panelNode =
        open && channel !== null
          ? ReactDOM.createPortal(
              h(Panel, {
                t,
                rpc,
                cliRpc,
                channel,
                rect,
                onPickChannel,
                onClose: () => setOpen(false),
              }),
              document.body,
            )
          : null;

      return h(React.Fragment, null, capsuleNode, panelNode);
    }

    /* ────────────────────────── 插件本体 ────────────────────────── */

    return {
      name: 'dsh-our-free-model-composer-credits',
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(
            () => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }),
            'ofm-composer-credits: dictionaries',
          );
          const cssId = 'dsh-our-free-model-composer-credits/style.css';
          ctx.effect(
            () => {
              if (typeof document === 'undefined') return () => {};
              if (document.querySelector(`style[data-plugin-css="${cssId}"]`) !== null) return () => {};
              const tag = document.createElement('style');
              tag.dataset.plugin = 'dsh-our-free-model-composer-credits';
              tag.dataset.pluginCss = cssId;
              tag.textContent = CSS;
              document.head.appendChild(tag);
              return () => {
                try {
                  tag.remove();
                } catch {
                  /* 已被移除 */
                }
              };
            },
            'ofm-composer-credits: styles',
          );
          const t = ctx.locale.bind(NS);
          // 注册是无条件的；组件自己读宿主 modelSelection 投影与 RPC 可用性，
          // 不可用时降级显示，绝不抛错（抛错会清空整个插槽）。
          ctx.slots.inject(SLOT, () =>
            ctx.slots.register(
              {
                name: SLOT,
                id: 'dsh-our-free-model-composer-credits',
                order: 4,
                locale: NS,
                inject: () => ({ t, hostCtx: ctx }),
              },
              Capsule,
            ),
          );
        } catch (error) {
          console.warn('[ofm-composer-credits] apply failed:', String(error?.message ?? error));
        }
      },
    };
  },
});
