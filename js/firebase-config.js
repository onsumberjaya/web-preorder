// ==========================================================================
// GANTI seluruh isi objek di bawah ini dengan Firebase Config dari project
// Firebase Anda sendiri (Project Settings > General > Your apps > SDK setup).
// Lihat PANDUAN-SETUP.md untuk cara mendapatkannya.
// ==========================================================================
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDigzDlt2pKFeZVz4ZJuFiWzg1u-vXW8Go",
  authDomain: "manajemen-pesanan-benih.firebaseapp.com",
  projectId: "manajemen-pesanan-benih",
  storageBucket: "manajemen-pesanan-benih.firebasestorage.app",
  messagingSenderId: "648413234604",
  appId: "1:648413234604:web:01b296f97ffeb7f24b6609",
  measurementId: "G-C96BWFSEFH",
  // Dipakai fitur "Karyawan Online" di halaman Kelola Pengguna. Isi dengan
  // URL Realtime Database Anda -- muncul di Firebase Console setelah Anda
  // klik "Create Database" di menu "Realtime Database" (BUKAN "Firestore
  // Database", ini layanan terpisah). Bentuknya mirip:
  // https://NAMA-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app
  databaseURL: "https://manajemen-pesanan-benih-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// Domain palsu untuk mengubah "username" jadi format email yang dibutuhkan
// Firebase Authentication. User cukup login pakai username biasa, tapi di
// balik layar sistem ini menambahkan akhiran ini secara otomatis.
// Boleh diganti sesuai selera, tidak perlu domain asli.
const FAKE_EMAIL_DOMAIN = "benihpreorder.local";

// (Opsional -- SEKARANG TIDAK DISARANKAN, lihat PANDUAN-SETUP.md Bagian 1f)
// App Check. Sejak April 2026 Google mengubah reCAPTCHA: pendaftaran key v3
// klasik gratis penuh sudah ditutup, diganti reCAPTCHA Enterprise yang
// kuotanya jauh lebih kecil & biasanya butuh kartu/billing Google Cloud
// tersambung. Karena itu, DISARANKAN dibiarkan seperti ini (placeholder
// "GANTI_...") -- aplikasi 100% aman & lengkap fiturnya tanpa App Check,
// keamanan data sesungguhnya sudah ada di firestore.rules & database.rules.json.
//
// PERBAIKAN (optimasi kecepatan): karena fitur ini tidak dipakai, tag
// <script src=".../firebase-app-check-compat.js"> ikut DIHAPUS dari semua
// halaman HTML -- tidak ada gunanya mengunduh & menjalankan skrip untuk
// fitur yang tidak aktif di setiap perpindahan halaman. Konsekuensinya:
// kalau nanti Anda BENAR-BENAR mau mengaktifkan App Check lagi, langkah
// PERTAMA yang wajib dilakukan adalah memasang KEMBALI tag script itu di
// SEMUA 12 file HTML (posisinya tepat setelah firebase-app-compat.js,
// sebelum firebase-auth-compat.js) -- tanpa itu, `firebase.appCheck()` di
// bawah tidak akan pernah ada (undefined) dan try/catch di bawah cuma akan
// mencatat peringatan di console, App Check tidak akan pernah benar-benar
// menyala walau RECAPTCHA_V3_SITE_KEY sudah diisi.
const RECAPTCHA_V3_SITE_KEY = "GANTI_DENGAN_RECAPTCHA_V3_SITE_KEY";

firebase.initializeApp(firebaseConfig);

if (!RECAPTCHA_V3_SITE_KEY.startsWith("GANTI_")) {
  try {
    // isTokenAutoRefreshEnabled: true -- token App Check diperpanjang
    // otomatis di belakang layar selama halaman terbuka, staf tidak perlu
    // login ulang gara-gara ini.
    firebase.appCheck().activate(RECAPTCHA_V3_SITE_KEY, true);
  } catch (err) {
    // Jaga-jaga: baris ini ada di skrip yang di-load langsung (bukan
    // module/async), jadi kalau .activate() sampai melempar error (mis.
    // site key ditulis salah format) dan TIDAK ditangkap di sini, SELURUH
    // baris kode SESUDAHNYA di file ini (termasuk `firebase.auth()` dkk di
    // bawah) ikut tidak pernah jalan -- artinya App Check yang salah pasang
    // bisa mematikan TOTAL aplikasi, bukan cuma fitur App Check-nya saja.
    // Ditangkap di sini supaya paling buruk cuma App Check yang tidak aktif
    // (persis seperti belum diisi), aplikasi selebihnya tetap jalan normal.
    console.warn("Gagal mengaktifkan App Check (cek RECAPTCHA_V3_SITE_KEY di js/firebase-config.js):", err);
  }
}

const auth = firebase.auth();
const db = firebase.firestore();
// PERBAIKAN (optimasi kecepatan): aktifkan cache offline Firestore supaya
// data yang sama sekali baru saja dilihat langsung tampil INSTAN dari cache
// lokal (IndexedDB) saat halaman lain dibuka -- tanpa menunggu jawaban dari
// server dulu -- baru diperbarui diam-diam kalau ada perubahan dari server.
// Ini yang paling terasa untuk "pindah halaman jadi lebih ringan", karena
// aplikasi ini reload penuh browser tiap ganti menu (bukan SPA), jadi
// tanpa ini SEMUA data selalu ditarik ulang dari nol tiap perpindahan.
// `synchronizeTabs: true` supaya tidak error kalau staf membuka lebih dari
// 1 tab/jendela aplikasi ini sekaligus (mis. Dashboard di 1 tab, Daftar
// Pesanan di tab lain) -- tanpa opsi ini, cuma tab PERTAMA yang berhasil
// mengaktifkan cache, tab lainnya akan gagal dengan error "failed-precondition".
// WAJIB dipanggil di sini, SEBELUM baris manapun lain yang memakai `db`
// (lihat file-file lain yang di-load sesudah ini) -- Firestore mewajibkan
// enablePersistence() jadi operasi PERTAMA yang dipanggil ke instance ini.
// Dibungkus .catch() (bukan try/catch/await) supaya TIDAK memblokir baris
// kode sesudahnya sama sekali kalau gagal (mis. browser lama yang tidak
// dukung IndexedDB) -- aplikasi tetap 100% jalan normal tanpa cache ini,
// cuma sedikit lebih lambat seperti sebelumnya.
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
  console.warn("Cache offline Firestore tidak aktif (" + err.code + ") -- aplikasi tetap jalan normal, cuma tanpa cache ini.", err);
});
// Kalau databaseURL belum diisi (masih placeholder), akses ke fitur
// "Karyawan Online" akan gagal dengan jelas alih-alih bikin seluruh halaman
// error saat baru dibuka -- lihat pemakaiannya di js/presence.js.
const rtdb = firebaseConfig.databaseURL.startsWith("GANTI_") ? null : firebase.database();

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}
