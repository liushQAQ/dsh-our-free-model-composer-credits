/**
 * CLI 反代通道的平台额度读数（宿主半体）。
 *
 * 三条 CLI 通道把请求交给本机客户端 CLI 执行（wb-cli = WorkBuddy/CodeBuddy CLI、
 * zcode-cli = ZCode 客户端 agent、qodercn-cli = Qoder CN CLI），凭证都留在各自
 * 客户端手里，**不在** dsh-our-free-model 的 channel-pack 账号池里 —— 胶囊面板
 * 调 `credits.balances` 读不到它们。
 *
 * 本模块注册 `/api/cli-credits` 的 `cli.balances`，返回与 channel-pack 一致的
 * `{accounts:[{accountId, nickname, balance, error?}]}`，balance 也是同一个
 * `CreditBalance`（`{total, packages[], expiredTotal}`）形状，客户端复用同一套渲染。
 *
 * 三个平台的口径：
 * - ZCode：解密 `~/.zcode/v2/credentials.json` 里的 `zcodejwttoken`，问 Start Plan
 *   的 `/zcode-plan/billing/balance`。单位是 token。⚠️ channel-pack 池里的 `zcode`
 *   账号与本机 CLI **不是同一个**，所以必须直读磁盘凭据。
 * - Qoder CN：CLI 只把登录态写进 `~/.qoder-cn/.qoder-app-status.json`，令牌加密且
 *   没有额度查询接口 —— 这里**只报登录名**，额度由客户端复用 channel-pack 的
 *   `qodercn` 池读数（同账号），登录名用于一致性核对。
 * - WorkBuddy：直读 wb-cli 同款 vault（`$DSH_HOME/workbuddy-vault/<region>/*.json`，
 *   明文 accessToken），逐账号问 CodeBuddy 计费接口
 *   `POST /v2/billing/meter/get-user-resource`（ProductCode p_tcaca）。
 *   口径与 connect-workbuddy 5.5.1 的 `fetchCredits` 完全同源（2026-11-03 实测：
 *   🌈QAQAQ风丶 total=346.39 = 拉新权益包 27.39 + 运营裂变包 319）。该插件已卸载
 *   （恢复加载会挂起内核，见 qclaw-data 备份目录备注），故读数收编进本模块。
 *
 * @module cli-credits
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDecipheriv, createHash } from 'node:crypto'

export const CLI_CREDITS_PATH = '/api/cli-credits'
export const CLI_CREDITS_ENDPOINT = 'cli-credits'

/** 单个上游请求的墙钟上限：额度读数是面板按需触发，宁可报错也不能拖住 RPC。 */
const TIMEOUT_MS = 20000

/** ZCode 客户端版本号（Start Plan 请求头要求；与 channel-pack 的兜底同源口径）。 */
const ZCODE_APP_VERSION = '3.15.0'

/* ────────────────────────── 通用 ────────────────────────── */

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 一次 JSON 请求。非 2xx 也把 body 交给调用方，由调用方决定失败语义。 */
async function requestJson(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return { ok: response.ok, status: response.status, body }
}

/** 与 channel-pack 的 `CreditBalance` 同形；读不到就是 null，绝不伪造 0。 */
function toBalance(packages) {
  let total = 0
  for (const pack of packages) {
    if (Number.isFinite(pack.remaining)) total += pack.remaining
  }
  return { total, packages, expiredTotal: 0 }
}

function packageOf({ name, unit, remaining, total, expiredTime = '' }) {
  const known = Number.isFinite(remaining)
  const size = Number.isFinite(total) ? Math.max(0, total) : Math.max(0, known ? remaining : 0)
  const left = known ? Math.max(0, remaining) : 0
  return {
    name,
    unit,
    remaining: left,
    total: size,
    used: Math.max(0, size - left),
    active: true,
    cycleStartTime: '',
    cycleEndTime: '',
    expiredTime,
  }
}

/* ────────────────────────── ZCode CLI（zcode-cli） ────────────────────────── */

/**
 * 与 zcode.cjs 一致的机器指纹：环境变量优先，否则
 * `zcode-credential-fallback:<platform>:<homedir>:<username>`。
 */
