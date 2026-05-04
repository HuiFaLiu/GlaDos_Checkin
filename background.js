// ============================================================
// GLaDOS Auto Check-in v3.0 — Background Service Worker
// 双保险方案: declarativeNetRequest + chrome.cookies API
// 智能随机签到: 开机补签 + 防重复
// ============================================================

const ALARM_NAME = 'glados-auto-checkin';
const ALARM_RETRY = 'glados-retry-checkin';
const GLADOS_ORIGIN = 'https://glados.one';
const CHECKIN_URL = 'https://glados.one/api/user/checkin';
const STATUS_URL = 'https://glados.one/api/user/status';

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

function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() *((max - min) + 1)) + min;
}

function minutesOfDay(h, m) {
  return h * 60 + m;
}

async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...config };
}

async function setConfig(newConfig) {
  const current = await getConfig();
  const merged = { ...current, ...newConfig };
  await chrome.storage.local.set({ config: merged });
  return merged;
}

// ============================================================
// declarativeNetRequest 规则: 伪造 Origin / Referer
// ============================================================

const DNR_RULE_ID = 1;

async function setupDeclarativeNetRequest() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [{
        id: DNR_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Origin', operation: 'set', value: GLADOS_ORIGIN },
            { header: 'Referer', operation: 'set', value: `${GLADOS_ORIGIN}/console/checkin` }
          ]
        },
        condition: {
          urlFilter: 'glados.one/api/user/checkin',
          resourceTypes: ['xmlhttprequest']
        }
      }]
    });
    log('declarativeNetRequest 规则已设置');
  } catch (e) {
    log(`declarativeNetRequest 设置失败: ${e.message}`);
  }
}

// ============================================================
// Cookie 读取 (双保险方案)
// ============================================================

