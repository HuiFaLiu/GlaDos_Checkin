// ============================================================
// GLaDOS Auto Check-in v3.2.3 — Background Service Worker
// 多域名自动切换 (glados.cloud / railgun.info / glados.one)
// Cookie 认证 + 超时/重试 + 随机签到 + 失败补签
// ============================================================

const ALARM_NAME = 'glados-auto-checkin';
const LEGACY_RETRY_ALARM = 'glados-retry-checkin';

// 2026 年起 glados.one 在部分网络下无法直连，官方脚本已迁移到新域名。
// 顺序即优先级；有登录 Cookie 的域名会排在前面。
const DOMAINS = ['glados.cloud', 'glados.space', 'railgun.info', 'glados.one'];

const CHECKIN_PATH = '/api/user/checkin';
const STATUS_PATH = '/api/user/status';
const POINTS_PATH = '/api/user/points';

const REQUEST_TIMEOUT_MS = 12000;
const USER_INFO_TIMEOUT_MS = 6000;
const DIAGNOSE_TIMEOUT_MS = 8000;

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_DELAYS_MIN = [5, 10, 20, 40, 60];

const DNR_RULE_BASE = 100;

const HISTORY_KEY = 'checkinHistory';
const MAX_HISTORY = 100;

// ---- 默认配置 ----
const DEFAULT_CONFIG = {
  checkinHour: 8,
  checkinMinute: 0,
  randomTime: true,
  randomStartHour: 8,
  randomStartMinute: 0,
  randomEndHour: 22,
  randomEndMinute: 0,
  notifyEnabled: true,
  autoCheckin: true,
};

// ---- 工具函数 ----

function log(msg) {
  const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`[GLaDOS][${timestamp}] ${msg}`);
}

// GLaDOS 的“一天”按北京时间计算，用固定时区避免系统时区/夏令时导致跨日误判。
const DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getTodayStr() {
  const parts = DATE_FORMATTER.formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * ((max - min) + 1)) + min;
}

function minutesOfDay(h, m) {
  return h * 60 + m;
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toBool(value, fallback = true) {
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return fallback;
}

function sanitizeConfig(raw) {
  const config = { ...DEFAULT_CONFIG, ...(raw || {}) };
  return {
    checkinHour: clampInt(config.checkinHour, DEFAULT_CONFIG.checkinHour, 0, 23),
    checkinMinute: clampInt(config.checkinMinute, DEFAULT_CONFIG.checkinMinute, 0, 59),
    randomTime: toBool(config.randomTime, DEFAULT_CONFIG.randomTime),
    randomStartHour: clampInt(config.randomStartHour, DEFAULT_CONFIG.randomStartHour, 0, 23),
    randomStartMinute: clampInt(config.randomStartMinute, DEFAULT_CONFIG.randomStartMinute, 0, 59),
    randomEndHour: clampInt(config.randomEndHour, DEFAULT_CONFIG.randomEndHour, 0, 23),
    randomEndMinute: clampInt(config.randomEndMinute, DEFAULT_CONFIG.randomEndMinute, 0, 59),
    notifyEnabled: toBool(config.notifyEnabled, DEFAULT_CONFIG.notifyEnabled),
    autoCheckin: toBool(config.autoCheckin, DEFAULT_CONFIG.autoCheckin),
  };
}

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return sanitizeConfig(config);
}

async function setConfig(newConfig) {
  const current = await getConfig();
  const merged = sanitizeConfig({ ...current, ...(newConfig || {}) });
  await chrome.storage.local.set({ config: merged });
  return merged;
}

// ============================================================
// declarativeNetRequest：为每个域名伪造匹配的 Origin / Referer
// （fetch 不允许手动设置这两个头，只能由 DNR 修改）
// ============================================================

let dnrReady = false;

async function setupDeclarativeNetRequest(force = false) {
  if (dnrReady && !force) return;

  const rules = DOMAINS.map((domain, index) => ({
    id: DNR_RULE_BASE + index,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [
        { header: 'Origin', operation: 'set', value: `https://${domain}` },
        { header: 'Referer', operation: 'set', value: `https://${domain}/console/checkin` },
      ],
    },
    condition: {
      urlFilter: `||${domain}${CHECKIN_PATH}`,
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  }));

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      // 同时清理旧版本 id=1 的规则
      removeRuleIds: [1, ...rules.map((r) => r.id)],
      addRules: rules,
    });
    dnrReady = true;
    log('declarativeNetRequest 规则已更新');
  } catch (e) {
    dnrReady = false;
    log(`declarativeNetRequest 设置失败: ${e.message}`);
  }
}

