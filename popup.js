// ============================================================
// GLaDOS Auto Check-in v3.2.3 — Popup Logic
// ============================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// DOM 元素
const el = {
  // Header
  btnSettings:   $('#btnSettings'),
  btnRefresh:    $('#btnRefresh'),
  // User Card
  userCard:      $('#userCard'),
  userEmail:     $('#userEmail'),
  userDomain:    $('#userDomain'),
  // Status
  statusCard:    $('#statusCard'),
  pulse:         $('#pulse'),
  statusText:    $('#statusText'),
  statusDetails: $('#statusDetails'),
  // Button
  btnCheckin:    $('#btnCheckin'),
  btnLoading:    $('#btnLoading'),
  // Info
  lastTime:      $('#lastTime'),
  nextTime:      $('#nextTime'),
  nextLabel:     $('#nextLabel'),
  remainDays:    $('#remainDays'),
  points:        $('#points'),
  // History
  logList:       $('#logList'),
  logPagination: $('#logPagination'),
  btnClear:      $('#btnClear'),
  btnExport:     $('#btnExport'),
  btnPrevPage:   $('#btnPrevPage'),
  btnNextPage:   $('#btnNextPage'),
  pageInfo:      $('#pageInfo'),
  // Settings
  cfgAutoCheckin:      $('#cfgAutoCheckin'),
  cfgHour:             $('#cfgHour'),
  cfgMinute:           $('#cfgMinute'),
  cfgRandomTime:       $('#cfgRandomTime'),
  fixedTimeRow:        $('#fixedTimeRow'),
  randomTimeRow:       $('#randomTimeRow'),
  cfgRandomStartHour:  $('#cfgRandomStartHour'),
  cfgRandomStartMinute:$('#cfgRandomStartMinute'),
  cfgRandomEndHour:    $('#cfgRandomEndHour'),
  cfgRandomEndMinute:  $('#cfgRandomEndMinute'),
  cfgNotify:           $('#cfgNotify'),
  btnSave:             $('#btnSave'),
  btnDiagnose:         $('#btnDiagnose'),
};

// ---- 常量 ----
const LOGS_PER_PAGE = 8;
const STATUS_LABELS = {
  success: '成功',
  already: '已签到',
  error: '失败',
  auth: '登录失效',
  device: '设备不一致',
  unknown: '未知',
};
const STATUS_ICONS = {
  success: '✅',
  already: '🔁',
  error: '❌',
  auth: '🔐',
  device: '📱',
  info: 'ℹ️',
  unknown: '⚠️',
};
const SAFE_STATUSES = new Set(['success', 'already', 'error', 'auth', 'device', 'info', 'unknown']);

// ---- 状态 ----
let allHistory = [];
let currentPage = 0;
let toastTimer = null;
let countdownTimer = null;
let lastNextCheckinTime = null;

// ---- 工具函数 ----

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function dateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function todayKey() {
  return dateKey(new Date());
}

function csvCell(value) {
  let text = String(value ?? '');
  // 防止 Excel 把 = + - @ 开头的内容当成公式执行
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// GLaDOS 接口会返回 461.0000000000000000 这类浮点字符串
function formatDays(value) {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'number'
    ? value
    : Number.parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(value);

  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatPoints(value) {
  if (value === null || value === undefined || value === '') return '--';
  const n = typeof value === 'number'
    ? value
    : Number.parseFloat(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(value);
  return String(Math.round(n));
}

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  });
}

function formatTimeFull(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Shanghai'
  });
}

function formatNextTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--';
  const now = new Date();
  const diff = d - now;

  if (diff <= 0) return '即将签到';

  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);

  const timeStr = d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai'
  });

  if (hours > 0) {
    return `${timeStr} (${hours}h${mins}m)`;
  }
  return `${timeStr} (${mins}m)`;
}

