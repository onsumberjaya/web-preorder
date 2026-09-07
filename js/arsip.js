let arProfile = null;
let arProductsMap = {};
let arCabangMap = {};
let arToko = { nama: "Toko Benih" };

// Hasil "Cek Jumlah Pesanan" yang lagi ditampilkan (belum tentu sudah
// dibackup) -- termasuk riwayat pembayaran tiap pesanan (field _payments,
// diambil sekali di sini supaya tidak perlu baca ulang saat benar-benar
// membuat file backup).
let arLastPreview = null;

// Info backup yang BARU SAJA dibuat & diunduh di sesi ini -- dipakai supaya
// tombol "Hapus dari Database" menghapus PERSIS pesanan yang barusan
// dibackup (bukan query ulang berdasarkan filter tanggal, yang berisiko beda
// hasil kalau ada pesanan baru masuk di antara backup & hapus).
let arLastBackup = null;

window.onAuthReady = async function (profile) {
  try {
    arProfile = profile;

    // PERBAIKAN: Restore (menulis ulang pesanan lama ke database, dengan
    // created_by bebas) dikunci ke Owner saja -- ini setara "impor data
    // mentah", lebih berisiko daripada Backup (yang cuma membaca/mengunduh,
    // tidak mengubah database) sehingga sengaja dibatasi lebih ketat.
    // Admin Kasir tetap bisa mengakses halaman ini & memakai Backup seperti
    // biasa, cuma kartu Restore-nya diganti catatan penjelasan.
    if (profile.role !== "owner") {
      document.getElementById("ar-restore-card").style.display = "none";
      document.getElementById("ar-restore-owner-only-note").style.display = "";
    }

    const [prodSnap, cabangSnap, tokoDoc] = await Promise.all([
      db.collection("products").orderBy("nama").get(),
      db.collection("cabang").orderBy("nama").get(),
      db.collection("config").doc("toko").get(),
    ]);
    if (tokoDoc.exists) arToko = tokoDoc.data();

    cabangSnap.docs.forEach((d) => {
      arCabangMap[d.id] = { id: d.id, ...d.data() };
    });
    const cabangSelect = document.getElementById("ar-cabang");
    Object.values(arCabangMap).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.nama;
      cabangSelect.appendChild(opt);
    });

    const produkSelect = document.getElementById("ar-produk");
    prodSnap.docs.forEach((d) => {
      const p = { id: d.id, ...d.data() };
      arProductsMap[p.id] = p;
      const opt = document.createElement("option");
      opt.value = p.nama;
      opt.textContent = p.nama;
      produkSelect.appendChild(opt);
    });
    produkSelect.addEventListener("change", updateArGelombangOptions);
    updateArGelombangOptions();

    document.getElementById("ar-restore-file").addEventListener("change", handleRestoreFileSelected);

    await loadArsipRiwayat();
  } catch (err) {
    showToast("Gagal memuat halaman Arsip: " + friendlyFirebaseError(err), "error");
  }
};

// Opsi Gelombang mengikuti Produk yang dipilih -- sama seperti di halaman
// Laporan & Export (lihat updateLapGelombangOptions() di js/laporan.js).
function updateArGelombangOptions() {
  const produkNama = document.getElementById("ar-produk").value;
  const select = document.getElementById("ar-gelombang");
  const currentValue = select.value;
  select.innerHTML = '<option value="">Semua Gelombang</option>';
  const product = produkNama ? Object.values(arProductsMap).find((p) => p.nama === produkNama) : null;
  if (product) {
    (product.waves || []).forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.label;
      opt.textContent = w.label;
      select.appendChild(opt);
    });
  } else {
    const labels = new Set();
    Object.values(arProductsMap).forEach((p) => (p.waves || []).forEach((w) => labels.add(w.label)));
    labels.forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      select.appendChild(opt);
    });
  }
  const optionValues = Array.from(select.options).map((o) => o.value);
  if (optionValues.includes(currentValue)) select.value = currentValue;
}

