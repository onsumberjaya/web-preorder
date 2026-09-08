// Service Worker untuk PWA "Benih Preorder".
//
// PENTING -- filosofi cache di sini SENGAJA dibuat sederhana & konservatif:
// SW ini CUMA menangani "app shell" (HTML/CSS/JS/ikon milik app ini sendiri,
// origin sama). Semua request ke domain lain (Firebase Auth, Firestore,
// Google Fonts, Phosphor Icons dari unpkg, dst) TIDAK PERNAH disentuh SW ini
// -- dibiarkan lewat langsung ke jaringan seperti biasa. Ini disengaja:
// Firestore SDK sudah punya mekanisme cache/offline-nya sendiri yang jauh
// lebih canggih (dan real-time), jadi SW generik seperti ini JANGAN ikut
// campur di situ -- bisa bikin data pesanan basi tersangkut di cache SW atau
// mengganggu koneksi long-polling/WebChannel Firestore.
//
// PERBAIKAN v3 -- dua masalah dibetulkan:
//
// 1) BUG: precache tidak pernah kepakai untuk file JS. Semua tag
//    <script src="js/xxx.js?v=10"> di HTML minta URL DENGAN query string,
//    tapi precache lama menyimpan key "js/xxx.js" TANPA query string.
//    caches.match() mencocokkan URL persis (termasuk query), jadi precache
//    lama itu jadi entri mati -- tidak pernah benar-benar dipakai untuk
//    offline/cache-hit. Diperbaiki dengan menambahkan ASSET_VERSION di
//    bawah dan menyusun precache JS dengan query string yang SAMA PERSIS
//    dengan yang dipasang di file HTML.
//
// 2) STRATEGI: dulu SEMUA file (termasuk JS/CSS yang sudah version-bust
//    lewat "?v=") pakai network-first -- artinya tiap pindah halaman
//    (reload penuh, app ini bukan SPA) selalu nunggu jaringan dulu untuk
//    file yang PASTI TIDAK BERUBAH ISINYA (karena sudah dikunci oleh nomor
//    versi di query string). Sekarang dipecah dua strategi:
//      - HTML halaman        -> tetap NETWORK-FIRST (biar update konten/
//                                bugfix langsung kepakai begitu online).
//      - JS/CSS/manifest/ikon -> STALE-WHILE-REVALIDATE (kalau sudah ada
//                                di cache, langsung disajikan INSTAN tanpa
//                                nunggu jaringan sama sekali; cache
//                                diperbarui diam-diam di belakang layar
//                                untuk kunjungan berikutnya).
//    Ini aman dilakukan justru KARENA sudah ada "?v=" -- begitu kalian
//    naikkan angka versinya saat deploy, URL-nya otomatis beda dan otomatis
//    dianggap file baru (bukan menyajikan versi lama yang basi).
//
// PENTING BUAT KE DEPAN: kalau kalian mengganti angka "?v=" di file HTML
// (misal dari v=10 jadi v=11) karena ada update js/css, JANGAN LUPA update
// juga ASSET_VERSION di bawah ini supaya precache tetap sinkron. Kalau lupa,
// bug #1 di atas kambuh lagi (bukan fatal -- app tetap jalan normal lewat
// network-first fallback bawaan browser, cuma manfaat cache instan-nya
// hilang sampai disinkronkan lagi).
const CACHE_VERSION = "v3";
const CACHE_NAME = `benih-preorder-shell-${CACHE_VERSION}`;
const ASSET_VERSION = "10"; // HARUS sama dengan "?v=" di semua tag <script> di file HTML

// Halaman HTML -- diminta TANPA query string, network-first.
const HTML_SHELL_FILES = [
  "index.html",
  "dashboard.html",
  "pesanan.html",
  "input-pesanan.html",
  "produk.html",
  "cabang.html",
  "pengguna.html",
  "laporan.html",
  "nota.html",
  "toko.html",
  "arsip.html",
  "panduan.html",
];

// File JS -- di HTML selalu diminta DENGAN "?v=ASSET_VERSION", jadi
// precache-nya juga harus pakai query yang sama supaya benar-benar match.
const JS_SHELL_FILES = [
  "js/firebase-config.js",
  "js/utils.js",
  "js/auth-guard.js",
  "js/nav.js",
  "js/presence.js",
  "js/pwa-register.js", // PERBAIKAN v3: sebelumnya kelewat, padahal dimuat di SEMUA halaman
  "js/dashboard.js",
  "js/pesanan.js",
  "js/input-pesanan.js",
  "js/produk.js",
  "js/cabang.js",
  "js/pengguna.js",
  "js/laporan.js",
  "js/nota.js",
  "js/toko.js",
  "js/arsip.js",
].map((f) => `${f}?v=${ASSET_VERSION}`);

// File statis lain -- diminta TANPA query string.
const OTHER_SHELL_FILES = [
  "manifest.json",
  "css/style.css",
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-512-maskable.png",
  "assets/apple-touch-icon.png",
];

const APP_SHELL_FILES = [...HTML_SHELL_FILES, ...OTHER_SHELL_FILES, ...JS_SHELL_FILES];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES))
      // Jangan tunggu tab lama ditutup -- SW baru langsung aktif begitu
      // instalasi selesai, supaya perbaikan/update secepatnya kepakai.
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Halaman HTML: request navigasi (klik menu/reload) ATAU path berakhiran
// ".html". Selain itu (JS/CSS/manifest/ikon) dianggap "aset versioned".
function isHtmlRequest(req, url) {
  return req.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/";
}

// NETWORK-FIRST -- dipakai untuk halaman HTML. Coba jaringan dulu supaya
// update konten/bugfix langsung kepakai; kalau gagal (offline), baru pakai
// cache, dan kalau halaman itu juga belum pernah ke-cache, fallback ke
// index.html supaya user tidak lihat error offline polos tanpa konteks.
function networkFirst(req) {
  return fetch(req)
    .then((networkRes) => {
      const resClone = networkRes.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
      return networkRes;
    })
    .catch(() => caches.match(req).then((cached) => cached || caches.match("index.html")));
}

// STALE-WHILE-REVALIDATE -- dipakai untuk JS/CSS/manifest/ikon yang sudah
// version-bust lewat "?v=". Kalau sudah ada di cache: langsung disajikan
// INSTAN (tanpa nunggu jaringan sama sekali), lalu diam-diam ambil versi
// terbaru dari jaringan untuk memperbarui cache buat kunjungan berikutnya.
// Kalau BELUM ada di cache (pertama kali diminta / versi baru): tunggu
// jaringan seperti biasa, lalu simpan ke cache.
function staleWhileRevalidate(req) {
  return caches.open(CACHE_NAME).then((cache) =>
    cache.match(req).then((cachedRes) => {
      const networkFetch = fetch(req)
        .then((networkRes) => {
          cache.put(req, networkRes.clone());
          return networkRes;
        })
        .catch(() => cachedRes); // offline & tidak ada apa pun -- pasrah ke cache lama (bisa saja undefined)

      return cachedRes || networkFetch;
    })
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cuma tangani GET ke origin yang sama (app shell milik kita sendiri).
  // Selain itu (POST/PUT lain, atau GET ke domain lain seperti Firestore/
  // Firebase Auth/Google Fonts/unpkg) -- JANGAN panggil respondWith() sama
  // sekali, biarkan browser proses seperti biasa tanpa campur tangan SW ini.
  if (req.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(isHtmlRequest(req, url) ? networkFirst(req) : staleWhileRevalidate(req));
});
