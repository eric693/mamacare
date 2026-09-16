// 共用的 AI 助理頁（pages-ai.js）在其他站台是掛在 App.page／App.can／GET／POST 上的。
// 本站的前端比那些站早寫，沒有 App 這一層 —— 這個檔就是那一層薄薄的轉接頭，
// 讓共用檔一個字都不用改。要載在 pages-ai.js **之前**。
(function () {
  if (window.App) return;

  const App = window.App = {
    pages: {},
    aiStatus: null,
    page(key, def) { App.pages[key] = def; },
    // 本站的權限：admin 全通，其餘看 currentUser.modules。
    can(moduleKey) {
      if (!moduleKey) return true;
      // app.js 的 currentUser 是 let 宣告（不會掛上 window），所以直接讀識別字。
      const u = typeof currentUser !== 'undefined' ? currentUser : null;
      if (!u) return false;
      if (u.role === 'admin') return true;
      return Array.isArray(u.modules) && u.modules.includes(moduleKey);
    }
  };

  window.GET = path => api(path);
  window.POST = (path, body) => api(path, { method: 'POST', body });

  window.UI = window.UI || {
    esc: s => (typeof esc === 'function' ? esc(s) : String(s == null ? '' : s)),
    toast: (msg, bad) => (typeof toast === 'function' ? toast(msg, bad) : alert(msg))
  };
})();