function buildArFilterRingkas() {
  const parts = [];
  const produk = document.getElementById("ar-produk").value;
  if (produk) parts.push(`Produk: ${produk}`);
  const cabangEl = document.getElementById("ar-cabang");
  const cabangId = cabangEl.value;
  if (cabangId) {
    const opt = Array.from(cabangEl.options).find((o) => o.value === cabangId);
    parts.push(`Cabang: ${opt ? opt.textContent : cabangId}`);
  }
  const gelombang = document.getElementById("ar-gelombang").value;
  if (gelombang) parts.push(`Gelombang: ${gelombang}`);
  return parts;
}

// Langkah 1: cek dulu ADA BERAPA pesanan yang cocok filter, sebelum benar-2
// membuat file (supaya tidak kejutan file kosong / kebanyakan/kekurangan).
async function previewArsipData() {
  const dari = document.getElementById("ar-dari").value;
  const sampai = document.getElementById("ar-sampai").value;
  const box = document.getElementById("ar-preview-box");

  if (!dari || !sampai) {
    showToast("Dari Tanggal dan Sampai Tanggal wajib diisi.", "error");
    return;
  }

  arLastPreview = null;
  arLastBackup = null;
  box.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

  try {
    let ordersQuery = db
      .collection("orders")
      .where("tanggal", ">=", new Date(dari + "T00:00:00"))
      .where("tanggal", "<=", new Date(sampai + "T23:59:59"));

    // Kalau Cabang dipilih (bukan "Semua Cabang"), ikut dibatasi di query ini
    // juga -- sama seperti optimasi yang sama di js/laporan.js & js/dashboard.js,
    // supaya tidak baca data cabang lain yang tidak relevan sama sekali.
    const cabangId = document.getElementById("ar-cabang").value;
    if (cabangId) ordersQuery = ordersQuery.where("cabang_id", "==", cabangId);

    ordersQuery = ordersQuery.orderBy("tanggal", "desc");
    const snap = await ordersQuery.get();

    let orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const produk = document.getElementById("ar-produk").value;
    const gelombang = document.getElementById("ar-gelombang").value;

    orders = orders.filter((o) => {
      if (produk && !(o.items || []).some((it) => it.product_name === produk)) return false;
      if (gelombang && !(o.items || []).some((it) => resolveWaveLabel(it, arProductsMap) === gelombang)) return false;
      return true;
    });

    if (orders.length === 0) {
      box.innerHTML = `<div class="alert alert-info">Tidak ada pesanan yang cocok dengan filter ini.</div>`;
      return;
    }

    // Ambil riwayat pembayaran tiap pesanan -- dibutuhkan supaya file backup
    // lengkap & bisa direstore persis seperti semula (bukan cuma data pesanan
    // utamanya saja).
    const paymentsPerOrder = await Promise.all(
      orders.map((o) => db.collection("orders").doc(o.id).collection("payments").get())
    );
    orders.forEach((o, idx) => {
      o.__payments = paymentsPerOrder[idx].docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    const totalUang = orders.reduce((s, o) => s + o.total, 0);
    const filterRingkas = buildArFilterRingkas();
    arLastPreview = { orders, dari, sampai, filterRingkas };

    box.innerHTML = `
      <div class="alert alert-info" style="margin-bottom:12px;">
        Ditemukan <strong>${orders.length}</strong> pesanan (total ${formatRupiah(totalUang)})${
      filterRingkas.length ? " dengan filter: " + escapeHtml(filterRingkas.join(", ")) : ""
    }.
      </div>
      <button class="btn-primary" onclick="downloadArsipBackup()"><i class="ph-bold ph-download-simple"></i> Buat &amp; Unduh File Backup</button>
    `;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function buildArsipFilename(dari, sampai) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `arsip-po_${dari}_sd_${sampai}_${stamp}.json`;
}

// Langkah 2: benar-benar buat file JSON-nya & unduh, lalu catat ke Riwayat
// Arsip (cuma metadata -- nama file/jumlah/filter -- BUKAN isi datanya, biar
// ringan). Belum menghapus apa pun dari database di langkah ini.
async function downloadArsipBackup() {
  if (!arLastPreview || arLastPreview.orders.length === 0) return;
  const { orders, dari, sampai, filterRingkas } = arLastPreview;
  const filename = buildArsipFilename(dari, sampai);

  const payload = {
    app: "preorder-benih-arsip",
    versi: 1,
    dibuat_at: new Date().toISOString(),
    nama_file: filename,
    toko: arToko.nama || "Toko Benih",
    rentang_tanggal: { dari, sampai },
    filter: filterRingkas,
    jumlah_pesanan: orders.length,
    orders: orders.map((o) => {
      const { __payments, ...orderFields } = o;
      return { ...tsFirestoreToPlain(orderFields), __payments: tsFirestoreToPlain(__payments || []) };
    }),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  let logId = null;
  try {
    const filterRingkasLengkap = [
      `Tanggal: ${formatTanggal(new Date(dari + "T00:00:00"))} s/d ${formatTanggal(new Date(sampai + "T23:59:59"))}`,
      ...filterRingkas,
    ].join("  |  ");
    const logRef = await db.collection("arsip_log").add({
      nama_file: filename,
      dibuat_at: firebase.firestore.FieldValue.serverTimestamp(),
      dibuat_oleh: arProfile.uid,
      dibuat_oleh_nama: arProfile.full_name || arProfile.username || "-",
      jumlah_pesanan: orders.length,
      filter_ringkas: filterRingkasLengkap,
      status: "utuh",
    });
    logId = logRef.id;
  } catch (err) {
    showToast("File backup berhasil diunduh, tapi gagal mencatat ke Riwayat Arsip: " + friendlyFirebaseError(err), "error");
  }

  arLastBackup = { orderIds: orders.map((o) => o.id), filename, logId, jumlah: orders.length };
  renderPostBackupBox();
  await loadArsipRiwayat();
}

// Kotak konfirmasi setelah file diunduh -- tombol Hapus (khusus Owner) baru
// aktif setelah centang "sudah disimpan" dicentang, supaya tidak ada yang
// kehapus tanpa backup yang benar-benar sudah aman tersimpan.
function renderPostBackupBox() {
  const box = document.getElementById("ar-preview-box");
  const isOwner = arProfile.role === "owner";
  box.innerHTML = `
    <div class="alert alert-success">File <strong>${escapeHtml(arLastBackup.filename)}</strong> (${arLastBackup.jumlah} pesanan) berhasil diunduh.</div>
    ${
      isOwner
        ? `
    <div class="card" style="background:var(--red-50); border-color:#fecaca; margin-top:10px;">
      <label style="display:flex; gap:8px; align-items:flex-start; font-size:13px; font-weight:500; margin-bottom:10px; cursor:pointer;">
        <input type="checkbox" id="ar-confirm-saved" style="margin-top:3px;" />
        <span>Saya sudah menyimpan file backup ini di tempat yang aman (komputer/Google Drive/dll).</span>
      </label>
      <button class="btn-danger" id="ar-delete-btn" disabled onclick="hapusArsipDariDatabase()"><i class="ph-bold ph-trash"></i> Hapus ${arLastBackup.jumlah} Pesanan Ini dari Database</button>
      <p style="font-size:12px; color:var(--gray-500); margin:8px 0 0;">Menghapus permanen dari database -- kalau nanti ingin ditampilkan lagi, gunakan "Restore dari File Backup" di bawah dengan file yang baru saja diunduh ini.</p>
    </div>`
        : `<p style="font-size:12.5px; color:var(--gray-500); margin-top:8px;">Hanya Owner yang bisa menghapus pesanan dari database setelah dibackup. Silakan minta Owner membuka halaman ini untuk melanjutkan penghapusan kalau memang sudah ingin dihapus.</p>`
    }
  `;
  if (isOwner) {
    document.getElementById("ar-confirm-saved").addEventListener("change", (e) => {
      document.getElementById("ar-delete-btn").disabled = !e.target.checked;
    });
  }
}

// Langkah 3 (opsional, khusus Owner): hapus permanen pesanan yang BARU SAJA
// dibackup di sesi ini dari database.
async function hapusArsipDariDatabase() {
  if (!arLastBackup) return;
  if (
    !(await showConfirmModal(
      `Menghapus PERMANEN ${arLastBackup.jumlah} pesanan dari database. Tindakan ini tidak bisa dibatalkan (kecuali direstore lagi dari file backup yang baru saja diunduh). Lanjutkan?`,
      { okLabel: "Ya, Hapus Permanen", danger: true }
    ))
  )
    return;

  const btn = document.getElementById("ar-delete-btn");
  if (btn) btn.disabled = true;
  let deleted = 0;
  try {
    for (const id of arLastBackup.orderIds) {
      await deleteOrderCascade(id);
      deleted++;
    }
    if (arLastBackup.logId) {
      await db.collection("arsip_log").doc(arLastBackup.logId).update({
        status: "sudah_dihapus",
        dihapus_at: firebase.firestore.FieldValue.serverTimestamp(),
        dihapus_oleh: arProfile.uid,
        dihapus_oleh_nama: arProfile.full_name || arProfile.username || "-",
      });
    }
    showToast(`${deleted} pesanan berhasil dihapus dari database.`, "success");
    document.getElementById(
      "ar-preview-box"
    ).innerHTML = `<div class="alert alert-success">${deleted} pesanan sudah dihapus dari database. File backup-nya tetap tersimpan di perangkat Anda.</div>`;
    arLastBackup = null;
    arLastPreview = null;
    await loadArsipRiwayat();
  } catch (err) {
    showToast(`Berhenti di tengah jalan (${deleted}/${arLastBackup.orderIds.length} terhapus): ${friendlyFirebaseError(err)}`, "error");
    if (btn) btn.disabled = false;
  }
}

async function loadArsipRiwayat() {
  const container = document.getElementById("ar-riwayat-table");
  try {
    const snap = await db.collection("arsip_log").orderBy("dibuat_at", "desc").limit(50).get();
    if (snap.empty) {
      container.innerHTML = `<div class="empty-state">Belum ada riwayat backup.</div>`;
      return;
    }
    const rows = snap.docs
      .map((d) => {
        const a = d.data();
        const statusBadge =
          a.status === "sudah_dihapus"
            ? `<span class="badge badge-gray">Sudah Dihapus dari Database</span>`
            : `<span class="badge badge-green">Utuh di Database</span>`;
        return `
      <tr>
        <td style="font-weight:600; word-break:break-all;">${escapeHtml(a.nama_file)}</td>
        <td style="font-size:12px; color:var(--gray-500); white-space:nowrap;">${a.dibuat_at ? formatTanggalWaktu(a.dibuat_at) : "-"}<br/>oleh ${escapeHtml(a.dibuat_oleh_nama || "-")}</td>
        <td style="text-align:center;">${a.jumlah_pesanan}</td>
        <td style="font-size:12px; color:var(--gray-500);">${escapeHtml(a.filter_ringkas || "-")}</td>
        <td style="white-space:nowrap;">${statusBadge}</td>
      </tr>`;
      })
      .join("");
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nama File</th><th>Dibuat</th><th>Jumlah</th><th>Filter</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

// ---------- Restore dari File Backup ----------
let arRestorePayload = null;

function handleRestoreFileSelected(e) {
  const file = e.target.files[0];
  const previewBox = document.getElementById("ar-restore-preview");
  arRestorePayload = null;
  if (!file) {
    previewBox.innerHTML = "";
    return;
  }

  previewBox.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || data.app !== "preorder-benih-arsip" || !Array.isArray(data.orders)) {
        previewBox.innerHTML = `<div class="alert alert-error">File ini bukan file backup Arsip PO yang valid.</div>`;
        return;
      }
      arRestorePayload = data;
      previewBox.innerHTML = `
        <div class="alert alert-info">
          File <strong>${escapeHtml(data.nama_file || file.name)}</strong> berisi <strong>${data.orders.length}</strong> pesanan${
        data.rentang_tanggal ? ` (rentang ${escapeHtml(data.rentang_tanggal.dari)} s/d ${escapeHtml(data.rentang_tanggal.sampai)})` : ""
      }.
        </div>
        <button class="btn-primary" onclick="restoreArsipData()"><i class="ph-bold ph-clock-counter-clockwise"></i> Restore ${data.orders.length} Pesanan Ini</button>
      `;
    } catch (err) {
      previewBox.innerHTML = `<div class="alert alert-error">Gagal membaca file (bukan JSON yang valid).</div>`;
    }
  };
  reader.readAsText(file);
}

async function restoreArsipData() {
  // Jaga-jaga lapis kedua (di luar kartu yang disembunyikan di UI untuk
  // non-Owner di atas) -- kalau sampai fungsi ini terpanggil lewat cara lain
  // (mis. dari console browser) oleh Admin Kasir, tetap ditolak di sini.
  if (!arProfile || arProfile.role !== "owner") {
    showToast("Restore data khusus Owner.", "error");
    return;
  }
  if (!arRestorePayload) return;
  const orders = arRestorePayload.orders;
  if (
    !(await showConfirmModal(
      `Memulihkan ${orders.length} pesanan ke database. Pesanan yang ID-nya SUDAH ADA di database akan dilewati (tidak ditimpa). Lanjutkan?`,
      { okLabel: "Ya, Restore" }
    ))
  )
    return;

  const previewBox = document.getElementById("ar-restore-preview");
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  const total = orders.length;

  for (let i = 0; i < orders.length; i++) {
    const raw = orders[i];
    previewBox.innerHTML = `<div class="loading-center"><div class="spinner"></div></div><p style="text-align:center; font-size:12.5px; color:var(--gray-500);">Memulihkan pesanan ${i + 1}/${total}...</p>`;
    try {
      const { __payments, id, ...orderFieldsPlain } = raw;
      const orderRef = db.collection("orders").doc(id);
      const existing = await orderRef.get();
      if (existing.exists) {
        skipped++;
        continue;
      }

      const orderData = tsPlainToFirestore(orderFieldsPlain);
      const batch = db.batch();
      batch.set(orderRef, orderData);
      (__payments || []).forEach((p) => {
        const { id: paymentId, ...paymentFieldsPlain } = p;
        batch.set(orderRef.collection("payments").doc(paymentId), tsPlainToFirestore(paymentFieldsPlain));
      });
      await batch.commit();

      // Rekap stats/produk_cabang & stats/produk_gelombang: tambahkan lagi
      // qty pesanan yang direstore ini (sebelumnya sempat dikurangi saat
      // diarsipkan/dihapus).
      try {
        await db.runTransaction(async (tx) => {
          applyProdukCabangStatsDelta(tx, orderData.cabang_id, aggregateQtyByProduct(orderData.items));
          applyProdukGelombangStatsDelta(tx, aggregateQtyByWave(orderData.items));
        });
      } catch (statsErr) {
        // Diamkan -- kalaupun rekap gagal ikut update, bisa diperbaiki lewat
        // tombol "Hitung Ulang Rekap Produk per Cabang" di halaman Laporan.
      }

      restored++;
    } catch (err) {
      failed++;
    }
  }

  // Tandai balik status di Riwayat Arsip (kalau ketemu berdasar nama file) --
  // kalau tidak ketemu (mis. catatan lognya sudah lama terhapus), buat
  // catatan baru supaya tetap tercatat di Riwayat.
  try {
    const namaFile = arRestorePayload.nama_file || null;
    if (namaFile) {
      const logSnap = await db.collection("arsip_log").where("nama_file", "==", namaFile).limit(1).get();
      if (!logSnap.empty) {
        await logSnap.docs[0].ref.update({
          status: "utuh",
          direstore_at: firebase.firestore.FieldValue.serverTimestamp(),
          direstore_oleh: arProfile.uid,
          direstore_oleh_nama: arProfile.full_name || arProfile.username || "-",
        });
      } else {
        await db.collection("arsip_log").add({
          nama_file: namaFile,
          dibuat_at: firebase.firestore.FieldValue.serverTimestamp(),
          dibuat_oleh: arProfile.uid,
          dibuat_oleh_nama: arProfile.full_name || arProfile.username || "-",
          jumlah_pesanan: restored,
          filter_ringkas: "(direstore dari file backup, tidak ada catatan Riwayat Arsip sebelumnya)",
          status: "utuh",
        });
      }
    }
  } catch (err) {
    // Diamkan -- kegagalan mencatat log tidak menggagalkan restore datanya sendiri.
  }

  previewBox.innerHTML = `<div class="alert ${failed > 0 ? "alert-error" : "alert-success"}">
    Selesai. ${restored} pesanan dipulihkan${skipped ? `, ${skipped} dilewati (sudah ada di database)` : ""}${failed ? `, ${failed} gagal` : ""}.
  </div>`;
  document.getElementById("ar-restore-file").value = "";
  arRestorePayload = null;
  await loadArsipRiwayat();
}
