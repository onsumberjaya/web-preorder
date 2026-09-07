// ==========================================================================
// GANTI seluruh isi objek di bawah ini dengan Firebase Config dari project
// Firebase Anda sendiri (Project Settings > General > Your apps > SDK setup).
// Lihat PANDUAN-SETUP.md untuk cara mendapatkannya.
// ==========================================================================
const firebaseConfig = {
  apiKey: "AIzaSyDigzDlt2pKFeZVz4ZJuFiWzg1u-vXW8Go",
  authDomain: "manajemen-pesanan-benih.firebaseapp.com",
  databaseURL: "https://manajemen-pesanan-benih-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "manajemen-pesanan-benih",
  storageBucket: "manajemen-pesanan-benih.firebasestorage.app",
  messagingSenderId: "648413234604",
  appId: "1:648413234604:web:01b296f97ffeb7f24b6609",
  measurementId: "G-C96BWFSEFH"
};

// Domain palsu untuk mengubah "username" jadi format email yang dibutuhkan
// Firebase Authentication. User cukup login pakai username biasa, tapi di
// balik layar sistem ini menambahkan akhiran ini secara otomatis.
// Boleh diganti sesuai selera, tidak perlu domain asli.
const FAKE_EMAIL_DOMAIN = "benihpreorder.local";

// (Opsional, sangat disarankan) App Check -- lihat PANDUAN-SETUP.md Bagian 1f.
// Kalau dibiarkan "GANTI_..." (belum diisi), App Check dilewati diam-diam --
// aplikasi tetap jalan 100% normal seperti sebelumnya.
const RECAPTCHA_V3_SITE_KEY = "6LfXSq4tAAAAAJl6ZUvMJbTXkoB2stBgo7IEpIqV";

firebase.initializeApp(firebaseConfig);

if (!RECAPTCHA_V3_SITE_KEY.startsWith("GANTI_")) {
  try {
    firebase.appCheck().activate(RECAPTCHA_V3_SITE_KEY, true);
  } catch (err) {
    console.warn("Gagal mengaktifkan App Check (cek RECAPTCHA_V3_SITE_KEY di js/firebase-config.js):", err);
  }
}

const auth = firebase.auth();
const db = firebase.firestore();
const rtdb = firebaseConfig.databaseURL.startsWith("GANTI_") ? null : firebase.database();

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}