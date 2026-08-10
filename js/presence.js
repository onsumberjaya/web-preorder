// ==========================================================================
// Fitur "Karyawan Online" -- dipakai di halaman Kelola Pengguna.
//
// Beda dengan Firestore, Realtime Database punya event ".info/connected"
// dan onDisconnect() yang dijalankan LANGSUNG OLEH SERVER FIREBASE begitu
// koneksi dari perangkat itu putus (nutup tab, mati internet, HP dikunci
// lama, dst) -- bukan oleh kode di perangkat itu sendiri (karena kalau
// dilepas begitu saja, perangkat yang mati mendadak tidak akan sempat
// bilang "saya offline"). Ini kenapa fitur ini butuh Realtime Database,
// bukan Firestore biasa.
//
// Dipanggil sekali dari auth-guard.js setelah pengguna dipastikan login &
// aktif.
// ==========================================================================

function startPresenceTracking(uid) {
  if (!rtdb) return; // databaseURL belum dikonfigurasi -- lewati diam-diam

  const myPresenceRef = rtdb.ref("presence/" + uid);
  const connectedRef = rtdb.ref(".info/connected");

  connectedRef.on("value", (snap) => {
    if (snap.val() !== true) return;

    // Susun dulu apa yang harus ditulis server KALAU koneksi ini putus,
    // baru setelah itu tandai diri sebagai online. Urutannya penting --
    // kalau dibalik, ada celah waktu singkat di mana status "online" sudah
    // tercatat tapi rencana "offline saat putus" belum sempat terpasang.
    myPresenceRef
      .onDisconnect()
      .set({ online: false, last_active: firebase.database.ServerValue.TIMESTAMP })
      .then(() => {
        myPresenceRef.set({ online: true, last_active: firebase.database.ServerValue.TIMESTAMP });
      });
  });

  // Tab/HP-nya sendiri tetap dianggap "aktif" selama tab-nya kebuka, jadi
  // timestamp-nya di-refresh berkala juga (bukan cuma pas connect pertama)
  // supaya "Terakhir aktif" di Kelola Pengguna tetap mutakhir buat sesi yang
  // sedang online lama.
  setInterval(() => {
    if (document.visibilityState === "visible") {
      myPresenceRef.update({ last_active: firebase.database.ServerValue.TIMESTAMP });
    }
  }, 60000);
}
