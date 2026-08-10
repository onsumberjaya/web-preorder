// Dipasang di semua halaman KECUALI index.html (halaman login).
// Menunggu status login, mengambil profil (role) dari Firestore,
// lalu memanggil window.onAuthReady(profile) yang didefinisikan tiap halaman.
// Jika halaman punya <body data-owner-only="true">, karyawan otomatis
// diarahkan kembali ke pesanan.html.

window.currentUserProfile = null;

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (!doc.exists || doc.data().is_active === false) {
      showToast("Akun tidak aktif atau tidak ditemukan. Hubungi Owner.", "error");
      await auth.signOut();
      window.location.href = "index.html";
      return;
    }
    const profile = { uid: user.uid, ...doc.data() };
    window.currentUserProfile = profile;

    const ownerOnly = document.body.getAttribute("data-owner-only") === "true";
    if (ownerOnly && profile.role !== "owner") {
      window.location.href = "pesanan.html";
      return;
    }

    // Halaman dengan <body data-allowed-roles="owner,admin_kasir"> hanya
    // boleh diakses role yang disebut (dipisah koma); role lain otomatis
    // diarahkan kembali. Dipakai untuk halaman yang boleh dipakai lebih dari
    // 1 role tapi tidak semua role (mis. Produk & Batch: Owner + Admin
    // Kasir, tapi bukan Karyawan cabang).
    const allowedRolesAttr = document.body.getAttribute("data-allowed-roles");
    if (allowedRolesAttr) {
      const allowedRoles = allowedRolesAttr.split(",").map((r) => r.trim());
      if (!allowedRoles.includes(profile.role)) {
        window.location.href = "pesanan.html";
        return;
      }
    }

    if (typeof renderSidebar === "function") renderSidebar(profile);
    if (typeof window.onAuthReady === "function") window.onAuthReady(profile);
    if (typeof startPresenceTracking === "function") startPresenceTracking(user.uid);

    watchSingleSession(user.uid);
  } catch (err) {
    console.error(err);
    showToast("Gagal memuat profil pengguna.", "error");
  }
});

// Fitur "1 sesi login per perangkat". localStorage dibagi otomatis ke semua
// tab dalam browser yang sama di komputer yang sama -- jadi buka beberapa
// tab di 1 komputer tetap dianggap 1 sesi, tidak saling menendang.
let sessionKickHandled = false;
async function watchSingleSession(uid) {
  const localSessionId = localStorage.getItem("device_session_id");

  if (!localSessionId) {
    // Sesi ini belum tercatat lokal -- kemungkinan besar login dari SEBELUM
    // fitur ini ada, localStorage sempat kepencet bersih, atau ada beberapa
    // tab di browser yang sama yang KEBETULAN sama-sama baru pertama kali
    // mengalami ini bersamaan (mis. browser baru start & mengembalikan
    // banyak tab sekaligus). Supaya tab-tab semacam itu tidak saling
    // menimpa lalu saling menendang satu sama lain, pakai TRANSAKSI: baca
    // dulu apa yang tercatat di server SEKARANG -- kalau ternyata sudah ada
    // (dari tab lain yang menang lebih dulu), ikuti saja ID itu; baru kalau
    // memang benar-benar belum pernah ada sama sekali, klaim sebagai sesi
    // ini. Transaksi memastikan baca+tulis ini atomik, tidak ada 2 tab yang
    // bisa lolos mengklaim ID berbeda secara bersamaan.
    const newId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ref = db.collection("users").doc(uid);
    try {
      const finalId = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? snap.data().active_session_id : null;
        if (existing) return existing;
        tx.update(ref, { active_session_id: newId });
        return newId;
      });
      localStorage.setItem("device_session_id", finalId);
      watchSingleSession(uid); // localStorage sudah terisi -- lanjut pasang pengawas sesi seperti biasa
    } catch (e) {
      // Gagal transaksi (jarang terjadi) -- jangan sampai macet, anggap
      // valid dengan ID sendiri supaya orang tetap bisa lanjut pakai app.
      localStorage.setItem("device_session_id", newId);
    }
    return;
  }

  db.collection("users")
    .doc(uid)
    .onSnapshot((snap) => {
      if (sessionKickHandled || !snap.exists) return;
      const serverSessionId = snap.data().active_session_id;
      if (serverSessionId && serverSessionId !== localSessionId) {
        sessionKickHandled = true;
        localStorage.removeItem("device_session_id");
        showSessionKickedModal();
      }
    });
}

// Modal custom (bukan alert() bawaan browser) supaya gayanya konsisten
// dengan modal lain di aplikasi ini. Sengaja TIDAK bisa ditutup lewat klik
// di luar kotak atau tombol X -- satu-satunya tombolnya langsung logout,
// supaya orang tidak bisa "mengabaikan" peringatan ini dan terus memakai
// sesi yang sebenarnya sudah tidak valid.
function showSessionKickedModal() {
  const div = document.createElement("div");
  div.innerHTML = `
    <div class="modal-backdrop" style="display:flex;">
      <div class="modal-box" style="max-width:380px; text-align:center;">
        <i class="ph-bold ph-warning-circle" style="font-size:34px; color:var(--red-600);"></i>
        <h3 style="margin:12px 0 6px;">Sesi Anda Diakhiri</h3>
        <p style="color:var(--gray-500); font-size:13.5px; margin:0;">Akun ini baru saja login dari perangkat lain.</p>
        <button type="button" class="btn-primary" style="width:100%; justify-content:center; margin-top:18px;" id="session-kicked-ok">OK</button>
      </div>
    </div>`;
  document.body.appendChild(div.firstElementChild);
  document.getElementById("session-kicked-ok").addEventListener("click", () => {
    auth.signOut().then(() => (window.location.href = "index.html"));
  });
}

async function logout() {
  if (!(await showConfirmModal("Keluar dari aplikasi?"))) return;
  const uid = auth.currentUser && auth.currentUser.uid;
  localStorage.removeItem("device_session_id");
  // Bersihkan juga active_session_id di server (bukan cuma lokal) -- harus
  // dilakukan SEBELUM signOut(), karena begitu signOut() selesai, request.auth
  // jadi null dan tidak lagi punya izin menulis ke dokumen users manapun.
  if (uid) {
    try {
      await db.collection("users").doc(uid).update({ active_session_id: firebase.firestore.FieldValue.delete() });
    } catch (e) {
      // Diamkan -- kalaupun gagal, tetap lanjut logout seperti biasa.
    }
  }
  auth.signOut().then(() => (window.location.href = "index.html"));
}