function showToast(msg, duration = 2000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---- 状态更新 ----

function setStatus(type, title, detail) {
  const card = el.statusCard;
  const pulse = el.pulse;

  card.classList.remove('success', 'error', 'already');
  pulse.classList.remove('checking', 'success', 'error', 'already');

  if (type) {
    card.classList.add(type);
    pulse.classList.add(type);
  }

  el.statusText.textContent = title;
  el.statusDetails.textContent = detail || '';
}

// ---- 用户信息 ----

function renderUserInfo(info) {
  if (!info) {
    el.userEmail.textContent = '未登录';
    el.userEmail.title = '';
    el.userDomain.textContent = '';
    el.points.textContent = '--';
    return;
  }

  el.userEmail.textContent = info.email || '-';
  el.userEmail.title = info.email || '';
  el.userDomain.textContent = info.domain ? `@${info.domain}` : '';
  el.points.textContent = formatPoints(info.points);
}

async function refreshUserInfo() {
  el.btnRefresh.style.opacity = '0.4';
  el.btnRefresh.disabled = true;
  try {
    const info = await chrome.runtime.sendMessage({ action: 'fetchUserInfo' });
    if (!info || !info.email) {
      showToast('❌ 未登录或 Cookie 已失效');
      return;
    }
    renderUserInfo(info);
    await loadStatus();
    showToast('✅ 用户信息已刷新');
  } catch (e) {
    showToast('❌ 刷新失败');
  } finally {
    el.btnRefresh.style.opacity = '1';
    el.btnRefresh.disabled = false;
  }
}

// ---- Tab 切换 ----

function initTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      $(`#panel${capitalize(tab.dataset.tab)}`).classList.add('active');
    });
  });
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- 历史记录 ----

async function loadHistory() {
  try {
    const history = await chrome.runtime.sendMessage({ action: 'getHistory' });
    allHistory = Array.isArray(history) ? history : [];
  } catch {
    allHistory = [];
  }
  currentPage = 0;
  renderHistoryPage();
}

function renderHistoryPage() {
  const totalPages = Math.max(1, Math.ceil(allHistory.length / LOGS_PER_PAGE));
  if (currentPage >= totalPages) currentPage = totalPages - 1;
  if (currentPage < 0) currentPage = 0;

  const start = currentPage * LOGS_PER_PAGE;
  const pageItems = allHistory.slice(start, start + LOGS_PER_PAGE);

  if (allHistory.length === 0) {
    el.logList.innerHTML = '<div class="log-empty">暂无签到记录</div>';
    el.logPagination.style.display = 'none';
    return;
  }

  el.logPagination.style.display = totalPages > 1 ? 'flex' : 'none';
  el.pageInfo.textContent = `${currentPage + 1}/${totalPages}`;
  el.btnPrevPage.disabled = currentPage <= 0;
  el.btnNextPage.disabled = currentPage >= totalPages - 1;

  el.logList.innerHTML = pageItems.map(rawItem => {
    const item = rawItem || {};
    const time = formatTime(item.time);
    const status = SAFE_STATUSES.has(item.status) ? item.status : 'unknown';
    const statusIcon = STATUS_ICONS[status] || '❓';
    const statusLabel = STATUS_LABELS[status] || '未知';
    const rawMessage = item.message || statusLabel;
    const daysValue = formatDays(item.days);
    const daysStr = daysValue !== '-' ? `${daysValue}天` : '';
    const domainTitle = item.domain ? `签到域名: ${item.domain}` : '';

    return `
      <div class="log-item" title="${escapeHtml(domainTitle)}">
        <span class="log-dot ${status}"></span>
        <span class="log-time">${escapeHtml(time)}</span>
        <span class="log-msg">${statusIcon} ${escapeHtml(rawMessage)}</span>
        ${daysStr ? `<span class="log-days">${escapeHtml(daysStr)}</span>` : ''}
      </div>
    `;
  }).join('');
}

async function clearHistory() {
  if (!confirm('确定清空所有签到记录？')) return;
  try {
    await chrome.runtime.sendMessage({ action: 'clearHistory' });
    allHistory = [];
    renderHistoryPage();
    showToast('🗑️ 记录已清空');
  } catch (e) {
    showToast('❌ 清空失败');
  }
}