function zcodeSecret() {
  const fromEnv = process.env.ZCODE_CREDENTIAL_SECRET
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  let username = 'unknown'
  try {
    username = os.userInfo().username
  } catch {
    /* 取不到用户名就与 zcode.cjs 一样降级 */
  }
  return `zcode-credential-fallback:${process.platform}:${os.homedir()}:${username}`
}

/** `enc:v1:<iv>.<tag>.<data>` → 明文；非密文原样返回。 */
function decryptZcodeValue(value, key) {
  if (typeof value !== 'string' || !value.startsWith('enc:v1:')) return value
  const parts = value.slice('enc:v1:'.length).split('.')
  if (parts.length !== 3) throw new Error('ZCode 凭据密文格式无效')
  const [iv, tag, data] = parts
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

function readZcodeState() {
  const dir = path.join(os.homedir(), '.zcode', 'v2')
  const credentials = readJson(path.join(dir, 'credentials.json'))
  const key = createHash('sha256').update(zcodeSecret()).digest()
  const jwt = decryptZcodeValue(credentials['zcodejwttoken'], key)
  if (typeof jwt !== 'string' || jwt === '') throw new Error('ZCode 凭据里没有 zcodejwttoken')

  let name
  let userId
  try {
    const info = JSON.parse(decryptZcodeValue(credentials['oauth:zai:user_info'], key))
    name = typeof info?.name === 'string' ? info.name : undefined
    userId = typeof info?.user_id === 'string' ? info.user_id : undefined
  } catch {
    /* 用户信息只是展示用，读不到不影响额度 */
  }

  let deviceMid
  for (const file of ['telemetry-state.json', 'onboarding-record.json']) {
    try {
      const doc = readJson(path.join(dir, file))
      const value = typeof doc?.deviceMid === 'string' ? doc.deviceMid.trim() : ''
      if (value !== '') {
        deviceMid = value
        break
      }
    } catch {
      continue
    }
  }

  return { jwt, deviceMid, name, userId }
}

function zcodeHeaders(state) {
  const headers = {
    'User-Agent': `ZCode/${ZCODE_APP_VERSION}`,
    'HTTP-Referer': 'https://zcode.z.ai',
    'X-ZCode-App-Version': ZCODE_APP_VERSION,
    'X-Release-Channel': 'stable',
    'X-Client-Language': 'zh-CN',
    'X-Client-Timezone': 'Asia/Shanghai',
    'X-Platform': 'win32',
    'X-Os-Category': 'windows',
    'anthropic-version': '2023-06-01',
    Authorization: `Bearer ${state.jwt}`,
  }
  if (typeof state.deviceMid === 'string' && state.deviceMid !== '') headers['X-Device-Mid'] = state.deviceMid
  return headers
}

async function fetchZcodeBalance(state) {
  const { ok, status, body } = await requestJson('https://zcode.z.ai/api/v1/zcode-plan/billing/balance', {
    method: 'GET',
    headers: zcodeHeaders(state),
  })
  if (!ok || body === undefined) throw new Error(`ZCode 额度接口返回 HTTP ${status}`)
  if (body.code !== 0) throw new Error(String(body.msg ?? `ZCode 额度接口业务码 ${body.code}`))
  const data = body?.data
  if (data === undefined || data === null) throw new Error('ZCode 额度接口没有 data')
  if (data.displayMode === 'enterprise') throw new Error('企业版账号不下发额度数字，请在 ZCode 内查看')

  const buckets = Array.isArray(data.balances) ? data.balances : []
  const packages = []
  for (const item of buckets) {
    if (typeof item !== 'object' || item === null) continue
    const remaining = [item.available_units, item.remaining_units].find((value) => typeof value === 'number')
    if (!Number.isFinite(remaining)) continue
    const expiresAt = typeof item.expires_at === 'number' && item.expires_at > 0 ? item.expires_at : undefined
    packages.push(
      packageOf({
        name: typeof item.show_name === 'string' && item.show_name !== '' ? item.show_name : 'ZCode 额度',
        unit: item.unit_type === 'token' ? 'token' : 'credit',
        remaining,
        total: typeof item.total_units === 'number' ? item.total_units : remaining,
        expiredTime: expiresAt !== undefined ? new Date(expiresAt * 1000).toISOString() : '',
      }),
    )
  }
  // 上游对「今天没有剩余桶」回的是空数组 —— 这是真实的 0，不是读取失败。
  return toBalance(packages)
}

async function collectZcode(warn) {
  let state
  try {
    state = readZcodeState()
  } catch (error) {
    return [
      {
        accountId: 'zcode-cli:disk',
        nickname: 'ZCode 本地账号',
        balance: null,
        error: `读不到 ZCode 登录凭据：${reasonOf(error)}`,
      },
    ]
  }
  const nickname = state.name ?? (state.userId !== undefined ? `ZCode ${state.userId.slice(0, 8)}` : 'ZCode 本地账号')
  const accountId = `zcode-cli:${state.userId ?? 'disk'}`
  try {
    return [{ accountId, nickname, balance: await fetchZcodeBalance(state) }]
  } catch (error) {
    warn?.(`[composer-credits] zcode-cli 额度读取失败：${reasonOf(error)}`)
    return [{ accountId, nickname, balance: null, error: reasonOf(error) }]
  }
}

/* ────────────────────────── Qoder CN CLI（qodercn-cli） ────────────────────────── */

/**
 * 只读登录态。额度由客户端复用 channel-pack 的 `qodercn` 池（同账号），
 * 这里的 nickname 供客户端核对「池里那个是不是同一个账号」。
 */
function collectQoderCn() {
  try {
    const doc = readJson(path.join(os.homedir(), '.qoder-cn', '.qoder-app-status.json'))
    if (doc?.logged_in !== true) {
      return [
        {
          accountId: 'qodercn-cli:disk',
          nickname: typeof doc?.name === 'string' && doc.name !== '' ? doc.name : 'Qoder CN 本地账号',
          balance: null,
          error: 'Qoder CN CLI 未登录',
        },
      ]
    }
    return [
      {
        accountId: 'qodercn-cli:disk',
        nickname: typeof doc.name === 'string' && doc.name !== '' ? doc.name : 'Qoder CN 本地账号',
        balance: null,
      },
    ]
  } catch (error) {
    return [
      {
        accountId: 'qodercn-cli:disk',
        nickname: 'Qoder CN 本地账号',
        balance: null,
        error: `读不到 Qoder CN 登录态：${reasonOf(error)}`,
      },
    ]
  }
}

/* ────────────────────────── WorkBuddy CLI（wb-cli） ────────────────────────── */

/** CodeBuddy 国内计费入口（connect-workbuddy 5.5.1 的 CN_BILLING_BASE 同值）。 */
const WB_BILLING_BASE = 'https://www.codebuddy.cn'

/** 个人版资源包 ProductCode（connect-workbuddy 5.5.1 同值）。 */
const WB_PRODUCT_CODE = 'p_tcaca'

/** 与 wb-cli 反代同源：$DSH_HOME/workbuddy-vault，缺省 ~/.dsh/workbuddy-vault。 */
function wbVaultDir() {
  const dshHome = (process.env.DSH_HOME ?? '').trim()
  const base = dshHome !== '' && fs.existsSync(dshHome) ? dshHome : path.join(os.homedir(), '.dsh')
  return path.join(base, 'workbuddy-vault')
}

/**
 * CLI 通道「当前账号」状态文件：`$DSH_HOME/cli-active-accounts.json`。
 *
 * 2026-11-03 老总令「胶囊下面加 CLI 账户切换」：胶囊面板点行写入这里，
 * `dsh-wb-cli-proxy` 每回合重读 vault 时按它把选中账号排到首位（反代侧只认
 * 排第一的那个），因此切完下一轮立即生效，不需要重启 DSH。
 *
 * 形状：`{ "wb-cli": { "accountId": "...", "nickname": "...", "at": 1793... } }`
 * 按 provider 分键，后续接 zcode-cli / qodercn-cli 时不必再改文件格式。
 */
function cliStateFile() {
  return path.join(path.dirname(wbVaultDir()), 'cli-active-accounts.json')
}

/** 读状态文件；文件缺失/损坏一律当空表，绝不让面板因它报错。 */
function readActiveAccounts() {
  try {
    const doc = readJson(cliStateFile())
    return doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}
  } catch {
    return {}
  }
}

