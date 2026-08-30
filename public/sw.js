/* MamaCare 服務工作者：快取靜態外殼，支援「加到主畫面」與離線檢視。
   API 與上傳檔不快取（一律走網路，確保資料即時與權限正確）。 */
const CACHE = 'mamacare-v72';
const ASSETS = [
  '/family.html', '/index.html',
  '/css/style.css', '/js/api.js', '/js/family.js', '/js/app.js',
  '/favicon.svg', '/manifest-family.webmanifest', '/manifest-staff.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return; // 即時資料不快取
  const offlineShell = url.pathname.startsWith('/family') ? '/family.html' : '/index.html';
  // 程式碼與頁面（HTML/JS/CSS）走網路優先：改版後立即生效，不會停在舊版畫面；離線才回退快取。
  // 其餘靜態檔（圖示、manifest）維持快取優先並背景更新。
  const codeAsset = e.request.mode === 'navigate' || /\.(html|js|css)$/.test(url.pathname) || url.pathname === '/';
  if (codeAsset) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match(offlineShell)))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      }).catch(() => cached || caches.match(offlineShell));
      return cached || fetched;
    })
  );
});