async function getGladosCookies() {
  const cookies = await chrome.cookies.getAll({ domain: 'glados.one' });
  if (!cookies || cookies.length === 0) {
    throw new Error('未找到 GLaDOS 登录 Cookie，请先在浏览器中登录 glados.one');
  }
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

// ============================================================
// 双保险 fetch: credentials + Cookie header 同时使用
// ============================================================

async function gladosFetch(url, options = {}) {
  // 方案A: credentials: 'include' (利用 host_permissions 自动携带 cookie)
  // 方案B: 手动读取 cookie 设置 Cookie header
  // 双保险: 两种方式都带上
  let cookieHeader;
  try {
    cookieHeader = await getGladosCookies();
  } catch (e) {
    log(`Cookie 读取失败, 仅依赖 credentials: ${e.message}`);
  }

  const headers = {
    'Content-Type': 'application/json',
    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
    ...(options.headers || {})
  };

  const resp = await fetch(url, {
    ...options,
    headers,
    credentials: 'include'
  });
  return resp.json();
}

// ============================================================
// 核心签到逻辑
// ============================================================

async function doCheckin(isManual = false) {
  const today = getTodayStr();
  const tag = isManual ? '手动' : '自动';

  try {
    log(`[${tag}] 开始签到...`);

    const data = await gladosFetch(CHECKIN_URL, {
      method: 'POST',
      body: JSON.stringify({ token: 'glados.one' })
    });
    log(`[${tag}] 签到响应: ${JSON.stringify(data)}`);

    const msg = (data.message || '').toLowerCase();
    const isAlready = data.code === 1 && msg.includes('checkin repeats');
    const isSuccess = data.code === 0;

    let status, days;
    if (isAlready) {
      status = 'already';
      days = data.data?.days || '-';
    } else if (isSuccess) {
      status = 'success';
      days = data.data?.days || '-';
    } else {
      status = 'unknown';
      days = data.data?.days || '-';
    }

    // 自动签到成功/已签 → 记录今日日期，防止重复
    if (!isManual && (isSuccess || isAlready)) {
      await chrome.storage.local.set({ lastAutoCheckinDate: today });
      log(`[${tag}] 已标记今日 (${today}) 签到完成`);
    }

    const result = {
      time: new Date().toISOString(),
      status,
      code: data.code,
      message: data.message || '',
      days,
      isManual,
      raw: data
    };

    await chrome.storage.local.set({
      lastCheckin: result,
      lastCheckinTime: result.time
    });

    await addHistory(result);

    // 获取用户信息
    const userInfo = await fetchUserInfo();
    if (userInfo) {
      result.userInfo = userInfo;
      await chrome.storage.local.set({ lastCheckin: result });
    }

    // 发送通知
    const config = await getConfig();
    if (config.notifyEnabled) {
      const prefix = isManual ? '🔧 手动测试' : '';
      if (status === 'success') {
        showNotification(
          `${prefix} ✅ GLaDOS 签到成功`,
          `获得 ${days} 天时长！${userInfo ? `积分: ${userInfo.points}` : ''}`
        );
      } else if (status === 'already') {
        showNotification(
          `${prefix} ℹ️ GLaDOS 签到`,
          `今日已签到，剩余 ${days} 天${userInfo ? ` | 积分: ${userInfo.points}` : ''}`
        );
      } else {
        showNotification(`${prefix} ⚠️ GLaDOS 签到`, `返回信息: ${data.message}`);
      }
    }

    log(`[${tag}] 签到完成: status=${status}, days=${days}`);
    return result;

  } catch (error) {
    log(`[${tag}] 签到失败: ${error.message}`);

    const failResult = {
      time: new Date().toISOString(),
      status: 'error',
      message: error.message,
      isManual
    };

    await chrome.storage.local.set({ lastCheckin: failResult });
    await addHistory(failResult);

    const config = await getConfig();
    if (config.notifyEnabled) {
      showNotification('❌ GLaDOS 签到失败', error.message);
    }

    return failResult;
  }
}

// ============================================================
// 获取用户信息
// ============================================================

async function fetchUserInfo() {
  try {
    const data = await gladosFetch(STATUS_URL);
    if (!data || data.code !== 0) return null;

    const info = {
      email: data.data?.email || '-',
      points: data.data?.points ?? '-',
      updateTime: new Date().toISOString()
    };

    await chrome.storage.local.set({ userInfo: info });
    log(`用户信息已更新: ${info.email}`);
    return info;

  } catch (e) {
    log(`获取用户信息失败: ${e.message}`);
    return null;
  }
}

// ============================================================
// 智能随机签到调度
// ============================================================

/**
 * 计算今天的签到时间。
 *
 * 逻辑:
 *  1. 随机模式下，在 [start, end] 窗口内随机选一个时间点
 *  2. 如果现在还没到那个时间 → 返回那个时间
 *  3. 如果已经过了那个时间但在窗口内 → 在 [now, end] 之间再随机一次 (开机补签)
 *  4. 如果已经过了整个窗口 → 明天的随机时间
 */
function computeCheckinTime(config) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (!config.randomTime) {
    // 固定时间模式
    const targetMin = minutesOfDay(config.checkinHour, config.checkinMinute);
    const t = new Date();
    t.setSeconds(0, 0);
    if (nowMin < targetMin) {
      t.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    } else {
      // 明天
      t.setDate(t.getDate() + 1);
      t.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    }
    return t;
  }

  // 随机时间模式
  const startMin = minutesOfDay(config.randomStartHour, config.randomStartMinute);
  const endMin = minutesOfDay(config.randomEndHour, config.randomEndMinute);

  if (startMin >= endMin) {
    // 配置错误，退回固定时间
    const t = new Date();
    t.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    if (nowMin >= minutesOfDay(config.checkinHour, config.checkinMinute)) {
      t.setDate(t.getDate() + 1);
    }
    return t;
  }

  let pickedMin;

  if (nowMin < startMin) {
    // 还没到窗口 → 在整个窗口内随机
    pickedMin = randomInt(startMin, endMin);
    log(`还没到窗口，在 [${startMin}, ${endMin}] 随机 → ${pickedMin}`);
  } else if (nowMin <= endMin) {
    // 在窗口内 (可能错过了之前的随机时间) → 在 [now, end] 内随机
    pickedMin = randomInt(nowMin, endMin);
    log(`在窗口内，在 [${nowMin}, ${endMin}] 随机补签 → ${pickedMin}`);
  } else {
    // 过了窗口但今天还没签 → 尽快补签 (1-5分钟后)
    const retryMin = randomInt(1, 5);
    const t = new Date(now.getTime() + retryMin * 60 * 1000);
    log(`过了窗口但今日未签，${retryMin}分钟后补签`);
    return t;
  }

  const t = new Date();
  t.setHours(Math.floor(pickedMin / 60), pickedMin % 60, 0, 0);
  return t;
}

