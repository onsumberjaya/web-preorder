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
  databaseURL: "Ghttps://manajemen-pesanan-benih-default-rtdb.asia-southeast1.firebasedatabase.app",
};

// Domain palsu untuk mengubah "username" jadi format email yang dibutuhkan
// Firebase Authentication. User cukup login pakai username biasa, tapi di
// balik layar sistem ini menambahkan akhiran ini secara otomatis.
// Boleh diganti sesuai selera, tidak perlu domain asli.
const FAKE_EMAIL_DOMAIN = "benihpreorder.local";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
// Kalau databaseURL belum diisi (masih placeholder), akses ke fitur
// "Karyawan Online" akan gagal dengan jelas alih-alih bikin seluruh halaman
// error saat baru dibuka -- lihat pemakaiannya di js/presence.js.
const rtdb = firebaseConfig.databaseURL.startsWith("GANTI_") ? null : firebase.database();

function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${FAKE_EMAIL_DOMAIN}`;
}
