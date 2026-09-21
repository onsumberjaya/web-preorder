let dashOrders = [];
let dashProducts = [];
let dashProductsMap = {};
let allCabangDash = [];
let dashStatsProdukCabang = null; // { [productId]: { [cabangId]: qty } } -- rekap all-time, lihat js/utils.js:adjustProdukCabangStats
let chartProduk = null;
let chartAlamat = null;
let chartWaktu = null;
let dashGranularitas = "harian";
let dashMetrik = "unit"; // "unit" atau "uang" -- toggle di grafik "Pesanan Masuk"
// Sembunyikan angka "Total Uang" jadi "********" (mis. dilihat orang lewat
// bahu, atau layar di-share ke orang lain) -- disimpan di localStorage
// (per PERANGKAT/browser, bukan per akun) supaya pilihannya tetap diingat
// walau halaman di-refresh atau dibuka lagi nanti, sama seperti pola dark
// mode/sidebar yang sudah ada di aplikasi ini.
let dashMoneyHidden = localStorage.getItem("dashboardMoneyHidden") === "1";
let dashHasRendered = false; // sudah pernah render (data pesanan sudah termuat)
let dashPrefs = { hidden: [], statistik: false }; // pengaturan tampilan per akun (lihat js/dashboard-prefs.js)
let dashLastTotalUang = 0; // disimpan supaya toggle bisa langsung ganti teks tanpa perlu render ulang seluruh dashboard

// Chart.js kadang tidak langsung menyesuaikan lebar canvas saat browser
// di-zoom (beda dengan kotak/box biasa yang otomatis mengikuti lebar layar
// lewat CSS). Panggil resize() manual tiap ada perubahan ukuran window
// (termasuk saat zoom in/out) supaya ketiga grafik ikut menyesuaikan.
window.addEventListener("resize", () => {
  if (chartWaktu) chartWaktu.resize();
  if (chartProduk) chartProduk.resize();
  if (chartAlamat) chartAlamat.resize();
  dashExtraCharts.forEach((c) => c.resize());
});

// Toggle tombol mata di kartu "Total Uang". Sengaja langsung ubah teks di
// DOM (bukan panggil ulang renderDashboard()) supaya responsnya instan,
// tidak perlu tunggu apa pun -- dashLastTotalUang sudah disimpan dari
// render terakhir.
function toggleDashMoneyVisibility() {
  dashMoneyHidden = !dashMoneyHidden;
  localStorage.setItem("dashboardMoneyHidden", dashMoneyHidden ? "1" : "0");
  // Sekarang banyak angka uang di dashboard (kartu, tabel, grafik) -- render ulang dari
  // data yang SUDAH ada di memori (tanpa baca Firestore) supaya semuanya ikut tersembunyi.
  if (dashHasRendered) {
    renderDashboard();
    return;
  }
  const valEl = document.getElementById("dash-total-uang-value");
  const iconEl = document.getElementById("dash-total-uang-eye-icon");
  if (valEl) valEl.textContent = dashMoneyHidden ? "********" : formatRupiah(dashLastTotalUang);
  if (iconEl) iconEl.className = dashMoneyHidden ? "ph-bold ph-eye-slash" : "ph-bold ph-eye";
}

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

function updateProdukFilterOptionsDash() {
  const select = document.getElementById("filter-produk-dash");
  const currentValue = select.value;
  select.innerHTML = '<option value="">Semua Produk</option>';
  dashProducts.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nama;
    select.appendChild(opt);
  });
  if (dashProductsMap[currentValue]) select.value = currentValue;
}

// PENINGKATAN UI/UX: filter Produk di Dashboard -- kalau produk dipilih,
// dropdown Gelombang ikut disaring cuma menampilkan gelombang milik produk
// itu (sama seperti pola di Daftar Pesanan), bukan lagi semua label
// gelombang unik dari seluruh produk.
function updateGelombangFilterOptionsDash() {
  const gelSelect = document.getElementById("filter-gelombang-dash");
  const currentValue = gelSelect.value;
  const produkId = document.getElementById("filter-produk-dash") ? document.getElementById("filter-produk-dash").value : "";
  gelSelect.innerHTML = '<option value="">Semua Gelombang</option>';
  const produk = dashProductsMap[produkId];
  if (produk) {
    (produk.waves || []).forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.label;
      opt.textContent = w.label;
      gelSelect.appendChild(opt);
    });
  } else {
    const labels = new Set();
    dashProducts.forEach((p) => (p.waves || []).forEach((w) => labels.add(w.label)));
    labels.forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      gelSelect.appendChild(opt);
    });
  }
  if ([...gelSelect.options].some((o) => o.value === currentValue)) gelSelect.value = currentValue;
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

