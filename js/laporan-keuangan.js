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

function defaultLkDari() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localYmd(d);
}

window.onAuthReady = async function (profile) {
  lkProfile = profile;
  document.getElementById("lk-dari").value = defaultLkDari();
  document.getElementById("lk-sampai").value = localYmd(new Date());
  await applyLkFilter();
};

function switchLkTab(tab) {
  lkTab = tab;
  ["kas", "labarugi", "piutang"].forEach((t) => {
    const btn = document.getElementById("lk-tab-" + t);
    btn.className = t === tab ? "btn-primary" : "btn-secondary";
  });
  renderLkContent();
}

async function applyLkFilter() {
  const dari = document.getElementById("lk-dari").value;
  const sampai = document.getElementById("lk-sampai").value;
  document.getElementById("lk-content").innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;

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
    lkOrders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lkExpenses = expenseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    lkPayments = paymentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    switchLkTab(lkTab);
  } catch (err) {
    document.getElementById("lk-content").innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function renderLkContent() {
  if (lkTab === "kas") renderLkKas();
  else if (lkTab === "labarugi") renderLkLabaRugi();
  else renderLkPiutang();
}

// ---------- Tab Buku Kas ----------
function renderLkKas() {
  // Gabungkan kas masuk (payments) & kas keluar (pengeluaran) jadi satu
  // linimasa terurut tanggal, lalu hitung saldo berjalan MULAI DARI 0
  // (bukan saldo awal riil toko -- sesuai keputusan Owner: belum perlu
  // input saldo awal, jadi angka "Saldo" di sini artinya "arus kas bersih
  // sejak tanggal Dari", bukan saldo kas fisik toko saat ini).
  const timeline = [
    ...lkPayments.map((p) => ({ tanggal: p.tanggal, masuk: p.jumlah, keluar: 0, ket: p.catatan || "Pembayaran pesanan" })),
    ...lkExpenses.map((e) => ({ tanggal: e.tanggal, masuk: 0, keluar: e.jumlah, ket: `${e.kategori} -- ${e.keterangan || ""}` })),
  ].sort((a, b) => toDateObj(a.tanggal) - toDateObj(b.tanggal));

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
  const totalKeluar = lkExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);

  document.getElementById("lk-content").innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-arrow-circle-down", "Kas Masuk", formatRupiah(totalMasuk))}
      ${statCard("ph-arrow-circle-up", "Kas Keluar", formatRupiah(totalKeluar))}
      ${statCard("ph-scales", "Arus Kas Bersih", formatRupiah(totalMasuk - totalKeluar), true)}
    </div>
    <p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;"><i class="ph-bold ph-info"></i> "Saldo" dihitung mulai dari 0 sejak tanggal "Dari" di atas -- bukan saldo kas fisik toko saat ini, karena belum ada saldo awal yang diinput.</p>
    ${
      timeline.length === 0
        ? `<div class="card empty-state">Belum ada arus kas di rentang tanggal ini.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Tanggal</th><th>Keterangan</th><th style="text-align:right;">Kas Masuk</th><th style="text-align:right;">Kas Keluar</th><th style="text-align:right;">Saldo</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
    }`;
}

// ---------- Tab Laba Rugi ----------
function renderLkLabaRugi() {
  const omzet = lkOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const hpp = lkOrders.reduce((s, o) => s + (o.items || []).reduce((si, it) => si + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0), 0);
  const labaKotor = omzet - hpp;

  const biayaPerKategori = {};
  lkExpenses.forEach((e) => {
    biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0);
  });
  const totalBiaya = lkExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
  const labaBersih = labaKotor - totalBiaya;

  const biayaRows = Object.entries(biayaPerKategori)
    .map(([kategori, jumlah]) => `<tr><td>${escapeHtml(kategori)}</td><td style="text-align:right;">${formatRupiah(jumlah)}</td></tr>`)
    .join("");

  document.getElementById("lk-content").innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-trend-up", "Omzet (Penjualan)", formatRupiah(omzet))}
      ${statCard("ph-package", "HPP (Harga Modal)", formatRupiah(hpp))}
      ${statCard("ph-scales", "Laba Bersih", formatRupiah(labaBersih), true)}
    </div>
    <p style="font-size:12px; color:var(--gray-500); margin:0 0 16px;"><i class="ph-bold ph-info"></i> HPP hanya terhitung untuk pesanan yang harga modal produknya sudah diisi di halaman Produk saat pesanan itu dibuat/diedit. Pesanan lama sebelum fitur ini ada dihitung HPP = Rp0.</p>
    <div class="card">
      <h3 style="margin-top:0; font-size:15px;">Ringkasan Laba Rugi</h3>
      <table>
        <tbody>
          <tr><td>Omzet (Total Penjualan)</td><td style="text-align:right;">${formatRupiah(omzet)}</td></tr>
          <tr><td>HPP (Harga Pokok Penjualan)</td><td style="text-align:right;">(${formatRupiah(hpp)})</td></tr>
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Laba Kotor</td><td style="text-align:right;">${formatRupiah(labaKotor)}</td></tr>
        </tbody>
      </table>
      <h4 style="margin:18px 0 6px; font-size:13.5px; color:var(--gray-500);">Biaya Operasional</h4>
      <table>
        <tbody>
          ${biayaRows || `<tr><td colspan="2" style="color:var(--gray-400);">Tidak ada pengeluaran di periode ini.</td></tr>`}
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Total Biaya Operasional</td><td style="text-align:right;">(${formatRupiah(totalBiaya)})</td></tr>
        </tbody>
      </table>
      <table style="margin-top:12px;">
        <tbody>
          <tr style="font-weight:800; font-size:15px; border-top:2px solid var(--gray-200);"><td>Laba Bersih</td><td style="text-align:right; color:${labaBersih >= 0 ? "var(--brand-ink)" : "var(--red-600)"};">${formatRupiah(labaBersih)}</td></tr>
        </tbody>
      </table>
    </div>`;
}

// ---------- Tab Piutang ----------
function renderLkPiutang() {
  const piutang = lkOrders.filter((o) => o.status_bayar !== "lunas");
  const totalPiutang = piutang.reduce((s, o) => s + (o.total - (o.paid_amount || 0)), 0);

  const rows = piutang
    .map(
      (o) => `
    <tr>
      <td style="white-space:nowrap;">${formatTanggal(o.tanggal)}</td>
      <td>${escapeHtml(o.nama_pembeli)}${o.no_hp ? `<br><span style="font-size:11.5px; color:var(--gray-500);">${escapeHtml(o.no_hp)}</span>` : ""}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(o.total)}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(o.paid_amount || 0)}</td>
      <td style="text-align:right; white-space:nowrap; font-weight:700;">${formatRupiah(o.total - (o.paid_amount || 0))}</td>
      <td><span class="badge ${STATUS_BAYAR_BADGE[o.status_bayar]}">${STATUS_BAYAR_LABEL[o.status_bayar]}</span></td>
    </tr>`
    )
    .join("");

  document.getElementById("lk-content").innerHTML = `
    <div class="grid grid-3" style="margin-bottom:16px;">
      ${statCard("ph-hand-coins", "Jumlah Pesanan Belum Lunas", piutang.length)}
      ${statCard("ph-wallet", "Total Piutang", formatRupiah(totalPiutang), true)}
    </div>
    <p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;"><i class="ph-bold ph-info"></i> Cuma pesanan dengan tanggal di rentang filter di atas. Perlebar rentang tanggal kalau ada piutang lama yang mau ikut ditampilkan.</p>
    ${
      piutang.length === 0
        ? `<div class="card empty-state">Tidak ada piutang di rentang tanggal ini -- semua pesanan sudah lunas.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr><th>Tanggal</th><th>Pembeli</th><th style="text-align:right;">Total</th><th style="text-align:right;">Dibayar</th><th style="text-align:right;">Sisa</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
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
function toDateObj(dateLike) {
  return dateLike && dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
}
