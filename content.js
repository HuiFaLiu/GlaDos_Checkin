// ============================================================
// GLaDOS Auto Check-in — Content Script
// 注入到 glados.one 页面，在页面上下文中执行 API 请求
// ============================================================

(() => {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'doCheckin') {
      fetch('https://glados.one/api/user/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: "glados.one" }),
        credentials: 'include'
      })
        .then(r => r.json())
        .then(sendResponse)
        .catch(e => sendResponse({ code: -1, message: e.message }));
      return true;
    }

    if (message.action === 'fetchUserInfo') {
      fetch('https://glados.one/api/user/status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
        .then(r => r.json())
        .then(sendResponse)
        .catch(e => sendResponse({ code: -1, message: e.message }));
      return true;
    }
  });
})();
