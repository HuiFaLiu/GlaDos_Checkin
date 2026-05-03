// ============================================================
// GLaDOS Auto Check-in v2.0 — Content Script
// 注入到 glados.one 页面，在页面上下文中执行 API 请求
// ============================================================;

(async () => {
  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'doCheckin') {
      doCheckin().then(sendResponse);
      return true;
    }
    if (message.action === 'fetchUserInfo') {
      fetchUserInfo().then(sendResponse);
      return true;
    }
  });

  async function doCheckin() {
    try {
      const response = await fetch('https://glados.one/api/user/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: "glados.one" }),
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (e) {
      return { code: -1, message: e.message };
    }
  }

  async function fetchUserInfo() {
    try {
      const response = await fetch('https://glados.one/api/user/status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (e) {
      return { code: -1, message: e.message };
    }
  }
})();
