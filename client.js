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
     * 挂载位置：**会话头部按钮区**（顶栏那一行：对话 / 轨迹 / 系统监控 的右侧）。
     *
     * 🔴 2026-10-23 老总令（原话）：「任何插件看都不要占用这个会话框位置，
     *   占用了压缩原生按钮空间。提示其他玩家。这是规范纳入 dsh 自建插件要求。」
     *   规范全文见仓库 PLUGIN_LAYOUT_RULES.md（会话框禁占区）。
     *
     * 旧值 = `conversation.input.left`（输入框工具行左侧）—— 那是**原生按钮的地盘**：
     * 读数胶囊 + 宿主自带的权限/agent/模型控件挤在同一行，430pt 真机上直接把原生
     * 按钮压窄、叠印（老总 2026-10-23 08:51 截图实锤：模型按钮只剩 5px 宽）。
     * 迁到 `conversation.session.header.actions` 后：会话框里一个插件元素都不留，
     * 原生按钮拿到完整宽度；桌面端与手机端同一套前端，两端同时生效。
     *
     * 通用性：header.actions 是 DSH 官方公开 slot（dsh-anywhere / agent-teams 均在用），
     * 不依赖任何本机特有结构，其他玩家装同一个包得到同样的位置。
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
    const CHANNEL_BY_ID = new Map(CHANNELS.map(channel => [channel.id, channel]));

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
        'panel.hint': '点一行即把该账号排到最前（秒切优先账号）。',
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
        'panel.hint': 'Click a row to move that account to the front.',
        'panel.failed': 'Failed: {reason}',
        'panel.accounts': '{count} accounts',
      },
    };

    const CSS = `
.${P}root { display: inline-flex; align-items: center; }
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
.${P}chips { display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.${P}chip {
  flex: none; height: 22px; padding: 0 9px; border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px;
  white-space: nowrap; cursor: pointer;
}
.${P}chip:hover { color: var(--dsw-alias-label-primary); }
.${P}chip[data-active="true"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.${P}list { flex: 1; overflow: auto; padding: 4px 0; }
.${P}row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; cursor: pointer; }
.${P}row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.${P}row[data-current="true"] { background: var(--dsw-alias-bg-layer-2); }
.${P}row[data-disabled="true"] { opacity: 0.55; cursor: default; }
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

    /** 余额对象 → 显示串；读不到就是 null，绝不伪造 0。 */
    function balanceText(balance, unit) {
      const total = balance?.total;
      if (!Number.isFinite(total)) return null;
      if (unit === 'dollars') return `$${kilo(total)}`;
      return kilo(total);
    }

    /**
     * channel-pack 的 RPC 通道。与 `vendor/dsh-our-free-model/client.js:4036-4078`
     * 完全同构：`connection` 是机会式读取，拿不到时 available=false，调用抛错，
     * 由调用方降级而不是让插槽崩掉。
     */
    function useChannelRpc(ctx) {
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
              'channel-pack',
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
        [readTransport],
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

    /* ────────────────────────── 面板 ────────────────────────── */

    function Panel(props) {
      const { t, rpc, channel, rect, onPickChannel, onClose } = props;
      const [accounts, setAccounts] = useState(null);
      const [balances, setBalances] = useState(null);
      const [loading, setLoading] = useState(false);
      const [error, setError] = useState('');
      const [busyId, setBusyId] = useState(null);
      const [channels, setChannels] = useState(null);
      const generation = useRef(0);
      const panelRef = useRef(null);

      const meta = CHANNEL_BY_ID.get(channel);

      const load = useCallback(
        async force => {
          const gen = ++generation.current;
          setLoading(true);
          const failures = [];
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
        [channel, rpc],
      );

      // 打开时立刻抓一次；此后每分钟抓一次（只在面板打开期间，绝不按账号数放大上游读）。
      useEffect(() => {
        void load(false);
        const timer = setInterval(() => void load(false), PANEL_INTERVAL_MS);
        return () => clearInterval(timer);
      }, [load]);

      // 渠道清单：provider.status 一次问完全部渠道，挑出「确实有账号」的给用户切。
      useEffect(() => {
        let cancelled = false;
        void (async () => {
          try {
            const value = await rpc('provider.status', { providers: CHANNEL_IDS }, 20000);
            if (cancelled) return;
            const statuses = value?.statuses ?? {};
            const alive = CHANNEL_IDS.filter(id => (statuses[id]?.accounts?.total ?? 0) > 0);
            setChannels(alive.length > 0 ? alive : [channel]);
          } catch {
            if (!cancelled) setChannels([channel]);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [rpc, channel]);

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
              { className: `${P}chips` },
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
          ? h('div', { className: `${P}empty` }, t('panel.empty'))
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
                    'data-current': index === 0 ? 'true' : 'false',
                    'data-disabled': disabled ? 'true' : 'false',
                    'data-busy': busyId === account.id ? 'true' : 'false',
                    title: typeof failure === 'string' ? failure : undefined,
                    onClick: () => {
                      if (!disabled) void switchTo(account.id);
                    },
                  },
                  h(
                    'span',
                    { className: `${P}nick` },
                    account.nickname ?? account.accountName ?? account.id,
                  ),
                  index === 0 ? h('span', { className: `${P}badge` }, t('panel.priority')) : null,
                  disabled
                    ? h('span', { className: `${P}badge`, 'data-kind': 'off' }, t('panel.disabled'))
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
            : t('panel.hint'),
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

      const [channel, setChannel] = useState(() => readStoredChannel());
      const [snapshot, setSnapshot] = useState(null);
      const [reading, setReading] = useState(false);
      const [open, setOpen] = useState(false);
      const [anchorRef, rect] = useAnchorRect(open);
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
            const value = await rpc(
              'usage.badge',
              { provider: channel, ...(force ? { force: true } : {}) },
              90000,
            );
            if (gen !== generation.current) return;
            const rows = value?.accounts ?? [];
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
        [channel, available, rpc],
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

      return h(
        'div',
        { className: `${P}root` },
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
        open && channel !== null
          ? ReactDOM.createPortal(
              h(Panel, {
                t,
                rpc,
                channel,
                rect,
                onPickChannel,
                onClose: () => setOpen(false),
              }),
              document.body,
            )
          : null,
      );
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
