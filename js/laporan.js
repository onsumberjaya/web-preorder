let lapOrders = [];
let lapToko = { nama: "Toko Benih" };
let lapFiltered = [];
let lapProductsMap = {};
let lapCabangMap = {};
let lapShowCabang = false;
let lapPage = 1;
let lapPageSize = 20;

// resolveWaveLabel() & hasOrderAnomaly() sekarang di js/utils.js (dipakai
// bersama oleh Daftar Pesanan, Laporan, Dashboard).

let lapProfile = null;

function defaultLapDari() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

// Ambil pesanan sesuai rentang tanggal yang dipilih (default: 30 hari
// terakhir) langsung lewat query Firestore -- bukan baca SELURUH koleksi
// "orders" lalu disaring di browser seperti sebelumnya. Kalau butuh data
// yang lebih lama, tinggal ubah tanggalnya lalu klik "Terapkan Filter".
async function loadLaporanOrders() {
  const profile = lapProfile;
  if (!profile) return;
  const dari = document.getElementById("lap-dari").value;
  const sampai = document.getElementById("lap-sampai").value;

  let ordersQuery = db.collection("orders");
  if (!lapShowCabang && profile.cabang_id) {
    ordersQuery = ordersQuery.where("cabang_id", "==", profile.cabang_id);
  }
  if (dari) ordersQuery = ordersQuery.where("tanggal", ">=", new Date(dari + "T00:00:00"));
  if (sampai) ordersQuery = ordersQuery.where("tanggal", "<=", new Date(sampai + "T23:59:59"));
  ordersQuery = ordersQuery.orderBy("tanggal", "desc");

  const orderSnap = await ordersQuery.get();
  lapOrders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

window.onAuthReady = async function (profile) {
  try {
    lapProfile = profile;
    lapShowCabang = canAccessAllBranches(profile);

    document.getElementById("lap-dari").value = defaultLapDari();
    document.getElementById("lap-sampai").value = new Date().toISOString().slice(0, 10);

    const [prodSnap, cabangSnap, tokoDoc] = await Promise.all([
      db.collection("products").orderBy("nama").get(),
      db.collection("cabang").orderBy("nama").get(),
      db.collection("config").doc("toko").get(),
    ]);
    if (tokoDoc.exists) lapToko = tokoDoc.data();

    cabangSnap.docs.forEach((d) => {
      lapCabangMap[d.id] = { id: d.id, ...d.data() };
    });

    if (lapShowCabang) {
      document.getElementById("lap-cabang-field").style.display = "";
      const cabangSelect = document.getElementById("lap-cabang");
      Object.values(lapCabangMap).forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.nama;
        cabangSelect.appendChild(opt);
      });
      cabangSelect.addEventListener("change", applyReportFilter);
    }

    const select = document.getElementById("lap-produk");
    prodSnap.docs.forEach((d) => {
      const p = { id: d.id, ...d.data() };
      lapProductsMap[p.id] = p;
      const opt = document.createElement("option");
      opt.value = p.nama;
      opt.textContent = p.nama;
      select.appendChild(opt);
    });

    await applyReportFilter();
    document.getElementById("lap-pagesize").addEventListener("change", (e) => {
      lapPageSize = Number(e.target.value) || 20;
      lapPage = 1;
      renderReport();
    });

    // "Alat Lanjutan" (cek nomor nota bentrok, rapikan nama/alamat lama)
    // cuma relevan untuk Owner -- keduanya mengubah field yang Firestore
    // Rules kunci khusus Owner (nama_pembeli/alamat/nota_seq bukan termasuk
    // field yang boleh disentuh Admin Kasir/Karyawan), jadi disembunyikan
    // total dari role lain daripada menampilkan tombol yang pasti gagal.
    if (profile.role === "owner") {
      document.getElementById("nota-check-toggle-wrap").style.display = "block";
    }
    // Catatan: pengecekan nomor nota bentrok TIDAK dijalankan otomatis di
    // sini lagi -- itu butuh baca seluruh riwayat pesanan (bukan cuma
    // rentang tanggal di atas), jadi sekarang jadi tombol manual terpisah
    // ("Cek Nomor Nota Bentrok (Riwayat Penuh)") supaya tidak membaca ulang
    // seluruh koleksi orders tiap kali halaman ini dibuka.
  } catch (err) {
    document.getElementById("laporan-table").innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
};

