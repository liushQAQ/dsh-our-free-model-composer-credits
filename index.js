/**
 * dsh-our-free-model-composer-credits — 宿主半体。
 *
 * 本插件有两个半体，各管两件事：
 *
 * 1. Client 半体（`client.js`）：在会话 tab 栏常驻一枚「渠道 · 余额」积分胶囊，
 *    点开面板可切换优先账号。它靠 package.json 的 `dsh.client` 声明与
 *    `exports["./client"]` 被 dsh-client-modules 发现并注入页面。
 *
 * 2. 宿主半体（本文件 + `cli-credits.js`）：
 *    - 给 dsh-our-free-model 各渠道的模型名加上平台前缀，解决「不同平台存在同名模型、
 *      界面上分不出是哪个平台」的问题。显示效果示例：`LobsterAI · DeepSeek-V4.1-Flash · x0.05`。
 *    - 注册 `/api/cli-credits`，给胶囊面板提供三条 CLI 反代通道（wb-cli / zcode-cli /
 *      qodercn-cli）的平台额度读数 —— 它们的凭证不在 channel-pack 账号池里。
 *
 * 宿主半体必须是能被 Loader import 的合法模块：导出 name / inject / apply，
 * 否则 `EntryTree.import` 无法为该 entry 建 fiber，客户端 bundle 也就不会被扫描到。
 */

import { registerCliCredits } from './cli-credits.js'

export const name = 'dsh-our-free-model-composer-credits';

/** `llm` 必须就绪才能拿到模型读取接口。 */
export const inject = ['llm'];

/**
 * provider 路由 → 平台前缀。
 *
 * 路由名由 dsh-our-free-model 内置的渠道包注册（每渠道一个 provider id）。
 * 只有命中这里的 provider 才会加前缀，其它 provider（官方路由、第三方插件注册的
 * 路由等）原样透传，不做任何改写。
 */
const CHANNEL_LABELS = {
  codearts: 'CodeArts',
  lobsterai: 'LobsterAI',
  qoder: 'Qoder',
  qodercn: 'QoderCN',
  trae: 'TRAE',
  cline: 'Cline',
  loomy: 'Loomy',
  raccoon: 'Raccoon',
  minimax: 'MiniMax',
  zcode: 'ZCode',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  // 以下两个渠道在上游较新版本里已移除入口，映射保留：旧版本或回滚时仍能正确显示。
  buddy: 'CodeBuddy',
  workbuddy: 'WorkBuddy',
};

/** 前缀分隔符，与 dsh-our-free-model 在模型名后缀倍率时用的是同一个字符。 */
const SEPARATOR = ' · ';

/**
 * 给一个模型名加平台前缀。
 *
 * @param provider - 该模型所属的 provider 路由。
 * @param name - 适配器原本返回的显示名（可能已带 ` · x<倍率>` 后缀）。
 * @returns 加前缀后的显示名；provider 不在表内或名字为空时原样返回。
 */
function withChannelPrefix(provider, name) {
  if (typeof name !== 'string' || name.length === 0) return name;
  const label = Object.prototype.hasOwnProperty.call(CHANNEL_LABELS, provider) ? CHANNEL_LABELS[provider] : undefined;
  if (label === undefined) return name;
  // 幂等：已经加过（例如热重载后又包了一层）就不叠加。
  if (name.startsWith(label + SEPARATOR)) return name;
  return label + SEPARATOR + name;
}

/** 幂等标记，挂在 llm 服务实例上，避免热重载把同一个方法反复包装。 */
const APPLIED = Symbol.for('dsh-our-free-model-composer-credits.host.applied');

/**
 * 在 `llm` 的两处「读取模型元数据」的出口上做显示名改写。
 *
 * 之所以改读取端而不是注册端：渠道包在它自己的 apply 里注册适配器，注册顺序不受本插件
 * 控制；而所有面向界面的模型目录都经由这两个方法取值，改在出口处对顺序不敏感。
 *
 * - `llm.listModels(provider)`：模型选择器/目录列表用。
 * - `llm.resolveModelInfo(provider, model, signal)`：选中某个模型后的详情（`name` 也用于展示）。
 *
 * 只改 `name` 这一个显示字段，`id` / `provider` / 上下文与工具元数据一律不动，
 * 因此不影响路由、请求组装与会话历史里已有的模型标识。
 *
 * @param ctx - 插件上下文（`inject` 保证 `ctx.llm` 已就绪）。
 */
export function apply(ctx) {
  // CLI 通道额度 RPC 与模型名前缀互不依赖：先挂 RPC，llm 不在时前缀改写直接跳过。
  registerCliCredits(ctx);

  const llm = ctx === undefined || ctx === null ? undefined : ctx.llm;
  if (llm === undefined || llm === null) return;
  if (llm[APPLIED] === true) return;

  try {
    Object.defineProperty(llm, APPLIED, { value: true, enumerable: false, configurable: true });
  } catch {
    return;
  }

  const originalListModels = llm.listModels.bind(llm);
  llm.listModels = async function listModelsWithChannelPrefix(provider) {
    const models = await originalListModels(provider);
    if (!Array.isArray(models)) return models;
    return models.map((model) => ({ ...model, name: withChannelPrefix(provider, model.name) }));
  };

  const resolveModelInfo = llm.resolveModelInfo;
  if (typeof resolveModelInfo === 'function') {
    const originalResolveModelInfo = resolveModelInfo.bind(llm);
    llm.resolveModelInfo = async function resolveModelInfoWithChannelPrefix(provider, model, signal) {
      const info = await originalResolveModelInfo(provider, model, signal);
      if (info === undefined || info === null) return info;
      return { ...info, name: withChannelPrefix(provider, info.name) };
    };
  }
}
