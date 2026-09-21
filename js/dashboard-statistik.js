// ============================================================
// Statistik Bulanan Dashboard: tahun ini vs tahun lalu (OPSIONAL)
// ============================================================
// Bawaan NONAKTIF (lihat dashboard-prefs.js). Dinyalakan manual lewat tombol
// "Statistik Bulanan" di Dashboard atau di halaman Kelola Tampilan.
//
// Kenapa opsional: statistik ini membaca SEMUA pesanan sejak 1 Januari tahun lalu
// (1 bacaan per pesanan) -- jauh lebih banyak daripada filter periode Dashboard
// biasa, padahal tier gratis Firebase dibatasi 50 ribu bacaan/hari. Supaya hemat:
//   - dibaca SEKALI lalu disaring ulang di memori tiap filter berubah (0 bacaan),
//   - hasilnya disimpan di sessionStorage 30 menit (pindah-pindah halaman tidak
//     membaca ulang), dan
//   - "Muat Ulang" manual untuk memaksa membaca ulang.
// Mengikuti filter Produk, Gelombang, Cabang, dan Alamat di Dashboard (filter Periode
// diabaikan karena statistik ini selalu 2 tahun penuh). Pesanan yang sudah diarsipkan &
// dihapus dari database ditambahkan dari rekap bulanan arsip (hanya omzet & jumlah
// pesanan) selama TIDAK ada filter yang aktif -- rekapnya tidak dipecah per produk/
// gelombang/cabang/alamat.

const STAT_CACHE_TTL_MS = 30 * 60 * 1000;
const STAT_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
let statData = null; // { rows, arsip, n, at, year }
let statLoading = false;
let statError = null;
let statTried = false; // sudah pernah mencoba memuat (sukses/gagal) -- mencegah loop render kalau gagal
let statMetrik = "pesanan"; // pesanan | unit | omzet

function statCacheKey() {
  const lingkup = canAccessAllBranches(dashProfile) ? "all" : "cab:" + dashProfile.cabang_id;
  return `dashStat:v1:${dashProfile.uid}:${lingkup}:${new Date().getFullYear()}`;
}
function statReadCache() {
  try {
    const raw = sessionStorage.getItem(statCacheKey());
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.rows) || Date.now() - c.at > STAT_CACHE_TTL_MS) return null;
    return c;
  } catch (e) {
    return null;
  }
}
function statWriteCache(d) {
  try {
    sessionStorage.setItem(statCacheKey(), JSON.stringify(d));
  } catch (e) {
    // penyimpanan penuh/diblokir: tidak apa-apa, data tetap ada di memori halaman ini
  }
}

async function statLoad() {
  if (statLoading) return;
  statLoading = true;
  statError = null;
  try {
    const year = new Date().getFullYear();
    const from = new Date(year - 1, 0, 1);
    // Bentuk query SAMA dengan yang sudah dipakai Dashboard (cabang_id + tanggal untuk
    // Karyawan; tanggal saja untuk Owner/Admin Kasir), jadi tidak butuh index baru.
    let q = db.collection("orders");
    if (!canAccessAllBranches(dashProfile) && dashProfile.cabang_id) q = q.where("cabang_id", "==", dashProfile.cabang_id);
    q = q.where("tanggal", ">=", from);
    const snap = await q.get();
    const rows = snap.docs
      .map((d) => {
        const o = d.data();
        const t = o.tanggal && typeof o.tanggal.toDate === "function" ? o.tanggal.toDate().getTime() : new Date(o.tanggal).getTime();
        return {
          t,
          c: o.cabang_id || "",
          a: o.alamat || "",
          tot: Number(o.total) || 0,
          it: (o.items || []).map((it) => [it.product_id || "", it.wave_id || "", it.wave_label || "", Number(it.jumlah) || 0]),
        };
      })
      .filter((r) => !isNaN(r.t));
    let arsip = [];
    let bacaArsip = 0;
    if (canAccessAllBranches(dashProfile)) {
      try {
        const as = await db.collection("arsip_log").where("status", "==", "sudah_dihapus").get();
        bacaArsip = as.size;
        arsip = as.docs.map((d) => d.data().rekap_bulanan).filter(Boolean);
      } catch (e) {} // rekap arsip cuma pelengkap
    }
    statData = { rows, arsip, n: snap.size + bacaArsip, at: Date.now(), year };
    statWriteCache(statData);
  } catch (err) {
    statError = friendlyFirebaseError(err);
  } finally {
    statLoading = false;
    statTried = true;
  }
}