async function scheduleAlarm() {
  const config = await getConfig();
  const today = getTodayStr();
  const { lastAutoCheckinDate } = await chrome.storage.local.get('lastAutoCheckinDate');

  // 清除旧的重试闹钟
  await chrome.alarms.clear(ALARM_RETRY);

  if (!config.autoCheckin) {
    await chrome.alarms.clear(ALARM_NAME);
    log('自动签到已关闭');
    return;
  }

  // 今天已经自动签过了 → 安排到明天
  if (lastAutoCheckinDate === today) {
    log(`今日 (${today}) 已签到，安排到明天`);
    // 设置明天凌晨 0:05 的闹钟来重新计算
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 5, 0, 0);
    await chrome.alarms.create(ALARM_NAME, { when: tomorrow.getTime() });
    log(`下次签到调度: ${tomorrow.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    await chrome.storage.local.set({ nextCheckinTime: tomorrow.toISOString() });
    return;
  }

  // 计算今天的签到时间
  const next = computeCheckinTime(config);
  const now = new Date();

  if (next <= now) {
    // 极端情况: 计算出的时间已过 → 立即签
    log('计算出的时间已过，立即签到');
    await doCheckin(false);
    // 签完后安排明天
    await scheduleAlarm();
    return;
  }

  await chrome.alarms.create(ALARM_NAME, { when: next.getTime() });

  const timeStr = next.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  log(`下次签到: ${timeStr}`);
  await chrome.storage.local.set({ nextCheckinTime: next.toISOString() });
}

// ============================================================
// 历史记录
// ============================================================

const HISTORY_KEY = 'checkinHistory';
const MAX_HISTORY = 100;

async function addHistory(record) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  const prefix = record.isManual ? '[手动] ' : '[自动] ';
  history.unshift({
    time: record.time,
    status: record.status,
    message: prefix + (record.message || ''),
    days: record.days || '-'
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
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
    message,
    priority: 1
  });
}

// ============================================================
// 事件监听
// ============================================================

chrome.runtime.onInstalled.addListener(async () => {
  log('插件已安装/更新');
  await setupDeclarativeNetRequest();
  const { config } = await chrome.storage.local.get('config');
  if (!config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  await scheduleAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  log('浏览器启动，检查签到状态...');
  await setupDeclarativeNetRequest();
  // 浏览器启动时重新计算调度 (可能需要补签)
  await scheduleAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    log('签到闹钟触发');
    const today = getTodayStr();
    const { lastAutoCheckinDate } = await chrome.storage.local.get('lastAutoCheckinDate');

    if (lastAutoCheckinDate === today) {
      log('今日已签到，跳过');
      await scheduleAlarm(); // 安排明天
      return;
    }

    await doCheckin(false);
    await scheduleAlarm(); // 安排明天
  }

  if (alarm.name === ALARM_RETRY) {
    log('重试闹钟触发');
    await doCheckin(false);
    await scheduleAlarm();
  }
});

// ============================================================
// 消息处理 (popup / options 通信)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.action) {
      case 'checkin':
        return await doCheckin(true);

      case 'getStatus':
        return await chrome.storage.local.get([
          'lastCheckin', 'nextCheckinTime', 'userInfo', 'config', 'lastAutoCheckinDate'
        ]);

      case 'getHistory': {
        const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
        return history;
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

      case 'fetchUserInfo':
        return await fetchUserInfo();

      case 'reschedule':
        await scheduleAlarm();
        return { ok: true };

      default:
        return { error: 'unknown action' };
    }
  };

  handler().then(sendResponse);
  return true;
});