// ============================================================
// Cookie
// ============================================================

async function getDomainCookies(domain) {
  const results = await Promise.all([
    // domain 能拿到包括指定 path 的 Cookie（例如 Path=/console）
    chrome.cookies.getAll({ domain }).catch(() => []),
    // url 能拿到对该地址真正生效的 Cookie（包括父域）
    chrome.cookies.getAll({ url: `https://${domain}/` }).catch(() => []),
  ]);

  const seen = new Set();
  const cookies = [];
  for (const list of results) {
    for (const cookie of list || []) {
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cookies.push(cookie);
    }
  }
  return cookies;
}

async function hasHostPermission(domain) {
  try {
    return await chrome.permissions.contains({ origins: [`https://${domain}/*`] });
  } catch {
    return null;
  }
}

// 只读取域名/名称/路径等元数据，不读取 Cookie 值，用于诊断登录态落在哪个域名
async function listRelatedCookies() {
  try {
    const all = await chrome.cookies.getAll({});
    return (all || [])
      .filter((c) => /(^|\.)(glados|railgun)\.[a-z]+$/i.test(c.domain || ''))
      .map((c) => ({
        name: c.name,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        session: c.session,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate || null,
      }))
      .sort((a, b) => `${a.domain}${a.name}`.localeCompare(`${b.domain}${b.name}`));
  } catch {
    return [];
  }
}

// 有些 Cookie（Partitioned/特殊 Path）chrome.cookies 看不到，但 fetch 仍会携带。
// 用只读的 status 接口探测哪些域名当前真的带登录态。
async function probeAuthenticatedDomains(timeout = 6000) {
  const results = await Promise.all(DOMAINS.map(async (domain) => {
    try {
      const resp = await fetchJson(`https://${domain}${STATUS_PATH}`, { timeout });
      return { domain, authenticated: Number(resp.data?.code) === 0 };
    } catch {
      return { domain, authenticated: false };
    }
  }));

  return results.filter((r) => r.authenticated).map((r) => r.domain);
}

function hasAuthCookie(cookies) {
  return cookies.some((c) => /sess|session|auth|token|uid|user/i.test(c.name));
}

async function getCandidateDomains() {
  const entries = await Promise.all(
    DOMAINS.map(async (domain) => ({ domain, cookies: await getDomainCookies(domain) }))
  );

  return entries
    .filter((entry) => entry.cookies.length > 0)
    .sort((a, b) => Number(hasAuthCookie(b.cookies)) - Number(hasAuthCookie(a.cookies)));
}

// ============================================================
// HTTP
// ============================================================

async function fetchJson(url, { method = 'GET', body, headers = {}, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method,
      body,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });

    const text = await resp.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return { ok: resp.ok, status: resp.status, data, text };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    const message = aborted
      ? `请求超时（${Math.round(timeout / 1000)} 秒）`
      : `网络请求失败：${e.message || e}`;
    const error = new Error(message);
    error.network = true;
    error.aborted = aborted;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractDays(data, message) {
  const direct = data?.data?.days ?? data?.days;
  const days = toRoundedNumber(direct, 1);
  if (days !== null) return String(days);

  const match = String(message || '').match(/(\d+(?:\.\d+)?)\s*days?/i);
  return match ? String(toRoundedNumber(match[1], 1) ?? match[1]) : '-';
}

// 接口偶尔返回 461.0000000000000000 / 125.000000 这类浮点字符串，统一去掉噪音
function toRoundedNumber(value, digits = 0) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number'
    ? value
    : Number.parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;

  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

// ============================================================
// 单域名签到
// ============================================================

