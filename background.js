// ============================================================
// GLaDOS Auto Check-in v2.1 — Background Service Worker
// ============================================================

const ALARM_NAME = 'glados-auto-checkin';
const GLADOS_URL = 'https://glados.one/console/checkin';

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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---- 通过 Content Script 请求 API ----

async function ensureGladosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://glados.one/*' });
  if (tabs.length > 0) {
    return tabs.find(t => t.active) || tabs[0];
  }
  // 没有打开的标签页，自动创建一个后台标签
  log('未找到 GLaDOS 页面，自动打开后台标签...');
  const tab = await chrome.tabs.create({ url: GLADOS_URL, active: false });
  // 等待页面加载完成
  await new Promise(resolve => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // 超时 15 秒
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
  return tab;
}

async function sendToContentScript(action) {
  const tab = await ensureGladosTab();
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action });
    return response;
  } catch (e) {
    throw new Error('无法连接到 GLaDOS 页面，请刷新页面后重试');
  }
}

// ---- 核心签到逻辑 ----

async function doCheckin() {
  try {
    log('开始签到...');

    const data = await sendToContentScript('doCheckin');
    log(`签到响应: ${JSON.stringify(data)}`);

    const isAlready = data.code === 1 && (data.message || '').includes('Checkin Repeats');
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

    const result = {
      time: new Date().toISOString(),
      status,
      code: data.code,
      message: data.message || '',
      days,
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
      if (status === 'success') {
        showNotification(
          '✅ GLaDOS 签到成功',
          `获得 ${days} 天时长！${userInfo ? `当前积分: ${userInfo.points}` : ''}`
        );
      } else if (status === 'already') {
        showNotification(
          'ℹ️ GLaDOS 签到',
          `今日已签到，剩余 ${days} 天${userInfo ? ` | 积分: ${userInfo.points}` : ''}`
        );
      } else {
        showNotification('⚠️ GLaDOS 签到', `返回信息: ${data.message}`);
      }
    }

    log(`签到完成: status=${status}, days=${days}`);
    return result;

  } catch (error) {
    log(`签到失败: ${error.message}`);

    const failResult = {
      time: new Date().toISOString(),
      status: 'error',
      message: error.message
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

// ---- 获取用户信息 ----

async function fetchUserInfo() {
  try {
    const data = await sendToContentScript('fetchUserInfo');
    if (!data || data.code !== 0) return null;

    const info = {
      email: data.data?.email || '-',
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

// ---- 历史记录 ----

const HISTORY_KEY = 'checkinHistory';
const MAX_HISTORY = 100;

async function addHistory(record) {
  const { [HISTORY_KEY]: history = [] } = await chrome.storage.local.get(HISTORY_KEY);
  history.unshift({
    time: record.time,
    status: record.status,
    message: record.message || '',
    days: record.days || '-'
  });
  if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

// ---- 通知 ----

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 1
  });
}

// ---- 定时器管理 ----

function getTodayRandomTime(config) {
  const startMin = config.randomStartHour * 60 + config.randomStartMinute;
  const endMin = config.randomEndHour * 60 + config.randomEndMinute;

  if (startMin >= endMin) {
    const t = new Date();
    t.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    return t;
  }

  const picked = randomInt(startMin, endMin);
  const t = new Date();
  t.setHours(Math.floor(picked / 60), picked % 60, 0, 0);
  return t;
}

async function scheduleAlarm() {
  const config = await getConfig();

  if (!config.autoCheckin) {
    await chrome.alarms.clear(ALARM_NAME);
    log('自动签到已关闭');
    return;
  }

  const now = new Date();
  let next;

  if (config.randomTime) {
    next = getTodayRandomTime(config);
    if (now >= next) {
      next.setDate(next.getDate() + 1);
      next = getTodayRandomTime(config);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      if (next < tomorrow) {
        next.setDate(next.getDate() + 1);
      }
    }
    log(`随机时间段 ${config.randomStartHour}:${String(config.randomStartMinute).padStart(2,'0')} - ${config.randomEndHour}:${String(config.randomEndMinute).padStart(2,'0')}`);
  } else {
    next = new Date();
    next.setHours(config.checkinHour, config.checkinMinute, 0, 0);
    if (now >= next) {
      next.setDate(next.getDate() + 1);
    }
  }

  await chrome.alarms.create(ALARM_NAME, {
    when: next.getTime(),
    periodInMinutes: 24 * 60
  });

  log(`下次签到: ${next.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  await chrome.storage.local.set({ nextCheckinTime: next.toISOString() });
}

// ---- 事件监听 ----

chrome.runtime.onInstalled.addListener(async () => {
  log('插件已安装/更新');
  const { config } = await chrome.storage.local.get('config');
  if (!config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }
  await scheduleAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  log('浏览器启动');
  await scheduleAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    log('闹钟触发，执行签到');
    await doCheckin();
  }
});

// ---- 消息处理 ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.action) {
      case 'checkin':
        return await doCheckin();

      case 'getStatus':
        return await chrome.storage.local.get(['lastCheckin', 'nextCheckinTime', 'userInfo', 'config']);

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