function statReload() {
  try {
    sessionStorage.removeItem(statCacheKey());
  } catch (e) {}
  statData = null;
  statTried = false;
  renderDashboard(); // memicu pemuatan ulang (lihat buildStatistikSection)
}

function toggleStatistikBulanan() {
  dashPrefs.statistik = !dashPrefs.statistik;
  saveDashPrefs(dashProfile.uid, dashPrefs);
  updateStatistikToggleButton();
  if (dashHasRendered) renderDashboard();
}
function updateStatistikToggleButton() {
  const btn = document.getElementById("dash-statistik-toggle-btn");
  if (!btn) return;
  btn.innerHTML = `<i class="ph-bold ph-chart-line"></i> Statistik Bulanan: ${dashPrefs.statistik ? "Aktif" : "Nonaktif"}`;
  btn.classList.toggle("btn-primary", dashPrefs.statistik);
  btn.classList.toggle("btn-secondary", !dashPrefs.statistik);
}

function statFilters() {
  const g = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : "";
  };
  return { produk: g("filter-produk-dash"), gelombang: g("filter-gelombang-dash"), cabang: g("filter-cabang-dash"), alamat: g("filter-alamat-dash").trim().toLowerCase() };
}

// Hitung per bulan (Jan..Des) untuk tahun ini & tahun lalu dengan filter Dashboard yang aktif.
// Semantik filter SAMA dengan filteredDashOrders(): pesanan dipilih utuh (semua item &
// total ikut dihitung) kalau memuat produk/gelombang yang dipilih.
function statAggregate() {
  const f = statFilters();
  const year = statData.year;
  const kosong = () => Array.from({ length: 12 }, () => ({ pesanan: 0, unit: 0, omzet: 0 }));
  const ini = kosong();
  const lalu = kosong();
  statData.rows.forEach((r) => {
    if (f.produk && !r.it.some((x) => x[0] === f.produk)) return;
    if (f.gelombang && !r.it.some((x) => resolveWaveLabelDash({ product_id: x[0], wave_id: x[1], wave_label: x[2] }) === f.gelombang)) return;
    if (f.cabang && r.c !== f.cabang) return;
    if (f.alamat && !r.a.toLowerCase().includes(f.alamat)) return;
    const d = new Date(r.t);
    const y = d.getFullYear();
    if (y !== year && y !== year - 1) return;
    const b = (y === year ? ini : lalu)[d.getMonth()];
    b.pesanan += 1;
    b.omzet += r.tot;
    b.unit += r.it.reduce((s, x) => s + x[3], 0);
  });
  const tanpaFilter = !f.produk && !f.gelombang && !f.cabang && !f.alamat;
  let arsipDipakai = 0;
  if (tanpaFilter && canAccessAllBranches(dashProfile)) {
    statData.arsip.forEach((rk) =>
      Object.entries(rk).forEach(([k, r]) => {
        const y = Number(k.slice(0, 4));
        const m = Number(k.slice(5, 7)) - 1;
        if ((y !== year && y !== year - 1) || !(m >= 0 && m < 12)) return;
        const b = (y === year ? ini : lalu)[m];
        b.pesanan += Number(r.pesanan) || 0;
        b.omzet += Number(r.omzet) || 0;
        arsipDipakai += Number(r.pesanan) || 0;
      })
    );
  }
  return { ini, lalu, year, tanpaFilter, arsipDipakai, adaArsip: statData.arsip.length > 0 };
}