function exportHistory() {
  if (allHistory.length === 0) {
    showToast('📋 没有可导出的记录');
    return;
  }

  const header = ['时间', '状态', '消息', '获得天数', '域名'].map(csvCell).join(',');
  const lines = [header];

  allHistory.forEach(item => {
    const status = SAFE_STATUSES.has(item.status) ? item.status : 'unknown';
    lines.push([
      formatTimeFull(item.time),
      STATUS_LABELS[status] || '未知',
      item.message || '',
      formatDays(item.days),
      item.domain || '',
    ].map(csvCell).join(','));
  });

  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `glados-checkin-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast('📋 已导出 CSV');
}

// ---- 网络诊断 ----

async function runDiagnose() {
  el.btnDiagnose.disabled = true;
  showToast('🩺 正在检测四个域名...');
  try {
    const diag = await chrome.runtime.sendMessage({ action: 'diagnose' });
    if (!diag || !Array.isArray(diag.domains)) throw new Error('诊断返回异常');

    const lines = diag.domains.map((d) => {
      const cookie = d.cookieCount > 0
        ? `Cookie ${d.cookieCount}${d.hasAuthCookie ? '(含登录态)' : ''}`
        : (d.session ? 'Cookie API 不可见，但登录态有效' : '无 Cookie');
      const net = d.reachable
        ? `可访问(code=${d.code})`
        : `不可访问(${d.message})`;
      const permission = d.permission === false ? ', 无站点权限' : '';
      return `${d.domain}: ${net}, ${cookie}${permission}, ${d.ms}ms`;
    });

    const checkedDomains = new Set(diag.domains.map((d) => d.domain));
    const otherDomains = (diag.relatedDomains || []).filter((d) => !checkedDomains.has(d));
    const extra = otherDomains.length > 0 ? `；其他相关域名 Cookie：${otherDomains.join('、')}` : '';

    console.log('[GLaDOS 诊断]', diag);
    setStatus(
      diag.loggedIn ? 'success' : 'error',
      diag.loggedIn ? '诊断：登录态正常' : '诊断：未登录或域名不可达',
      lines.join('；') + extra
    );
    showToast('🩺 诊断完成，详情见控制台');
  } catch (e) {
    setStatus('error', '诊断失败', e.message);
    showToast('❌ 诊断失败');
  } finally {
    el.btnDiagnose.disabled = false;
  }
}

// ---- 设置 ----

function initTimeOptions() {
  const hourSelects = [el.cfgHour, el.cfgRandomStartHour, el.cfgRandomEndHour];
  const minuteSelects = [el.cfgMinute, el.cfgRandomStartMinute, el.cfgRandomEndMinute];

  hourSelects.forEach(sel => {
    for (let h = 0; h < 24; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = String(h).padStart(2, '0');
      sel.appendChild(opt);
    }
  });

  minuteSelects.forEach(sel => {
    for (let m = 0; m < 60; m += 5) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = String(m).padStart(2, '0');
      sel.appendChild(opt);
    }
  });
}

async function loadSettings() {
  try {
    const config = await chrome.runtime.sendMessage({ action: 'getConfig' });
    if (!config || config.status === 'error') throw new Error(config?.message || '读取配置失败');
    el.cfgAutoCheckin.checked = config.autoCheckin !== false;
    el.cfgHour.value = config.checkinHour ?? 8;
    el.cfgMinute.value = config.checkinMinute ?? 0;
    el.cfgRandomTime.checked = config.randomTime !== false;
    el.cfgRandomStartHour.value = config.randomStartHour ?? 8;
    el.cfgRandomStartMinute.value = config.randomStartMinute ?? 0;
    el.cfgRandomEndHour.value = config.randomEndHour ?? 22;
    el.cfgRandomEndMinute.value = config.randomEndMinute ?? 0;
    el.cfgNotify.checked = config.notifyEnabled !== false;
    toggleRandomTime();
  } catch (e) {
    console.error('加载设置失败:', e);
  }
}

function toggleRandomTime() {
  const on = el.cfgRandomTime.checked;
  el.randomTimeRow.style.display = on ? 'flex' : 'none';
  el.fixedTimeRow.style.display = on ? 'none' : 'flex';
}

async function saveSettings() {
  const readNumber = (select, fallback) => {
    const value = Number.parseInt(select.value, 10);
    return Number.isFinite(value) ? value : fallback;
  };

  const config = {
    autoCheckin: el.cfgAutoCheckin.checked,
    checkinHour: readNumber(el.cfgHour, 8),
    checkinMinute: readNumber(el.cfgMinute, 0),
    randomTime: el.cfgRandomTime.checked,
    randomStartHour: readNumber(el.cfgRandomStartHour, 8),
    randomStartMinute: readNumber(el.cfgRandomStartMinute, 0),
    randomEndHour: readNumber(el.cfgRandomEndHour, 22),
    randomEndMinute: readNumber(el.cfgRandomEndMinute, 0),
    notifyEnabled: el.cfgNotify.checked,
  };

  // 验证：随机模式下，起始时间不能晚于结束时间
  if (config.randomTime) {
    const startMin = config.randomStartHour * 60 + config.randomStartMinute;
    const endMin = config.randomEndHour * 60 + config.randomEndMinute;
    if (startMin >= endMin) {
      showToast('❌ 签到窗口起始时间必须早于结束时间');
      return;
    }
  }

  try {
    const saved = await chrome.runtime.sendMessage({ action: 'saveConfig', config });
    if (!saved || saved.error || saved.status === 'error') {
      throw new Error(saved?.message || saved?.error || '保存失败');
    }
    showToast('✅ 设置已保存');
    await loadStatus();
  } catch (e) {
    showToast(`❌ 保存失败：${e.message}`);
  }
}

// ---- 加载状态 ----

function startCountdown() {
  if (countdownTimer) return;
  countdownTimer = setInterval(() => {
    if (lastNextCheckinTime) {
      el.nextTime.textContent = formatNextTime(lastNextCheckinTime);
    }
  }, 30000);
}

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    if (!response || response.status === 'error') {
      throw new Error(response?.message || '后台无响应');
    }

    const { lastCheckin, nextCheckinTime, userInfo, retryState, lastAutoCheckinDate, config } = response;
    const today = todayKey();

    const pendingRetry = Boolean(
      retryState && retryState.date === today && !retryState.exhausted && retryState.nextAt
    );
    el.nextLabel.textContent = pendingRetry ? '下次重试' : '下次自动';

    // 用户信息
    renderUserInfo(userInfo);

    // 下次签到时间
    lastNextCheckinTime = nextCheckinTime || null;
    el.nextTime.textContent = formatNextTime(nextCheckinTime);
    startCountdown();

    // 剩余时长以 /api/user/status 的 leftDays 为准，签到响应里的 days 只作兜底
    const leftDays = userInfo?.leftDays ?? lastCheckin?.days;
    const leftDaysText = formatDays(leftDays);
    el.remainDays.textContent = leftDaysText !== '-' ? `${leftDaysText} 天` : '--';

    if (!lastCheckin) {
      if (lastAutoCheckinDate === today) {
        setStatus('already', '今日已签到', '今日签到记录已保存');
      } else {
        setStatus(null, '等待首次签到...', '点击下方按钮或等待定时触发');
      }
      el.lastTime.textContent = '--';
      return;
    }

    // 上次签到时间
    el.lastTime.textContent = formatTime(lastCheckin.time);

    const lastIsToday = dateKey(lastCheckin.time) === today;
    const checkedToday = lastAutoCheckinDate === today
      || (lastIsToday && (lastCheckin.status === 'success' || lastCheckin.status === 'already'));

    let retryText = '';
    if (retryState && retryState.date === today) {
      if (retryState.exhausted) {
        retryText = ' · 今日已停止自动重试';
      } else if (retryState.nextAt) {
        retryText = ` · 第 ${retryState.attempts} 次重试已安排`;
      }
    }

    // 今天已经完成过签到：优先显示“今日已签到”，避免把昨天的成功记录当成今天
    if (checkedToday) {
      let type = 'already';
      let detail;

      if (lastCheckin.status === 'success') {
        type = 'success';
        detail = `获得 ${formatDays(lastCheckin.days) !== '-' ? formatDays(lastCheckin.days) : '?'} 天${lastCheckin.domain ? ` · ${lastCheckin.domain}` : ''}`;
      } else if (lastCheckin.status === 'already') {
        detail = lastCheckin.message || '无需重复操作';
      } else {
        detail = `今日已完成签到；最近一次操作：${lastCheckin.message || '未知状态'}`;
      }

      setStatus(type, '今日已签到', detail + retryText);
      return;
    }

    // 上次记录是昨天或更早：显示“今日待签到”，不要冒充今天的成功
    if (!lastIsToday) {
      const label = STATUS_LABELS[lastCheckin.status] || '未知';
      const detail = `上次 ${formatTime(lastCheckin.time)} · ${label}${lastCheckin.message ? `：${lastCheckin.message}` : ''}`;

      if (config && config.autoCheckin === false) {
        setStatus(null, '自动签到已关闭', `${detail} · 可手动签到`);
      } else {
        setStatus(null, '今日待签到', detail + retryText);
      }
      return;
    }

    // 今天尝试过但尚未成功：显示具体失败原因和重试进度
    const statusMap = {
      success: {
        type: 'success',
        title: '签到成功',
        detail: `获得 ${formatDays(lastCheckin.days) !== '-' ? formatDays(lastCheckin.days) : '?'} 天${lastCheckin.domain ? ` · ${lastCheckin.domain}` : ''}`
      },
      already: {
        type: 'already',
        title: '今日已签到',
        detail: lastCheckin.message || '无需重复操作'
      },
      auth: {
        type: 'error',
        title: '登录已失效',
        detail: lastCheckin.message || '请重新登录 GLaDOS'
      },
      device: {
        type: 'error',
        title: '登录设备不一致',
        detail: lastCheckin.message || '请在本浏览器重新登录'
      },
      error: {
        type: 'error',
        title: '签到失败',
        detail: lastCheckin.message || '未知错误'
      },
      unknown: {
        type: null,
        title: '签到返回异常',
        detail: lastCheckin.message || ''
      }
    };

    const s = statusMap[lastCheckin.status] || statusMap.unknown;
    setStatus(s.type, s.title, (s.detail || '') + retryText);

  } catch (e) {
    console.error('加载状态失败:', e);
    setStatus('error', '加载状态失败', e.message);
  }
}

// ---- 手动签到 ----

async function handleCheckin() {
  const btn = el.btnCheckin;
  btn.classList.add('loading');
  btn.disabled = true;

  setStatus('checking', '正在签到...', '请稍候');

  try {
    const result = await chrome.runtime.sendMessage({ action: 'checkin' });

    const statusMap = {
      success: {
        type: 'success',
        title: '签到成功',
        detail: `获得 ${formatDays(result.days) !== '-' ? formatDays(result.days) : '?'} 天${result.domain ? ` · ${result.domain}` : ''}`,
        log: `签到成功，获得 ${formatDays(result.days) !== '-' ? formatDays(result.days) : '?'} 天`
      },
      already: {
        type: 'already',
        title: '今日已签到',
        detail: result.message || '',
        log: '今日已签到'
      },
      auth: {
        type: 'error',
        title: '登录已失效',
        detail: result.message || '请重新登录 GLaDOS',
        log: result.message
      },
      device: {
        type: 'error',
        title: '登录设备不一致',
        detail: result.message || '请在本浏览器重新登录',
        log: result.message
      },
      error: {
        type: 'error',
        title: '签到失败',
        detail: result.message,
        log: result.message
      }
    };

    const s = statusMap[result.status] || {
      type: null,
      title: '签到完成',
      detail: result.message || '请查看日志',
      log: result.message || '返回未知状态'
    };

    setStatus(s.type, s.title, s.detail);

    // 刷新全部
    await loadStatus();
    await loadHistory();

  } catch (err) {
    setStatus('error', '签到异常', err.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ---- 事件绑定 ----

el.btnCheckin.addEventListener('click', handleCheckin);
el.btnRefresh.addEventListener('click', refreshUserInfo);

el.btnClear.addEventListener('click', clearHistory);
el.btnExport.addEventListener('click', exportHistory);

el.btnPrevPage.addEventListener('click', () => {
  currentPage--;
  renderHistoryPage();
});

el.btnNextPage.addEventListener('click', () => {
  currentPage++;
  renderHistoryPage();
});

el.cfgRandomTime.addEventListener('change', toggleRandomTime);
el.btnSave.addEventListener('click', saveSettings);
el.btnDiagnose.addEventListener('click', runDiagnose);

el.btnSettings.addEventListener('click', () => {
  // 切换到设置 tab
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.tab-panel').forEach(p => p.classList.remove('active'));
  $('.tab[data-tab="settings"]').classList.add('active');
  $('#panelSettings').classList.add('active');
});

// ---- 初始化 ----

(async function init() {
  initTimeOptions();
  initTabs();
  // 三个读取互不依赖，并行加载，减少弹窗打开时的白屏时间
  await Promise.all([loadSettings(), loadStatus(), loadHistory()]);
})();
