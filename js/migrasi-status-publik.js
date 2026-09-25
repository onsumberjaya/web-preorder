// Alat migrasi sekali-jalan (lihat migrasi-status-publik.html) -- untuk
// pesanan LAMA yang dibuat sebelum fitur QR/status publik ada, supaya
// /orders_public/{id} ikut terisi (dipakai status.html, dibuka lewat scan
// QR). Pesanan yang dibuat/diubah SETELAH fitur ini aktif sudah otomatis
// tersinkron lewat js/input-pesanan.js & js/pesanan.js -- alat ini tidak
// perlu dijalankan rutin, cukup sekali (atau sesekali kalau ragu ada yang
// terlewat, aman diulang kapan saja).

let allOrdersCache = [];

window.onAuthReady = async function () {
  try {
    const snap = await db.collection("orders").get();
    allOrdersCache = snap.docs;
    const btn = document.getElementById("migrasi-btn");
    const desc = document.getElementById("migrasi-desc");
    if (allOrdersCache.length === 0) {
      desc.textContent = "Tidak ada pesanan ditemukan di database.";
      btn.disabled = true;
      return;
    }
    desc.textContent = `Ditemukan ${allOrdersCache.length} pesanan di database. Klik tombol di bawah untuk menyalin/menyinkronkan ringkasan status publiknya (dipakai halaman status.html & QR code di nota).`;
    btn.disabled = false;
  } catch (err) {
    document.getElementById("migrasi-desc").textContent = "Gagal memuat daftar pesanan: " + friendlyFirebaseError(err);
  }
};

async function jalankanMigrasiStatusPublik() {
  if (allOrdersCache.length === 0) return;
  if (!(await showConfirmModal(`Sinkronkan status publik untuk ${allOrdersCache.length} pesanan sekarang? Data pesanan asli di /orders TIDAK ikut berubah.`))) return;

  const btn = document.getElementById("migrasi-btn");
  btn.disabled = true;
  const progressWrap = document.getElementById("migrasi-progress");
  const progressBar = document.getElementById("migrasi-progress-bar");
  const progressText = document.getElementById("migrasi-progress-text");
  progressWrap.style.display = "block";

  // Batch Firestore maksimal 500 operasi -- pecah jadi rombongan 400 supaya aman.
  const CHUNK = 400;
  let done = 0;
  try {
    for (let i = 0; i < allOrdersCache.length; i += CHUNK) {
      const batch = db.batch();
      const slice = allOrdersCache.slice(i, i + CHUNK);
      slice.forEach((docSnap) => {
        const publicData = buildPublicOrderStatusData(docSnap.data());
        batch.set(publicOrderStatusRef(docSnap.id), publicData);
      });
      await batch.commit();
      done += slice.length;
      const pct = Math.round((done / allOrdersCache.length) * 100);
      progressBar.style.width = pct + "%";
      progressText.textContent = `${done} dari ${allOrdersCache.length} pesanan selesai disinkronkan...`;
    }
    progressText.textContent = `Selesai! ${done} pesanan berhasil disinkronkan.`;
    showToast("Migrasi selesai.", "success");
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
    progressText.textContent = `Berhenti di tengah jalan (${done} dari ${allOrdersCache.length} selesai) -- coba klik lagi, aman diulang.`;
  } finally {
    btn.disabled = false;
  }
}
