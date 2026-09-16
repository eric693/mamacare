// 把共用的 AI 助理頁接進本站的路由表與權限表。要載在 pages-ai.js **之後**。
//
// 本站的 routes 以 '#/xxx' 為鍵、render 自己往 main() 塞 HTML；
// 共用檔的 render(el) 是拿到容器。差別只有這一層。
(function () {
  const def = App.pages.ai;
  if (!def) return;

  routes['#/ai'] = () => def.render(main());
  ROUTE_PERM['#/ai'] = 'ai';

  // 共用檔的「開啟報表」按鈕會做 location.hash = '#residents?date=2026-09-06'，
  // 那是其他站的網址格式；本站是 '#/residents'。這裡接住轉成本站的格式
  // —— 本站自己產生的 hash 一律以 '#/' 開頭，不會被誤傷。
  window.addEventListener('hashchange', () => {
    const h = location.hash;
    if (!h || h.startsWith('#/')) return;
    const [page, qs] = h.slice(1).split('?');
    if (routes['#/' + page]) location.hash = '#/' + page + (qs ? '?' + qs : '');
  });
})();
