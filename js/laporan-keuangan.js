// Laporan Keuangan -- 3 tab: Buku Kas, Laba Rugi, Piutang. Terpusat (tidak
// dipecah per cabang, sesuai keputusan Owner), khusus Owner & Admin Kasir
// (lihat data-allowed-roles di laporan-keuangan.html).
//
// CATATAN PENTING soal Laba Rugi: HPP (harga modal) cuma tersimpan di
// pesanan yang dibuat/diedit SETELAH field "Harga Modal" diisi di halaman
// Produk (lihat js/input-pesanan.js -- disimpan sebagai snapshot per item,
// field harga_modal). Pesanan LAMA yang belum pernah tersentuh sejak fitur
// ini ada belum punya harga_modal di items-nya -> dianggap HPP=0 di sini,
// jadi Laba Kotor untuk periode yang masih banyak pesanan lama BISA tampil
// lebih besar dari kenyataan. Ini keterbatasan yang disadari (data historis
// harga modal memang tidak pernah dicatat sebelumnya), bukan bug.

let lkTab = "kas";
let lkOrders = [];
let lkExpenses = [];
let lkPayments = [];
let lkProfile = null;
// Piutang & Hutang = posisi SAAT INI (semua yang belum lunas, tanpa peduli tanggal
// pesanan/pengeluarannya) -- sengaja TERPISAH dari lkOrders/lkExpenses yang
// dibatasi filter Dari/Sampai, supaya piutang & hutang bulan lalu tidak "hilang"
// cuma karena rentang tanggal diganti. Dimuat malas (lazy) saat tab dibuka.
let lkPiutangData = null; // { orders: [...], expenses: [...] }
// Riwayat pembayaran PENGELUARAN (subcollection pengeluaran/{id}/pembayaran) --
// dasar kas KELUAR yang benar (per tanggal bayar, bukan per tanggal pengeluaran).
let lkPembayaran = [];
let lkPembayaranError = null; // kalau query gagal (mis. index/rules belum di-deploy): Kas Keluar tidak lengkap -> ditampilkan sebagai peringatan di Buku Kas
// Riwayat arsip yang SUDAH dihapus dari database -> peringatan "data periode ini tidak lengkap".
let lkArsipDihapus = []; // [{ dari, sampai, nama }]
let lkToko = { nama: "Toko Benih" };

function defaultLkDari() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localYmd(d);
}

window.onAuthReady = async function (profile) {
  lkProfile = profile;
  document.getElementById("lk-dari").value = defaultLkDari();
  document.getElementById("lk-sampai").value = localYmd(new Date());
  // Nama toko buat kop Export Excel/PDF -- kalau gagal dimuat (jarang),
  // diamkan & pakai fallback "Toko Benih" seperti di Laporan biasa, tidak
  // sampai menghalangi halaman ini dipakai.
  try {
    const tokoDoc = await db.collection("config").doc("toko").get();
    if (tokoDoc.exists) lkToko = tokoDoc.data();
  } catch (e) {}
  await applyLkFilter();
};

function switchLkTab(tab) {
  lkTab = tab;
  ["kas", "labarugi", "piutang", "tren"].forEach((t) => {
    const btn = document.getElementById("lk-tab-" + t);
    btn.className = t === tab ? "btn-primary" : "btn-secondary";
  });
  renderLkContent();
}