function writeActiveAccounts(doc) {
  const file = cliStateFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
}

/** 某个 CLI 通道当前选中的账号 id（无选择时返回空串）。 */
export function activeCliAccountId(provider) {
  const entry = readActiveAccounts()[provider]
  return entry !== null && typeof entry === 'object' && typeof entry.accountId === 'string' ? entry.accountId : ''
}

/** 扫 vault 下 cn 区账号（global 区计费入口不同，未实现，不读）。 */
function readWbVaultAccounts(warn) {
  const out = []
  const dir = path.join(wbVaultDir(), 'cn')
  let names
  try {
    names = fs.readdirSync(dir).filter((file) => file.endsWith('.json'))
  } catch {
    return out
  }
  for (const name of names) {
    try {
      const doc = readJson(path.join(dir, name))
      const token = doc?.auth?.accessToken
      if (typeof token !== 'string' || token === '') continue
      out.push({
        token,
        uid: typeof doc?.account?.uid === 'string' ? doc.account.uid : '',
        domain: typeof doc?.auth?.domain === 'string' ? doc.auth.domain : '',
        // 反代的自然排序口径：expiresAt 越大越靠前；面板复刻同一顺序才不会「显示一个、用的是另一个」。
        expiresAt: typeof doc?.auth?.expiresAt === 'number' ? doc.auth.expiresAt : 0,
        accountId: typeof doc?.accountId === 'string' && doc.accountId !== '' ? doc.accountId : name.replace(/\.json$/, ''),
        nickname: typeof doc?.account?.nickname === 'string' && doc.account.nickname !== '' ? doc.account.nickname : '',
      })
    } catch (error) {
      warn?.(`[composer-credits] wb-cli vault 账号 ${name} 读取失败：${reasonOf(error)}`)
    }
  }
  return out
}