function cabangNamaLap(cabangId) {
  return cabangId && lapCabangMap[cabangId] ? lapCabangMap[cabangId].nama : "-";
}

// Pesanan lama (dibuat sebelum fitur nomor nota per-tahun ada) belum punya
// nota_seq -> formatOrderNo() jatuh ke fallback pakai order_no, yang bisa
// KEBETULAN sama dengan nota_seq pesanan baru (sama-sama mulai dari 1).
// Fungsi ini cuma mendeteksi & menampilkan tombol perbaikan -- tidak
// mengubah apa pun sampai Owner klik tombolnya.
let legacyNotaCache = [];

// Ini SENGAJA baca seluruh riwayat pesanan (bukan cuma rentang tanggal yang
// sedang difilter di laporan) karena tujuannya memang mencari pesanan lama
// yang belum punya nota_seq -- kapan pun itu terjadi. Karena itu dibuatkan
// tombol manual terpisah, bukan dijalankan otomatis tiap halaman dibuka.
function toggleNotaCheckTools() {
  const box = document.getElementById("nota-check-tools");
  box.style.display = box.style.display === "none" ? "block" : "none";
}

// Cari pesanan lama yang Nama/Alamat-nya belum sesuai format baru (Nama
// HURUF KAPITAL, Alamat Kapital Tiap Kata) -- dibaca dari SELURUH riwayat
// (bukan cuma rentang tanggal aktif), sama seperti pengecekan nomor nota.
let legacyNamaAlamatCache = [];
async function checkNamaAlamatFormat() {
  const profile = lapProfile;
  if (!profile) return;
  showToast("Memeriksa seluruh riwayat pesanan...", "success");
  try {
    let q = db.collection("orders");
    if (!lapShowCabang && profile.cabang_id) {
      q = q.where("cabang_id", "==", profile.cabang_id);
    }
    const snap = await q.get();
    legacyNamaAlamatCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter(
        (o) =>
          (o.nama_pembeli && o.nama_pembeli !== formatNamaPembeli(o.nama_pembeli)) ||
          (o.alamat && o.alamat !== formatAlamat(o.alamat))
      );

    if (legacyNamaAlamatCache.length === 0) {
      showToast("Semua Nama & Alamat sudah rapi, tidak ada yang perlu diperbaiki.", "success");
      return;
    }
    const card = document.getElementById("fix-nama-alamat-card");
    document.getElementById("fix-nama-alamat-desc").textContent =
      `Ditemukan ${legacyNamaAlamatCache.length} pesanan lama yang Nama/Alamat-nya belum rapi (Nama belum HURUF KAPITAL, atau Alamat belum Kapital Tiap Kata). Klik tombol di bawah untuk merapikannya sekaligus.`;
    card.style.display = "block";
  } catch (err) {
    showToast("Gagal memeriksa riwayat: " + friendlyFirebaseError(err), "error");
  }
}

async function fixNamaAlamatFormat() {
  const legacy = legacyNamaAlamatCache;
  if (legacy.length === 0) {
    showToast("Tidak ada Nama/Alamat yang perlu dirapikan.", "success");
    return;
  }
  if (!(await showConfirmModal(`Merapikan Nama & Alamat di ${legacy.length} pesanan lama. Lanjutkan?`))) return;

  const btn = document.getElementById("fix-nama-alamat-btn");
  btn.disabled = true;
  // Ditulis lewat batch (bukan satu-satu seperti perbaikan nomor nota)
  // karena di sini TIDAK ada counter yang perlu ditransaksikan berurutan --
  // tiap pesanan independen, jadi lebih cepat digabung dalam beberapa batch.
  const CHUNK_SIZE = 400; // batas aman jauh di bawah limit 500 tulisan/batch Firestore
  let fixed = 0;
  try {
    for (let i = 0; i < legacy.length; i += CHUNK_SIZE) {
      const chunk = legacy.slice(i, i + CHUNK_SIZE);
      const batch = db.batch();
      chunk.forEach((order) => {
        const newNama = formatNamaPembeli(order.nama_pembeli);
        const newAlamat = order.alamat ? formatAlamat(order.alamat) : order.alamat;
        batch.update(db.collection("orders").doc(order.id), {
          nama_pembeli: newNama,
          alamat: newAlamat,
        });
        order.nama_pembeli = newNama;
        order.alamat = newAlamat;
      });
      await batch.commit();
      fixed += chunk.length;
    }
    showToast(`${fixed} pesanan berhasil dirapikan Nama/Alamat-nya.`, "success");
    document.getElementById("fix-nama-alamat-card").style.display = "none";
    await applyReportFilter();
  } catch (err) {
    showToast(`Berhenti di tengah jalan (${fixed}/${legacy.length} selesai): ${friendlyFirebaseError(err)}`, "error");
  } finally {
    btn.disabled = false;
  }
}