async function applyLkFilter() {
  const dari = document.getElementById("lk-dari").value;
  const sampai = document.getElementById("lk-sampai").value;
  document.getElementById("lk-content").innerHTML = skeletonRows(6);

  try {
    const dariDate = dari ? new Date(dari + "T00:00:00") : null;
    const sampaiDate = sampai ? new Date(sampai + "T23:59:59") : null;

    let ordersQuery = db.collection("orders");
    if (dariDate) ordersQuery = ordersQuery.where("tanggal", ">=", dariDate);
    if (sampaiDate) ordersQuery = ordersQuery.where("tanggal", "<=", sampaiDate);
    ordersQuery = ordersQuery.orderBy("tanggal", "desc");

    let expenseQuery = db.collection("pengeluaran");
    if (dariDate) expenseQuery = expenseQuery.where("tanggal", ">=", dariDate);
    if (sampaiDate) expenseQuery = expenseQuery.where("tanggal", "<=", sampaiDate);
    expenseQuery = expenseQuery.orderBy("tanggal", "desc");

    // Buku Kas butuh tanggal PEMBAYARAN sebenarnya (kapan uang benar-benar
    // masuk), BUKAN tanggal pesanan dibuat -- makanya baca langsung dari
    // subcollection payments di SEMUA pesanan lewat collectionGroup(), bukan
    // dari field "tanggal"/"total"/"paid_amount" di dokumen orders. Butuh
    // index Collection Group untuk field "tanggal" di koleksi "payments"
    // (lihat firestore.indexes.json) -- kalau belum ke-deploy, query ini akan
    // gagal dengan pesan error berisi link untuk membuat index-nya otomatis.
    let paymentsQuery = db.collectionGroup("payments");
    if (dariDate) paymentsQuery = paymentsQuery.where("tanggal", ">=", dariDate);
    if (sampaiDate) paymentsQuery = paymentsQuery.where("tanggal", "<=", sampaiDate);
    paymentsQuery = paymentsQuery.orderBy("tanggal", "asc");

    let orderSnap, expenseSnap, paymentSnap;
    try {
      orderSnap = await ordersQuery.get();
    } catch (err) {
      throw new Error("Gagal memuat data Pesanan (orders): " + friendlyFirebaseError(err));
    }
    try {
      expenseSnap = await expenseQuery.get();
    } catch (err) {
      throw new Error("Gagal memuat data Pengeluaran: " + friendlyFirebaseError(err));
    }
    try {
      paymentSnap = await paymentsQuery.get();
    } catch (err) {
      throw new Error("Gagal memuat riwayat Pembayaran (untuk Buku Kas): " + friendlyFirebaseError(err));
    }
    // Riwayat pembayaran pengeluaran (cicilan/pelunasan hutang, per tanggal bayar).
    // Kalau gagal (mis. rules/index baru belum di-deploy), JANGAN gagalkan seluruh
    // halaman -- tab lain tetap bisa dipakai; Buku Kas yang menampilkan peringatan.
    let pembayaranSnap = null;
    lkPembayaranError = null;
    try {
      let pq = db.collectionGroup("pembayaran");
      if (dariDate) pq = pq.where("tanggal", ">=", dariDate);
      if (sampaiDate) pq = pq.where("tanggal", "<=", sampaiDate);
      pembayaranSnap = await pq.orderBy("tanggal", "asc").get();
    } catch (err) {
      lkPembayaranError = friendlyFirebaseError(err);
    }
    lkPembayaran = pembayaranSnap ? pembayaranSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
    await loadLkArsipDihapus();
    lkOrders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lkExpenses = expenseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lkPayments = paymentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lkPiutangData = null; // "Terapkan Filter" juga menyegarkan tab Piutang & Hutang (dimuat ulang saat tab dibuka)

    switchLkTab(lkTab);
  } catch (err) {
    document.getElementById("lk-content").innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function renderLkContent() {
  if (lkTab === "kas") renderLkKas();
  else if (lkTab === "labarugi") renderLkLabaRugi();
  else if (lkTab === "piutang") renderLkPiutang();
  else renderLkTren();
}

// Arsip yang SUDAH dihapus dari database (status "sudah_dihapus") -- pesanan &
// pembayarannya sudah tidak ada, sementara pengeluaran tetap ada, jadi laporan
// periode itu bisa tampak jauh lebih kecil/rugi. Rentang tanggal arsip dibaca dari
// field rentang_dari/rentang_sampai (arsip baru) atau dari nama file backup
// (arsip lama: "arsip-po_YYYY-MM-DD_sd_YYYY-MM-DD_...json"). Tidak pernah melempar
// error -- kalau gagal dibaca, banner peringatan saja yang tidak muncul.
async function loadLkArsipDihapus() {
  try {
    const snap = await db.collection("arsip_log").where("status", "==", "sudah_dihapus").get();
    lkArsipDihapus = snap.docs
      .map((d) => {
        const x = d.data();
        let dari = x.rentang_dari;
        let sampai = x.rentang_sampai;
        if (!dari || !sampai) {
          const m = String(x.nama_file || "").match(/(\d{4}-\d{2}-\d{2})_sd_(\d{4}-\d{2}-\d{2})/);
          if (m) {
            dari = m[1];
            sampai = m[2];
          }
        }
        return dari && sampai ? { dari, sampai, nama: x.nama_file } : null;
      })
      .filter(Boolean);
  } catch (e) {
    lkArsipDihapus = [];
  }
}
function lkArsipBanner(dari, sampai) {
  const hit = lkArsipDihapus.filter((a) => (!sampai || a.dari <= sampai) && (!dari || a.sampai >= dari));
  if (hit.length === 0) return "";
  const rentang = hit.map((a) => `${a.dari} s/d ${a.sampai}`).join(", ");
  return `<div class="alert alert-error" style="margin-bottom:16px;"><i class="ph-bold ph-warning"></i> Rentang ini mencakup pesanan yang sudah <strong>diarsipkan &amp; dihapus dari database</strong> (${rentang}). Omzet, kas masuk, dan piutang periode itu bisa tidak lengkap, sementara pengeluaran tetap tercatat -- jadi laba bisa tampak jauh lebih kecil atau rugi. Restore file backup di halaman Arsip PO kalau butuh angka lengkap.</div>`;
}
function lkArsipBannerFilter() {
  return lkArsipBanner(document.getElementById("lk-dari").value, document.getElementById("lk-sampai").value);
}

// KAS KELUAR: dihitung per TANGGAL PEMBAYARAN. Pengeluaran yang punya riwayat
// pembayaran (riwayat_bayar = true) diambil dari subcollection pembayaran-nya
// (jadi cicilan/pelunasan hutang jatuh di bulan bayarnya, bukan di bulan
// pengeluaran dicatat). Pengeluaran LAMA (sebelum ada riwayat bayar) tetap
// dihitung seperti dulu: bagian yang sudah dibayar (paid_amount) di tanggal
// pengeluarannya.
function lkKasKeluarItems() {
  const lama = lkExpenses
    .filter((e) => !e.riwayat_bayar)
    .map((e) => ({ tanggal: e.tanggal, keluar: pengKasKeluar(e), ket: `${e.kategori} -- ${e.keterangan || ""}` }));
  const berRiwayat = lkPembayaran.map((p) => ({
    tanggal: p.tanggal,
    keluar: Number(p.jumlah) || 0,
    ket: `${p.kategori || "Pengeluaran"} -- ${p.keterangan || ""}${p.awal ? "" : " (bayar hutang)"}`,
  }));
  return [...lama, ...berRiwayat];
}
function lkTimeline() {
  return [
    ...lkPayments.map((p) => ({ tanggal: p.tanggal, masuk: p.jumlah, keluar: 0, ket: p.catatan || "Pembayaran pesanan" })),
    ...lkKasKeluarItems().map((k) => ({ tanggal: k.tanggal, masuk: 0, keluar: k.keluar, ket: k.ket })),
  ].sort((a, b) => toDateObj(a.tanggal) - toDateObj(b.tanggal));
}

// FITUR HUTANG USAHA: dipakai bersama oleh renderLkKas() & kedua fungsi
// export -- lihat catatan lengkap di renderLkKas() soal kenapa yang
// dihitung sebagai kas keluar cuma bagian yang SUDAH dibayar, bukan jumlah
// penuh pengeluaran.
function pengKasKeluar(e) {
  return e.paid_amount !== undefined ? e.paid_amount : e.jumlah;
}

// ---------- Tab Buku Kas ----------
function renderLkKas() {
  // Gabungkan kas masuk (payments) & kas keluar (pengeluaran) jadi satu
  // linimasa terurut tanggal, lalu hitung saldo berjalan MULAI DARI 0
  // (bukan saldo awal riil toko -- sesuai keputusan Owner: belum perlu
  // input saldo awal, jadi angka "Saldo" di sini artinya "arus kas bersih
  // sejak tanggal Dari", bukan saldo kas fisik toko saat ini).
  //
  // PERBAIKAN (fitur Hutang Usaha): Buku Kas ini basisnya KAS (cash basis)
  // -- cuma uang yang BENAR-BENAR keluar dari kas yang dihitung. Kalau
  // sebuah pengeluaran masih ada Hutang Usaha (belum lunas dibayar), yang
  // jadi kas keluar cuma bagian yang SUDAH dibayar (paid_amount), BUKAN
  // jumlah penuhnya -- beda dengan tab Laba Rugi yang basisnya AKRUAL
  // (jumlah penuh tetap dihitung sebagai biaya begitu terjadi, terlepas
  // sudah dibayar tunai atau belum -- itu memang sengaja tidak diubah).
  // Dokumen /pengeluaran lama (belum punya paid_amount) dianggap lunas
  // penuh, konsisten dengan catatan yang sama di js/pengeluaran.js.
  const timeline = lkTimeline();

  let saldo = 0;
  const rows = timeline
    .map((t) => {
      saldo += (t.masuk || 0) - (t.keluar || 0);
      return `
    <tr>
      <td style="white-space:nowrap;">${formatTanggal(t.tanggal)}</td>
      <td>${escapeHtml(t.ket)}</td>
      <td style="text-align:right; color:var(--brand-ink); white-space:nowrap;">${t.masuk ? formatRupiah(t.masuk) : "-"}</td>
      <td style="text-align:right; color:var(--red-600); white-space:nowrap;">${t.keluar ? formatRupiah(t.keluar) : "-"}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(saldo)}</td>
    </tr>`;
    })
    .join("");

  const totalMasuk = lkPayments.reduce((s, p) => s + (Number(p.jumlah) || 0), 0);
  const totalKeluar = lkKasKeluarItems().reduce((s, k) => s + (Number(k.keluar) || 0), 0);

  document.getElementById("lk-content").innerHTML = `
    ${lkArsipBannerFilter()}
    ${
      lkPembayaranError
        ? `<div class="alert alert-error" style="margin-bottom:16px;"><i class="ph-bold ph-warning"></i> Riwayat pembayaran pengeluaran gagal dimuat, jadi <strong>Kas Keluar bisa tidak lengkap</strong>: ${lkPembayaranError}</div>`
        : ""
    }
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-arrow-circle-down", "Kas Masuk", formatRupiah(totalMasuk))}
      ${statCard("ph-arrow-circle-up", "Kas Keluar", formatRupiah(totalKeluar))}
      ${statCard("ph-scales", "Arus Kas Bersih", formatRupiah(totalMasuk - totalKeluar), true)}
    </div>
    <p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;"><i class="ph-bold ph-info"></i> "Kas Bersih Berjalan" dihitung mulai dari 0 sejak tanggal "Dari" di atas -- bukan saldo kas fisik toko saat ini, karena belum ada saldo awal yang diinput. "Kas Keluar" cuma menghitung uang yang SUDAH dibayar, pada tanggal pembayarannya (cicilan/pelunasan hutang jatuh di tanggal bayar) -- sisa Hutang Usaha yang belum dibayar tidak ikut dihitung, lihat tab Piutang & Hutang. Pengeluaran lama yang dicatat sebelum ada riwayat bayar dihitung di tanggal pengeluarannya.</p>
    ${
      timeline.length === 0
        ? `<div class="card empty-state">Belum ada arus kas di rentang tanggal ini.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Tanggal</th><th>Keterangan</th><th style="text-align:right;">Kas Masuk</th><th style="text-align:right;">Kas Keluar</th><th style="text-align:right;">Kas Bersih Berjalan</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
    }`;
}

// ---------- Tab Laba Rugi ----------
// Jumlah pesanan di periode ini yang HPP-nya belum lengkap (minimal 1 item belum
// punya harga_modal) -- dipakai tab Laba Rugi & kedua export.
function lkHppIncompleteCount() {
  return lkOrders.filter((o) => (o.items || []).some((it) => it.harga_modal === undefined || it.harga_modal === null)).length;
}

let lkKategoriFilter = ""; // filter kategori pengeluaran khusus tab Laba Rugi (client-side, tidak perlu baca ulang ke Firestore)

function renderLkLabaRugi() {
  const omzet = lkOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const hpp = lkOrders.reduce((s, o) => s + (o.items || []).reduce((si, it) => si + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0), 0);
  const labaKotor = omzet - hpp;

  // PENINGKATAN: hitung berapa PESANAN di periode ini yang HPP-nya belum
  // lengkap (minimal 1 item belum ada harga_modal) -- dulu cuma catatan
  // teks generik di bawah tanpa angka pasti, sekarang ditampilkan sebagai
  // peringatan jelas dengan jumlah persis supaya Owner tidak salah baca
  // "Laba Kotor" sebagai angka final kalau datanya memang belum lengkap.
  const incompleteHppCount = lkHppIncompleteCount();
  const hppBadge = incompleteHppCount > 0 ? ` <span class="badge badge-red" style="margin-left:4px;">Belum final</span>` : "";

  // PENINGKATAN: filter kategori biaya operasional -- opsi dropdown diambil
  // dari kategori yang BENAR-BENAR ada di pengeluaran periode ini (bukan
  // seluruh daftar kategori_pengeluaran yang mungkin tidak semuanya
  // terpakai di periode ini).
  const kategoriTersedia = [...new Set(lkExpenses.map((e) => e.kategori))].sort();
  // Kategori yang dipilih tapi tidak ada lagi di periode ini (mis. setelah ganti
  // rentang tanggal) -> reset, supaya filter tidak aktif diam-diam padahal
  // dropdown sudah menampilkan "Semua Kategori".
  if (lkKategoriFilter && !kategoriTersedia.includes(lkKategoriFilter)) lkKategoriFilter = "";
  const filteredExpenses = lkKategoriFilter ? lkExpenses.filter((e) => e.kategori === lkKategoriFilter) : lkExpenses;

  // Filter kategori CUMA memilih baris rincian biaya yang ditampilkan. Total
  // Biaya Operasional & Laba Bersih SELALU dihitung dari SEMUA kategori, supaya
  // Laba Bersih tidak pernah tampil lebih besar dari yang sebenarnya cuma karena
  // ada filter aktif.
  const biayaPerKategori = {};
  filteredExpenses.forEach((e) => {
    biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0);
  });
  const subtotalTerfilter = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
  const totalBiaya = lkExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
  const labaBersih = labaKotor - totalBiaya;

  const biayaRows = Object.entries(biayaPerKategori)
    .map(([kategori, jumlah]) => `<tr><td>${escapeHtml(kategori)}</td><td style="text-align:right;">${formatRupiah(jumlah)}</td></tr>`)
    .join("");

  document.getElementById("lk-content").innerHTML = `
    ${lkArsipBannerFilter()}
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-trend-up", "Omzet (Penjualan)", formatRupiah(omzet))}
      ${statCard("ph-package", "HPP (Harga Modal)", formatRupiah(hpp))}
      ${statCard("ph-scales", "Laba Bersih" + hppBadge, formatRupiah(labaBersih), true)}
    </div>
    ${
      incompleteHppCount > 0
        ? `<div class="alert alert-error" style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
            <span><i class="ph-bold ph-warning"></i> <strong>${incompleteHppCount} pesanan</strong> di periode ini belum lengkap HPP-nya (minimal 1 item belum ada Harga Modal) -- Laba Kotor & Laba Bersih di atas kemungkinan lebih besar dari yang sebenarnya.</span>
            <a href="laporan.html" class="btn-secondary btn-sm" style="white-space:nowrap;">Isi Ulang HPP <i class="ph-bold ph-arrow-right"></i></a>
          </div>`
        : `<p style="font-size:12px; color:var(--gray-500); margin:0 0 16px;"><i class="ph-bold ph-check-circle" style="color:var(--brand-600);"></i> HPP semua pesanan di periode ini sudah lengkap.</p>`
    }
    <div class="card">
      <h3 style="margin-top:0; font-size:15px;">Ringkasan Laba Rugi</h3>
      <table>
        <tbody>
          <tr><td>Omzet (Total Penjualan)</td><td style="text-align:right;">${formatRupiah(omzet)}</td></tr>
          <tr><td>HPP (Harga Pokok Penjualan)</td><td style="text-align:right;">(${formatRupiah(hpp)})</td></tr>
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Laba Kotor${hppBadge}</td><td style="text-align:right;">${formatRupiah(labaKotor)}</td></tr>
        </tbody>
      </table>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin:18px 0 6px; flex-wrap:wrap;">
        <h4 style="margin:0; font-size:13.5px; color:var(--gray-500);">Biaya Operasional</h4>
        <select id="lk-kategori-filter" style="min-width:auto; font-size:12.5px; padding:6px 10px;" onchange="lkKategoriFilter = this.value; renderLkLabaRugi();">
          <option value="">Semua Kategori</option>
          ${kategoriTersedia.map((k) => `<option value="${escapeHtml(k)}" ${k === lkKategoriFilter ? "selected" : ""}>${escapeHtml(k)}</option>`).join("")}
        </select>
      </div>
      <table>
        <tbody>
          ${biayaRows || `<tr><td colspan="2" style="color:var(--gray-400);">Tidak ada pengeluaran di periode ini${lkKategoriFilter ? " untuk kategori ini" : ""}.</td></tr>`}
          ${lkKategoriFilter ? `<tr style="color:var(--gray-500);"><td>Subtotal kategori "${escapeHtml(lkKategoriFilter)}"</td><td style="text-align:right;">(${formatRupiah(subtotalTerfilter)})</td></tr>` : ""}
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Total Biaya Operasional${lkKategoriFilter ? " (Semua Kategori)" : ""}</td><td style="text-align:right;">(${formatRupiah(totalBiaya)})</td></tr>
        </tbody>
      </table>
      <table style="margin-top:12px;">
        <tbody>
          <tr style="font-weight:800; font-size:15px; border-top:2px solid var(--gray-200);"><td>Laba Bersih${hppBadge}</td><td style="text-align:right; color:${labaBersih >= 0 ? "var(--brand-ink)" : "var(--red-600)"};">${formatRupiah(labaBersih)}</td></tr>
        </tbody>
      </table>
      ${lkKategoriFilter ? `<p style="font-size:11.5px; color:var(--gray-400); margin:8px 0 0;"><i class="ph-bold ph-info"></i> Filter kategori cuma memilih rincian biaya yang ditampilkan. Total Biaya Operasional & Laba Bersih tetap dihitung dari semua kategori.</p>` : ""}
    </div>`;
}

// ---------- Tab Piutang & Hutang ----------
// PENINGKATAN (reminder piutang menunggak): sistem pesanan ini tidak punya
// field "tanggal jatuh tempo" eksplisit per pesanan -- jadi reminder di sini
// pakai pendekatan lebih sederhana: piutang yang UMURNYA (hari sejak
// tanggal pesanan) sudah lewat ambang batas dianggap "menunggak" dan
// disorot. Ambang batas 7 hari dipilih sebagai default yang wajar untuk
// preorder benih (siklusnya relatif cepat) -- gampang diubah lewat
// LK_PIUTANG_MENUNGGAK_HARI di bawah kalau ternyata kurang/kelebihan pas.
const LK_PIUTANG_MENUNGGAK_HARI = 7;

const LK_STATUS_BELUM_LUNAS = ["belum_bayar", "cicilan"];

// Query cuma pakai 1 field (status_bayar, operator "in") tanpa orderBy, jadi TIDAK
// butuh index komposit baru. Dokumen /pengeluaran lama (sebelum fitur Hutang
// Usaha) tidak punya status_bayar sama sekali -- memang dianggap lunas, jadi
// wajar tidak ikut terambil.
async function loadLkPiutangData() {
  let orderSnap, expenseSnap;
  try {
    orderSnap = await db.collection("orders").where("status_bayar", "in", LK_STATUS_BELUM_LUNAS).get();
  } catch (err) {
    throw new Error("Gagal memuat data Piutang: " + friendlyFirebaseError(err));
  }
  try {
    expenseSnap = await db.collection("pengeluaran").where("status_bayar", "in", LK_STATUS_BELUM_LUNAS).get();
  } catch (err) {
    throw new Error("Gagal memuat data Hutang Usaha: " + friendlyFirebaseError(err));
  }
  lkPiutangData = {
    orders: orderSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    expenses: expenseSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// Daftar piutang & hutang yang sudah siap tampil -- dipakai bersama oleh tab
// Piutang & Hutang dan kedua fungsi export supaya angkanya selalu sama.
function lkPiutangLists() {
  if (!lkPiutangData) return null;
  const now = new Date();
  const piutang = lkPiutangData.orders
    .filter((o) => o.status_bayar !== "lunas")
    .map((o) => ({ ...o, umurHari: Math.floor((now - toDateObj(o.tanggal)) / (1000 * 60 * 60 * 24)) }))
    .sort((a, b) => b.umurHari - a.umurHari); // paling lama menunggak di atas
  const hutangList = lkPiutangData.expenses
    .filter((e) => (Number(e.jumlah) || 0) - (Number(pengKasKeluar(e)) || 0) > 0)
    .sort((a, b) => toDateObj(a.tanggal) - toDateObj(b.tanggal)); // hutang paling lama di atas
  return { piutang, hutangList };
}

function renderLkPiutang() {
  const container = document.getElementById("lk-content");
  if (!lkPiutangData) {
    container.innerHTML = skeletonRows(6);
    loadLkPiutangData()
      .then(() => {
        if (lkTab === "piutang") renderLkPiutang(); // render ulang cuma kalau user belum keburu pindah tab lain
      })
      .catch((err) => {
        container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
      });
    return;
  }
  const { piutang, hutangList } = lkPiutangLists();
  const totalPiutang = piutang.reduce((s, o) => s + (o.total - (o.paid_amount || 0)), 0);
  const menunggakCount = piutang.filter((o) => o.umurHari >= LK_PIUTANG_MENUNGGAK_HARI).length;

  const rows = piutang
    .map((o) => {
      const menunggak = o.umurHari >= LK_PIUTANG_MENUNGGAK_HARI;
      return `
    <tr${menunggak ? ' style="background:var(--red-50);"' : ""}>
      <td style="white-space:nowrap;">${formatTanggal(o.tanggal)}</td>
      <td>${escapeHtml(o.nama_pembeli)}${o.no_hp ? `<br><span style="font-size:11.5px; color:var(--gray-500);">${escapeHtml(o.no_hp)}</span>` : ""}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(o.total)}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(o.paid_amount || 0)}</td>
      <td style="text-align:right; white-space:nowrap; font-weight:700;">${formatRupiah(o.total - (o.paid_amount || 0))}</td>
      <td style="text-align:center; white-space:nowrap;">${menunggak ? `<span class="badge badge-red"><i class="ph-bold ph-warning" style="font-size:11px;"></i> ${o.umurHari} hari</span>` : `${o.umurHari} hari`}</td>
      <td><span class="badge ${STATUS_BAYAR_BADGE[o.status_bayar]}">${STATUS_BAYAR_LABEL[o.status_bayar]}</span></td>
    </tr>`;
    })
    .join("");

  // Hutang Usaha: SEMUA pengeluaran yang belum lunas dibayar (bukan cuma yang
  // tanggalnya di rentang filter) -- daftar hutangList dari lkPiutangLists() di atas.
  const totalHutang = hutangList.reduce((s, e) => {
    const paid = e.paid_amount !== undefined ? e.paid_amount : e.jumlah;
    return s + ((Number(e.jumlah) || 0) - (Number(paid) || 0));
  }, 0);
  const hutangRows = hutangList
    .map((e) => {
      const paid = e.paid_amount !== undefined ? e.paid_amount : e.jumlah;
      const status = e.status_bayar || computeStatusBayar(e.jumlah, paid);
      return `
    <tr>
      <td style="white-space:nowrap;">${formatTanggal(e.tanggal)}</td>
      <td>${escapeHtml(e.kategori)}${e.keterangan ? `<br><span style="font-size:11.5px; color:var(--gray-500);">${escapeHtml(e.keterangan)}</span>` : ""}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(e.jumlah)}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(paid)}</td>
      <td style="text-align:right; white-space:nowrap; font-weight:700; color:var(--red-600);">${formatRupiah(e.jumlah - paid)}</td>
      <td><span class="badge ${STATUS_BAYAR_BADGE[status]}">${STATUS_BAYAR_LABEL[status]}</span></td>
    </tr>`;
    })
    .join("");

  document.getElementById("lk-content").innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-hand-coins", "Jumlah Pesanan Belum Lunas", piutang.length)}
      ${statCard("ph-wallet", "Total Piutang", formatRupiah(totalPiutang), true)}
      ${statCard("ph-warning", "Piutang Menunggak (>= " + LK_PIUTANG_MENUNGGAK_HARI + " hari)", menunggakCount)}
    </div>
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; margin:0 0 10px;">
      <p style="font-size:12px; color:var(--gray-500); margin:0;"><i class="ph-bold ph-info"></i> Menampilkan SEMUA piutang & hutang yang belum lunas saat ini -- tidak mengikuti filter tanggal di atas, jadi yang dari bulan-bulan sebelumnya tetap muncul. Baris piutang disorot merah kalau umur pesanan sudah ${LK_PIUTANG_MENUNGGAK_HARI}+ hari belum lunas -- sistem ini belum punya tanggal jatuh tempo per pesanan, jadi "menunggak" dihitung dari umur pesanan, bukan tanggal jatuh tempo sesungguhnya.</p>
      <button type="button" class="btn-secondary btn-sm" style="white-space:nowrap;" onclick="lkPiutangData = null; renderLkPiutang();"><i class="ph-bold ph-arrow-clockwise"></i> Muat Ulang</button>
    </div>
    ${
      piutang.length === 0
        ? `<div class="card empty-state">Tidak ada piutang -- semua pesanan sudah lunas.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Tanggal</th><th>Pembeli</th><th style="text-align:right;">Total</th><th style="text-align:right;">Dibayar</th><th style="text-align:right;">Sisa</th><th style="text-align:center;">Umur</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
    }

    <h3 style="margin:24px 0 10px; font-size:15px;">Hutang Usaha (Pengeluaran Belum Dibayar)</h3>
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-receipt", "Jumlah Pengeluaran Belum Lunas", hutangList.length)}
      ${statCard("ph-hand-coins", "Total Hutang Usaha", formatRupiah(totalHutang), true)}
    </div>
    ${
      hutangList.length === 0
        ? `<div class="card empty-state">Tidak ada Hutang Usaha -- semua pengeluaran sudah lunas dibayar.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Tanggal</th><th>Kategori</th><th style="text-align:right;">Jumlah</th><th style="text-align:right;">Dibayar</th><th style="text-align:right;">Sisa</th><th>Status</th></tr></thead>
            <tbody>${hutangRows}</tbody>
          </table></div>`
    }`;
}

// ---------- Helper ----------
function statCard(icon, label, value, brand) {
  return `
    <div class="stat-card${brand ? " brand" : ""}">
      <span class="stat-icon"><i class="ph-bold ${icon}"></i></span>
      <div class="stat-body">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      </div>
    </div>`;
}
let lkTrenData = null; // cache -- sekali dimuat, tidak fetch ulang tiap pindah tab (beda dari 3 tab lain yang datanya ikut filter tanggal utama)
let lkTrenChart = null;
let lkKomposisiChart = null;

// ---------- Tab Tren & Analisis ----------
// PENINGKATAN: grafik tren omzet/laba per bulan (6 bulan terakhir) +
// perbandingan bulan ini vs bulan lalu + komposisi biaya per kategori.
// SENGAJA memakai rentang waktu SENDIRI (6 bulan terakhir dari hari ini),
// TIDAK ikut filter tanggal "Dari/Sampai" di atas -- tren bulanan perlu
// jendela waktu yang lebih panjang supaya kelihatan naik-turunnya, beda
// kebutuhan dari 3 tab lain yang memang dirancang untuk 1 rentang tanggal
// spesifik yang dipilih user. Datanya di-cache (lkTrenData) supaya tidak
// baca ulang ke Firestore tiap kali pindah-pindah tab -- cukup sekali per
// kunjungan halaman ini, kecuali klik "Muat Ulang" di tab ini sendiri.
async function loadLkTrenData() {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString("id-ID", { month: "short", year: "2-digit" }) });
  }
  const rangeStart = new Date(months[0].year, months[0].month, 1);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [orderSnap, expenseSnap] = await Promise.all([
    db.collection("orders").where("tanggal", ">=", rangeStart).where("tanggal", "<=", rangeEnd).get(),
    db.collection("pengeluaran").where("tanggal", ">=", rangeStart).where("tanggal", "<=", rangeEnd).get(),
  ]);
  const orders = orderSnap.docs.map((d) => d.data());
  const expenses = expenseSnap.docs.map((d) => d.data());

  const monthly = months.map((m) => ({ ...m, omzet: 0, hpp: 0, biaya: 0, hppKurang: 0 }));
  const monthIndex = (d) => {
    const dt = toDateObj(d);
    return monthly.findIndex((m) => m.year === dt.getFullYear() && m.month === dt.getMonth());
  };
  orders.forEach((o) => {
    const idx = monthIndex(o.tanggal);
    if (idx === -1) return;
    monthly[idx].omzet += Number(o.total) || 0;
    monthly[idx].hpp += (o.items || []).reduce((s, it) => s + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0);
    if ((o.items || []).some((it) => it.harga_modal === undefined || it.harga_modal === null)) monthly[idx].hppKurang += 1;
  });
  const biayaPerKategoriTotal = {};
  expenses.forEach((e) => {
    const idx = monthIndex(e.tanggal);
    if (idx !== -1) monthly[idx].biaya += Number(e.jumlah) || 0;
    biayaPerKategoriTotal[e.kategori] = (biayaPerKategoriTotal[e.kategori] || 0) + (Number(e.jumlah) || 0);
  });
  monthly.forEach((m) => (m.laba = m.omzet - m.hpp - m.biaya));

  lkTrenData = { monthly, biayaPerKategoriTotal, rangeDari: localYmd(rangeStart), rangeSampai: localYmd(now) };
}

function renderLkTren() {
  const container = document.getElementById("lk-content");
  if (!lkTrenData) {
    container.innerHTML = skeletonRows(6);
    loadLkTrenData()
      .then(() => {
        if (lkTab === "tren") renderLkTren(); // render ulang cuma kalau user belum keburu pindah tab lain
      })
      .catch((err) => {
        container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
      });
    return;
  }

  const { monthly, biayaPerKategoriTotal } = lkTrenData;
  const bulanHppKurang = monthly.filter((m) => m.hppKurang > 0);
  const trenNote = bulanHppKurang.length
    ? `<p style="font-size:12px; color:var(--gray-500); margin:8px 0 0;"><i class="ph-bold ph-warning" style="color:#f59e0b;"></i> Titik oranye = bulan yang ada pesanan dengan HPP belum lengkap (${bulanHppKurang.map((m) => `${m.label}: ${m.hppKurang} pesanan`).join(", ")}) -- Laba bulan itu kemungkinan lebih besar dari sebenarnya.</p>`
    : "";
  const iniBulan = monthly[monthly.length - 1];
  const bulanLalu = monthly[monthly.length - 2];
  const pctChange = (now, before) => (before === 0 ? (now === 0 ? 0 : 100) : Math.round(((now - before) / Math.abs(before)) * 100));
  const omzetPct = pctChange(iniBulan.omzet, bulanLalu.omzet);
  const labaPct = pctChange(iniBulan.laba, bulanLalu.laba);
  const trendBadge = (pct) =>
    `<span style="font-size:11.5px; font-weight:700; color:${pct >= 0 ? "var(--brand-700)" : "var(--red-600)"};"><i class="ph-bold ${pct >= 0 ? "ph-trend-up" : "ph-trend-down"}"></i> ${pct >= 0 ? "+" : ""}${pct}%</span>`;

  container.innerHTML = `
    ${lkArsipBanner(lkTrenData.rangeDari, lkTrenData.rangeSampai)}
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:2px;">
        <h3 style="margin:0; font-size:15px;">Tren Omzet & Laba -- 6 Bulan Terakhir</h3>
        <button type="button" class="btn-secondary btn-sm" onclick="lkTrenData = null; renderLkTren();"><i class="ph-bold ph-arrow-clockwise"></i> Muat Ulang</button>
      </div>
      <div style="height:260px; margin-top:12px;"><canvas id="lk-tren-chart"></canvas></div>
      ${trenNote}
    </div>
    <div class="grid grid-2" style="margin-bottom:16px;">
      <div class="card">
        <div style="font-size:12px; color:var(--gray-500); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Omzet Bulan Ini vs Lalu</div>
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span style="font-size:18px; font-weight:800;">${formatRupiah(iniBulan.omzet)}</span>
          ${trendBadge(omzetPct)}
        </div>
        <div style="font-size:11.5px; color:var(--gray-400); margin-top:4px;">Bulan lalu: ${formatRupiah(bulanLalu.omzet)}</div>
      </div>
      <div class="card">
        <div style="font-size:12px; color:var(--gray-500); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Laba Bersih Bulan Ini vs Lalu${iniBulan.hppKurang > 0 ? ` <span class="badge badge-red" style="text-transform:none;">Belum final</span>` : ""}</div>
        <div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;">
          <span style="font-size:18px; font-weight:800;">${formatRupiah(iniBulan.laba)}</span>
          ${trendBadge(labaPct)}
        </div>
        <div style="font-size:11.5px; color:var(--gray-400); margin-top:4px;">Bulan lalu: ${formatRupiah(bulanLalu.laba)}</div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-top:0; font-size:15px;">Komposisi Biaya per Kategori -- 6 Bulan Terakhir</h3>
      ${
        Object.keys(biayaPerKategoriTotal).length === 0
          ? `<p style="color:var(--gray-400); font-size:13px;">Belum ada pengeluaran tercatat.</p>`
          : `<div style="max-width:320px; margin:0 auto;"><canvas id="lk-komposisi-chart"></canvas></div>`
      }
    </div>`;

  drawLkTrenChart(monthly);
  if (Object.keys(biayaPerKategoriTotal).length > 0) drawLkKomposisiChart(biayaPerKategoriTotal);
}

function drawLkTrenChart(monthly) {
  const ctx = document.getElementById("lk-tren-chart");
  if (!ctx) return;
  if (lkTrenChart) lkTrenChart.destroy();
  lkTrenChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: monthly.map((m) => m.label),
      datasets: [
        { type: "line", label: "Laba Bersih", data: monthly.map((m) => m.laba), borderColor: "#16a34a", backgroundColor: "#16a34a", tension: 0.3, pointRadius: monthly.map((m) => (m.hppKurang > 0 ? 5 : 3)), pointBackgroundColor: monthly.map((m) => (m.hppKurang > 0 ? "#f59e0b" : "#16a34a")), yAxisID: "y" },
        { type: "bar", label: "Omzet", data: monthly.map((m) => m.omzet), backgroundColor: "rgba(22, 163, 74, 0.18)", yAxisID: "y" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: (v) => formatRupiah(v) } } },
      plugins: {
        tooltip: {
          callbacks: {
            label: (c) => `${c.dataset.label}: ${formatRupiah(c.parsed.y)}`,
            afterLabel: (c) => (c.dataset.label === "Laba Bersih" && monthly[c.dataIndex].hppKurang > 0 ? `⚠ ${monthly[c.dataIndex].hppKurang} pesanan HPP-nya belum lengkap` : ""),
          },
        },
      },
    },
  });
}

function drawLkKomposisiChart(biayaPerKategoriTotal) {
  const ctx = document.getElementById("lk-komposisi-chart");
  if (!ctx) return;
  if (lkKomposisiChart) lkKomposisiChart.destroy();
  const labels = Object.keys(biayaPerKategoriTotal);
  const palette = ["#16a34a", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b", "#14b8a6"];
  lkKomposisiChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data: labels.map((k) => biayaPerKategoriTotal[k]), backgroundColor: labels.map((_, i) => palette[i % palette.length]) }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${formatRupiah(c.parsed)}` } },
      },
    },
  });
}

