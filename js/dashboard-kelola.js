// ============================================================
// Halaman Kelola Tampilan Dashboard
// ============================================================
// Mengatur bagian Dashboard mana yang tampil/disembunyikan + menyalakan Statistik
// Bulanan (opsional, bawaan nonaktif). Semua tersimpan di localStorage perangkat ini
// per akun (lihat js/dashboard-prefs.js) -- tidak membaca/menulis Firestore.

let kelolaProfile = null;
let kelolaPrefs = { hidden: [], statistik: false };
let kelolaStatusTimer = null;

window.onAuthReady = function (profile) {
  kelolaProfile = profile;
  kelolaPrefs = loadDashPrefs(profile.uid);
  renderKelola();
};

function kelolaBagianTampil() {
  const semuaCabang = canAccessAllBranches(kelolaProfile);
  return DASH_SECTIONS.filter((s) => !s.semuaCabang || semuaCabang);
}

function kelolaSimpan() {
  if (!saveDashPrefs(kelolaProfile.uid, kelolaPrefs)) {
    showToast("Pengaturan gagal disimpan (penyimpanan browser diblokir).", "error");
    return false;
  }
  const el = document.getElementById("kelola-status");
  if (el) {
    el.textContent = "Tersimpan";
    clearTimeout(kelolaStatusTimer);
    kelolaStatusTimer = setTimeout(() => {
      const e2 = document.getElementById("kelola-status");
      if (e2) e2.textContent = "";
    }, 1500);
  }
  return true;
}

function kelolaToggle(key, tampil) {
  const hidden = new Set(kelolaPrefs.hidden);
  if (tampil) hidden.delete(key);
  else hidden.add(key);
  kelolaPrefs.hidden = [...hidden];
  kelolaSimpan();
  kelolaRingkasanGrup();
}

function kelolaSemua(tampil) {
  const kunciDiKelola = new Set(kelolaBagianTampil().map((s) => s.key));
  const hidden = new Set(kelolaPrefs.hidden.filter((k) => !kunciDiKelola.has(k))); // kunci yang tidak ditampilkan untuk role ini dibiarkan
  if (!tampil) kunciDiKelola.forEach((k) => hidden.add(k));
  kelolaPrefs.hidden = [...hidden];
  kelolaSimpan();
  renderKelola();
}

function kelolaReset() {
  kelolaPrefs = { hidden: [], statistik: false };
  kelolaSimpan();
  renderKelola();
  showToast("Tampilan dikembalikan ke bawaan.", "success");
}

function kelolaStatistik(aktif) {
  kelolaPrefs.statistik = aktif;
  kelolaSimpan();
}

function kelolaUang(sembunyi) {
  try {
    localStorage.setItem("dashboardMoneyHidden", sembunyi ? "1" : "0"); // kunci yang sama dengan ikon mata di Dashboard
  } catch (e) {
    showToast("Pengaturan gagal disimpan (penyimpanan browser diblokir).", "error");
  }
}

function kelolaBaris(label, desc, key, checked, onchange) {
  return `
    <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--gray-100); cursor:pointer;">
      <span>
        <span style="font-size:13.5px; font-weight:500;">${escapeHtml(label)}</span>
        ${desc ? `<br><span style="font-size:12px; color:var(--gray-500);">${escapeHtml(desc)}</span>` : ""}
      </span>
      <input type="checkbox" ${key ? `data-key="${key}"` : ""} ${checked ? "checked" : ""} onchange="${onchange}" style="width:20px; height:20px;" />
    </label>`;
}

// Ringkasan "X dari Y tampil" di judul tiap grup -- diperbarui tanpa merender ulang seluruh halaman
function kelolaRingkasanGrup() {
  const hidden = new Set(kelolaPrefs.hidden);
  const grup = {};
  kelolaBagianTampil().forEach((s) => {
    grup[s.grup] = grup[s.grup] || { total: 0, tampil: 0 };
    grup[s.grup].total += 1;
    if (!hidden.has(s.key)) grup[s.grup].tampil += 1;
  });
  Object.entries(grup).forEach(([nama, g]) => {
    const el = document.getElementById("kelola-jumlah-" + nama.replace(/[^a-z0-9]/gi, "_"));
    if (el) el.textContent = `${g.tampil} dari ${g.total} tampil`;
  });
}

function renderKelola() {
  const hidden = new Set(kelolaPrefs.hidden);
  const uangSembunyi = localStorage.getItem("dashboardMoneyHidden") === "1";
  const bagian = kelolaBagianTampil();
  const grupUrut = [];
  bagian.forEach((s) => {
    if (!grupUrut.includes(s.grup)) grupUrut.push(s.grup);
  });

  const kartuGrup = grupUrut
    .map((nama) => {
      const item = bagian.filter((s) => s.grup === nama);
      const tampil = item.filter((s) => !hidden.has(s.key)).length;
      return `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <h3 style="margin:0; font-size:15px;">${escapeHtml(nama)}</h3>
          <span id="kelola-jumlah-${nama.replace(/[^a-z0-9]/gi, "_")}" style="font-size:12px; color:var(--gray-500);">${tampil} dari ${item.length} tampil</span>
        </div>
        ${item.map((s) => kelolaBaris(s.label, s.desc || "", s.key, !hidden.has(s.key), `kelolaToggle('${s.key}', this.checked)`)).join("")}
      </div>`;
    })
    .join("");

  document.getElementById("kelola-content").innerHTML = `
    <div class="content-fade-in">
      <div class="card" style="margin-bottom:16px;">
        <h3 style="margin:0 0 4px; font-size:15px;">Umum</h3>
        ${kelolaBaris("Sembunyikan angka uang", "Angka Rupiah di kartu, daftar, dan grafik tampil sebagai ********. Sama dengan ikon mata di kartu Total Uang.", "", uangSembunyi, "kelolaUang(this.checked)")}
        ${kelolaBaris("Statistik Bulanan (tahun ini vs tahun lalu)", "Bawaan nonaktif. Memuat semua pesanan sejak Januari tahun lalu (1 bacaan database per pesanan), lalu disimpan sementara 30 menit. Mengikuti filter Produk, Gelombang, Cabang, dan Alamat di Dashboard.", "", kelolaPrefs.statistik, "kelolaStatistik(this.checked)")}
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:16px;">
        <button type="button" class="btn-secondary btn-sm" onclick="kelolaSemua(true)"><i class="ph-bold ph-eye"></i> Tampilkan Semua</button>
        <button type="button" class="btn-secondary btn-sm" onclick="kelolaSemua(false)"><i class="ph-bold ph-eye-slash"></i> Sembunyikan Semua</button>
        <button type="button" class="btn-secondary btn-sm" onclick="kelolaReset()"><i class="ph-bold ph-arrow-counter-clockwise"></i> Kembalikan ke Bawaan</button>
        <span id="kelola-status" style="font-size:12.5px; color:var(--brand-700); font-weight:600;"></span>
      </div>

      ${kartuGrup}

      <p style="font-size:12px; color:var(--gray-500);"><i class="ph-bold ph-info"></i> Pengaturan ini tersimpan di perangkat dan browser ini untuk akun Anda -- tidak ikut pindah ke perangkat lain, dan tidak mengubah tampilan akun lain. Bagian yang disembunyikan tidak ikut dirender (tidak menambah beban halaman).</p>
    </div>`;
}