async function checkDuplicateNotaNumbers() {
  const profile = lapProfile;
  if (!profile) return;
  showToast("Memeriksa seluruh riwayat pesanan...", "success");
  try {
    let q = db.collection("orders");
    if (!lapShowCabang && profile.cabang_id) {
      q = q.where("cabang_id", "==", profile.cabang_id);
    }
    const snap = await q.get();
    legacyNotaCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((o) => !o.nota_seq || !o.nota_tahun);

    if (legacyNotaCache.length === 0) {
      showToast("Tidak ditemukan pesanan lama dengan nomor nota bentrok.", "success");
      return;
    }
    const card = document.getElementById("fix-nota-card");
    document.getElementById("fix-nota-desc").textContent =
      `Ditemukan ${legacyNotaCache.length} pesanan lama yang masih pakai cara penomoran nota yang lama, sehingga nomornya bisa sama dengan pesanan baru. Klik tombol di bawah untuk menomori ulang pesanan-pesanan lama itu (sekali jalan, aman diulang kapan saja).`;
    card.style.display = "block";
  } catch (err) {
    showToast("Gagal memeriksa riwayat: " + friendlyFirebaseError(err), "error");
  }
}

// Beri nota_tahun/nota_seq yang BENAR (lanjut dari nomor counter yang
// sedang berjalan, bukan menimpa nomor yang sudah dipakai pesanan baru)
// ke pesanan-pesanan lama yang belum punya nota_seq, satu per satu supaya
// tidak tabrakan sesama proses ini sendiri. Diurutkan dari yang paling lama
// dulu supaya nomor barunya tetap terasa kronologis.
async function fixDuplicateNotaNumbers() {
  const legacy = legacyNotaCache.slice().sort((a, b) => {
    const da = a.tanggal && a.tanggal.toDate ? a.tanggal.toDate() : new Date(a.tanggal || 0);
    const db_ = b.tanggal && b.tanggal.toDate ? b.tanggal.toDate() : new Date(b.tanggal || 0);
    return da - db_;
  });
  if (legacy.length === 0) {
    showToast("Tidak ada nomor nota yang perlu diperbaiki.", "success");
    return;
  }
  if (!(await showConfirmModal(`Menomori ulang ${legacy.length} pesanan lama supaya tidak bentrok lagi dengan pesanan baru. Lanjutkan?`))) return;

  const btn = document.getElementById("fix-nota-btn");
  btn.disabled = true;
  let fixed = 0;
  for (const order of legacy) {
    try {
      const year = order.tanggal
        ? (order.tanggal.toDate ? order.tanggal.toDate() : new Date(order.tanggal)).getFullYear()
        : new Date().getFullYear();
      const ids = await getNextNotaSeq(year);
      await db.collection("orders").doc(order.id).update({
        nota_tahun: ids.nota_tahun,
        nota_seq: ids.nota_seq,
      });
      order.nota_tahun = ids.nota_tahun;
      order.nota_seq = ids.nota_seq;
      fixed++;
    } catch (err) {
      showToast(`Berhenti di tengah jalan (${fixed}/${legacy.length} selesai): ${friendlyFirebaseError(err)}`, "error");
      btn.disabled = false;
      return;
    }
  }
  showToast(`${fixed} nomor nota berhasil diperbaiki.`, "success");
  document.getElementById("fix-nota-card").style.display = "none";
  await applyReportFilter();
}