function wbDateHeader(date) {
  const pad = (value) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function wbParseDateMs(value) {
  if (typeof value === 'number' && value > 1e12) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

/**
 * 单账号积分读数。字段映射与 connect-workbuddy 5.5.1 `fetchCredits` 逐项同源：
 * CapacityType===4 为月度包；余量取 CycleCapacityRemain（含 Precise 字符串变体），
 * 非月度包余量 ≤0 或已过期直接跳过（与上游一致，不算进 total）。
 */
async function fetchWbBalance(account) {
  const now = new Date()
  const headers = {
    Authorization: `Bearer ${account.token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }
  if (account.uid !== '') headers['X-User-Id'] = account.uid
  if (account.domain !== '') headers['X-Domain'] = account.domain
  const { ok, status, body } = await requestJson(`${WB_BILLING_BASE}/v2/billing/meter/get-user-resource`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      PageNumber: 1,
      PageSize: 100,
      ProductCode: WB_PRODUCT_CODE,
      Status: [0, 3],
      PackageEndTimeRangeBegin: wbDateHeader(now),
      PackageEndTimeRangeEnd: wbDateHeader(new Date(now.getTime() + 3185136e6)),
    }),
  })
  if (!ok || body === undefined) throw new Error(`WorkBuddy 计费接口返回 HTTP ${status}`)
  if (body?.code !== 0) throw new Error(String(body?.msg ?? `WorkBuddy 计费接口业务码 ${body?.code}`))
  const rawAccounts = body?.data?.Response?.Data?.Accounts
  const packages = []
  for (const raw of Array.isArray(rawAccounts) ? rawAccounts : []) {
    if (raw === null || typeof raw !== 'object') continue
    const numberOf = (key) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : 0)
    const preciseOf = (key) => {
      const text = raw[`${key}Precise`]
      if (typeof text === 'string' && text !== '') {
        const parsed = Number.parseFloat(text)
        if (Number.isFinite(parsed)) return parsed
      }
      if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) return raw[key]
      return numberOf(key)
    }
    const monthly = numberOf('CapacityType') === 4
    const remain = raw.CycleCapacityRemain !== undefined || raw.CycleCapacityRemainPrecise !== undefined
      ? preciseOf('CycleCapacityRemain')
      : preciseOf('CapacityRemain')
    const capped = remain > 0 ? remain : 0
    const cycleEndMs = wbParseDateMs(raw.CycleEndTime)
    const expiresAtMs = monthly ? undefined : (wbParseDateMs(raw.ExpiredTime) ?? cycleEndMs)
    if (!monthly && (capped <= 0 || (expiresAtMs !== undefined && expiresAtMs <= Date.now()))) continue
    packages.push(packageOf({
      name: typeof raw.PackageName === 'string' && raw.PackageName !== '' ? raw.PackageName : 'WorkBuddy 积分包',
      unit: 'credit',
      remaining: capped,
      total: preciseOf('CycleCapacitySize') || preciseOf('CapacitySize'),
      expiredTime: expiresAtMs !== undefined ? new Date(expiresAtMs).toISOString() : '',
    }))
  }
  return toBalance(packages)
}

/** vault 里每个账号一行；读数失败带 error，绝不伪造 0。第一行 = 反代实际会用的那个。 */
async function collectWbCli(warn) {
  const accounts = readWbVaultAccounts(warn)
  if (accounts.length === 0) {
    return [
      {
        accountId: 'wb-cli:disk',
        nickname: 'WorkBuddy 本地 vault',
        balance: null,
        error: 'vault 里没有可用账号（请先在 WorkBuddy 客户端登录）',
      },
    ]
  }
  const activeId = activeCliAccountId('wb-cli')
  // 顺序与反代逐条对齐：选中的账号第一；没选过就按 expiresAt 降序（反代的原始口径）。
  // 这样面板第一行永远是「下一回合真正会被使用的账号」，不会显示一个、实际用另一个。
  const ordered = [...accounts].sort((left, right) => {
    const prefer = Number(right.accountId === activeId) - Number(left.accountId === activeId)
    if (prefer !== 0) return prefer
    return (right.expiresAt ?? 0) - (left.expiresAt ?? 0)
  })
  const effectiveId = ordered[0]?.accountId ?? ''
  const rows = await Promise.all(ordered.map(async (account) => {
    const row = {
      accountId: `wb-cli:${account.accountId}`,
      nickname: account.nickname !== '' ? account.nickname : `cn 账号 ${account.accountId.slice(0, 8)}`,
      active: account.accountId === effectiveId,
    }
    try {
      row.balance = await fetchWbBalance(account)
    } catch (error) {
      warn?.(`[composer-credits] wb-cli 额度读取失败（${row.nickname}）：${reasonOf(error)}`)
      row.error = reasonOf(error)
    }
    return row
  }))
  return rows
}

/* ────────────────────────── RPC ────────────────────────── */

export const CLI_CHANNEL_IDS = ['wb-cli', 'zcode-cli', 'qodercn-cli']

/** 已注册的反代 provider；未装对应插件的玩家不该在芯片条里看到空条目。 */
function installedCliProviders(llm) {
  try {
    const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : []
    const ids = new Set((providers ?? []).map((provider) => provider?.id))
    return CLI_CHANNEL_IDS.filter((id) => ids.has(id))
  } catch {
    return []
  }
}

/**
 * 切换某个 CLI 通道的当前账号：写状态文件，`dsh-wb-cli-proxy` 下一回合读 vault 时
 * 会把该账号排到首位（反代只用排第一的凭据，401 才继续往下换）。
 *
 * 只做「排序声明」，不动 vault 里的任何凭据文件 —— 账号凭证仍由客户端/插件维护，
 * 这里的操作随时可以删掉状态文件回滚。
 *
 * @param {string} provider - 目前只支持 `wb-cli`（另两条 CLI 通道暂时只有一个本机账号）。
 * @param {string} accountId - 面板行 id（`wb-cli:<vault文件名去后缀>`）或裸 accountId。
 */
export async function switchCliAccount(provider, accountId, warn) {
  if (provider !== 'wb-cli') {
    return { ok: false, error: { code: 'bad-request', message: `该通道不支持切换账号：${String(provider)}` } }
  }
  const raw = String(accountId ?? '').startsWith('wb-cli:') ? String(accountId).slice('wb-cli:'.length) : String(accountId ?? '')
  const target = readWbVaultAccounts(warn).find((account) => account.accountId === raw)
  if (target === undefined) {
    return { ok: false, error: { code: 'bad-request', message: `vault 里没有账号：${raw}` } }
  }
  const doc = readActiveAccounts()
  doc['wb-cli'] = { accountId: target.accountId, nickname: target.nickname, at: Date.now() }
  try {
    writeActiveAccounts(doc)
  } catch (error) {
    return { ok: false, error: { code: 'cli-credits/write-failed', message: `写状态文件失败：${reasonOf(error)}` } }
  }
  warn?.(`[composer-credits] wb-cli 当前账号 → ${target.nickname !== '' ? target.nickname : target.accountId}`)
  return { ok: true, value: { provider: 'wb-cli', accountId: target.accountId, nickname: target.nickname } }
}

/**
 * `cli.balances` / `cli.channels` / `cli.switchAccount` 的分派。
 * @param {string} method
 * @param {object} payload - `{provider}` 或 `{provider, accountId}`。
 * @param {(message: string) => void} [warn]
 * @param {object} [llm] - 宿主 `llm` 服务，`cli.channels` 用它判断哪些反代已安装。
 */
export async function handleCliCredits(method, payload, warn, llm) {
  if (method === 'cli.channels') {
    return { ok: true, value: { providers: installedCliProviders(llm) } }
  }
  if (method === 'cli.switchAccount') {
    const body = payload !== null && typeof payload === 'object' ? payload : {}
    return switchCliAccount(body.provider, body.accountId, warn)
  }
  if (method !== 'cli.balances') {
    return { ok: false, error: { code: 'gateway/bad-request', message: `unsupported method: ${String(method)}` } }
  }
  const provider = payload !== null && typeof payload === 'object' ? payload.provider : undefined
  let accounts
  switch (provider) {
    case 'zcode-cli':
      accounts = await collectZcode(warn)
      break
    case 'wb-cli':
      accounts = await collectWbCli(warn)
      break
    case 'qodercn-cli':
      accounts = collectQoderCn()
      break
    default:
      return { ok: false, error: { code: 'bad-request', message: `unsupported provider: ${String(provider)}` } }
  }
  return { ok: true, value: { accounts } }
}

function reply(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result })
}

/** 挂上 `/api/cli-credits`：协议与 channel-pack 的 RPC 同构，客户端复用同一个调用器。 */
export function registerCliCredits(ctx) {
  ctx.inject(['connection'], (connectionCtx) => {
    const connection = connectionCtx.connection ?? connectionCtx.get?.('connection')
    if (connection === undefined || connection === null || typeof connection.fetch?.register !== 'function') {
      ctx.logger?.warn?.('[composer-credits] connection.fetch 不可用，CLI 额度 RPC 未注册')
      return
    }
    connection.fetch.register({
      path: CLI_CREDITS_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
        const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (contentType !== 'application/json') return new Response('content type must be application/json', { status: 415 })
        let message
        try {
          message = await request.json()
        } catch {
          return new Response('body is not JSON', { status: 400 })
        }
        const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
        const call = message?.payload
        if (
          message?.type !== 'client-request' ||
          typeof message?.rpcId !== 'string' ||
          message?.method !== CLI_CREDITS_ENDPOINT ||
          call === null ||
          typeof call !== 'object' ||
          typeof call.method !== 'string' ||
          !Object.prototype.hasOwnProperty.call(call, 'payload')
        ) {
          return reply(rpcId, { ok: false, error: { code: 'gateway/bad-request', message: 'Invalid CLI credits request.' } })
        }
        try {
          return reply(rpcId, await handleCliCredits(call.method, call.payload, (line) => ctx.logger?.warn?.(line), ctx.llm))
        } catch (error) {
          const reason = reasonOf(error)
          ctx.logger?.warn?.(`[composer-credits] ${String(call.method)} failed: ${reason}`)
          return reply(rpcId, { ok: false, error: { code: 'cli-credits/handler-failed', message: reason } })
        }
      },
    })
  })
}