async function checkinOnDomain(domain) {
  const url = `https://${domain}${CHECKIN_PATH}`;

  const resp = await fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({ token: domain }),
    headers: { 'Content-Type': 'application/json' },
    timeout: REQUEST_TIMEOUT_MS,
  });

  if (!resp.ok) {
    const snippet = String(resp.text || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    if (resp.status === 401) {
      return {
        status: 'auth',
        code: 401,
        message: '登录状态无效（HTTP 401），请重新登录',
        retryable: false,
        days: '-',
      };
    }

    const retryable = resp.status === 403 || resp.status === 408 || resp.status === 429 || resp.status >= 500;
    return {
      status: 'error',
      code: resp.status,
      message: `HTTP ${resp.status}${snippet ? `：${snippet}` : ''}`,
      retryable,
      days: '-',
    };
  }

  const data = resp.data;
  if (!data || typeof data !== 'object') {
    return {
      status: 'error',
      code: -1,
      message: `响应不是 JSON（HTTP ${resp.status}），可能被 Cloudflare 或代理拦截`,
      retryable: true,
      days: '-',
    };
  }

  const code = Number(data.code);
  const message = String(data.message ?? '');
  const days = extractDays(data, message);

  // 0 = 签到成功；1 = 今日已签到（不同版本文案不同，按 code 判断更可靠）
  if (code === 0) {
    return { status: 'success', code, message: message || '签到成功', days, retryable: false };
  }
  if (code === 1) {
    return { status: 'already', code, message: message || '今日已签到', days, retryable: false };
  }

  if (code === 4) {
    const reason = String(data.reason || '');
    const device = data.loginDevice ? String(data.loginDevice) : '未知';
    const hint = reason === 'device-mismatch'
      ? `登录设备与当前浏览器不一致（${device}），请在本浏览器重新登录`
      : '服务端风控拒绝';
    return {
      status: 'device',
      code,
      message: `${message || '签到被拒绝'}（${hint}）`,
      retryable: false,
      days,
    };
  }

  if (code === -2) {
    return {
      status: 'auth',
      code,
      message: message || '没有权限，登录 Cookie 可能已失效',
      retryable: false,
      days,
    };
  }

  return {
    status: 'unknown',
    code: Number.isFinite(code) ? code : -1,
    message: message || `未知响应 code=${data.code}`,
    retryable: true,
    days,
  };
}

// ============================================================
// 多域名签到
// ============================================================

async function runCheckin() {
  await setupDeclarativeNetRequest();

  let candidates = await getCandidateDomains();
  if (candidates.length === 0) {
    // Cookie API 可能看不到 Partitioned/特殊 Path 的 Cookie；
    // 但 fetch 仍可能带登录态，所以用 status 接口探测。
    const probed = await probeAuthenticatedDomains();
    if (probed.length > 0) {
      log(`Cookie API 未返回 Cookie，但 status 探测到登录态: ${probed.join(', ')}`);
      candidates = probed.map((domain) => ({ domain, cookies: [] }));
    } else {
      const [related, permissions] = await Promise.all([
        listRelatedCookies(),
        Promise.all(DOMAINS.map((domain) => hasHostPermission(domain))),
      ]);

      const denied = DOMAINS.filter((_, index) => permissions[index] === false);
      const relatedDomains = [...new Set(related.map((c) => c.domain.replace(/^\./, '')))];

      let message;
      if (denied.length > 0) {
        message = `扩展缺少这些站点的访问权限：${denied.join('、')}。请到 chrome://extensions → 本扩展 → 详情 → 站点访问权限，改为“在特定网站上允许”并加入这些域名，或直接重新加载扩展。`;
      } else if (relatedDomains.length > 0) {
        message = `在 ${DOMAINS.join(' / ')} 下没有找到可用登录 Cookie，但检测到这些域名有 Cookie：${relatedDomains.join('、')}。请确认你登录的域名，并在同一个 Chrome 配置文件中重新登录一次。`;
      } else {
        message = `未找到登录 Cookie，且 ${DOMAINS.join(' / ')} 的 status 接口都没有返回登录态（均非 code=0）。请确认：① 在安装扩展的这个 Chrome 配置文件中打开 https://glados.cloud 登录；② 登录后点“网络诊断”；③ 旧域名 glados.one 的登录态不会自动迁移。`;
      }

      return {
        status: 'auth',
        code: -2,
        message,
        retryable: false,
        days: '-',
      };
    }
  }

  // 有明确登录 Cookie 的域名优先；如果都只是 cf_clearance 之类的 Cookie，再全部尝试
  const authenticated = candidates.filter((c) => hasAuthCookie(c.cookies));
  const pool = authenticated.length > 0 ? authenticated : candidates;

  const failures = [];
  for (const { domain } of pool) {
    try {
      const result = await checkinOnDomain(domain);
      result.domain = domain;

      if (result.status === 'success' || result.status === 'already') {
        return result;
      }

      failures.push(result);
      log(`${domain} 签到未成功: ${result.message}`);
    } catch (e) {
      failures.push({
        status: 'error',
        code: -1,
        domain,
        message: e.message || '网络请求失败',
        retryable: true,
        days: '-',
      });
      log(`${domain} 签到异常: ${e.message}`);
    }
  }

  const blocking = failures.some((f) => f.status === 'auth' || f.status === 'device');
  const messages = [...new Set(failures.map((f) => `${f.domain}: ${f.message}`))];
  const last = failures[failures.length - 1];
  const oldDomainHint = failures.some((f) => f.domain === 'glados.one')
    ? '；若 glados.one 无法直连，请打开 https://glados.cloud 重新登录后再试'
    : '';

  return {
    status: failures.every((f) => f.status === 'auth')
      ? 'auth'
      : failures.every((f) => f.status === 'device')
        ? 'device'
        : 'error',
    code: last?.code ?? -1,
    message: (messages.join('；') || '所有域名均签到失败') + oldDomainHint,
    retryable: !blocking && failures.some((f) => f.retryable !== false),
    days: '-',
  };
}