async function applyReportFilter() {
  lapPage = 1;
  const container = document.getElementById("laporan-table");
  const prevHtml = container ? container.innerHTML : "";
  try {
    if (container) container.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
    // Tanggal "Dari"/"Sampai" menentukan query ke server (lihat loadLaporanOrders),
    // jadi setiap klik "Terapkan Filter" perlu baca ulang dari Firestore --
    // bukan cuma menyaring data yang sudah ada di memori seperti sebelumnya.
    await loadLaporanOrders();
  } catch (err) {
    if (container) container.innerHTML = prevHtml;
    showToast("Gagal memuat laporan: " + friendlyFirebaseError(err), "error");
    return;
  }

  const produk = document.getElementById("lap-produk").value;
  const cabangEl = document.getElementById("lap-cabang");
  const cabangId = cabangEl ? cabangEl.value : "";

  lapFiltered = lapOrders.filter((o) => {
    if (produk && !(o.items || []).some((it) => it.product_name === produk)) return false;
    if (cabangId && o.cabang_id !== cabangId) return false;
    return true;
  });

  renderReport();
}

function renderReport() {
  const totalUang = lapFiltered.reduce((s, o) => s + o.total, 0);
  const totalTerbayar = lapFiltered.reduce((s, o) => s + (o.paid_amount || 0), 0);
  const totalKekurangan = totalUang - totalTerbayar;
  const totalUnitProduk = lapFiltered.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, it) => s + (Number(it.jumlah) || 0), 0),
    0
  );
  const jumlahJanggal = lapFiltered.filter((o) => hasOrderAnomaly(o, lapProductsMap)).length;

  document.getElementById("laporan-summary").innerHTML = `
    <div class="grid grid-4">
      <div class="stat-card"><div class="stat-label">Jumlah Pesanan</div><div class="stat-value">${lapFiltered.length}</div></div>
      <div class="stat-card"><div class="stat-label">Jumlah Produk Dipesan (Unit)</div><div class="stat-value">${totalUnitProduk}</div></div>
      <div class="stat-card brand"><div class="stat-label">Total Uang</div><div class="stat-value" style="font-size:16px;">${formatRupiah(totalUang)}</div></div>
      <div class="stat-card brand"><div class="stat-label">Sudah Bayar / Kekurangan</div><div class="stat-value" style="font-size:15px; color:#fff;">${formatRupiah(totalTerbayar)} <span style="color:var(--brand-100); font-weight:600;">/</span> <span style="color:#fecaca;">${formatRupiah(totalKekurangan)}</span></div></div>
    </div>
    ${
      jumlahJanggal > 0
        ? `<div class="alert alert-error" style="margin-top:12px;">⚠️ ${jumlahJanggal} pesanan dalam rentang ini punya harga yang berbeda dari harga gelombang yang berlaku sekarang — cek kolom "Cek Harga" di tabel, lalu bandingkan manual ke Detail Pesanan kalau perlu.</div>`
        : ""
    }`;

  const totalPages = Math.max(1, Math.ceil(lapFiltered.length / lapPageSize));
  if (lapPage > totalPages) lapPage = totalPages;
  if (lapPage < 1) lapPage = 1;
  const startIdx = (lapPage - 1) * lapPageSize;
  const pageList = lapFiltered.slice(startIdx, startIdx + lapPageSize);

  const rows = pageList
    .map((o, idx) => {
      const items = o.items || [];
      const janggal = hasOrderAnomaly(o, lapProductsMap);
      const belumLunas = o.status_bayar !== "lunas";

      const produkCell = items
        .map(
          (it) => `
        <div class="order-item-line">
          <div class="item-produk">${escapeHtml(it.product_name)} <span style="color:var(--gray-400); font-weight:500;">x${it.jumlah}</span></div>
          <div class="item-gelombang">${escapeHtml(resolveWaveLabel(it, lapProductsMap))}</div>
        </div>`
        )
        .join("");

      const totalQty = items.reduce((s, it) => s + (Number(it.jumlah) || 0), 0);
      const kekurangan = o.total - (o.paid_amount || 0);

      return `
    <tr>
      <td style="text-align:center; color:var(--gray-400); font-size:12.5px;">${startIdx + idx + 1}</td>
      <td>
        <div style="font-weight:700; color:var(--gray-900);">${formatOrderNo(o)} ${janggal ? '<span title="Harga di pesanan ini berbeda dari harga gelombang yang berlaku sekarang" style="color:var(--red-600);">⚠️</span>' : ""}</div>
        <div style="font-size:11.5px; color:var(--gray-400); margin-top:1px;">${formatTanggal(o.tanggal)}</div>
      </td>
      ${lapShowCabang ? `<td>${escapeHtml(cabangNamaLap(o.cabang_id))}</td>` : ""}
      <td>
        <div style="font-weight:600;">${escapeHtml(o.nama_pembeli)}</div>
        <div style="font-size:11.5px; color:var(--gray-400); margin-top:1px;">${escapeHtml(o.no_hp || "-")}</div>
        ${o.alamat ? `<div style="font-size:11.5px; color:var(--gray-400);">${escapeHtml(o.alamat)}</div>` : ""}
      </td>
      <td style="min-width:170px;">${produkCell}</td>
      <td style="text-align:center;">${totalQty}</td>
      <td style="text-align:right; font-weight:700; color:var(--gray-900);">${formatRupiah(o.total)}</td>
      <td style="text-align:right;">${formatRupiah(o.paid_amount || 0)}</td>
      <td style="text-align:right; ${belumLunas ? "color:var(--red-600); font-weight:600;" : ""}">${formatRupiah(kekurangan)}</td>
      <td><span class="badge ${STATUS_BAYAR_BADGE[o.status_bayar]}">${STATUS_BAYAR_LABEL[o.status_bayar].toUpperCase()}</span></td>
      <td><span class="badge ${o.is_diambil ? "badge-green" : "badge-gray"}">${o.is_diambil ? "SUDAH" : "BELUM"}</span></td>
      <td>${janggal ? '<span class="badge badge-red">⚠️ JANGGAL</span>' : '<span class="badge badge-gray">OK</span>'}</td>
    </tr>`;
    })
    .join("");

  document.getElementById("laporan-table").innerHTML = `
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>No</th>
              <th>Nota / Tanggal</th>
              ${lapShowCabang ? "<th>Cabang</th>" : ""}
              <th>Pemesan</th>
              <th>Produk & Gelombang</th>
              <th>Qty</th>
              <th style="text-align:right;">Total</th>
              <th style="text-align:right;">Dibayar</th>
              <th style="text-align:right;">Kekurangan</th>
              <th>Status Bayar</th>
              <th>Pengambilan</th>
              <th>Cek Harga</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="${lapShowCabang ? 12 : 11}" style="text-align:center; color:var(--gray-400);">Tidak ada data</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    ${renderPaginationControls(lapPage, lapPageSize, lapFiltered.length, "goToLapPage")}`;
}

