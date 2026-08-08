let dashOrders = [];
let dashProducts = [];
let dashProductsMap = {};
let allCabangDash = [];
let dashStatsProdukCabang = null; // { [productId]: { [cabangId]: qty } } -- rekap all-time, lihat js/utils.js:adjustProdukCabangStats
let chartProduk = null;
let chartAlamat = null;
let chartWaktu = null;
let dashGranularitas = "harian";

// Chart.js kadang tidak langsung menyesuaikan lebar canvas saat browser
// di-zoom (beda dengan kotak/box biasa yang otomatis mengikuti lebar layar
// lewat CSS). Panggil resize() manual tiap ada perubahan ukuran window
// (termasuk saat zoom in/out) supaya ketiga grafik ikut menyesuaikan.
window.addEventListener("resize", () => {
  if (chartWaktu) chartWaktu.resize();
  if (chartProduk) chartProduk.resize();
  if (chartAlamat) chartAlamat.resize();
});

// Tombol "Filter" di pojok kanan atas -- kotak filter disembunyikan
// secara default dan baru muncul saat tombol ini diklik.
function toggleDashFilterVisibility() {
  const toolbar = document.getElementById("dash-filter-toolbar");
  const btn = document.getElementById("dash-filter-toggle-btn");
  const hidden = toolbar.style.display === "none";
  toolbar.style.display = hidden ? "" : "none";
  btn.innerHTML = hidden
    ? '<i class="ph-bold ph-eye-slash"></i> Sembunyikan Filter'
    : '<i class="ph-bold ph-funnel"></i> Filter';
}

// Sengaja dinamai beda dari resolveWaveLabel(item, productsMap) di js/utils.js
// (dipakai bersama oleh Daftar Pesanan/Laporan) -- versi khusus dashboard ini
// tanda tangannya beda (cuma 1 parameter, ambil dashProducts dari closure).
// Kalau namanya disamakan, script ini (dimuat setelah utils.js di
// dashboard.html) akan diam-diam MENIMPA fungsi global utils.js karena semua
// script jalan di scope global yang sama -- jebakan tersembunyi kalau nanti
// ada kode lain di halaman ini yang memanggil resolveWaveLabel(item, map).
function resolveWaveLabelDash(item) {
  const product = dashProducts.find((p) => p.id === item.product_id);
  const wave = product ? (product.waves || []).find((w) => w.id === item.wave_id) : null;
  return wave ? wave.label : item.wave_label;
}

// Format teks jadi "Huruf Kapital Di Awal Tiap Kata" -- dipakai supaya nama
// alamat yang diketik beda-beda (SUKORAME / sukorame / Sukorame) tampil
// konsisten satu gaya di grafik "Jumlah Unit Terjual per Alamat".
function toTitleCase(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/(^|\s|[-/])\S/g, (c) => c.toUpperCase());
}

function updateGelombangFilterOptionsDash() {
  const gelSelect = document.getElementById("filter-gelombang-dash");
  const currentValue = gelSelect.value;
  const labels = new Set();
  dashProducts.forEach((p) => (p.waves || []).forEach((w) => labels.add(w.label)));
  gelSelect.innerHTML = '<option value="">Semua Gelombang</option>';
  labels.forEach((label) => {
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    gelSelect.appendChild(opt);
  });
  if (labels.has(currentValue)) gelSelect.value = currentValue;
}

function updateCabangFilterOptionsDash(profile) {
  const select = document.getElementById("filter-cabang-dash");
  // Karyawan cabang cuma bisa lihat cabangnya sendiri (query juga sudah
  // dibatasi ke cabang itu) -- filter ini tidak relevan buat mereka, jadi
  // disembunyikan saja daripada nampilkan dropdown isi 1 pilihan doang.
  if (!canAccessAllBranches(profile)) {
    select.style.display = "none";
    return;
  }
  const currentValue = select.value;
  select.innerHTML = '<option value="">Semua Cabang</option>';
  allCabangDash
    .filter((c) => c.is_active !== false)
    .forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.nama;
      select.appendChild(opt);
    });
  if (Array.from(select.options).some((o) => o.value === currentValue)) select.value = currentValue;
}

let dashProfile = null;