// ============================================================
// 用户信息
// ============================================================

async function fetchUserInfo(preferredDomain) {
  const candidates = await getCandidateDomains();
  const domains = [];

  if (preferredDomain) domains.push(preferredDomain);
  for (const { domain } of candidates) {
    if (!domains.includes(domain)) domains.push(domain);
  }

  // Cookie API 看不到 Cookie 时，用 status 接口找当前带登录态的域名
  if (candidates.length === 0) {
    for (const domain of await probeAuthenticatedDomains()) {
      if (!domains.includes(domain)) domains.push(domain);
    }
  }

  // 最多查两个域名，避免用户信息接口拖慢签到结果返回
  for (const domain of domains.slice(0, 2)) {
    try {
      const [statusResp, pointsResp] = await Promise.all([
        fetchJson(`https://${domain}${STATUS_PATH}`, { timeout: USER_INFO_TIMEOUT_MS }),
        fetchJson(`https://${domain}${POINTS_PATH}`, { timeout: USER_INFO_TIMEOUT_MS }).catch(() => null),
      ]);

      if (!statusResp.ok || Number(statusResp.data?.code) !== 0) continue;

      const info = {
        email: statusResp.data?.data?.email || '-',
        leftDays: toRoundedNumber(statusResp.data?.data?.leftDays, 1),
        // /api/user/points 的积分在顶层 points，/api/user/status 也可能带 data.points
        points: toRoundedNumber(pointsResp?.data?.points ?? statusResp.data?.data?.points, 0),
        domain,
        updateTime: new Date().toISOString(),
      };

      await chrome.storage.local.set({ userInfo: info });
      log(`用户信息已更新: ${info.email} @${domain}`);
      return info;
    } catch (e) {
      log(`获取 ${domain} 用户信息失败: ${e.message}`);
    }
  }

  return null;
}

// ============================================================
// 核心签到流程
// ============================================================

let checkinInFlight = null;