function goToLapPage(page) {
  lapPage = page;
  renderReport();
  document.getElementById("laporan-table").scrollIntoView({ behavior: "smooth", block: "start" });
}

function exportExcel() {
  if (lapFiltered.length === 0) {
    showToast("Tidak ada data untuk diekspor.", "error");
    return;
  }
  const data = [];
  lapFiltered.forEach((o) => {
    const items = o.items && o.items.length ? o.items : [null];
    items.forEach((it) => {
      const row = {
        "No Pesanan": formatOrderNo(o),
        Tanggal: formatTanggal(o.tanggal),
      };
      if (lapShowCabang) row.Cabang = cabangNamaLap(o.cabang_id);
      Object.assign(row, {
        Nama: o.nama_pembeli,
        "No HP": o.no_hp || "",
        Alamat: o.alamat || "",
        Produk: it ? it.product_name : "-",
        Gelombang: it ? resolveWaveLabel(it, lapProductsMap) : "-",
        Qty: it ? it.jumlah : "",
        "Harga Satuan": it ? it.harga_satuan : "",
        Subtotal: it ? it.subtotal : "",
        "Total Pesanan": o.total,
        Dibayar: o.paid_amount || 0,
        Kekurangan: o.total - (o.paid_amount || 0),
        "Status Bayar": STATUS_BAYAR_LABEL[o.status_bayar],
        Pengambilan: o.is_diambil ? "Sudah" : "Belum",
        "Cek Harga": hasOrderAnomaly(o, lapProductsMap) ? "JANGGAL" : "OK",
        Catatan: o.catatan || "",
      });
      data.push(row);
    });
  });
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Pesanan");
  XLSX.writeFile(wb, `laporan-pesanan-${todayInputValue()}.xlsx`);
}