function toDateObj(dateLike) {
  return dateLike && dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
}

// ---------- Export Excel/PDF -- menyesuaikan tab yang sedang aktif ----------
function lkFilterSummary() {
  // Tab Tren memakai rentang sendiri (6 bulan terakhir), TIDAK mengikuti
  // Dari/Sampai -- jangan tampilkan filter tanggal yang menyesatkan di kop export.
  if (lkTab === "tren") return ["6 bulan terakhir (tidak mengikuti filter tanggal)"];
  if (lkTab === "piutang") return ["Semua yang belum lunas per hari ini (tidak mengikuti filter tanggal)"];
  const dari = document.getElementById("lk-dari").value;
  const sampai = document.getElementById("lk-sampai").value;
  const parts = [];
  if (dari) parts.push(`Dari: ${formatTanggal(new Date(dari + "T00:00:00"))}`);
  if (sampai) parts.push(`Sampai: ${formatTanggal(new Date(sampai + "T23:59:59"))}`);
  return parts;
}
function lkTabTitle() {
  return { kas: "Buku Kas", labarugi: "Laba Rugi", piutang: "Piutang & Hutang", tren: "Tren & Analisis" }[lkTab];
}

// Data export tab Tren -- dari cache lkTrenData (yang sama dengan yang digambar
// di grafik), jadi angka export selalu persis sama dengan yang tampil di layar.
function lkTrenExportData() {
  if (!lkTrenData) return null;
  const { monthly, biayaPerKategoriTotal } = lkTrenData;
  const tot = monthly.reduce(
    (a, m) => ({ omzet: a.omzet + m.omzet, hpp: a.hpp + m.hpp, biaya: a.biaya + m.biaya, laba: a.laba + m.laba }),
    { omzet: 0, hpp: 0, biaya: 0, laba: 0 }
  );
  const bulanKurang = monthly.filter((m) => m.hppKurang > 0);
  return {
    monthly: monthly.map((m) => ({ ...m, label: m.hppKurang > 0 ? m.label + " *" : m.label })),
    tot,
    komposisi: Object.entries(biayaPerKategoriTotal),
    note:
      "Laba Bersih = Omzet - HPP - Biaya Operasional. Pesanan lama yang belum punya Harga Modal dihitung HPP Rp0, jadi Laba bisa lebih besar dari yang sebenarnya." +
      (bulanKurang.length ? ` * = bulan dengan HPP belum lengkap (${bulanKurang.map((m) => `${m.label}: ${m.hppKurang} pesanan`).join(", ")}).` : ""),
  };
}

