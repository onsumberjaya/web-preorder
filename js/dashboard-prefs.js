// ============================================================
// Pengaturan tampilan Dashboard (per akun, tersimpan di perangkat ini)
// ============================================================
// Dipakai bersama oleh dashboard.html (menerapkan) dan dashboard-kelola.html
// (mengubah). Disimpan di localStorage dengan kunci per-UID -- jadi tiap akun di
// perangkat yang sama punya pengaturan sendiri, TANPA menambah pemakaian
// Firestore (tier gratis) dan tanpa perubahan Firestore Rules. Konsekuensinya:
// pengaturan berlaku per perangkat/browser, tidak ikut pindah ke perangkat lain.
//
// Bentuk data: { hidden: ["kunci-bagian", ...], statistik: false }
//  - hidden   : kunci bagian yang DISEMBUNYIKAN (bawaan: kosong = semua tampil)
//  - statistik: Statistik Bulanan (tahun ini vs tahun lalu) -- OPT-IN, bawaan
//               NONAKTIF karena memuat pesanan 2 tahun (lebih banyak bacaan).

const DASH_SECTIONS = [
  { grup: "Peringatan", key: "kpi-anomali", label: "Peringatan pesanan janggal", desc: "Kotak merah saat ada pesanan yang totalnya tidak cocok." },

  { grup: "Kartu ringkasan", key: "kpi-pembeli", label: "Jumlah Pembeli" },
  { grup: "Kartu ringkasan", key: "kpi-unit", label: "Total Pesanan (Unit Produk)" },
  { grup: "Kartu ringkasan", key: "kpi-uang", label: "Total Uang", desc: "Berisi ikon mata untuk menyembunyikan angka uang." },
  { grup: "Kartu ringkasan", key: "kpi-lunas", label: "Lunas / Belum Lunas" },
  { grup: "Kartu ringkasan", key: "kpi-diambil", label: "Sudah Diambil / Belum Diambil" },
  { grup: "Kartu ringkasan", key: "kpi-terkumpul", label: "Uang Terkumpul" },
  { grup: "Kartu ringkasan", key: "kpi-sisa", label: "Sisa Tagihan" },
  { grup: "Kartu ringkasan", key: "kpi-rata", label: "Rata-rata per Pesanan" },
  { grup: "Kartu ringkasan", key: "kpi-siap", label: "Siap Diambil" },
  { grup: "Kartu ringkasan", key: "kpi-berulang", label: "Pembeli Berulang" },

  { grup: "Grafik", key: "chart-waktu", label: "Pesanan Masuk (tren waktu)" },
  { grup: "Grafik", key: "chart-produk", label: "Jumlah Pesanan per Produk" },
  { grup: "Grafik", key: "chart-alamat", label: "Unit Terjual per Alamat (Top 10)" },
  { grup: "Grafik", key: "dx-bayar", label: "Status Pembayaran" },
  { grup: "Grafik", key: "dx-ambil", label: "Status Pengambilan" },
  { grup: "Grafik", key: "dx-hari", label: "Pesanan per Hari dalam Seminggu" },
  { grup: "Grafik", key: "dx-gelombang", label: "Unit per Gelombang (Top 10)" },
  { grup: "Grafik", key: "dx-produk-uang", label: "Omzet per Produk (Top 8)" },
  { grup: "Grafik", key: "dx-cabang", label: "Omzet per Cabang", desc: "Hanya tersedia untuk Owner dan Admin Kasir.", semuaCabang: true },
  { grup: "Grafik", key: "dx-umur", label: "Umur Tagihan Belum Lunas" },

  { grup: "Daftar & tabel", key: "list-tagih", label: "Perlu Ditagih" },
  { grup: "Daftar & tabel", key: "list-siap", label: "Siap Diambil (daftar)" },
  { grup: "Daftar & tabel", key: "list-pembeli", label: "Pembeli Teratas" },
  { grup: "Daftar & tabel", key: "tabel-produk", label: "Detail Total per Produk per Cabang" },
];

function dashPrefsKey(uid) {
  return "dashPrefs:" + uid;
}

function loadDashPrefs(uid) {
  const bawaan = { hidden: [], statistik: false };
  try {
    const raw = localStorage.getItem(dashPrefsKey(uid));
    if (!raw) return bawaan;
    const p = JSON.parse(raw);
    return {
      hidden: Array.isArray(p.hidden) ? p.hidden.filter((k) => typeof k === "string") : [],
      statistik: p.statistik === true,
    };
  } catch (e) {
    return bawaan; // data rusak / penyimpanan diblokir -> pakai bawaan (semua tampil, statistik nonaktif)
  }
}

function saveDashPrefs(uid, prefs) {
  try {
    localStorage.setItem(dashPrefsKey(uid), JSON.stringify({ hidden: prefs.hidden || [], statistik: prefs.statistik === true }));
    return true;
  } catch (e) {
    return false;
  }
}

// Buang blok <div ...data-dash="kunci"...>...</div> (lengkap dengan isinya) dari HTML dashboard.
// Dipakai supaya bagian yang disembunyikan TIDAK ikut dirender sama sekali (tidak ada
// canvas/grafik yang digambar percuma). Penutup dicari dengan menghitung <div>/</div>
// yang seimbang. Baris "grid" yang jadi kosong setelahnya ikut dibuang.
function stripDashHidden(html, hiddenKeys) {
  (hiddenKeys || []).forEach((key) => {
    const attr = `data-dash="${key}"`;
    let idx;
    while ((idx = html.indexOf(attr)) !== -1) {
      const start = html.lastIndexOf("<div", idx);
      if (start === -1) break; // atribut tidak berada di <div> -- jangan sampai loop tak berujung
      const re = /<div\b|<\/div>/g;
      re.lastIndex = start;
      let depth = 0;
      let end = -1;
      let m;
      while ((m = re.exec(html))) {
        if (m[0] === "</div>") {
          depth -= 1;
          if (depth === 0) {
            end = m.index + 6;
            break;
          }
        } else depth += 1;
      }
      if (end === -1) break;
      html = html.slice(0, start) + html.slice(end);
    }
  });
  let sebelum;
  do {
    sebelum = html;
    html = html.replace(/<div class="grid[^"]*"[^>]*>\s*<\/div>/g, "");
  } while (html !== sebelum);
  return html;
}