async function doCheckin(isManual = false) {
  // 防止手动签到和定时签到同时触发，重复请求接口
  if (checkinInFlight) return checkinInFlight;

  checkinInFlight = (async () => {
    const tag = isManual ? '手动' : '自动';
    const today = getTodayStr();
    log(`[${tag}] 开始签到...`);

    let result;
    try {
      result = await runCheckin();
    } catch (e) {
      result = {
        status: 'error',
        code: -1,
        message: e.message || '未知错误',
        retryable: true,
        days: '-',
      };
    }

    result.time = new Date().toISOString();
    result.isManual = isManual;
    result.message = result.message || '';
    result.days = result.days || '-';

    if (result.status === 'success' || result.status === 'already') {
      try {
        await chrome.storage.local.set({ lastAutoCheckinDate: today });
        await chrome.storage.local.remove('retryState');
        log(`[${tag}] 已标记今日 (${today}) 签到完成`);
      } catch (e) {
        log(`[${tag}] 标记今日签到状态失败: ${e.message}`);
      }
    }

    try {
      await recordResult(result);
    } catch (e) {
      log(`保存签到结果失败: ${e.message}`);
    }

    if (result.status === 'success' || result.status === 'already') {
      const userInfo = await fetchUserInfo(result.domain);
      if (userInfo) {
        result.userInfo = userInfo;
        const { raw, ...saved } = result;
        await chrome.storage.local.set({ lastCheckin: saved });
      }
    }

    try {
      await notifyResult(result, tag);
    } catch (e) {
      log(`发送通知失败: ${e.message}`);
    }

    log(`[${tag}] 签到完成: status=${result.status}, domain=${result.domain || '-'}, message=${result.message}`);
    return result;
  })();

  try {
    return await checkinInFlight;
  } finally {
    checkinInFlight = null;
  }
}

async function notifyResult(result, tag) {
  const config = await getConfig();
  if (!config.notifyEnabled) return;

  const prefix = tag === '手动' ? '🔧 手动测试 · ' : '';
  const domain = result.domain ? ` @${result.domain}` : '';
  const points = result.userInfo?.points != null ? ` | 积分: ${result.userInfo.points}` : '';

  if (result.status === 'success') {
    const days = result.days && result.days !== '-' ? `获得 ${result.days} 天` : '签到成功';
    showNotification(`${prefix}✅ GLaDOS 签到成功`, `${days}${domain}${points}`);
  } else if (result.status === 'already') {
    const left = result.userInfo?.leftDays ?? (result.days && result.days !== '-' ? result.days : null);
    const days = left !== null && left !== undefined ? `剩余 ${left} 天` : '今日已签到';
    showNotification(`${prefix}ℹ️ GLaDOS 签到`, `${days}${domain}${points}`);
  } else if (result.status === 'auth') {
    showNotification(`${prefix}🔐 GLaDOS 登录失效`, result.message);
  } else if (result.status === 'device') {
    showNotification(`${prefix}⚠️ GLaDOS 设备不一致`, result.message);
  } else {
    showNotification(`${prefix}❌ GLaDOS 签到失败`, result.message);
  }
}

// ============================================================
// 历史记录
// ============================================================

async function addHistory(record) {
  const { [HISTORY_KEY]: stored } = await chrome.storage.local.get(HISTORY_KEY);
  const history = Array.isArray(stored) ? stored : [];
  const prefix = record.isManual ? '[手动] ' : '[自动] ';
  const message = (prefix + (record.message || '')).slice(0, 500);

  history.unshift({
    time: record.time,
    status: record.status,
    message,
    days: record.days || '-',
    domain: record.domain || '',
  });

  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function recordResult(result) {
  const { raw, ...saved } = result;
  await chrome.storage.local.set({
    lastCheckin: saved,
    lastCheckinTime: saved.time,
  });
  await addHistory(saved);
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

// ============================================================
// 通知
// ============================================================

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message: message || '',
    priority: 1,
  });
}

// ============================================================
// 调度
// ============================================================

function computeNextCheckin(config) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (!config.randomTime) {
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    if (target.getTime() > now.getTime()) return target;
    // 已经过了固定时间：立即补签，而不是直接跳到明天
    return new Date(now.getTime() + 15000);
  }

  const startMin = minutesOfDay(config.randomStartHour, config.randomStartMinute);
  const endMin = minutesOfDay(config.randomEndHour, config.randomEndMinute);

  // 配置异常时退回固定时间
  if (startMin >= endMin) {
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    return target.getTime() > now.getTime()
      ? target
      : new Date(now.getTime() + 15000);
  }

  let pickedMin;

  if (nowMin < startMin) {
    pickedMin = randomInt(startMin, endMin);
  } else if (nowMin < endMin) {
    // 已经进入窗口：不要立刻签到（避免每次打开浏览器都秒签），
    // 在 [现在+2分钟, 窗口结束] 内随机
    const lower = Math.min(endMin, nowMin + 2);
    pickedMin = randomInt(lower, endMin);
  } else {
    // 已过窗口：立即补签，避免当天漏签
    return new Date(now.getTime() + 15000);
  }

  const target = new Date(now);
  target.setSeconds(0, 0);
  target.setHours(Math.floor(pickedMin / 60), pickedMin % 60, 0, 0);

  if (target.getTime() <= now.getTime()) {
    return new Date(now.getTime() + 15000);
  }
  return target;
}