// Sengaja pakai .get() (baca sekali), BUKAN onSnapshot (real-time). Dashboard
// ini menampilkan ringkasan, bukan angka yang harus update detik-itu-juga --
// listener real-time yang menyala terus di halaman ini boros bacaan
// Firestore. Klik "Muat Ulang" kapan pun perlu angka terbaru.
//
// Rentang tanggal (dari filter "Hari Ini"/"7 Hari Terakhir"/"Bulan Ini"/
// "Rentang Tanggal...") DIBATASI LANGSUNG DI QUERY FIRESTORE lewat
// where('tanggal', ...) -- bukan baca SELURUH koleksi "orders" lalu disaring
// di browser seperti sebelumnya. Ini penting karena koleksi orders akan terus
// bertambah seiring waktu; tanpa ini, tiap buka Dashboard = baca ulang
// seluruh riwayat pesanan sejak awal, padahal biasanya yang dilihat cuma
// data hari ini/minggu ini/bulan ini. Pilihan "Semua Waktu" tetap tersedia
// dan memang sengaja baca semua -- itu pilihan eksplisit pengguna, sama
// seperti tombol "Cek Nomor Nota Bentrok (Riwayat Penuh)" di Laporan.
async function loadDashboardData(profile) {
  const container = document.getElementById("dashboard-content");
  container.innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
  try {
    const { from, to } = getDateRange();

    // Karyawan cabang: query WAJIB dibatasi where('cabang_id', '==', ...), kalau
    // tidak Firestore rules akan menolak query ini sepenuhnya (bukan cuma
    // menyaring hasilnya) karena berpotensi mengembalikan data cabang lain.
    let ordersQuery = db.collection("orders");
    if (!canAccessAllBranches(profile) && profile.cabang_id) {
      ordersQuery = ordersQuery.where("cabang_id", "==", profile.cabang_id);
    }
    if (from) ordersQuery = ordersQuery.where("tanggal", ">=", from);
    if (to) ordersQuery = ordersQuery.where("tanggal", "<=", to);

    const [orderSnap, prodSnap, cabangSnap] = await Promise.all([
      ordersQuery.get(),
      db.collection("products").orderBy("nama").get(),
      db.collection("cabang").orderBy("nama").get(),
    ]);
    dashOrders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    dashProducts = prodSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    dashProductsMap = {};
    dashProducts.forEach((p) => (dashProductsMap[p.id] = p));
    allCabangDash = cabangSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Karyawan Cabang: query pesanan di atas SENGAJA dibatasi ke cabangnya
    // sendiri (lihat komentar di atas), jadi tidak bisa dipakai untuk
    // menghitung total cabang LAIN di tabel "Detail Total per Produk per
    // Cabang" di bawah. Buat itu, ambil rekap terpisah yang memang boleh
    // dibaca semua role (cuma berisi angka jumlah per produk per cabang,
    // tidak ada nama/HP/alamat pembeli) -- lihat js/utils.js:
    // adjustProdukCabangStats() untuk cara angka ini dijaga tetap akurat.
    // Owner/Admin Kasir tidak perlu ini (mereka sudah punya akses penuh ke
    // "orders" utuh, dan supaya tabelnya tetap ikut filter periode/gelombang
    // di atas -- rekap ini SELALU sepanjang waktu, tidak ikut filter).
    if (!canAccessAllBranches(profile)) {
      try {
        const statsDoc = await db.collection("stats").doc("produk_cabang").get();
        dashStatsProdukCabang = statsDoc.exists ? statsDoc.data() : {};
      } catch (e) {
        console.warn("Gagal ambil rekap produk_cabang:", e);
        dashStatsProdukCabang = {};
      }
    }

    updateGelombangFilterOptionsDash();
    updateCabangFilterOptionsDash(profile);
    renderDashboard();
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function refreshDashboard() {
  if (dashProfile) loadDashboardData(dashProfile);
}

// Ganti periode/rentang tanggal = perlu baca ulang data dari server (query
// berubah), beda dari ganti filter Gelombang/Cabang yang cukup disaring ulang
// di data yang sudah ada di memori (lihat filteredDashOrders()).
function reloadDashboardForDateChange() {
  if (dashProfile) loadDashboardData(dashProfile);
}

window.onAuthReady = async function (profile) {
  dashProfile = profile;
  loadDashboardData(profile);

  document.getElementById("filter-periode").addEventListener("change", (e) => {
    const isCustom = e.target.value === "custom";
    document.getElementById("filter-dari").style.display = isCustom ? "block" : "none";
    document.getElementById("dash-to-label").style.display = isCustom ? "inline" : "none";
    document.getElementById("filter-sampai").style.display = isCustom ? "block" : "none";
    // Kalau baru pindah ke "Rentang Tanggal..." tapi tanggalnya belum diisi,
    // jangan reload dulu (tanggal kosong = query tanpa batas, sama seperti
    // "Semua Waktu") -- tunggu sampai kedua tanggal diisi lewat listener
    // filter-dari/filter-sampai di bawah.
    if (!isCustom) reloadDashboardForDateChange();
  });
  document.getElementById("filter-dari").addEventListener("change", reloadDashboardForDateChange);
  document.getElementById("filter-sampai").addEventListener("change", reloadDashboardForDateChange);
  document.getElementById("filter-gelombang-dash").addEventListener("change", renderDashboard);
  document.getElementById("filter-cabang-dash").addEventListener("change", renderDashboard);
};

function getDateRange() {
  const mode = document.getElementById("filter-periode").value;
  const now = new Date();
  let from = null;
  let to = null;
  if (mode === "harian") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (mode === "mingguan") {
    from = new Date(now);
    from.setDate(now.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    to = now;
  } else if (mode === "bulanan") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (mode === "custom") {
    const dariVal = document.getElementById("filter-dari").value;
    const sampaiVal = document.getElementById("filter-sampai").value;
    from = dariVal ? new Date(dariVal + "T00:00:00") : null;
    to = sampaiVal ? new Date(sampaiVal + "T23:59:59") : null;
  }
  return { from, to };
}

// Rentang tanggal SUDAH dibatasi di query Firestore lewat loadDashboardData()
// -- dashOrders yang ada di memori sudah otomatis sesuai periode yang
// dipilih. Fungsi ini cuma menyaring 2 filter sisanya (Gelombang & Cabang)
// yang tidak perlu baca ulang ke server, cukup disaring di data yang sudah ada.
function filteredDashOrders() {
  const gelombang = document.getElementById("filter-gelombang-dash").value;
  const cabangFilter = document.getElementById("filter-cabang-dash").value;
  return dashOrders.filter((o) => {
    if (gelombang && !(o.items || []).some((it) => resolveWaveLabelDash(it) === gelombang)) return false;
    if (cabangFilter && o.cabang_id !== cabangFilter) return false;
    return true;
  });
}

// Kelompokkan pesanan berdasarkan tanggal jadi titik-titik data harian/mingguan/bulanan
// untuk grafik tren "Pesanan Masuk". Rentang tanggalnya sendiri sudah diatur lewat
// filter Semua Waktu/Hari Ini/7 Hari Terakhir/Bulan Ini/Rentang Tanggal di atas.
function buildTimeSeries(orders, granularitas) {
  const buckets = {};
  orders.forEach((o) => {
    const d = o.tanggal && o.tanggal.toDate ? o.tanggal.toDate() : new Date(o.tanggal);
    if (isNaN(d)) return;
    let key, label;
    if (granularitas === "bulanan") {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = d.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
    } else if (granularitas === "mingguan") {
      const monday = new Date(d);
      const offset = (monday.getDay() + 6) % 7; // 0 = Senin
      monday.setDate(monday.getDate() - offset);
      monday.setHours(0, 0, 0, 0);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      key = monday.toISOString().slice(0, 10);
      label = `${monday.getDate()}/${monday.getMonth() + 1}-${sunday.getDate()}/${sunday.getMonth() + 1}`;
    } else {
      key = d.toISOString().slice(0, 10);
      label = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    }
    if (!buckets[key]) buckets[key] = { label, count: 0, perProduk: {} };
    (o.items || []).forEach((it) => {
      const qty = Number(it.jumlah) || 0;
      buckets[key].count += qty;
      buckets[key].perProduk[it.product_name] = (buckets[key].perProduk[it.product_name] || 0) + qty;
    });
  });
  return Object.keys(buckets)
    .sort()
    .map((key) => buckets[key]);
}

// Warna tetap untuk produk tertentu (biru untuk MAPAN, oren keemasan untuk NINGRAT),
// produk lain otomatis dapat warna berbeda dari palet cadangan biar tetap konsisten
// walau nanti ada produk baru.
function buildProductColorMap(names) {
  const palette = ["#9333ea", "#db2777", "#0891b2", "#65a30d", "#dc2626", "#0f766e", "#4338ca"];
  const map = {};
  let paletteIdx = 0;
  names.forEach((name) => {
    const upper = (name || "").toUpperCase();
    if (upper.includes("MAPAN")) {
      map[name] = "#2563eb"; // biru
    } else if (upper.includes("NINGRAT")) {
      map[name] = "#d97706"; // oren keemasan
    } else {
      map[name] = palette[paletteIdx % palette.length];
      paletteIdx++;
    }
  });
  return map;
}

function renderDashboard() {
  const orders = filteredDashOrders();
  const jumlahNota = orders.length;
  const totalUnitProduk = orders.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, it) => s + (Number(it.jumlah) || 0), 0),
    0
  );
  const totalUang = orders.reduce((s, o) => s + o.total, 0);
  const jumlahLunas = orders.filter((o) => o.status_bayar === "lunas").length;
  const jumlahBelumLunas = jumlahNota - jumlahLunas;
  const jumlahDiambil = orders.filter((o) => o.is_diambil).length;
  const jumlahBelumDiambil = jumlahNota - jumlahDiambil;
  const pembeliUnik = new Set(orders.map((o) => (o.nama_pembeli || "").trim().toLowerCase())).size;
  const jumlahJanggal = orders.filter((o) => hasOrderAnomaly(o, dashProductsMap)).length;

  const perProduk = {};
  const perProdukPerCabang = {};
  const perAlamat = {};
  orders.forEach((o) => {
    const cabangKey = o.cabang_id || "__tanpa_cabang__";
    (o.items || []).forEach((it) => {
      perProduk[it.product_name] = (perProduk[it.product_name] || 0) + it.jumlah;
      if (!perProdukPerCabang[it.product_name]) perProdukPerCabang[it.product_name] = {};
      perProdukPerCabang[it.product_name][cabangKey] =
        (perProdukPerCabang[it.product_name][cabangKey] || 0) + (Number(it.jumlah) || 0);
    });
    const alamatRaw = (o.alamat || "Tanpa Alamat").trim() || "Tanpa Alamat";
    const alamatKey = toTitleCase(alamatRaw);
    const orderQty = (o.items || []).reduce((s, it) => s + (Number(it.jumlah) || 0), 0);
    perAlamat[alamatKey] = (perAlamat[alamatKey] || 0) + orderQty;
  });

  // Tabel "Detail Total per Produk per Cabang" dan yang berikut ini pakai
  // salah satu dari 2 sumber data:
  // - Owner/Admin Kasir: dihitung dari `orders` yang sudah difilter (ikut
  //   filter periode/gelombang/produk di atas), sama seperti sebelumnya.
  // - Karyawan Cabang: query `orders` mereka SENGAJA cuma berisi cabang
  //   sendiri (lihat loadDashboardData), jadi tidak bisa dipakai menghitung
  //   total cabang lain. Sumbernya diganti rekap /stats/produk_cabang yang
  //   memang boleh dibaca semua role (cuma angka, tanpa data pembeli) --
  //   konsekuensinya: SELALU total sepanjang waktu, TIDAK ikut filter
  //   periode/gelombang di atas (rekapnya tidak dipecah per tanggal/gelombang).
  //   Ini dijelaskan lewat catatan kecil di bawah judul tabel.
  const pakaiRekapAllTime = !canAccessAllBranches(dashProfile);
  let cabangColumns = allCabangDash.filter((c) => c.is_active !== false).map((c) => ({ id: c.id, nama: c.nama }));
  let tabelPerProduk = perProduk;
  let tabelPerProdukPerCabang = perProdukPerCabang;

  if (pakaiRekapAllTime) {
    tabelPerProduk = {};
    tabelPerProdukPerCabang = {};
    const stats = dashStatsProdukCabang || {};
    Object.keys(stats).forEach((productId) => {
      const prod = dashProductsMap[productId];
      const nama = prod ? prod.nama : null;
      if (!nama) return; // produk sudah dihapus -- lewati, tidak ada nama buat ditampilkan
      const perCabangProdukIni = stats[productId] || {};
      tabelPerProdukPerCabang[nama] = {};
      Object.keys(perCabangProdukIni).forEach((cabangId) => {
        const qty = Number(perCabangProdukIni[cabangId]) || 0;
        tabelPerProdukPerCabang[nama][cabangId] = qty;
        tabelPerProduk[nama] = (tabelPerProduk[nama] || 0) + qty;
      });
    });
  }
  const adaTanpaCabang = pakaiRekapAllTime
    ? Object.values(tabelPerProdukPerCabang).some((row) => row["__tanpa_cabang__"])
    : orders.some((o) => !o.cabang_id);
  if (adaTanpaCabang) cabangColumns.push({ id: "__tanpa_cabang__", nama: "Tanpa Cabang" });

  const container = document.getElementById("dashboard-content");
  container.innerHTML = `
    ${jumlahJanggal > 0 ? `
    <div class="card" style="margin-bottom:16px; background:#fef2f2; border-color:#fecaca;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="card-heading-icon" style="background:#fee2e2; color:#b91c1c;"><i class="ph-bold ph-warning"></i></span>
          <div>
            <h3 style="font-size:14px; margin:0;">${jumlahJanggal} Pesanan Terdeteksi Janggal</h3>
            <p style="font-size:12.5px; color:var(--gray-500); margin:2px 0 0;">Total/harga per item tidak cocok dengan data produk saat ini atau tidak konsisten secara hitungan -- cek satu per satu, mungkin memang wajar (harga produk berubah setelah pesanan dibuat), tapi layak dipastikan.</p>
          </div>
        </div>
        <a href="pesanan.html?anomali=1" class="btn-secondary btn-sm" style="white-space:nowrap;">Cek di Daftar Pesanan</a>
      </div>
    </div>` : ""}
    <div class="grid grid-5" style="margin-bottom:20px;">
      <div class="stat-card brand">
        <div class="stat-icon"><i class="ph-bold ph-users-three"></i></div>
        <div class="stat-body"><div class="stat-label">Jumlah Pembeli</div><div class="stat-value">${pembeliUnik}</div></div>
      </div>
      <div class="stat-card brand">
        <div class="stat-icon"><i class="ph-bold ph-package"></i></div>
        <div class="stat-body"><div class="stat-label">Total Pesanan (Unit Produk)</div><div class="stat-value">${totalUnitProduk}</div><div style="font-size:11px; color:var(--brand-100); margin-top:2px;">dari ${jumlahNota} nota</div></div>
      </div>
      <div class="stat-card brand">
        <div class="stat-icon"><i class="ph-bold ph-wallet"></i></div>
        <div class="stat-body"><div class="stat-label">Total Uang</div><div class="stat-value" style="font-size:16px;">${formatRupiah(totalUang)}</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="ph-bold ph-check-circle"></i></div>
        <div class="stat-body"><div class="stat-label">Lunas / Belum Lunas</div><div class="stat-value" style="font-size:16px;"><span style="color:var(--brand-700);">${jumlahLunas}</span> / <span style="color:var(--red-600);">${jumlahBelumLunas}</span></div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><i class="ph-bold ph-basket"></i></div>
        <div class="stat-body"><div class="stat-label">Sudah Diambil / Belum Diambil</div><div class="stat-value" style="font-size:16px;"><span style="color:var(--brand-700);">${jumlahDiambil}</span> / <span style="color:var(--red-600);">${jumlahBelumDiambil}</span></div></div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <div class="card-heading"><span class="card-heading-icon"><i class="ph-bold ph-trend-up"></i></span><h3>Pesanan Masuk</h3></div>
        <select id="chart-granularitas" style="width:auto; min-width:140px;">
          <option value="harian" ${dashGranularitas === "harian" ? "selected" : ""}>Harian</option>
          <option value="mingguan" ${dashGranularitas === "mingguan" ? "selected" : ""}>Mingguan</option>
          <option value="bulanan" ${dashGranularitas === "bulanan" ? "selected" : ""}>Bulanan</option>
        </select>
      </div>
      <p style="font-size:12px; color:var(--gray-400); margin:-4px 0 12px;">Tips: pakai filter "Rentang Tanggal..." di atas untuk atur sendiri periode yang ditampilkan.</p>
      <div class="chart-waktu-box"><canvas id="chart-waktu"></canvas></div>
    </div>

    <div class="grid grid-2 chart-card-row" style="margin-top:20px;">
      <div class="card chart-card">
        <div class="card-heading" style="margin-bottom:14px;"><span class="card-heading-icon"><i class="ph-bold ph-chart-bar"></i></span><h3>Jumlah Pesanan per Produk</h3></div>
        <div class="chart-box" style="height:280px;"><canvas id="chart-produk"></canvas></div>
      </div>
      <div class="card chart-card">
        <div class="card-heading" style="margin-bottom:14px;"><span class="card-heading-icon"><i class="ph-bold ph-map-pin"></i></span><h3>Jumlah Unit Terjual per Alamat (Top 10)</h3></div>
        <div class="chart-box" style="height:280px;"><canvas id="chart-alamat"></canvas></div>
      </div>
    </div>

    <div class="card" style="margin-top:20px;">
      <div class="card-heading" style="margin-bottom:14px;"><span class="card-heading-icon"><i class="ph-bold ph-list-numbers"></i></span><h3>Detail Total per Produk${cabangColumns.length > 1 ? " per Cabang" : ""}</h3></div>
      ${
        pakaiRekapAllTime
          ? `<p style="font-size:12px; color:var(--gray-500); margin:-8px 0 14px;"><i class="ph-bold ph-info"></i> Angka di tabel ini total sepanjang waktu (semua tanggal & gelombang), tidak mengikuti filter periode di atas -- supaya Anda tetap bisa lihat total tiap cabang tanpa perlu membuka detail pesanan cabang lain.</p>`
          : ""
      }
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Produk</th>
              ${cabangColumns.map((c) => `<th style="text-align:center;">${escapeHtml(c.nama)}</th>`).join("")}
              <th style="text-align:center;">Total Semua Cabang</th>
            </tr>
          </thead>
          <tbody>
            ${
              Object.keys(tabelPerProduk).length === 0
                ? `<tr><td colspan="${cabangColumns.length + 2}" style="color:var(--gray-400);">Belum ada data.</td></tr>`
                : Object.keys(tabelPerProduk)
                    .sort((a, b) => tabelPerProduk[b] - tabelPerProduk[a])
                    .map(
                      (nama, idx) => `
                    <tr>
                      <td>${escapeHtml(nama)}${idx === 0 ? '<span class="rank-badge"><i class="ph-bold ph-trophy"></i> Terlaris</span>' : ""}</td>
                      ${cabangColumns.map((c) => `<td style="text-align:center;">${(tabelPerProdukPerCabang[nama] && tabelPerProdukPerCabang[nama][c.id]) || 0}</td>`).join("")}
                      <td style="text-align:center; font-weight:700;">${tabelPerProduk[nama]}</td>
                    </tr>`
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>
  `;

  const produkNamesUrut = Object.keys(perProduk).sort();
  const produkColorMap = buildProductColorMap(produkNamesUrut);
  drawTimeSeriesChart("chart-waktu", buildTimeSeries(orders, dashGranularitas), produkNamesUrut, produkColorMap);
  document.getElementById("chart-granularitas").addEventListener("change", (e) => {
    dashGranularitas = e.target.value;
    renderDashboard();
  });

  drawBarChart("chart-produk", perProduk, "chartProduk", "#16a34a");
  const topAlamat = Object.entries(perAlamat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reverse();
  drawBarChart("chart-alamat", Object.fromEntries(topAlamat), "chartAlamat", "#0ea5e9", true);
}

function drawTimeSeriesChart(canvasId, timeSeries, produkNames, produkColorMap) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (chartWaktu) chartWaktu.destroy();

  if (timeSeries.length === 0) {
    ctx.parentElement.insertAdjacentHTML("beforeend", '<p style="color:var(--gray-400); font-size:13px;">Belum ada data.</p>');
    return;
  }

  const datasets = [
    {
      label: "Total Unit",
      data: timeSeries.map((t) => t.count),
      borderColor: "#16a34a",
      backgroundColor: "rgba(22, 163, 74, 0.12)",
      fill: true,
      tension: 0.3,
      pointRadius: 3,
      pointBackgroundColor: "#16a34a",
    },
    ...produkNames.map((nama) => ({
      label: nama,
      data: timeSeries.map((t) => t.perProduk[nama] || 0),
      borderColor: produkColorMap[nama],
      backgroundColor: "transparent",
      fill: false,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 2,
      pointBackgroundColor: produkColorMap[nama],
    })),
  ];

  chartWaktu = new Chart(ctx, {
    type: "line",
    data: {
      labels: timeSeries.map((t) => t.label),
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function drawBarChart(canvasId, dataObj, varName, color, horizontal) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  const labels = Object.keys(dataObj);
  const values = Object.values(dataObj);

  if (window[varName]) window[varName].destroy();

  if (labels.length === 0) {
    ctx.parentElement.insertAdjacentHTML("beforeend", '<p style="color:var(--gray-400); font-size:13px;">Belum ada data.</p>');
    return;
  }

  window[varName] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Jumlah", data: values, backgroundColor: color, borderRadius: 6 }],
    },
    options: {
      indexAxis: horizontal ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: horizontal
        ? { x: { beginAtZero: true, ticks: { precision: 0 } } }
        : { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}
