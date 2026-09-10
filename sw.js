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
// Strategi untuk file app shell: NETWORK-FIRST (coba jaringan dulu, fallback
// ke cache kalau offline/gagal) -- bukan cache-first. Alasannya: aplikasi
// ini masih aktif dikembangkan, kalau pakai cache-first user bisa "terjebak"
// melihat versi lama terus meski sudah online, padahal ada perbaikan/bug fix
// terbaru. Cache di sini murni untuk jaga-jaga saat sinyal jelek/offline,
// bukan untuk mempercepat load (yang penting tetap dapat versi TERBARU kalau
// bisa).
//
// Naikkan angka versi ini kalau pernah menghapus/mengganti nama file app
// shell, supaya cache lama (yang menyimpan nama file yang sudah tidak ada)
// ikut dibersihkan saat SW versi baru aktif.
//
// PERBAIKAN v2: menambahkan arsip.html, js/arsip.js, panduan.html, dan
// js/presence.js -- 4 file yang sudah lama ada di aplikasi tapi ketinggalan
// dari daftar precache ini. Dengan strategi network-first di bawah, ini
// sebenarnya cuma memengaruhi pengalaman OFFLINE untuk pengguna yang BELUM
// PERNAH membuka halaman itu sekali pun secara online (baru akan ikut
// ke-cache begitu berhasil diambil dari jaringan) -- bukan "selalu gagal"
// tapi tetap lebih baik langsung tersedia dari awal.
const CACHE_VERSION = "v3"; // v3: + tentang.html, changelog.html
const CACHE_NAME = `benih-preorder-shell-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
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
  "tentang.html",
  "changelog.html",
  "manifest.json",
  "css/style.css",
  "js/firebase-config.js",
  "js/utils.js",
  "js/auth-guard.js",
  "js/nav.js",
  "js/presence.js",
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
  "assets/favicon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-512-maskable.png",
  "assets/apple-touch-icon.png",
];

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

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Cuma tangani GET ke origin yang sama (app shell milik kita sendiri).
  // Selain itu (POST/PUT lain, atau GET ke domain lain seperti Firestore/
  // Firebase Auth/Google Fonts/unpkg) -- JANGAN panggil respondWith() sama
  // sekali, biarkan browser proses seperti biasa tanpa campur tangan SW ini.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        // Berhasil dari jaringan -- simpan salinan terbaru ke cache supaya
        // kalau nanti offline, yang tersedia adalah versi paling baru yang
        // pernah berhasil diambil (bukan cuma versi saat instalasi awal).
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return networkRes;
      })
      .catch(() =>
        // Jaringan gagal (offline) -- pakai cache. Kalau file ini juga tidak
        // ada di cache (mis. halaman yang belum pernah dibuka sebelumnya),
        // fallback ke index.html supaya minimal tidak muncul error browser
        // polos "tidak ada koneksi" tanpa konteks apa-apa.
        caches.match(req).then((cached) => cached || caches.match("index.html"))
      )
  );
});