function getTomorrowCheckinTime(config) {
  const now = new Date();
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setSeconds(0, 0);

  if (config.randomTime) {
    const startMin = minutesOfDay(config.randomStartHour, config.randomStartMinute);
    const endMin = minutesOfDay(config.randomEndHour, config.randomEndMinute);
    if (startMin < endMin) {
      const pickedMin = randomInt(startMin, endMin);
      target.setHours(Math.floor(pickedMin / 60), pickedMin % 60, 0, 0);
      return target;
    }
  }

  target.setHours(config.checkinHour, config.checkinMinute, 0, 0);
  return target;
}

async function createAlarm(date) {
  const when = Math.max(date.getTime(), Date.now() + 1000);
  await chrome.alarms.create(ALARM_NAME, { when });
  await chrome.storage.local.set({ nextCheckinTime: new Date(when).toISOString() });
  log(`下次签到: ${new Date(when).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
}

async function scheduleAlarm() {
  const config = await getConfig();
  const today = getTodayStr();
  const { lastAutoCheckinDate, retryState } = await chrome.storage.local.get([
    'lastAutoCheckinDate',
    'retryState',
  ]);

  // 清理旧版本的独立重试闹钟
  await chrome.alarms.clear(LEGACY_RETRY_ALARM);

  if (!config.autoCheckin) {
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.storage.local.set({ nextCheckinTime: null });
    log('自动签到已关闭');
    return;
  }

  if (lastAutoCheckinDate === today) {
    await chrome.storage.local.remove('retryState');
    await createAlarm(getTomorrowCheckinTime(config));
    return;
  }

  const now = Date.now();
  if (retryState && retryState.date === today) {
    if (retryState.exhausted) {
      await createAlarm(getTomorrowCheckinTime(config));
      return;
    }
    if (retryState.nextAt && retryState.nextAt > now) {
      await createAlarm(new Date(retryState.nextAt));
      return;
    }
  }

  await createAlarm(computeNextCheckin(config));
}

async function scheduleRetry(result) {
  const today = getTodayStr();
  const { retryState } = await chrome.storage.local.get('retryState');
  const state = retryState && retryState.date === today
    ? retryState
    : { date: today, attempts: 0 };

  if (state.attempts >= MAX_RETRY_ATTEMPTS) {
    await chrome.storage.local.set({
      retryState: {
        date: today,
        attempts: state.attempts,
        exhausted: true,
        nextAt: null,
        lastMessage: result.message,
      },
    });
    await scheduleAlarm();
    log(`今日重试次数已用完 (${MAX_RETRY_ATTEMPTS} 次)`);
    return;
  }

  const delay = RETRY_DELAYS_MIN[Math.min(state.attempts, RETRY_DELAYS_MIN.length - 1)];
  await chrome.storage.local.set({
    retryState: {
      date: today,
      attempts: state.attempts + 1,
      exhausted: false,
      nextAt: Date.now() + delay * 60000,
      lastMessage: result.message,
    },
  });

  log(`签到失败，${delay} 分钟后重试（第 ${state.attempts + 1}/${MAX_RETRY_ATTEMPTS} 次）`);
  await scheduleAlarm();
}

async function handleAutoResult(result) {
  if (result.status === 'success' || result.status === 'already') {
    await scheduleAlarm();
    return;
  }

  if (result.retryable === false) {
    // Cookie 失效 / 设备不一致 / 风控：重试没有意义，今天不再自动尝试
    await chrome.storage.local.set({
      retryState: {
        date: getTodayStr(),
        attempts: 0,
        exhausted: true,
        nextAt: null,
        lastMessage: result.message,
      },
    });
    await scheduleAlarm();
    return;
  }

  await scheduleRetry(result);
}

// ============================================================
// 网络诊断
// ============================================================

async function diagnose() {
  const permissions = await Promise.all(DOMAINS.map((domain) => hasHostPermission(domain)));

  const results = await Promise.all(DOMAINS.map(async (domain, index) => {
    const cookies = await getDomainCookies(domain);
    const started = Date.now();
    let reachable = false;
    let code = null;
    let leftDays = null;
    let message = '';

    try {
      const resp = await fetchJson(`https://${domain}${STATUS_PATH}`, {
        timeout: DIAGNOSE_TIMEOUT_MS,
      });
      reachable = true;
      code = resp.data?.code ?? resp.status;
      leftDays = toRoundedNumber(resp.data?.data?.leftDays, 1);
      message = resp.data?.message || `HTTP ${resp.status}`;
    } catch (e) {
      message = e.message;
    }

    return {
      domain,
      permission: permissions[index],
      // code=0 说明这次请求实际带着登录态；Cookie API 可能看不到 Partitioned Cookie
      session: Number(code) === 0,
      cookieCount: cookies.length,
      hasAuthCookie: hasAuthCookie(cookies),
      reachable,
      code,
      leftDays,
      message,
      ms: Date.now() - started,
    };
  }));

  const relatedCookies = await listRelatedCookies();

  return {
    ok: results.some((r) => Number(r.code) === 0),
    loggedIn: results.some((r) => Number(r.code) === 0),
    domains: results,
    relatedCookies,
    relatedDomains: [...new Set(relatedCookies.map((c) => c.domain.replace(/^\./, '')))],
    timestamp: new Date().toISOString(),
  };
}