function exportPdf() {
  if (lapFiltered.length === 0) {
    showToast("Tidak ada data untuk diekspor.", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(lapToko.nama || "Toko Benih", 14, 15);
  doc.setFontSize(10);
  doc.text(`Laporan Pesanan - dicetak ${formatTanggal(new Date())}`, 14, 21);

  const body = lapFiltered.map((o, idx) => {
    const row = [idx + 1, `${formatOrderNo(o)}\n${formatTanggal(o.tanggal)}`];
    if (lapShowCabang) row.push(cabangNamaLap(o.cabang_id));
    row.push(
      `${o.nama_pembeli}\n${o.no_hp || "-"}${o.alamat ? "\n" + o.alamat : ""}`,
      (o.items || []).map((it) => `${it.product_name} x${it.jumlah}`).join("\n"),
      (o.items || []).map((it) => resolveWaveLabel(it, lapProductsMap)).join("\n"),
      (o.items || []).reduce((s, it) => s + (Number(it.jumlah) || 0), 0),
      formatRupiah(o.total),
      formatRupiah(o.paid_amount || 0),
      formatRupiah(o.total - (o.paid_amount || 0)),
      STATUS_BAYAR_LABEL[o.status_bayar],
      o.is_diambil ? "Sudah" : "Belum"
    );
    return row;
  });

  const head = ["No", "Nota / Tanggal"];
  if (lapShowCabang) head.push("Cabang");
  head.push("Pemesan", "Produk", "Gelombang", "Qty", "Total", "Dibayar", "Kekurangan", "Status Bayar", "Pengambilan");

  doc.autoTable({
    startY: 27,
    head: [head],
    body,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [22, 163, 74] },
  });

  doc.save(`laporan-pesanan-${todayInputValue()}.pdf`);
}

// ---------- Alat Lanjutan: Hitung Ulang Rekap Produk per Cabang ----------
// Rekap /stats/produk_cabang (dipakai Dashboard Karyawan untuk tabel "Detail
// Total per Produk per Cabang", lihat js/utils.js:adjustProdukCabangStats)
// hanya ke-update otomatis untuk pesanan yang dibuat/diubah/dihapus SETELAH
// fitur ini dipasang. Pesanan-pesanan lama yang sudah ada sebelumnya tidak
// pernah ikut terhitung. Alat ini membaca ULANG seluruh riwayat pesanan dari
// awal dan menulis ulang total yang benar -- aman dijalankan berkali-kali
// kapan saja (bukan menambah, tapi mengganti total dengan hitungan yang
// baru dihitung ulang dari nol).
async function rebuildProdukCabangStats() {
  const profile = lapProfile;
  if (!profile || profile.role !== "owner") return;

  const lanjut = await showConfirmModal(
    "Ini akan membaca ULANG seluruh riwayat pesanan (bisa makan waktu beberapa detik kalau datanya sudah banyak) lalu menghitung ulang total per produk per cabang dari nol. Aman dijalankan kapan saja, tidak mengubah data pesanan itu sendiri. Lanjutkan?",
    { okLabel: "Ya, Hitung Ulang" }
  );
  if (!lanjut) return;

  showToast("Menghitung ulang dari seluruh riwayat pesanan...", "success");
  try {
    const snap = await db.collection("orders").get();
    const rebuilt = {}; // { [productId]: { [cabangId]: qty } }
    let totalItemDihitung = 0;

    snap.docs.forEach((d) => {
      const order = d.data();
      const cabangKey = order.cabang_id || "__tanpa_cabang__";
      (order.items || []).forEach((it) => {
        if (!it.product_id) return;
        const qty = Number(it.jumlah) || 0;
        if (!rebuilt[it.product_id]) rebuilt[it.product_id] = {};
        rebuilt[it.product_id][cabangKey] = (rebuilt[it.product_id][cabangKey] || 0) + qty;
        totalItemDihitung++;
      });
    });

    // Pakai .set() TANPA merge -- ini penghitungan ulang total dari nol,
    // jadi dokumen rekap lama (kalau ada sisa data yang salah/parsial)
    // sengaja ditimpa habis, bukan digabung.
    await db.collection("stats").doc("produk_cabang").set(rebuilt);

    showToast(
      `Selesai! Rekap dihitung ulang dari ${snap.docs.length} pesanan (${totalItemDihitung} baris produk).`,
      "success"
    );
  } catch (err) {
    showToast("Gagal menghitung ulang rekap: " + friendlyFirebaseError(err), "error");
  }
}
