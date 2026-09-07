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

// (Opsional, sangat disarankan) App Check -- pagar tambahan di luar Rules.
// firebaseConfig di atas (termasuk apiKey) MEMANG publik dan itu normal
// untuk aplikasi Firebase manapun (keamanan sesungguhnya ada di Rules, bukan
// di kerahasiaan apiKey) -- TAPI tanpa App Check, siapa pun yang menyalin
// apiKey itu dari "View Source" bisa memakainya untuk mengirim request
// LANGSUNG ke Firestore/Realtime Database project ini dari LUAR aplikasi ini
// (mis. skrip sendiri), bukan untuk mencuri/mengubah data (Rules tetap
// menahan itu seperti biasa), tapi bisa dipakai untuk SPAM baca/tulis
// sampai kuota gratis harian Firebase habis. App Check menutup celah itu:
// cuma request yang benar-benar datang dari halaman aplikasi ini (lolos
// verifikasi reCAPTCHA v3 tak terlihat) yang akan dilayani.
//
// Cara mengisi RECAPTCHA_V3_SITE_KEY & mengaktifkan fitur ini (termasuk
// TAHAPAN PENTING supaya tidak sampai mengunci akses Anda sendiri): lihat
// PANDUAN-SETUP.md Bagian 1g.
//
// Kalau dibiarkan "GANTI_..." (belum diisi), App Check dilewati diam-diam
// -- aplikasi tetap jalan 100% normal seperti sebelumnya, cuma tanpa pagar
// tambahan ini.
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
// Kalau databaseURL belum diisi (masih placeholder), akses ke fitur
// "Karyawan Online" akan gagal dengan jelas alih-alih bikin seluruh halaman
// error saat baru dibuka -- lihat pemakaiannya di js/presence.js.
const rtdb = firebaseConfig.databaseURL.startsWith("GANTI_") ? null : firebase.database();

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}