// ============================================================
// 事件监听
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    log('插件已安装/更新');
    await setupDeclarativeNetRequest(true);
    await chrome.alarms.clear(LEGACY_RETRY_ALARM);

    const { config } = await chrome.storage.local.get('config');
    if (!config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG });
    }

    await scheduleAlarm();
  })().catch((e) => log(`安装初始化失败: ${e.message}`));
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    log('浏览器启动，检查签到状态...');
    await setupDeclarativeNetRequest(true);
    await scheduleAlarm();
  })().catch((e) => log(`启动初始化失败: ${e.message}`));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  Promise.resolve(chrome.tabs.create({ url: `https://${DOMAINS[0]}/console/checkin` }))
    .catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  (async () => {
    log('签到闹钟触发');

    const config = await getConfig();
    if (!config.autoCheckin) {
      log('自动签到已关闭，跳过');
      return;
    }

    const today = getTodayStr();
    const { lastAutoCheckinDate } = await chrome.storage.local.get('lastAutoCheckinDate');

    if (lastAutoCheckinDate === today) {
      log('今日已签到，跳过');
      await scheduleAlarm();
      return;
    }

    const result = await doCheckin(false);
    await handleAutoResult(result);
  })().catch((e) => log(`闹钟处理异常: ${e.message}`));
});

// ============================================================
// 消息处理 (popup / options 通信)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.action) {
      case 'checkin': {
        const result = await doCheckin(true);
        if (result.status === 'success' || result.status === 'already') {
          await scheduleAlarm();
        }
        return result;
      }

      case 'getStatus': {
        const state = await chrome.storage.local.get([
          'lastCheckin',
          'nextCheckinTime',
          'userInfo',
          'config',
          'lastAutoCheckinDate',
          'retryState',
        ]);
        // 旧版本可能存了非法时间/布尔值，弹出层统一拿规范化后的配置
        state.config = sanitizeConfig(state.config);
        return state;
      }

      case 'getHistory': {
        const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
        return Array.isArray(history) ? history : [];
      }

      case 'clearHistory':
        await clearHistory();
        return { ok: true };

      case 'getConfig':
        return await getConfig();

      case 'saveConfig': {
        const newConfig = await setConfig(message.config);
        await scheduleAlarm();
        return newConfig;
      }

      case 'fetchUserInfo': {
        const { lastCheckin } = await chrome.storage.local.get('lastCheckin');
        return await fetchUserInfo(lastCheckin?.domain);
      }

      case 'diagnose':
        return await diagnose();

      case 'reschedule':
        await scheduleAlarm();
        return { ok: true };

      default:
        return { error: 'unknown action' };
    }
  };

  handler()
    .then(sendResponse)
    .catch((e) => sendResponse({ status: 'error', message: e.message }));

  return true;
});