// PERBAIKAN: sebelumnya pakai .get() (baca sekali) dengan alasan real-time
// dianggap boros -- ternyata sebaliknya, onSnapshot() cuma dihitung sebagai
// pembacaan baru untuk dokumen yang BENAR-BENAR berubah setelah pemuatan
// awal (bukan menarik ulang semua dari nol tiap kali seperti .get()). Yang
// dibikin real-time cuma query pesanan-nya saja (bagian yang paling sering
// berubah) -- daftar produk & cabang tetap dibaca sekali seperti biasa
// karena jarang berubah, tidak perlu selalu "hidup".
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
let dashOrdersUnsubscribe = null; // fungsi buat melepas listener pesanan yang sedang aktif
async function loadDashboardData(profile) {
  const container = document.getElementById("dashboard-content");
  container.innerHTML = skeletonCards(5);

  // Lepas listener SEBELUMNYA (kalau ada) dulu sebelum memasang yang baru --
  // dipanggil lagi tiap ganti periode/rentang tanggal/filter cabang, atau
  // klik "Muat Ulang". Tanpa ini, listener lama menumpuk menyala di belakang
  // layar tiap ganti filter.
  if (dashOrdersUnsubscribe) {
    dashOrdersUnsubscribe();
    dashOrdersUnsubscribe = null;
  }

  try {
    const { from, to } = getDateRange();

    // Karyawan cabang: query WAJIB dibatasi where('cabang_id', '==', ...), kalau
    // tidak Firestore rules akan menolak query ini sepenuhnya (bukan cuma
    // menyaring hasilnya) karena berpotensi mengembalikan data cabang lain.
    // Owner/Admin Kasir: kalau mereka MEMILIH salah satu cabang lewat filter
    // "Cabang" (bukan "Semua Cabang"), ikut dibatasi di query yang sama juga
    // -- sebelumnya filter ini cuma disaring di browser SETELAH membaca
    // SELURUH cabang dalam rentang tanggal itu, jadi boros baca kalau
    // tokonya punya banyak cabang tapi yang mau dilihat cuma 1. Query dengan
    // bentuk where(cabang_id)+where(tanggal) ini SAMA PERSIS dengan yang
    // sudah dipakai untuk Karyawan cabang di atas, jadi tidak perlu index
    // Firestore baru (index yang sudah ada/sudah dibuat lewat Bagian 3d di
    // PANDUAN-SETUP.md sudah cukup).
    let ordersQuery = db.collection("orders");
    if (!canAccessAllBranches(profile) && profile.cabang_id) {
      ordersQuery = ordersQuery.where("cabang_id", "==", profile.cabang_id);
    } else if (canAccessAllBranches(profile)) {
      const cabangFilterVal = document.getElementById("filter-cabang-dash") ? document.getElementById("filter-cabang-dash").value : "";
      if (cabangFilterVal) ordersQuery = ordersQuery.where("cabang_id", "==", cabangFilterVal);
    }
    if (from) ordersQuery = ordersQuery.where("tanggal", ">=", from);
    if (to) ordersQuery = ordersQuery.where("tanggal", "<=", to);

    const [prodSnap, cabangSnap] = await Promise.all([
      db.collection("products").orderBy("nama").get(),
      db.collection("cabang").orderBy("nama").get(),
    ]);
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

    updateProdukFilterOptionsDash();
    updateGelombangFilterOptionsDash();
    updateCabangFilterOptionsDash(profile);

    dashOrdersUnsubscribe = ordersQuery.onSnapshot(
      (orderSnap) => {
        dashOrders = orderSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderDashboard();
      },
      (err) => {
        container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
      }
    );
  } catch (err) {
    container.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function refreshDashboard() {
  if (dashProfile) loadDashboardData(dashProfile);
}

// Ganti periode/rentang tanggal ATAU ganti filter Cabang (khusus Owner/Admin
// Kasir) = perlu baca ulang data dari server (bentuk query-nya berubah --
// lihat komentar di loadDashboardData()), beda dari ganti filter Gelombang/
// Alamat yang cukup disaring ulang di data yang sudah ada di memori (lihat
// filteredDashOrders()).
function reloadDashboardForDateChange() {
  if (dashProfile) loadDashboardData(dashProfile);
}

window.onAuthReady = async function (profile) {
  dashProfile = profile;
  dashPrefs = loadDashPrefs(profile.uid); // pengaturan Kelola Tampilan (bagian yang disembunyikan, statistik bulanan)
  updateStatistikToggleButton();
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
  document.getElementById("filter-produk-dash").addEventListener("change", () => {
    updateGelombangFilterOptionsDash();
    renderDashboard();
  });
  document.getElementById("filter-gelombang-dash").addEventListener("change", renderDashboard);
  document.getElementById("filter-cabang-dash").addEventListener("change", reloadDashboardForDateChange);
  document.getElementById("filter-alamat-dash").addEventListener("input", debounceDashRender);
};

let dashDebounceTimer;
function debounceDashRender() {
  clearTimeout(dashDebounceTimer);
  dashDebounceTimer = setTimeout(renderDashboard, 200);
}

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

// Rentang tanggal & Cabang (kalau dipilih) SUDAH dibatasi di query Firestore
// lewat loadDashboardData() -- dashOrders yang ada di memori sudah otomatis
// sesuai itu. Fungsi ini menyaring 2 filter sisanya (Gelombang & Alamat) yang
// tidak perlu baca ulang ke server, cukup disaring di data yang sudah ada.
// Cek cabangFilter di bawah jadi cuma jaring pengaman (harusnya sudah cocok
// semua, karena query-nya sendiri sudah dibatasi) -- tidak menambah baca data.
function filteredDashOrders() {
  const produkId = document.getElementById("filter-produk-dash") ? document.getElementById("filter-produk-dash").value : "";
  const gelombang = document.getElementById("filter-gelombang-dash").value;
  const cabangFilter = document.getElementById("filter-cabang-dash").value;
  const alamat = document.getElementById("filter-alamat-dash").value.trim().toLowerCase();
  return dashOrders.filter((o) => {
    if (produkId && !(o.items || []).some((it) => it.product_id === produkId)) return false;
    if (gelombang && !(o.items || []).some((it) => resolveWaveLabelDash(it) === gelombang)) return false;
    if (cabangFilter && o.cabang_id !== cabangFilter) return false;
    if (alamat && !(o.alamat || "").toLowerCase().includes(alamat)) return false;
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
      key = localYmd(monday);
      label = `${monday.getDate()}/${monday.getMonth() + 1}-${sunday.getDate()}/${sunday.getMonth() + 1}`;
    } else {
      key = localYmd(d);
      label = d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
    }
    if (!buckets[key]) buckets[key] = { label, count: 0, uang: 0, perProduk: {} };
    buckets[key].uang += Number(o.total) || 0;
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
  const ins = buildDashInsights(orders); // kartu & grafik tambahan (lihat bagian "Insight tambahan" di bawah)
  const stat = buildStatistikSection(); // Statistik Bulanan (opsional, bawaan nonaktif) -- js/dashboard-statistik.js
  const jumlahNota = orders.length;
  const totalUnitProduk = orders.reduce(
    (sum, o) => sum + (o.items || []).reduce((s, it) => s + (Number(it.jumlah) || 0), 0),
    0
  );
  const totalUang = orders.reduce((s, o) => s + o.total, 0);
  dashLastTotalUang = totalUang; // dipakai toggleDashMoneyVisibility() supaya tidak perlu render ulang
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
  const htmlDashboard = `
    <div class="content-fade-in">
    ${jumlahJanggal > 0 ? `
    <div class="card" data-dash="kpi-anomali" style="margin-bottom:16px; background:#fef2f2; border-color:#fecaca;">
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
      <div class="stat-card brand" data-dash="kpi-pembeli">
        <div class="stat-icon"><i class="ph-bold ph-users-three"></i></div>
        <div class="stat-body"><div class="stat-label">Jumlah Pembeli</div><div class="stat-value">${pembeliUnik}</div></div>
      </div>
      <div class="stat-card brand" data-dash="kpi-unit">
        <div class="stat-icon"><i class="ph-bold ph-package"></i></div>
        <div class="stat-body"><div class="stat-label">Total Pesanan (Unit Produk)</div><div class="stat-value">${totalUnitProduk}</div><div style="font-size:11px; color:var(--brand-100); margin-top:2px;">dari ${jumlahNota} nota</div></div>
      </div>
      <div class="stat-card brand" data-dash="kpi-uang">
        <div class="stat-icon"><i class="ph-bold ph-wallet"></i></div>
        <div class="stat-body">
          <div class="stat-label" style="display:flex; align-items:center; gap:6px;">
            Total Uang
            <button type="button" onclick="toggleDashMoneyVisibility()" title="Sembunyikan/tampilkan angka" style="background:none; border:none; padding:0; cursor:pointer; color:inherit; opacity:0.8; display:inline-flex; align-items:center; font-size:13px;">
              <i class="${dashMoneyHidden ? "ph-bold ph-eye-slash" : "ph-bold ph-eye"}" id="dash-total-uang-eye-icon"></i>
            </button>
          </div>
          <div class="stat-value" style="font-size:16px;" id="dash-total-uang-value">${dashMoneyHidden ? "********" : formatRupiah(totalUang)}</div>
        </div>
      </div>
      <div class="stat-card" data-dash="kpi-lunas">
        <div class="stat-icon"><i class="ph-bold ph-check-circle"></i></div>
        <div class="stat-body"><div class="stat-label">Lunas / Belum Lunas</div><div class="stat-value" style="font-size:16px;"><span style="color:var(--brand-700);">${jumlahLunas}</span> / <span style="color:var(--red-600);">${jumlahBelumLunas}</span></div></div>
      </div>
      <div class="stat-card" data-dash="kpi-diambil">
        <div class="stat-icon"><i class="ph-bold ph-basket"></i></div>
        <div class="stat-body"><div class="stat-label">Sudah Diambil / Belum Diambil</div><div class="stat-value" style="font-size:16px;"><span style="color:var(--brand-700);">${jumlahDiambil}</span> / <span style="color:var(--red-600);">${jumlahBelumDiambil}</span></div></div>
      </div>
    </div>

    ${ins.kpiHtml}

    <div class="card" data-dash="chart-waktu" style="margin-top:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <div class="card-heading"><span class="card-heading-icon"><i class="ph-bold ph-trend-up"></i></span><h3>Pesanan Masuk</h3></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <select id="chart-metrik" style="width:auto; min-width:110px;">
            <option value="unit" ${dashMetrik === "unit" ? "selected" : ""}>Unit</option>
            <option value="uang" ${dashMetrik === "uang" ? "selected" : ""}>Rupiah</option>
          </select>
          <select id="chart-granularitas" style="width:auto; min-width:140px;">
            <option value="harian" ${dashGranularitas === "harian" ? "selected" : ""}>Harian</option>
            <option value="mingguan" ${dashGranularitas === "mingguan" ? "selected" : ""}>Mingguan</option>
            <option value="bulanan" ${dashGranularitas === "bulanan" ? "selected" : ""}>Bulanan</option>
          </select>
        </div>
      </div>
      <p style="font-size:12px; color:var(--gray-400); margin:-4px 0 12px;">Tips: pakai filter "Rentang Tanggal..." di atas untuk atur sendiri periode yang ditampilkan.</p>
      <div class="chart-waktu-box"><canvas id="chart-waktu"></canvas></div>
    </div>

    <div class="grid grid-2 chart-card-row" style="margin-top:20px;">
      <div class="card chart-card" data-dash="chart-produk">
        <div class="card-heading" style="margin-bottom:14px;"><span class="card-heading-icon"><i class="ph-bold ph-chart-bar"></i></span><h3>Jumlah Pesanan per Produk</h3></div>
        <div class="chart-box" style="height:280px;"><canvas id="chart-produk"></canvas></div>
      </div>
      <div class="card chart-card" data-dash="chart-alamat">
        <div class="card-heading" style="margin-bottom:14px;"><span class="card-heading-icon"><i class="ph-bold ph-map-pin"></i></span><h3>Jumlah Unit Terjual per Alamat (Top 10)</h3></div>
        <div class="chart-box" style="height:280px;"><canvas id="chart-alamat"></canvas></div>
      </div>
    </div>

    ${stat.html}

    ${ins.cardsHtml}

    <div class="card" data-dash="tabel-produk" style="margin-top:20px;">
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
    </div>
  `;
  // Bagian yang disembunyikan lewat "Kelola Tampilan" dibuang dari HTML SEBELUM dipasang,
  // jadi canvas & grafiknya tidak dirender sama sekali (lihat stripDashHidden di dashboard-prefs.js).
  container.innerHTML = stripDashHidden(htmlDashboard, dashPrefs.hidden);

  const produkNamesUrut = Object.keys(perProduk).sort();
  const produkColorMap = buildProductColorMap(produkNamesUrut);
  if (document.getElementById("chart-waktu")) {
    drawTimeSeriesChart("chart-waktu", buildTimeSeries(orders, dashGranularitas), produkNamesUrut, produkColorMap, dashMetrik);
    document.getElementById("chart-granularitas").addEventListener("change", (e) => {
      dashGranularitas = e.target.value;
      renderDashboard();
    });
    document.getElementById("chart-metrik").addEventListener("change", (e) => {
      dashMetrik = e.target.value;
      renderDashboard();
    });
  }

  if (document.getElementById("chart-produk")) drawBarChart("chart-produk", perProduk, "chartProduk", "#16a34a");
  if (document.getElementById("chart-alamat")) {
    const topAlamat = Object.entries(perAlamat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reverse();
    drawBarChart("chart-alamat", Object.fromEntries(topAlamat), "chartAlamat", "#0ea5e9", true);
  }
  ins.draw();
  stat.draw();
  dashHasRendered = true;
}


// ---------- Insight tambahan (kartu, grafik, dan daftar) ----------
// Semuanya dihitung dari `orders` yang SUDAH ada di memori (hasil query periode/cabang di
// loadDashboardData) -- TIDAK menambah bacaan Firestore sama sekali, jadi aman untuk
// kuota tier gratis. Karyawan cabang otomatis hanya melihat data cabangnya sendiri karena
// query pesanan mereka memang sudah dibatasi (lihat komentar di loadDashboardData).
let dashExtraCharts = [];
const DASH_PALET = ["#16a34a", "#0ea5e9", "#f59e0b", "#8b5cf6", "#14b8a6", "#ec4899", "#dc2626", "#64748b"];

function dashRp(n) {
  return dashMoneyHidden ? "********" : formatRupiah(n);
}
function dashDestroyExtraCharts() {
  dashExtraCharts.forEach((c) => c.destroy());
  dashExtraCharts = [];
}
function dashTanggalObj(o) {
  return o.tanggal && typeof o.tanggal.toDate === "function" ? o.tanggal.toDate() : new Date(o.tanggal);
}
function dashUmurHari(o) {
  return Math.max(0, Math.floor((Date.now() - dashTanggalObj(o).getTime()) / 86400000));
}
function dashSisa(o) {
  return Math.max(0, (Number(o.total) || 0) - (Number(o.paid_amount) || 0));
}
function dashSingkat(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".", ",").replace(",0", "")}jt` : n >= 1e3 ? `${Math.round(n / 1e3)}rb` : String(n);
}

function dashStat(key, icon, label, value, sub) {
  return `
      <div class="stat-card" data-dash="${key}">
        <div class="stat-icon"><i class="ph-bold ${icon}"></i></div>
        <div class="stat-body">
          <div class="stat-label">${label}</div>
          <div class="stat-value" style="font-size:16px;">${value}</div>
          ${sub ? `<div style="font-size:11px; color:var(--gray-500); margin-top:2px;">${sub}</div>` : ""}
        </div>
      </div>`;
}
function dashChartCard(id, icon, judul, ada, catatan, pesanKosong) {
  return `
      <div class="card chart-card" data-dash="${id}">
        <div class="card-heading" style="margin-bottom:${catatan ? 4 : 14}px;"><span class="card-heading-icon"><i class="ph-bold ${icon}"></i></span><h3>${judul}</h3></div>
        ${catatan ? `<p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;">${catatan}</p>` : ""}
        ${ada ? `<div class="chart-box" style="height:260px;"><canvas id="${id}"></canvas></div>` : `<p style="color:var(--gray-400); font-size:13px; margin:14px 0 6px;">${pesanKosong || "Belum ada data."}</p>`}
      </div>`;
}
function dashListCard(key, icon, judul, catatan, headHtml, rowsHtml) {
  return `
      <div class="card" data-dash="${key}">
        <div class="card-heading" style="margin-bottom:${catatan ? 4 : 14}px;"><span class="card-heading-icon"><i class="ph-bold ${icon}"></i></span><h3>${judul}</h3></div>
        ${catatan ? `<p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;">${catatan}</p>` : ""}
        ${rowsHtml ? `<div class="table-wrap"><table class="table"><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>` : `<p style="color:var(--gray-400); font-size:13px; margin:14px 0 6px;">Tidak ada.</p>`}
      </div>`;
}

function buildDashInsights(orders) {
  dashDestroyExtraCharts();
  const num = (v) => Number(v) || 0;
  const semuaCabang = canAccessAllBranches(dashProfile);
  const cabangNama = {};
  allCabangDash.forEach((c) => (cabangNama[c.id] = c.nama));

  const totalUang = orders.reduce((s, o) => s + num(o.total), 0);
  const terkumpul = orders.reduce((s, o) => s + Math.min(num(o.paid_amount), num(o.total)), 0);
  const belumLunas = orders.filter((o) => o.status_bayar !== "lunas");
  const totalSisa = orders.reduce((s, o) => s + dashSisa(o), 0);
  const rataRata = orders.length ? totalUang / orders.length : 0;
  const persenTerkumpul = totalUang > 0 ? Math.round((terkumpul / totalUang) * 100) : 0;

  const statusBayar = { lunas: 0, cicilan: 0, belum_bayar: 0 };
  const ambil = { sudah: 0, lunasBelum: 0, belumLunasBelum: 0 };
  const siapDiambil = [];
  orders.forEach((o) => {
    if (statusBayar[o.status_bayar] !== undefined) statusBayar[o.status_bayar] += 1;
    if (o.is_diambil) ambil.sudah += 1;
    else if (o.status_bayar === "lunas") {
      ambil.lunasBelum += 1;
      siapDiambil.push(o);
    } else ambil.belumLunasBelum += 1;
  });

  // Pembeli: dikelompokkan menurut nama (huruf besar/kecil & spasi diabaikan)
  const pembeli = {};
  orders.forEach((o) => {
    const kunci = String(o.nama_pembeli || "").trim().toLowerCase() || "(tanpa nama)";
    if (!pembeli[kunci]) pembeli[kunci] = { nama: (o.nama_pembeli || "").trim() || "(tanpa nama)", pesanan: 0, unit: 0, total: 0 };
    const b = pembeli[kunci];
    b.pesanan += 1;
    b.total += num(o.total);
    b.unit += (o.items || []).reduce((s, it) => s + num(it.jumlah), 0);
  });
  const pembeliArr = Object.values(pembeli);
  const berulang = pembeliArr.filter((b) => b.pesanan >= 2).length;

  const hariMinggu = [0, 0, 0, 0, 0, 0, 0]; // Senin..Minggu (jumlah nota)
  const gelombang = {};
  const omzetProduk = {};
  const omzetCabang = {};
  orders.forEach((o) => {
    hariMinggu[(dashTanggalObj(o).getDay() + 6) % 7] += 1;
    const cab = !o.cabang_id ? "Tanpa Cabang" : cabangNama[o.cabang_id] || "Cabang (dihapus)";
    omzetCabang[cab] = (omzetCabang[cab] || 0) + num(o.total);
    (o.items || []).forEach((it) => {
      const g = resolveWaveLabelDash(it) || "(tanpa gelombang)";
      gelombang[g] = (gelombang[g] || 0) + num(it.jumlah);
      omzetProduk[it.product_name] = (omzetProduk[it.product_name] || 0) + num(it.subtotal);
    });
  });

  // Umur tagihan (dari tanggal pesanan) -- hanya yang belum lunas di periode ini
  const umur = [
    { label: "0-7 hari", sisa: 0 },
    { label: "8-14 hari", sisa: 0 },
    { label: "15-30 hari", sisa: 0 },
    { label: "> 30 hari", sisa: 0 },
  ];
  belumLunas.forEach((o) => {
    const u = dashUmurHari(o);
    umur[u <= 7 ? 0 : u <= 14 ? 1 : u <= 30 ? 2 : 3].sisa += dashSisa(o);
  });

  // ---- kartu angka (baris kedua) ----
  const kpiHtml = `
    <div class="grid grid-5" style="margin-top:0; margin-bottom:20px;">
      ${dashStat("kpi-terkumpul", "ph-hand-coins", "Uang Terkumpul", dashRp(terkumpul), `${persenTerkumpul}% dari total pesanan`)}
      ${dashStat("kpi-sisa", "ph-hourglass-medium", "Sisa Tagihan", dashRp(totalSisa), `${belumLunas.length} pesanan belum lunas`)}
      ${dashStat("kpi-rata", "ph-receipt", "Rata-rata per Pesanan", dashRp(rataRata), `dari ${orders.length} pesanan`)}
      ${dashStat("kpi-siap", "ph-package", "Siap Diambil", String(ambil.lunasBelum), "lunas, menunggu pembeli")}
      ${dashStat("kpi-berulang", "ph-arrows-clockwise", "Pembeli Berulang", String(berulang), `pesan 2x atau lebih, dari ${pembeliArr.length} pembeli`)}
    </div>`;

  // ---- kartu grafik & daftar ----
  const adaOrders = orders.length > 0;
  const pesanUangSembunyi = "Angka uang disembunyikan (klik ikon mata di kartu Total Uang untuk menampilkan).";
  const gelombangUrut = Object.entries(gelombang).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const produkUangUrut = Object.entries(omzetProduk).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const cabangUrut = Object.entries(omzetCabang).sort((a, b) => b[1] - a[1]);
  const adaTagihan = belumLunas.length > 0;

  const cards = [];
  cards.push(dashChartCard("dx-bayar", "ph-check-circle", "Status Pembayaran", adaOrders, "Jumlah pesanan menurut status bayarnya."));
  cards.push(dashChartCard("dx-ambil", "ph-basket", "Status Pengambilan", adaOrders, "Sudah diambil, siap diambil (lunas), dan yang masih menunggu pelunasan."));
  cards.push(dashChartCard("dx-hari", "ph-calendar-blank", "Pesanan per Hari dalam Seminggu", adaOrders, "Kapan pesanan paling ramai masuk."));
  cards.push(dashChartCard("dx-gelombang", "ph-stack", "Unit per Gelombang (Top 10)", gelombangUrut.length > 0, "Sebaran unit pesanan menurut gelombang."));
  cards.push(dashChartCard("dx-produk-uang", "ph-coins", "Omzet per Produk (Top 8)", !dashMoneyHidden && produkUangUrut.length > 0, "Produk dengan nilai penjualan terbesar.", dashMoneyHidden ? pesanUangSembunyi : ""));
  if (semuaCabang && cabangUrut.length > 1) {
    cards.push(dashChartCard("dx-cabang", "ph-storefront", "Omzet per Cabang", !dashMoneyHidden, "Kontribusi tiap cabang terhadap total pesanan.", pesanUangSembunyi));
  }
  cards.push(dashChartCard("dx-umur", "ph-hourglass-medium", "Umur Tagihan Belum Lunas", !dashMoneyHidden && adaTagihan, "Sisa tagihan menurut umur pesanan -- makin lama makin perlu ditagih.", dashMoneyHidden ? pesanUangSembunyi : "Tidak ada tagihan belum lunas di periode ini."));

  const tagihRows = [...belumLunas]
    .sort((a, b) => dashTanggalObj(a) - dashTanggalObj(b))
    .slice(0, 8)
    .map(
      (o) => `<tr><td><a href="pesanan.html?cari=${encodeURIComponent(o.nama_pembeli || "")}">${escapeHtml(o.nama_pembeli || "-")}</a></td><td style="text-align:center;">${dashUmurHari(o)} hr</td><td style="text-align:right;">${dashRp(dashSisa(o))}</td></tr>`
    )
    .join("");
  cards.push(
    dashListCard(
      "list-tagih",
      "ph-bell-ringing",
      "Perlu Ditagih",
      `Pesanan belum lunas yang paling lama di periode ini.${semuaCabang ? ' Semua piutang ada di <a href="laporan-keuangan.html">Laporan Keuangan</a>.' : ""}`,
      `<th>Pembeli</th><th style="text-align:center;">Umur</th><th style="text-align:right;">Sisa</th>`,
      tagihRows
    )
  );
  const siapRows = [...siapDiambil]
    .sort((a, b) => dashTanggalObj(a) - dashTanggalObj(b))
    .slice(0, 8)
    .map(
      (o) => `<tr><td><a href="pesanan.html?cari=${encodeURIComponent(o.nama_pembeli || "")}">${escapeHtml(o.nama_pembeli || "-")}</a></td><td style="text-align:center;">${dashUmurHari(o)} hr</td><td style="text-align:center;">${(o.items || []).reduce((s, it) => s + num(it.jumlah), 0)}</td></tr>`
    )
    .join("");
  cards.push(
    dashListCard(
      "list-siap",
      "ph-package",
      "Siap Diambil",
      "Sudah lunas tapi belum diambil pembeli -- yang paling lama menunggu di atas.",
      `<th>Pembeli</th><th style="text-align:center;">Menunggu</th><th style="text-align:center;">Unit</th>`,
      siapRows
    )
  );
  const topPembeliRows = [...pembeliArr]
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)
    .map(
      (b) => `<tr><td>${escapeHtml(b.nama)}</td><td style="text-align:center;">${b.pesanan}</td><td style="text-align:center;">${b.unit}</td><td style="text-align:right;">${dashRp(b.total)}</td></tr>`
    )
    .join("");
  cards.push(
    dashListCard(
      "list-pembeli",
      "ph-trophy",
      "Pembeli Teratas",
      "Menurut total nilai pesanan di periode ini.",
      `<th>Pembeli</th><th style="text-align:center;">Pesanan</th><th style="text-align:center;">Unit</th><th style="text-align:right;">Total</th>`,
      topPembeliRows
    )
  );

  const cardsHtml = `
    <div class="grid grid-2 chart-card-row" style="margin-top:20px;">${cards.join("")}
    </div>`;

  // ---- gambar grafik (dipanggil setelah HTML dipasang ke halaman) ----
  const draw = () => {
    if (typeof Chart === "undefined") return;
    const bikin = (id, cfg) => {
      const el = document.getElementById(id);
      if (el) dashExtraCharts.push(new Chart(el, cfg));
    };
    const dasar = { responsive: true, maintainAspectRatio: false };
    const donat = (id, labels, data, warna, satuan) =>
      bikin(id, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: warna, borderWidth: 1 }] },
        options: { ...dasar, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => (satuan === "rp" ? `${c.label}: ${formatRupiah(c.parsed)}` : `${c.label}: ${c.parsed} pesanan`) } } } },
      });
    donat("dx-bayar", ["Lunas", "Bayar Sebagian", "Belum Bayar"], [statusBayar.lunas, statusBayar.cicilan, statusBayar.belum_bayar], ["#16a34a", "#f59e0b", "#dc2626"]);
    donat("dx-ambil", ["Sudah Diambil", "Lunas, Belum Diambil", "Belum Lunas, Belum Diambil"], [ambil.sudah, ambil.lunasBelum, ambil.belumLunasBelum], ["#16a34a", "#0ea5e9", "#f59e0b"]);
    bikin("dx-hari", {
      type: "bar",
      data: { labels: ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"], datasets: [{ label: "Pesanan", data: hariMinggu, backgroundColor: "#8b5cf6", borderRadius: 6 }] },
      options: { ...dasar, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
    bikin("dx-gelombang", {
      type: "bar",
      data: { labels: gelombangUrut.map((g) => g[0]), datasets: [{ label: "Unit", data: gelombangUrut.map((g) => g[1]), backgroundColor: "#14b8a6", borderRadius: 6 }] },
      options: { ...dasar, indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } },
    });
    if (!dashMoneyHidden) {
      bikin("dx-produk-uang", {
        type: "bar",
        data: { labels: produkUangUrut.map((p) => (p[0].length > 24 ? p[0].slice(0, 23) + "…" : p[0])), datasets: [{ label: "Omzet", data: produkUangUrut.map((p) => p[1]), backgroundColor: "#16a34a", borderRadius: 6 }] },
        options: { ...dasar, indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatRupiah(c.parsed.x) } } }, scales: { x: { beginAtZero: true, ticks: { callback: (v) => dashSingkat(v) } } } },
      });
      if (semuaCabang && cabangUrut.length > 1) donat("dx-cabang", cabangUrut.map((c) => c[0]), cabangUrut.map((c) => c[1]), DASH_PALET, "rp");
      if (adaTagihan) {
        bikin("dx-umur", {
          type: "bar",
          data: { labels: umur.map((u) => u.label), datasets: [{ label: "Sisa tagihan", data: umur.map((u) => u.sisa), backgroundColor: ["#16a34a", "#f59e0b", "#f97316", "#dc2626"], borderRadius: 6 }] },
          options: { ...dasar, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatRupiah(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => dashSingkat(v) } } } },
        });
      }
    }
  };

  return { kpiHtml, cardsHtml, draw };
}

function drawTimeSeriesChart(canvasId, timeSeries, produkNames, produkColorMap, metrik) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (chartWaktu) chartWaktu.destroy();

  if (timeSeries.length === 0) {
    ctx.parentElement.insertAdjacentHTML("beforeend", '<p style="color:var(--gray-400); font-size:13px;">Belum ada data.</p>');
    return;
  }

  // Mode "Rupiah": cuma 1 garis total omzet -- garis per produk (dalam unit)
  // tidak relevan digabung di skala uang, jadi disembunyikan di mode ini.
  const datasets =
    metrik === "uang"
      ? [
          {
            label: "Total Uang (Rp)",
            data: timeSeries.map((t) => t.uang),
            borderColor: "#16a34a",
            backgroundColor: "rgba(22, 163, 74, 0.12)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: "#16a34a",
          },
        ]
      : [
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
      plugins: {
        legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: metrik === "uang" ? { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatRupiah(ctx.parsed.y)}` } } : {},
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks:
            metrik === "uang"
              ? { callback: (value) => (value >= 1000000 ? `${value / 1000000}jt` : value >= 1000 ? `${value / 1000}rb` : value) }
              : { precision: 0 },
        },
      },
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
