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
  else if (lkTab === "piutang") renderLkPiutang();
  else renderLkTren();
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
  const incompleteHppCount = lkOrders.filter((o) =>
    (o.items || []).some((it) => it.harga_modal === undefined || it.harga_modal === null)
  ).length;

  // PENINGKATAN: filter kategori biaya operasional -- opsi dropdown diambil
  // dari kategori yang BENAR-BENAR ada di pengeluaran periode ini (bukan
  // seluruh daftar kategori_pengeluaran yang mungkin tidak semuanya
  // terpakai di periode ini).
  const kategoriTersedia = [...new Set(lkExpenses.map((e) => e.kategori))].sort();
  const filteredExpenses = lkKategoriFilter ? lkExpenses.filter((e) => e.kategori === lkKategoriFilter) : lkExpenses;

  const biayaPerKategori = {};
  filteredExpenses.forEach((e) => {
    biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0);
  });
  const totalBiaya = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
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
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Laba Kotor</td><td style="text-align:right;">${formatRupiah(labaKotor)}</td></tr>
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
          <tr style="font-weight:700; border-top:1px solid var(--gray-200);"><td>Total Biaya Operasional${lkKategoriFilter ? " (Terfilter)" : ""}</td><td style="text-align:right;">(${formatRupiah(totalBiaya)})</td></tr>
        </tbody>
      </table>
      <table style="margin-top:12px;">
        <tbody>
          <tr style="font-weight:800; font-size:15px; border-top:2px solid var(--gray-200);"><td>Laba Bersih${lkKategoriFilter ? " (Biaya Terfilter)" : ""}</td><td style="text-align:right; color:${labaBersih >= 0 ? "var(--brand-ink)" : "var(--red-600)"};">${formatRupiah(labaBersih)}</td></tr>
        </tbody>
      </table>
      ${lkKategoriFilter ? `<p style="font-size:11.5px; color:var(--gray-400); margin:8px 0 0;"><i class="ph-bold ph-info"></i> Laba Bersih di atas dihitung cuma dari biaya kategori "${escapeHtml(lkKategoriFilter)}" -- bukan Laba Bersih sesungguhnya (semua kategori).</p>` : ""}
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

  const monthly = months.map((m) => ({ ...m, omzet: 0, hpp: 0, biaya: 0 }));
  const monthIndex = (d) => {
    const dt = toDateObj(d);
    return monthly.findIndex((m) => m.year === dt.getFullYear() && m.month === dt.getMonth());
  };
  orders.forEach((o) => {
    const idx = monthIndex(o.tanggal);
    if (idx === -1) return;
    monthly[idx].omzet += Number(o.total) || 0;
    monthly[idx].hpp += (o.items || []).reduce((s, it) => s + (Number(it.harga_modal) || 0) * (Number(it.jumlah) || 0), 0);
  });
  const biayaPerKategoriTotal = {};
  expenses.forEach((e) => {
    const idx = monthIndex(e.tanggal);
    if (idx !== -1) monthly[idx].biaya += Number(e.jumlah) || 0;
    biayaPerKategoriTotal[e.kategori] = (biayaPerKategoriTotal[e.kategori] || 0) + (Number(e.jumlah) || 0);
  });
  monthly.forEach((m) => (m.laba = m.omzet - m.hpp - m.biaya));

  lkTrenData = { monthly, biayaPerKategoriTotal };
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
  const iniBulan = monthly[monthly.length - 1];
  const bulanLalu = monthly[monthly.length - 2];
  const pctChange = (now, before) => (before === 0 ? (now === 0 ? 0 : 100) : Math.round(((now - before) / Math.abs(before)) * 100));
  const omzetPct = pctChange(iniBulan.omzet, bulanLalu.omzet);
  const labaPct = pctChange(iniBulan.laba, bulanLalu.laba);
  const trendBadge = (pct) =>
    `<span style="font-size:11.5px; font-weight:700; color:${pct >= 0 ? "var(--brand-700)" : "var(--red-600)"};"><i class="ph-bold ${pct >= 0 ? "ph-trend-up" : "ph-trend-down"}"></i> ${pct >= 0 ? "+" : ""}${pct}%</span>`;

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:2px;">
        <h3 style="margin:0; font-size:15px;">Tren Omzet & Laba -- 6 Bulan Terakhir</h3>
        <button type="button" class="btn-secondary btn-sm" onclick="lkTrenData = null; renderLkTren();"><i class="ph-bold ph-arrow-clockwise"></i> Muat Ulang</button>
      </div>
      <div style="height:260px; margin-top:12px;"><canvas id="lk-tren-chart"></canvas></div>
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
        <div style="font-size:12px; color:var(--gray-500); font-weight:700; text-transform:uppercase; margin-bottom:6px;">Laba Bersih Bulan Ini vs Lalu</div>
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
        { type: "line", label: "Laba Bersih", data: monthly.map((m) => m.laba), borderColor: "#16a34a", backgroundColor: "#16a34a", tension: 0.3, pointRadius: 3, yAxisID: "y" },
        { type: "bar", label: "Omzet", data: monthly.map((m) => m.omzet), backgroundColor: "rgba(22, 163, 74, 0.18)", yAxisID: "y" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: (v) => formatRupiah(v) } } },
      plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatRupiah(c.parsed.y)}` } } },
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
  const dari = document.getElementById("lk-dari").value;
  const sampai = document.getElementById("lk-sampai").value;
  const parts = [];
  if (dari) parts.push(`Dari: ${formatTanggal(new Date(dari + "T00:00:00"))}`);
  if (sampai) parts.push(`Sampai: ${formatTanggal(new Date(sampai + "T23:59:59"))}`);
  return parts;
}
function lkTabTitle() {
  return { kas: "Buku Kas", labarugi: "Laba Rugi", piutang: "Piutang" }[lkTab];
}

function exportLkExcel() {
  const filterParts = lkFilterSummary();
  const aoa = [[lkToko.nama || "Toko Benih"], [`Laporan Keuangan -- ${lkTabTitle()} -- diekspor ${formatTanggal(new Date())}`]];
  if (filterParts.length > 0) aoa.push([`Filter aktif: ${filterParts.join("  |  ")}`]);
  aoa.push([]);
  const titleRows = aoa.length - 1; // baris terakhir yang perlu di-merge lebar penuh (0-indexed)

  let headers, dataRows;
  if (lkTab === "kas") {
    const timeline = [
      ...lkPayments.map((p) => ({ tanggal: p.tanggal, masuk: p.jumlah, keluar: 0, ket: p.catatan || "Pembayaran pesanan" })),
      ...lkExpenses.map((e) => ({ tanggal: e.tanggal, masuk: 0, keluar: e.jumlah, ket: `${e.kategori} -- ${e.keterangan || ""}` })),
    ].sort((a, b) => toDateObj(a.tanggal) - toDateObj(b.tanggal));
    if (timeline.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    let saldo = 0;
    headers = ["Tanggal", "Keterangan", "Kas Masuk", "Kas Keluar", "Saldo"];
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
    const filteredExpenses = lkKategoriFilter ? lkExpenses.filter((e) => e.kategori === lkKategoriFilter) : lkExpenses;
    const biayaPerKategori = {};
    filteredExpenses.forEach((e) => (biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0)));
    const totalBiaya = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
    headers = ["Pos", "Jumlah"];
    dataRows = [
      ["Omzet (Total Penjualan)", omzet],
      ["HPP (Harga Pokok Penjualan)", -hpp],
      ["Laba Kotor", omzet - hpp],
      ["", ""],
      ...Object.entries(biayaPerKategori).map(([k, v]) => [`Biaya: ${k}`, -v]),
      ["Total Biaya Operasional" + (lkKategoriFilter ? " (Terfilter)" : ""), -totalBiaya],
      ["", ""],
      ["Laba Bersih" + (lkKategoriFilter ? " (Biaya Terfilter)" : ""), omzet - hpp - totalBiaya],
    ];
  } else {
    const piutang = lkOrders.filter((o) => o.status_bayar !== "lunas");
    if (piutang.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    headers = ["Tanggal", "Pembeli", "No HP", "Total", "Dibayar", "Sisa", "Status"];
    dataRows = piutang.map((o) => [
      formatTanggal(o.tanggal), o.nama_pembeli, o.no_hp || "", o.total, o.paid_amount || 0,
      o.total - (o.paid_amount || 0), STATUS_BAYAR_LABEL[o.status_bayar],
    ]);
  }

  aoa.push(headers);
  dataRows.forEach((r) => aoa.push(r));
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
    const timeline = [
      ...lkPayments.map((p) => ({ tanggal: p.tanggal, masuk: p.jumlah, keluar: 0, ket: p.catatan || "Pembayaran pesanan" })),
      ...lkExpenses.map((e) => ({ tanggal: e.tanggal, masuk: 0, keluar: e.jumlah, ket: `${e.kategori} -- ${e.keterangan || ""}` })),
    ].sort((a, b) => toDateObj(a.tanggal) - toDateObj(b.tanggal));
    if (timeline.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    let saldo = 0;
    head = ["Tanggal", "Keterangan", "Kas Masuk", "Kas Keluar", "Saldo"];
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
    const filteredExpenses = lkKategoriFilter ? lkExpenses.filter((e) => e.kategori === lkKategoriFilter) : lkExpenses;
    const biayaPerKategori = {};
    filteredExpenses.forEach((e) => (biayaPerKategori[e.kategori] = (biayaPerKategori[e.kategori] || 0) + (Number(e.jumlah) || 0)));
    const totalBiaya = filteredExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
    head = ["Pos", "Jumlah"];
    body = [
      ["Omzet (Total Penjualan)", formatRupiah(omzet)],
      ["HPP (Harga Pokok Penjualan)", `(${formatRupiah(hpp)})`],
      ["Laba Kotor", formatRupiah(omzet - hpp)],
      ...Object.entries(biayaPerKategori).map(([k, v]) => [`Biaya: ${k}`, `(${formatRupiah(v)})`]),
      ["Total Biaya Operasional" + (lkKategoriFilter ? " (Terfilter)" : ""), `(${formatRupiah(totalBiaya)})`],
      ["Laba Bersih" + (lkKategoriFilter ? " (Biaya Terfilter)" : ""), formatRupiah(omzet - hpp - totalBiaya)],
    ];
  } else {
    const piutang = lkOrders.filter((o) => o.status_bayar !== "lunas");
    if (piutang.length === 0) {
      showToast("Tidak ada data untuk diekspor.", "error");
      return;
    }
    head = ["Tanggal", "Pembeli", "No HP", "Total", "Dibayar", "Sisa", "Status"];
    body = piutang.map((o) => [
      formatTanggal(o.tanggal), o.nama_pembeli, o.no_hp || "-", formatRupiah(o.total),
      formatRupiah(o.paid_amount || 0), formatRupiah(o.total - (o.paid_amount || 0)), STATUS_BAYAR_LABEL[o.status_bayar],
    ]);
  }

  doc.autoTable({ startY, head: [head], body, styles: { fontSize: 8 }, headStyles: { fillColor: [22, 163, 74] } });
  doc.save(`laporan-keuangan-${lkTab}-${todayInputValue()}.pdf`);
}
