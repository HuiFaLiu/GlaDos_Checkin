// ============================================================
// GLaDOS Auto Check-in v2.0 — Popup Logic
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
  remainDays:    $('#remainDays'),
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
};

// ---- 常量 ----
const LOGS_PER_PAGE = 8;

// ---- 状态 ----
let allHistory = [];
let currentPage = 0;

// ---- 工具函数 ----

function formatTime(isoString) {
  if (!isoString) return '--';
  const d = new Date(isoString);
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
  setTimeout(() => toast.classList.remove('show'), duration);
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
    return;
  }
  el.userEmail.textContent = info.email || '-';
}

async function refreshUserInfo() {
  el.btnRefresh.style.opacity = '0.4';
  try {
    const info = await chrome.runtime.sendMessage({ action: 'fetchUserInfo' });
    renderUserInfo(info);
    showToast('✅ 用户信息已刷新');
  } catch (e) {
    showToast('❌ 刷新失败');
  } finally {
    el.btnRefresh.style.opacity = '1';
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
    allHistory = await chrome.runtime.sendMessage({ action: 'getHistory' });
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

  el.logPagination.style.display = 'flex';
  el.pageInfo.textContent = `${currentPage + 1}/${totalPages}`;
  el.btnPrevPage.disabled = currentPage <= 0;
  el.btnNextPage.disabled = currentPage >= totalPages - 1;

  el.logList.innerHTML = pageItems.map(item => {
    const time = new Date(item.time).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Shanghai'
    });

    const statusIcon = {
      success: '✅',
      already: '🔁',
      error: '❌',
      info: 'ℹ️',
      unknown: '⚠️'
    }[item.status] || '❓';

    const daysStr = (item.days && item.days !== '-') ? `${item.days}天` : '';

    return `
      <div class="log-item">
        <span class="log-dot ${item.status}"></span>
        <span class="log-time">${time}</span>
        <span class="log-msg">${statusIcon} ${item.message || item.status}</span>
        ${daysStr ? `<span class="log-days">${daysStr}</span>` : ''}
      </div>
    `;
  }).join('');
}

function clearHistory() {
  if (!confirm('确定清空所有签到记录？')) return;
  chrome.runtime.sendMessage({ action: 'clearHistory' }).then(() => {
    allHistory = [];
    renderHistoryPage();
    showToast('🗑️ 记录已清空');
  });
}

function exportHistory() {
  if (allHistory.length === 0) {
    showToast('📋 没有可导出的记录');
    return;
  }

  const lines = ['时间,状态,消息,获得天数'];
  allHistory.forEach(item => {
    const time = formatTimeFull(item.time);
    const msg = (item.message || '').replace(/,/g, '，');
    lines.push(`${time},${item.status},${msg},${item.days || '-'}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `glados-checkin-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📋 已导出 CSV');
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
  const config = {
    autoCheckin: el.cfgAutoCheckin.checked,
    checkinHour: parseInt(el.cfgHour.value),
    checkinMinute: parseInt(el.cfgMinute.value),
    randomTime: el.cfgRandomTime.checked,
    randomStartHour: parseInt(el.cfgRandomStartHour.value),
    randomStartMinute: parseInt(el.cfgRandomStartMinute.value),
    randomEndHour: parseInt(el.cfgRandomEndHour.value),
    randomEndMinute: parseInt(el.cfgRandomEndMinute.value),
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
    await chrome.runtime.sendMessage({ action: 'saveConfig', config });
    showToast('✅ 设置已保存');
    loadStatus();
  } catch (e) {
    showToast('❌ 保存失败');
  }
}

// ---- 加载状态 ----

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    const { lastCheckin, nextCheckinTime, userInfo } = response;

    // 用户信息
    renderUserInfo(userInfo);

    // 下次签到时间
    el.nextTime.textContent = formatNextTime(nextCheckinTime);

    if (!lastCheckin) {
      setStatus(null, '等待首次签到...', '点击下方按钮或等待定时触发');
      el.lastTime.textContent = '--';
      el.remainDays.textContent = '--';
      return;
    }

    // 上次签到时间
    el.lastTime.textContent = formatTime(lastCheckin.time);

    // 状态映射
    const statusMap = {
      success: {
        type: 'success',
        title: '签到成功',
        detail: `获得 ${lastCheckin.days || '?'} 天时长`
      },
      already: {
        type: 'already',
        title: '今日已签到',
        detail: lastCheckin.message || '无需重复操作'
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
    setStatus(s.type, s.title, s.detail);

    // 剩余时长
    if (lastCheckin.days) {
      el.remainDays.textContent = `${lastCheckin.days} 天`;
    }

  } catch (e) {
    console.error('加载状态失败:', e);
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
        detail: `获得 ${result.days || '?'} 天时长`,
        log: `签到成功，获得 ${result.days || '?'} 天`
      },
      already: {
        type: 'already',
        title: '今日已签到',
        detail: result.message || '',
        log: '今日已签到'
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
  await loadSettings();
  await loadStatus();
  await loadHistory();
})();