// Mengembalikan { html, draw } -- html disisipkan ke Dashboard, draw() menggambar grafik
// setelah html terpasang. Nonaktif (bawaan) = tidak menghasilkan apa-apa dan TIDAK membaca data.
function buildStatistikSection() {
  const kosong = { html: "", draw: () => {} };
  if (!dashPrefs.statistik) return kosong;

  if (!statData && !statLoading && !statTried) {
    const c = statReadCache();
    if (c) {
      statData = c; // dari cache sesi: 0 bacaan
      statTried = true;
    } else {
      statLoad().then(() => {
        if (dashHasRendered && dashPrefs.statistik) renderDashboard();
      });
    }
  }

  const bungkus = (isi) => `
    <div class="card" style="margin-top:20px;">
      <div class="card-heading" style="margin-bottom:6px;"><span class="card-heading-icon"><i class="ph-bold ph-chart-line"></i></span><h3>Statistik Bulanan${statData ? `: ${statData.year} vs ${statData.year - 1}` : ""}</h3></div>
      ${isi}
    </div>`;

  if (statLoading || (!statData && !statError)) {
    return { html: bungkus(`<p style="color:var(--gray-500); font-size:13px; margin:10px 0;"><span class="spinner" style="display:inline-block; vertical-align:middle;"></span> Memuat pesanan dua tahun...</p>`), draw: () => {} };
  }
  if (statError || !statData) {
    return {
      html: bungkus(`<div class="alert alert-error" style="margin-top:10px;">${statError || "Gagal memuat statistik."}</div><button type="button" class="btn-secondary btn-sm" onclick="statReload()"><i class="ph-bold ph-arrow-clockwise"></i> Coba Lagi</button>`),
      draw: () => {},
    };
  }

  const agg = statAggregate();
  const m0 = new Date().getMonth(); // bulan berjalan (0 = Januari)
  const nilai = (b) => b[statMetrik];
  const fmt = (n) => (statMetrik === "omzet" ? dashRp(n) : String(n));
  const jumlah = (arr, sampai) => arr.slice(0, sampai + 1).reduce((s, b) => s + nilai(b), 0);
  const persen = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const chipPersen = (p) => (p === null ? "-" : `<span style="color:${p >= 0 ? "var(--brand-700)" : "var(--red-600)"}; font-weight:600;">${p >= 0 ? "▲" : "▼"} ${Math.abs(p)}%</span>`);
  const ytdIni = jumlah(agg.ini, m0);
  const ytdLalu = jumlah(agg.lalu, m0);
  const totalIni = agg.ini.reduce((s, b) => s + nilai(b), 0);
  const totalLalu = agg.lalu.reduce((s, b) => s + nilai(b), 0);
  const menit = Math.max(0, Math.round((Date.now() - statData.at) / 60000));
  const sembunyiUang = statMetrik === "omzet" && dashMoneyHidden;

  const baris = agg.ini
    .map((b, i) => {
      const depan = i > m0; // bulan yang belum terjadi di tahun ini
      const lalu = agg.lalu[i];
      return `<tr>
        <td>${STAT_BULAN[i]}${i === m0 ? ' <span style="font-size:11px; color:var(--gray-400);">(berjalan)</span>' : ""}</td>
        <td style="text-align:right;">${fmt(nilai(lalu))}</td>
        <td style="text-align:right; font-weight:600;">${depan ? "-" : fmt(nilai(b))}</td>
        <td style="text-align:right;">${depan ? "-" : chipPersen(persen(nilai(b), nilai(lalu)))}</td>
      </tr>`;
    })
    .join("");

  const catatanArsip = agg.arsipDipakai > 0
    ? `<p style="font-size:12px; color:var(--gray-500); margin:8px 0 0;"><i class="ph-bold ph-archive"></i> Termasuk ${agg.arsipDipakai} pesanan yang sudah diarsipkan &amp; dihapus dari database (dari rekap bulanan; tidak dihitung untuk metrik Unit).</p>`
    : agg.adaArsip && !agg.tanpaFilter
      ? `<p style="font-size:12px; color:var(--gray-500); margin:8px 0 0;"><i class="ph-bold ph-archive"></i> Ada pesanan yang sudah diarsipkan &amp; dihapus dari database -- tidak ikut dihitung selama filter di atas aktif (rekapnya tidak dipecah per produk/gelombang/cabang/alamat).</p>`
      : "";

  const html = bungkus(`
      <p style="font-size:12px; color:var(--gray-500); margin:0 0 10px;">Mengikuti filter Produk, Gelombang, Cabang, dan Alamat di atas (filter Periode diabaikan -- selalu Januari sampai Desember). Dimuat dari ${statData.n} dokumen, diperbarui ${menit} menit lalu; disimpan sementara di browser selama 30 menit supaya tidak membaca ulang.</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:12px;">
        <select id="stat-metrik" style="width:auto; min-width:140px;">
          <option value="pesanan" ${statMetrik === "pesanan" ? "selected" : ""}>Jumlah Pesanan</option>
          <option value="unit" ${statMetrik === "unit" ? "selected" : ""}>Unit Produk</option>
          <option value="omzet" ${statMetrik === "omzet" ? "selected" : ""}>Omzet (Rupiah)</option>
        </select>
        <button type="button" class="btn-secondary btn-sm" onclick="statReload()"><i class="ph-bold ph-arrow-clockwise"></i> Muat Ulang</button>
        <button type="button" class="btn-secondary btn-sm" onclick="toggleStatistikBulanan()"><i class="ph-bold ph-eye-slash"></i> Matikan</button>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px; margin-bottom:12px;">
        <div class="stat-card" style="margin:0;"><div class="stat-body"><div class="stat-label">Jan-${STAT_BULAN[m0]} ${agg.year}</div><div class="stat-value" style="font-size:16px;">${fmt(ytdIni)}</div><div style="font-size:11px; color:var(--gray-500);">vs ${fmt(ytdLalu)} tahun lalu &nbsp;${chipPersen(persen(ytdIni, ytdLalu))}</div></div></div>
        <div class="stat-card" style="margin:0;"><div class="stat-body"><div class="stat-label">Total ${agg.year - 1}</div><div class="stat-value" style="font-size:16px;">${fmt(totalLalu)}</div><div style="font-size:11px; color:var(--gray-500);">setahun penuh</div></div></div>
      </div>
      ${sembunyiUang ? `<p style="color:var(--gray-400); font-size:13px; margin:14px 0;">Angka uang disembunyikan (klik ikon mata di kartu Total Uang, atau atur di Kelola Tampilan).</p>` : `<div class="chart-box" style="height:280px;"><canvas id="dx-statistik-chart"></canvas></div>`}
      <div class="table-wrap" style="margin-top:12px;">
        <table class="table">
          <thead><tr><th>Bulan</th><th style="text-align:right;">${agg.year - 1}</th><th style="text-align:right;">${agg.year}</th><th style="text-align:right;">Selisih</th></tr></thead>
          <tbody>${baris}
            <tr style="font-weight:700; border-top:2px solid var(--gray-200);"><td>Total</td><td style="text-align:right;">${fmt(totalLalu)}</td><td style="text-align:right;">${fmt(totalIni)}</td><td style="text-align:right;">${chipPersen(persen(ytdIni, ytdLalu))}<div style="font-size:10.5px; font-weight:400; color:var(--gray-400);">Jan-${STAT_BULAN[m0]}</div></td></tr>
          </tbody>
        </table>
      </div>
      <p style="font-size:12px; color:var(--gray-500); margin:8px 0 0;">Bulan berjalan belum penuh, jadi selisihnya baru sebanding menjelang akhir bulan; persentase di kartu dan baris Total membandingkan Januari sampai bulan ini saja.</p>
      ${catatanArsip}`);

  const draw = () => {
    const el = document.getElementById("dx-statistik-chart");
    if (!el || typeof Chart === "undefined") return;
    document.getElementById("stat-metrik") && document.getElementById("stat-metrik").addEventListener("change", (e) => {
      statMetrik = e.target.value;
      renderDashboard();
    });
    dashExtraCharts.push(
      new Chart(el, {
        type: "bar",
        data: {
          labels: STAT_BULAN,
          datasets: [
            { label: String(agg.year - 1), data: agg.lalu.map(nilai), backgroundColor: "#94a3b8", borderRadius: 4 },
            { label: String(agg.year), data: agg.ini.map((b, i) => (i > m0 ? null : nilai(b))), backgroundColor: "#16a34a", borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: "index", intersect: false },
          plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${statMetrik === "omzet" ? formatRupiah(c.parsed.y || 0) : c.parsed.y}` } } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0, callback: (v) => (statMetrik === "omzet" ? dashSingkat(v) : v) } } },
        },
      })
    );
  };
  // Pemilih metrik juga harus berfungsi saat grafik disembunyikan (mode sembunyi uang)
  const drawSemua = () => {
    const sel = document.getElementById("stat-metrik");
    if (sel && !document.getElementById("dx-statistik-chart")) {
      sel.addEventListener("change", (e) => {
        statMetrik = e.target.value;
        renderDashboard();
      });
    }
    draw();
  };
  return { html, draw: drawSemua };
}