function exportLkExcel() {
  const filterParts = lkFilterSummary();
  const aoa = [[lkToko.nama || "Toko Benih"], [`Laporan Keuangan -- ${lkTabTitle()} -- diekspor ${formatTanggal(new Date())}`]];
  if (filterParts.length > 0) aoa.push([`Filter aktif: ${filterParts.join("  |  ")}`]);
  aoa.push([]);
  const titleRows = aoa.length - 1; // baris terakhir yang perlu di-merge lebar penuh (0-indexed)

  let headers, dataRows;
  let trenExtra = null; // blok tambahan (komposisi biaya + catatan) khusus tab Tren
  if (lkTab === "kas") {
    if (lkPembayaranError) {
      showToast("Riwayat pembayaran pengeluaran gagal dimuat -- Kas Keluar tidak lengkap, export dibatalkan.", "error");
      return;
    }
    const timeline = lkTimeline();
    if (timeline.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    let saldo = 0;
    headers = ["Tanggal", "Keterangan", "Kas Masuk", "Kas Keluar", "Kas Bersih Berjalan"];
    dataRows = timeline.map((t) => {
      saldo += (t.masuk || 0) - (t.keluar || 0);
      return [formatTanggal(t.tanggal), t.ket, t.masuk || "", t.keluar || "", saldo];
    });
  } else if (lkTab === "labarugi") {
    if (lkExpenses.length === 0 && lkOrders.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    const omzet = lkOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const hpp = lkOrders.reduce((s, o) => s + (o.items || []).reduce((si, it) => si + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0), 0);
    const filteredExpenses = lkExpenses; // export selalu memuat SEMUA kategori (filter kategori cuma untuk tampilan rincian di layar)
    const biayaPerKategori = {};
    filteredExpenses.forEach((e) => (biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0)));
    const totalBiaya = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
    const hppKurang = lkHppIncompleteCount();
    const sfx = hppKurang > 0 ? " (belum final)" : "";
    headers = ["Pos", "Jumlah"];
    dataRows = [
      ["Omzet (Total Penjualan)", omzet],
      ["HPP (Harga Pokok Penjualan)", -hpp],
      ["Laba Kotor" + sfx, omzet - hpp],
      ["", ""],
      ...Object.entries(biayaPerKategori).map(([k, v]) => [`Biaya: ${k}`, -v]),
      ["Total Biaya Operasional", -totalBiaya],
      ["", ""],
      ["Laba Bersih" + sfx, omzet - hpp - totalBiaya],
      ...(hppKurang > 0 ? [["", ""], [`Catatan: ${hppKurang} pesanan belum lengkap HPP-nya (belum ada Harga Modal) -- Laba Kotor & Laba Bersih kemungkinan lebih besar dari sebenarnya.`, ""]] : []),
    ];
  } else if (lkTab === "tren") {
    const t = lkTrenExportData();
    if (!t) {
      showToast("Data tren masih dimuat, coba lagi sebentar.", "error");
      return;
    }
    headers = ["Bulan", "Omzet", "HPP", "Biaya Operasional", "Laba Bersih"];
    dataRows = [
      ...t.monthly.map((m) => [m.label, m.omzet, m.hpp, m.biaya, m.laba]),
      ["Total", t.tot.omzet, t.tot.hpp, t.tot.biaya, t.tot.laba],
    ];
    trenExtra = t;
  } else {
    // Piutang & Hutang punya kolom berbeda (Pembeli+No HP vs Kategori) --
    // tidak bisa digabung 1 tabel headers+dataRows generik seperti tab
    // lain, jadi ditulis langsung sebagai 2 tabel terpisah di sheet yang
    // sama (bukan lewat variabel headers/dataRows yang dipakai di bawah).
    const lists = lkPiutangLists();
    if (!lists) {
      showToast("Data piutang masih dimuat, coba lagi sebentar.", "error");
      return;
    }
    const { piutang, hutangList } = lists;
    if (piutang.length === 0 && hutangList.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    aoa.push(["Piutang (Pesanan Belum Lunas)"]);
    aoa.push(["Tanggal", "Pembeli", "No HP", "Total", "Dibayar", "Sisa", "Status"]);
    piutang.forEach((o) =>
      aoa.push([formatTanggal(o.tanggal), o.nama_pembeli, o.no_hp || "", o.total, o.paid_amount || 0, o.total - (o.paid_amount || 0), STATUS_BAYAR_LABEL[o.status_bayar]])
    );
    aoa.push([]);
    aoa.push(["Hutang Usaha (Pengeluaran Belum Dibayar)"]);
    aoa.push(["Tanggal", "Kategori", "Keterangan", "Jumlah", "Dibayar", "Sisa", "Status"]);
    hutangList.forEach((e) => {
      const paid = pengKasKeluar(e);
      aoa.push([formatTanggal(e.tanggal), e.kategori, e.keterangan || "", e.jumlah, paid, e.jumlah - paid, STATUS_BAYAR_LABEL[e.status_bayar || computeStatusBayar(e.jumlah, paid)]]);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(aoa);
    ws2["!cols"] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    ws2["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } }];
    if (filterParts.length > 0) ws2["!merges"].push({ s: { r: 2, c: 0 }, e: { r: 2, c: 6 } });
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, ws2, lkTabTitle());
    XLSX.writeFile(wb2, `laporan-keuangan-${lkTab}-${todayInputValue()}.xlsx`);
    return; // sudah selesai ditulis & diunduh di atas, tidak lewat alur headers/dataRows generik di bawah
  }

  aoa.push(headers);
  dataRows.forEach((r) => aoa.push(r));
  if (trenExtra) {
    if (trenExtra.komposisi.length > 0) {
      aoa.push([]);
      aoa.push(["Komposisi Biaya per Kategori -- 6 Bulan Terakhir"]);
      aoa.push(["Kategori", "Jumlah"]);
      trenExtra.komposisi.forEach(([k, v]) => aoa.push([k, v]));
    }
    aoa.push([]);
    aoa.push([trenExtra.note]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const numCols = headers.length;
  // Lihat catatan di exportExcel() di js/laporan.js soal kenapa cuma merge +
  // lebar kolom otomatis (bukan bold/warna) -- SheetJS versi gratis yang
  // dipakai di sini tidak mendukung penulisan style ke file .xlsx.
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } }];
  if (filterParts.length > 0) ws["!merges"].push({ s: { r: 2, c: 0 }, e: { r: 2, c: numCols - 1 } });
  ws["!cols"] = headers.map((h, i) => {
    let maxLen = String(h).length;
    dataRows.forEach((r) => {
      const v = r[i];
      if (v !== undefined && v !== null && v !== "") maxLen = Math.max(maxLen, String(v).length);
    });
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, lkTabTitle());
  XLSX.writeFile(wb, `laporan-keuangan-${lkTab}-${todayInputValue()}.xlsx`);
}

function exportLkPdf() {
  const filterParts = lkFilterSummary();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text(lkToko.nama || "Toko Benih", 14, 15);
  doc.setFontSize(10);
  doc.text(`Laporan Keuangan -- ${lkTabTitle()} -- diekspor ${formatTanggal(new Date())}`, 14, 21);
  let startY = 27;
  if (filterParts.length > 0) {
    doc.setFontSize(9);
    doc.text(`Filter aktif: ${filterParts.join("  |  ")}`, 14, 26);
    startY = 31;
  }

  let head, body;
  if (lkTab === "kas") {
    if (lkPembayaranError) {
      showToast("Riwayat pembayaran pengeluaran gagal dimuat -- Kas Keluar tidak lengkap, export dibatalkan.", "error");
      return;
    }
    const timeline = lkTimeline();
    if (timeline.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    let saldo = 0;
    head = ["Tanggal", "Keterangan", "Kas Masuk", "Kas Keluar", "Kas Bersih Berjalan"];
    body = timeline.map((t) => {
      saldo += (t.masuk || 0) - (t.keluar || 0);
      return [formatTanggal(t.tanggal), t.ket, t.masuk ? formatRupiah(t.masuk) : "-", t.keluar ? formatRupiah(t.keluar) : "-", formatRupiah(saldo)];
    });
  } else if (lkTab === "labarugi") {
    if (lkExpenses.length === 0 && lkOrders.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    const omzet = lkOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const hpp = lkOrders.reduce((s, o) => s + (o.items || []).reduce((si, it) => si + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0), 0);
    const filteredExpenses = lkExpenses; // export selalu memuat SEMUA kategori (filter kategori cuma untuk tampilan rincian di layar)
    const biayaPerKategori = {};
    filteredExpenses.forEach((e) => (biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0)));
    const totalBiaya = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
    const hppKurang = lkHppIncompleteCount();
    const sfx = hppKurang > 0 ? " (belum final)" : "";
    head = ["Pos", "Jumlah"];
    body = [
      ["Omzet (Total Penjualan)", formatRupiah(omzet)],
      ["HPP (Harga Pokok Penjualan)", `(${formatRupiah(hpp)})`],
      ["Laba Kotor" + sfx, formatRupiah(omzet - hpp)],
      ...Object.entries(biayaPerKategori).map(([k, v]) => [`Biaya: ${k}`, `(${formatRupiah(v)})`]),
      ["Total Biaya Operasional", `(${formatRupiah(totalBiaya)})`],
      ["Laba Bersih" + sfx, formatRupiah(omzet - hpp - totalBiaya)],
      ...(hppKurang > 0 ? [[`Catatan: ${hppKurang} pesanan belum lengkap HPP-nya -- Laba Kotor & Laba Bersih kemungkinan lebih besar dari sebenarnya.`, ""]] : []),
    ];
  } else if (lkTab === "tren") {
    const t = lkTrenExportData();
    if (!t) {
      showToast("Data tren masih dimuat, coba lagi sebentar.", "error");
      return;
    }
    const rightCols = { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } };
    doc.autoTable({
      startY,
      head: [["Bulan", "Omzet", "HPP", "Biaya Operasional", "Laba Bersih"]],
      body: [
        ...t.monthly.map((m) => [m.label, formatRupiah(m.omzet), formatRupiah(m.hpp), formatRupiah(m.biaya), formatRupiah(m.laba)]),
        ["Total", formatRupiah(t.tot.omzet), formatRupiah(t.tot.hpp), formatRupiah(t.tot.biaya), formatRupiah(t.tot.laba)],
      ],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 163, 74] },
      columnStyles: rightCols,
    });
    let y = doc.lastAutoTable.finalY + 10;
    if (t.komposisi.length > 0) {
      doc.setFontSize(11);
      doc.text("Komposisi Biaya per Kategori -- 6 Bulan Terakhir", 14, y);
      doc.autoTable({
        startY: y + 4,
        head: [["Kategori", "Jumlah"]],
        body: t.komposisi.map(([k, v]) => [k, formatRupiah(v)]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [22, 163, 74] },
        columnStyles: { 1: { halign: "right" } },
      });
      y = doc.lastAutoTable.finalY + 10;
    }
    doc.setFontSize(8);
    const noteLines = doc.splitTextToSize(t.note, 180);
    if (y + noteLines.length * 4 > 285) {
      doc.addPage();
      y = 15;
    }
    doc.text(noteLines, 14, y);
    doc.save(`laporan-keuangan-${lkTab}-${todayInputValue()}.pdf`);
    return; // sudah selesai digambar & diunduh di atas, tidak lewat alur head/body generik di bawah
  } else {
    // Piutang & Hutang punya kolom berbeda -- digambar sebagai 2 tabel
    // terpisah di PDF yang sama (bukan lewat variabel head/body generik di
    // bawah), tabel kedua otomatis diletakkan di bawah tabel pertama lewat
    // doc.lastAutoTable.finalY.
    const lists = lkPiutangLists();
    if (!lists) {
      showToast("Data piutang masih dimuat, coba lagi sebentar.", "error");
      return;
    }
    const { piutang, hutangList } = lists;
    if (piutang.length === 0 && hutangList.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    doc.setFontSize(11);
    doc.text("Piutang (Pesanan Belum Lunas)", 14, startY);
    doc.autoTable({
      startY: startY + 4,
      head: [["Tanggal", "Pembeli", "No HP", "Total", "Dibayar", "Sisa", "Status"]],
      body: piutang.length
        ? piutang.map((o) => [formatTanggal(o.tanggal), o.nama_pembeli, o.no_hp || "-", formatRupiah(o.total), formatRupiah(o.paid_amount || 0), formatRupiah(o.total - (o.paid_amount || 0)), STATUS_BAYAR_LABEL[o.status_bayar]])
        : [["Tidak ada piutang yang belum lunas.", "", "", "", "", "", ""]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [22, 163, 74] },
    });
    const afterPiutangY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.text("Hutang Usaha (Pengeluaran Belum Dibayar)", 14, afterPiutangY);
    doc.autoTable({
      startY: afterPiutangY + 4,
      head: [["Tanggal", "Kategori", "Keterangan", "Jumlah", "Dibayar", "Sisa", "Status"]],
      body: hutangList.length
        ? hutangList.map((e) => {
            const paid = pengKasKeluar(e);
            return [formatTanggal(e.tanggal), e.kategori, e.keterangan || "-", formatRupiah(e.jumlah), formatRupiah(paid), formatRupiah(e.jumlah - paid), STATUS_BAYAR_LABEL[e.status_bayar || computeStatusBayar(e.jumlah, paid)]];
          })
        : [["Tidak ada Hutang Usaha yang belum lunas.", "", "", "", "", "", ""]],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [220, 38, 38] },
    });
    doc.save(`laporan-keuangan-${lkTab}-${todayInputValue()}.pdf`);
    return; // sudah selesai digambar & diunduh di atas, tidak lewat alur head/body generik di bawah
  }

  doc.autoTable({ startY, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [22, 163, 74] } });
  doc.save(`laporan-keuangan-${lkTab}-${todayInputValue()}.pdf`);
}
