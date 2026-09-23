function formatRupiah(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

function formatTanggal(dateLike) {
  if (!dateLike) return "-";
  const d = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
  if (isNaN(d)) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTanggalWaktu(dateLike) {
  if (!dateLike) return "-";
  const d = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
  if (isNaN(d)) return "-";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}

// Kode nota: PO-<2 digit tahun><4 digit nomor urut TAHUN ITU>, reset ke 0001
// tiap tahun baru. Contoh: pesanan ke-14 di tahun 2026 -> "PO-260014"; pesanan
// pertama di tahun 2027 -> "PO-270001".
// Untuk pesanan lama (dibuat sebelum fitur ini ada, belum punya nota_seq/nota_tahun),
// dipakai fallback: tahun dari field tanggal + nomor urut global (order_no).
function formatOrderNo(order) {
  if (order.nota_tahun && order.nota_seq) {
    return `PO-${String(order.nota_tahun).slice(-2)}${String(order.nota_seq).padStart(4, "0")}`;
  }
  const seq = String(order.order_no || 0).padStart(4, "0");
  let yy = new Date().getFullYear().toString().slice(-2);
  if (order.tanggal) {
    const d = order.tanggal.toDate ? order.tanggal.toDate() : new Date(order.tanggal);
    if (!isNaN(d)) yy = String(d.getFullYear()).slice(-2);
  }
  return `PO-${yy}${seq}`;
}

// Kunci angka tunggal untuk MENGURUTKAN pesanan berdasarkan nomor nota
// (tahun dulu, baru urutan dalam tahun itu) -- dipakai Daftar Pesanan supaya
// pesanan bisa diurutkan sesuai nomor nota, bukan cuma tanggal pesanan
// (yang kalau diisi tanggal yang sama oleh beberapa pesanan, urutan di
// antara mereka jadi tidak pasti/acak). Nota lama yang belum punya
// nota_tahun/nota_seq (dibuat sebelum fitur penomoran per-tahun ada) tetap
// bisa diurutkan lewat fallback ke order_no + tahun dari field "tanggal".
function getNotaSortKey(order) {
  if (order.nota_tahun && order.nota_seq) {
    return Number(order.nota_tahun) * 100000 + Number(order.nota_seq);
  }
  let yy = new Date().getFullYear();
  if (order.tanggal) {
    const d = order.tanggal.toDate ? order.tanggal.toDate() : new Date(order.tanggal);
    if (!isNaN(d)) yy = d.getFullYear();
  }
  return yy * 100000 + Number(order.order_no || 0);
}

// Ubah Firestore Timestamp/Date/null jadi angka milidetik yang bisa
// dibandingkan langsung -- dipakai buat urutkan pesanan (lihat
// getFilteredOrders() di js/pesanan.js). Nilai kosong/tidak valid dianggap 0
// (paling lama), supaya pesanan lama yang datanya tidak lengkap tetap
// muncul di urutan paling bawah, bukan bikin error.
function toMillis(value) {
  if (!value) return 0;
  const d = value.toDate ? value.toDate() : new Date(value);
  return isNaN(d) ? 0 : d.getTime();
}

// Ubah objek Date jadi string "YYYY-MM-DD" berdasarkan TANGGAL KALENDER
// LOKAL (sesuai jam di perangkat, mis. WIB), BUKAN toISOString() yang
// berbasis UTC.
//
// PERBAIKAN: sebelumnya banyak tempat di aplikasi ini pakai
// `d.toISOString().slice(0, 10)` untuk dapat string tanggal. Itu keliru
// karena toISOString() mengambil TANGGAL UTC dari momen itu, bukan tanggal
// kalender lokal. Di Indonesia (WIB = UTC+7, tidak ada perubahan musim),
// tengah malam lokal (00:00 WIB) itu masih jam 17:00 HARI SEBELUMNYA
// menurut UTC. Akibatnya:
// - Antara jam 00:00-06:59 WIB, default tanggal "hari ini" di form Input
//   Pesanan / filter Daftar Pesanan & Laporan jadi menunjukkan KEMARIN.
// - Tanggal pesanan yang disimpan sebagai tengah malam lokal (lihat pola
//   `new Date(tanggal + "T00:00:00")` di seluruh aplikasi) SELALU muncul
//   mundur 1 hari kalau dibaca ulang lewat toISOString() -- misalnya di
//   grafik tren Dashboard atau saat membuka Edit Pesanan.
// Pakai fungsi ini untuk SEMUA kebutuhan "ubah Date jadi YYYY-MM-DD",
// gantinya toISOString().slice(0, 10).
function localYmd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------- Filter Rentang Tanggal (Periode Cepat) -- SATU standar dipakai di
// semua halaman yang punya filter Dari/Sampai (Dashboard, Daftar Pesanan,
// Laporan, Laporan Keuangan, Pengeluaran, Arsip PO). Sebelumnya tiap halaman
// beda-beda: sebagian cuma 2 input tanggal polos (default macam-macam, ada
// yang 30 hari terakhir, ada yang kosong semua), Dashboard sendiri satu-
// satunya yang punya dropdown pilihan cepat. Sekarang semua pakai dropdown
// yang sama (5 pilihan) + 2 input tanggal di baliknya.
const DATE_FILTER_OPTIONS = [
  { value: "harian", label: "Hari Ini" },
  { value: "mingguan", label: "Minggu Ini" },
  { value: "bulanan", label: "Bulan Ini" },
  { value: "custom", label: "Rentang Tanggal..." },
  { value: "semua", label: "Semua Waktu" },
];

function dateFilterOptionsHtml(selected, excludeValues) {
  const excl = excludeValues || [];
  return DATE_FILTER_OPTIONS.filter((o) => !excl.includes(o.value))
    .map((o) => `<option value="${o.value}"${o.value === selected ? " selected" : ""}>${o.label}</option>`)
    .join("");
}

// mode -> { dari, sampai } sebagai string YYYY-MM-DD siap taruh ke
// input[type=date].value ("" berarti tidak dibatasi -- dipakai utk "Semua
// Waktu"). "custom" mengembalikan null (bukan diisi otomatis -- tanggalnya
// user yang isi/edit sendiri lewat 2 input di bawah dropdown).
// "mingguan" = MINGGU KALENDER (Senin s/d Minggu berjalan), bukan 7 hari
// terakhir bergulir -- konsisten dengan "bulanan" yang juga 1 Awal Bulan s/d
// akhir bulan (bukan "30 hari terakhir").
function dateFilterRangeStrings(mode) {
  const now = new Date();
  if (mode === "harian") {
    const s = localYmd(now);
    return { dari: s, sampai: s };
  }
  if (mode === "mingguan") {
    const senin = new Date(now);
    senin.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Senin minggu ini (Minggu dianggap akhir pekan, bukan awal)
    const minggu = new Date(senin);
    minggu.setDate(senin.getDate() + 6);
    return { dari: localYmd(senin), sampai: localYmd(minggu) };
  }
  if (mode === "bulanan") {
    const awal = new Date(now.getFullYear(), now.getMonth(), 1);
    const akhir = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { dari: localYmd(awal), sampai: localYmd(akhir) };
  }
  if (mode === "semua") return { dari: "", sampai: "" };
  return null; // "custom" -- biarkan input tanggal apa adanya
}

// Pasang listener di dropdown Periode Cepat: begitu diganti (kecuali ke
// "Rentang Tanggal...", yang membiarkan tanggal apa adanya), 2 input tanggal
// di sebelahnya otomatis terisi sesuai pilihan. `onFilled` dipanggil setelah
// tanggal terisi (mis. buat langsung memuat ulang data) -- TIDAK dipanggil
// saat pilih "Rentang Tanggal..." (nunggu user isi tanggalnya sendiri / tekan
// tombol Terapkan Filter, seperti alur yang sudah ada di tiap halaman).
// Kalau user mengedit input tanggal SECARA MANUAL setelah pilih preset,
// dropdown otomatis balik ke "Rentang Tanggal..." supaya tidak menyesatkan
// (menampilkan preset yang tanggalnya sudah tidak cocok lagi).
function wireDateFilterPreset(presetId, dariId, sampaiId, onFilled) {
  const presetEl = document.getElementById(presetId);
  const dariEl = document.getElementById(dariId);
  const sampaiEl = document.getElementById(sampaiId);
  if (!presetEl || !dariEl || !sampaiEl) return;
  presetEl.addEventListener("change", () => {
    const range = dateFilterRangeStrings(presetEl.value);
    if (!range) return; // "custom" -- tidak menyentuh tanggal yang sudah ada
    dariEl.value = range.dari;
    sampaiEl.value = range.sampai;
    if (onFilled) onFilled(presetEl.value);
  });
  const balikKeCustom = () => {
    if (presetEl.value !== "custom") presetEl.value = "custom";
  };
  dariEl.addEventListener("input", balikKeCustom);
  sampaiEl.addEventListener("input", balikKeCustom);
}

// PENINGKATAN UI/UX (Tahap 3): potongan HTML progress bar visual, dipakai
// bersama untuk proses panjang berulang (hapus massal, restore arsip, dst).
// Cukup timpa innerHTML container dengan hasil fungsi ini tiap iterasi.
// Animasi loading -- SATU jenis dipakai di seluruh aplikasi: spinner titik
// muter (.spinner, sama persis dengan yang tampil saat halaman pertama kali
// dibuka). Dulu ada 2 jenis animasi (spinner untuk buka halaman pertama kali,
// "skeleton" kotak abu-abu berkedip untuk muat ulang tabel) -- sekarang
// diseragamkan jadi spinner saja supaya konsisten, termasuk dengan keterangan
// fitur di halaman Tentang & Riwayat Pembaruan. Ketiga fungsi berikut
// (dipanggil lewat innerHTML dari 6 file: arsip.js, dashboard.js,
// laporan-keuangan.js, laporan.js, pengeluaran.js, pesanan.js) sengaja
// dipertahankan namanya supaya tidak perlu mengubah pemanggilnya satu per
// satu -- parameter `count` (jumlah baris/kartu) sudah tidak relevan untuk
// spinner, dibiarkan diterima tapi diabaikan.
function skeletonRows(count) {
  return `<div class="card" style="padding:0;"><div class="loading-inline"><div class="spinner"></div></div></div>`;
}
function skeletonCards(count) {
  return `<div class="loading-inline"><div class="spinner"></div></div>`;
}
// Versi ringan skeletonRows() TANPA bungkus .card -- buat dipakai di dalam
// modal/panel yang sudah punya bingkai sendiri (mis. bagian Riwayat
// Pembayaran di Detail Pesanan), supaya tidak dobel bingkai bersarang.
function skeletonRowsBare(count) {
  return `<div class="loading-inline" style="padding:16px 0;"><div class="spinner"></div></div>`;
}

// PENINGKATAN UI/UX: format ribuan otomatis saat mengetik nominal uang (mis.
// "150000" jadi "150.000" begitu diketik) -- lebih gampang dibaca/dicek
// sebelum submit, mengurangi salah ketik jumlah nol. Dipasang lewat
// formatNumberInputLive() sebagai listener "input" pada field bersangkutan.
// parseFormattedNumber() dipakai di sisi baca (submit/hitung total) untuk
// membalikkan lagi ke angka murni.
function parseFormattedNumber(str) {
  return Number(String(str || "").replace(/[^0-9]/g, "")) || 0;
}
function formatNumberInputLive(inputEl) {
  const raw = parseFormattedNumber(inputEl.value);
  inputEl.value = raw > 0 ? raw.toLocaleString("id-ID") : "";
}
// PERBAIKAN BUG: versi di atas menghapus isian field begitu hasilnya 0 --
// cocok untuk field yang MEMANG cuma valid kalau > 0 (jumlah bayar, harga
// jual, dst; field kosong lolos "required" di browser tapi tetap ditolak
// validasi JS-nya sendiri). TAPI untuk field yang 0 itu SENDIRI adalah
// jawaban sah (mis. "Bayar Sekarang" pesanan baru = 0 berarti belum bayar
// sama sekali), ini jadi bug: field itu wajib diisi (required) tapi tiap
// user mengosongkan lalu mengetik ulang "0", langsung terhapus lagi oleh
// baris di atas -- form jadi mustahil disimpan dengan nilai 0 walau memang
// itu yang diinginkan. Dipakai di "Bayar Sekarang" (Input Pesanan) & "Jumlah
// Dibayar" (Pengeluaran).
function formatNumberInputLiveAllowZero(inputEl) {
  const digits = String(inputEl.value || "").replace(/[^0-9]/g, "");
  inputEl.value = digits === "" ? "" : Number(digits).toLocaleString("id-ID");
}

function progressBarHtml(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return `
    <div style="padding:20px 4px;">
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
      <div class="progress-bar-label">${escapeHtml(label)} (${current}/${total})</div>
    </div>`;
}

function todayInputValue() {
  return localYmd(new Date());
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// PENINGKATAN UI/UX: toast dengan tombol "Batalkan" (undo) -- dipakai untuk
// hapus pesanan tunggal (lihat deleteOrder() di js/pesanan.js). Beda dari
// showToast() biasa (teks polos, auto-hilang) -- toast ini punya tombol
// aksi & TIDAK auto-hilang sebelum durationMs habis (supaya sempat diklik).
function showUndoToast(message, onUndo, durationMs) {
  let el = document.getElementById("app-undo-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "app-undo-toast";
    el.className = "undo-toast";
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" class="undo-toast-btn">Batalkan</button>`;
  el.style.display = "flex";
  const btn = el.querySelector(".undo-toast-btn");
  btn.onclick = () => {
    el.style.display = "none";
    clearTimeout(el._timer);
    onUndo();
  };
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.display = "none";
  }, durationMs);
}

function showToast(message, type) {
  type = type || "info";
  let el = document.getElementById("app-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "app-toast";
    el.style.position = "fixed";
    el.style.bottom = "20px";
    el.style.left = "50%";
    el.style.transform = "translateX(-50%)";
    el.style.zIndex = "999";
    el.style.maxWidth = "90vw";
    document.body.appendChild(el);
  }
  const colors = {
    info: "#1f2937",
    success: "#15803d",
    error: "#dc2626",
  };
  el.textContent = message;
  el.style.background = colors[type] || colors.info;
  el.style.color = "#fff";
  el.style.padding = "12px 20px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "14px";
  el.style.boxShadow = "0 4px 14px rgba(0,0,0,0.2)";
  el.style.opacity = "1";
  el.style.transition = "opacity 0.4s ease";
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.style.opacity = "0";
  }, 2800);
}

function friendlyFirebaseError(err) {
  const code = err && err.code;
  const map = {
    "auth/wrong-password": "Password salah.",
    "auth/user-not-found": "Username tidak ditemukan.",
    "auth/invalid-credential": "Username atau password salah.",
    "auth/invalid-login-credentials": "Username atau password salah.",
    "auth/too-many-requests": "Terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.",
    "auth/network-request-failed": "Gagal terhubung ke server. Cek koneksi internet Anda.",
    "auth/weak-password": "Password terlalu pendek (minimal 6 karakter).",
    "auth/email-already-in-use": "Username sudah dipakai, pilih username lain.",
    "permission-denied": "Anda tidak punya izin untuk melakukan aksi ini.",
  };
  return map[code] || (err && err.message) || "Terjadi kesalahan, silakan coba lagi.";
}

// Dipakai khusus untuk menomori ulang pesanan LAMA yang belum punya
// nota_seq (lihat fixDuplicateNotaNumbers() di js/laporan.js) -- BERDIRI
// SENDIRI, tidak ikut menaikkan counter order_no global, supaya tidak
// memboroskan nomor urut global yang sebenarnya tidak perlu berubah.
// (Penomoran untuk pesanan BARU dilakukan langsung di dalam transaksi
// penyimpanan pesanan di js/input-pesanan.js, bukan lewat fungsi terpisah,
// supaya penomoran & penyimpanan pesanan atomik dalam 1 transaksi yang sama.)
// Sama seperti getNextNotaSeq(), TAPI sekaligus menuliskan nomor nota yang
// baru diambil itu ke pesanan lama yang ditunjuk -- keduanya (naikkan
// counter + tulis ke pesanan) jadi 1 TRANSAKSI ATOMIK yang sama, bukan 2
// operasi terpisah. Dipakai oleh fixDuplicateNotaNumbers() di js/laporan.js
// untuk menomori ulang pesanan lama yang belum punya nota_seq/nota_tahun.
//
// PERBAIKAN: sebelumnya fixDuplicateNotaNumbers() memanggil getNextNotaSeq()
// (menaikkan counter) LALU baru .update() pesanannya sebagai 2 langkah
// terpisah -- persis pola "nomor nota terbuang" yang justru sudah dihindari
// dengan hati-hati di alur pembuatan pesanan BARU (lihat catatan di atas).
// Kalau .update() gagal di tengah jalan (mis. koneksi putus), counter sudah
// terlanjur naik tapi nomornya tidak pernah tertempel ke pesanan mana pun --
// bukan nomor bentrok/dobel, cuma ada lubang di urutan nomor nota. Sekarang
// keduanya digabung jadi 1 transaksi: kalau .update()-nya gagal (mis. pesanan
// itu sudah keburu dihapus orang lain), SELURUH transaksi (termasuk kenaikan
// counter-nya) ikut dibatalkan, jadi tidak ada nomor yang terbuang percuma.
async function assignLegacyNotaSeqAtomic(orderId, year) {
  const yearRef = db.collection("counters").doc("nota-" + year);
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async (tx) => {
    const yearDoc = await tx.get(yearRef);
    const nextYear = (yearDoc.exists ? yearDoc.data().seq || 0 : 0) + 1;
    tx.set(yearRef, { seq: nextYear }, { merge: true });
    tx.update(orderRef, { nota_tahun: year, nota_seq: nextYear });
    return { nota_tahun: year, nota_seq: nextYear };
  });
}

// Label & helper role: "karyawan" lama (sebelum fitur cabang) sudah dipakai
// ulang jadi "Admin Kasir"; "karyawan" yang baru sekarang berarti karyawan
// per-cabang (dibedakan lewat ADA-TIDAKNYA field cabang_id, bukan dari role
// string-nya saja -- lihat fungsi migrasi di js/cabang.js).
const ROLE_LABEL = {
  owner: "Owner",
  admin_kasir: "Admin Kasir",
  karyawan: "Karyawan",
};

function roleLabel(role) {
  return ROLE_LABEL[role] || "Karyawan";
}

// Owner & Admin Kasir bebas akses semua cabang; Karyawan (cabang) terkunci ke
// cabang_id akunnya sendiri. Dipakai berulang di pesanan.js/laporan.js/
// input-pesanan.js/dashboard.js untuk menyesuaikan query & tampilan per role.
function canAccessAllBranches(profile) {
  return !!profile && (profile.role === "owner" || profile.role === "admin_kasir");
}

const STATUS_BAYAR_LABEL = {
  lunas: "Lunas",
  cicilan: "Bayar Sebagian",
  belum_bayar: "Belum Bayar",
};
const STATUS_BAYAR_BADGE = {
  lunas: "badge-green",
  cicilan: "badge-yellow",
  belum_bayar: "badge-red",
};

function computeStatusBayar(total, paid) {
  if (paid <= 0) return "belum_bayar";
  if (paid >= total) return "lunas";
  return "cicilan";
}

// ---------- Notifikasi WhatsApp (tombol "Kirim WA", bukan otomatis penuh) ----------
// Sengaja pakai link wa.me (buka WhatsApp Web/App dengan nomor & teks pesan
// sudah terisi, staf tinggal klik kirim) -- BUKAN kirim otomatis lewat API
// pihak ketiga (Fonnte/WA Business API dst). Alasannya: app ini murni
// HTML/JS statis di GitHub Pages tanpa server/backend, jadi API key/token
// WhatsApp pihak ketiga TIDAK BISA disimpan dengan aman di kode -- siapa pun
// bisa lihat lewat "View Source"/DevTools dan mencuri tokennya. Kirim
// otomatis penuh butuh backend terpisah (Cloud Functions/Cloudflare Worker
// dst) yang di luar cakupan versi gratis ini.
function toWaNumber(noHp) {
  let n = String(noHp || "").replace(/[^0-9]/g, "");
  if (!n) return "";
  if (n.startsWith("0")) n = "62" + n.slice(1);
  else if (!n.startsWith("62")) n = "62" + n;
  return n;
}

// Validasi ringan format No. HP Indonesia sebelum pesanan disimpan --
// sengaja TETAP BOLEH DIKOSONGKAN (bukan wajib diisi, ada kalanya pembeli
// memang tidak kasih nomor), tapi KALAU diisi, formatnya dicek supaya tidak
// ada yang kesimpan salah ketik/format aneh yang bikin tombol "Kirim WA"
// nanti diam-diam membuka nomor yang salah/acak (lihat toWaNumber() di
// atas -- fungsi itu menerima APA SAJA yang mengandung angka, tidak
// memvalidasi bentuknya). Pola yang diterima: diawali 0 / 62 / +62, diikuti
// 8, lalu 7-11 digit lagi (total kira-kira 10-13 digit gaya 08xxxxxxxxx).
function isValidNoHp(noHp) {
  const trimmed = String(noHp || "").trim();
  if (!trimmed) return true;
  const cleaned = trimmed.replace(/[\s-]/g, "");
  return /^(0|62|\+62)8[0-9]{7,11}$/.test(cleaned);
}

function openWaLink(noHp, message) {
  const number = toWaNumber(noHp);
  if (!number) {
    showToast("Nomor HP pembeli tidak tersedia/tidak valid, tidak bisa buka WhatsApp.", "error");
    return;
  }
  window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, "_blank");
}

// Cari nama gelombang (wave label) sebuah item pesanan dari data produk yang
// berlaku SEKARANG. Kalau produk/gelombangnya sudah dihapus, pakai label
// yang tersimpan di pesanan sebagai fallback.
function resolveWaveLabel(item, productsMap) {
  const product = productsMap[item.product_id];
  const wave = product ? (product.waves || []).find((w) => w.id === item.wave_id) : null;
  return wave ? wave.label : item.wave_label;
}

// Deteksi (BUKAN mencegah -- itu keterbatasan Firestore Rules yang tidak
// bisa menjumlahkan list dengan panjang dinamis, lihat catatan di
// firestore.rules) kejanggalan pada sebuah pesanan, dari 3 sisi:
//  1. Harga satuan item beda dari harga gelombang yang berlaku SEKARANG di
//     data produk (bisa juga wajar kalau harga produk memang berubah SETELAH
//     pesanan dibuat -- bukan otomatis berarti kecurangan, tapi layak dicek).
//  2. Subtotal item tidak sama dengan harga_satuan x jumlah (mengindikasikan
//     data dikirim langsung lewat API/console, bukan lewat form aplikasi).
//  3. Total pesanan tidak sama dengan jumlah seluruh subtotal item.
// Kalau produk/gelombangnya sudah dihapus, pengecekan #1 dilewati untuk item
// itu (dianggap tidak bisa dicek, bukan otomatis aman/janggal).
function hasOrderAnomaly(order, productsMap) {
  const items = order.items || [];
  let sumSubtotal = 0;
  let anomaly = false;

  items.forEach((it) => {
    const hargaSatuan = Number(it.harga_satuan) || 0;
    const jumlah = Number(it.jumlah) || 0;
    const subtotal = Number(it.subtotal) || 0;
    sumSubtotal += subtotal;

    if (subtotal !== hargaSatuan * jumlah) anomaly = true;

    const product = productsMap[it.product_id];
    if (product) {
      const wave = (product.waves || []).find((w) => w.id === it.wave_id);
      if (wave && hargaSatuan !== Number(wave.harga)) anomaly = true;
    }
  });

  if (Number(order.total) !== sumSubtotal) anomaly = true;

  return anomaly;
}

// ---------- Rekap stats/produk_cabang (Dashboard: "Detail Total per Produk
// per Cabang", dipakai Karyawan cabang lihat total lintas cabang) ----------
// PERBAIKAN: sebelumnya rekap ini TIDAK PERNAH diupdate otomatis (komentar
// lama di kode menyebut fungsi "adjustProdukCabangStats()" yang ternyata
// tidak pernah benar-benar ada) -- satu-satunya cara memperbaruinya adalah
// tombol manual "Hitung Ulang" di halaman Laporan (lihat
// rebuildProdukCabangStats() di js/laporan.js). Sekarang diupdate INKREMENTAL
// di transaksi yang sama tiap kali pesanan dibuat/diedit/dihapus (lihat
// pemanggilnya di js/input-pesanan.js & js/pesanan.js) -- tombol "Hitung
// Ulang" tetap dipertahankan sebagai alat perbaikan darurat/migrasi data lama
// (kalau rekap sempat tidak sinkron, mis. dari pesanan yang dibuat sebelum
// perbaikan ini ada).

// Jumlah per product_id dari sebuah daftar items pesanan (gabung lintas
// gelombang/wave -- rekap ini memang per-produk, bukan per-gelombang).
function aggregateQtyByProduct(items) {
  const map = {};
  (items || []).forEach((it) => {
    if (!it.product_id) return;
    const qty = Number(it.jumlah) || 0;
    map[it.product_id] = (map[it.product_id] || 0) + qty;
  });
  return map;
}

// Selisih (bisa negatif) antara 2 hasil aggregateQtyByProduct() -- dipakai
// saat EDIT pesanan (item lama vs item baru, cabang_id-nya selalu sama
// karena terkunci) supaya cukup 1 penyesuaian delta, tidak perlu
// kurangi-semua-lalu-tambah-semua.
function diffQtyByProduct(oldMap, newMap) {
  const delta = {};
  new Set([...Object.keys(oldMap || {}), ...Object.keys(newMap || {})]).forEach((pid) => {
    const diff = (newMap[pid] || 0) - (oldMap[pid] || 0);
    if (diff !== 0) delta[pid] = diff;
  });
  return delta;
}

// Balik tanda semua nilai (dipakai saat pesanan DIHAPUS -- seluruh isinya
// jadi pengurangan, bukan penambahan).
function negateQtyMap(map) {
  const out = {};
  Object.keys(map || {}).forEach((pid) => (out[pid] = -map[pid]));
  return out;
}

// Terapkan deltaMap ke stats/produk_cabang DI DALAM transaksi Firestore yang
// sedang berjalan (tx) -- supaya rekap ini SELALU sinkron atomik dengan
// perubahan pesanan yang memicunya (kalau transaksinya gagal, rekap ini juga
// ikut batal, tidak ada risiko "pesanan gagal tersimpan tapi rekap sudah
// kadung berubah" atau sebaliknya). Pakai FieldValue.increment() + set()
// dengan merge:true (bukan overwrite) supaya field cabang/produk lain yang
// tidak disentuh tetap utuh -- lihat rebuildProdukCabangStats() di
// js/laporan.js untuk pembanding versi non-inkremental (hitung ulang total).
// Hapus 1 pesanan secara permanen beserta seluruh riwayat pembayarannya
// (subcollection "payments"), sekaligus menyesuaikan rekap stats/produk_cabang
// -- semuanya dalam SATU transaksi supaya atomik (kalau gagal di tengah,
// semuanya batal, tidak ada data yang jadi "yatim" separuh terhapus).
// Dipakai bersama oleh Daftar Pesanan (hapus 1 per 1 / massal) dan halaman
// Arsip PO (hapus banyak sekaligus setelah dibackup).
//
// PERBAIKAN: sebelumnya paymentsSnap dibaca lewat tx.get() ke SELURUH
// subcollection "payments" sekaligus (sebuah query/CollectionReference) DI
// DALAM transaksi. Ternyata Firestore SDK untuk BROWSER/client (beda dari
// Admin SDK di server) tidak mendukung tx.get() dengan Query/CollectionReference
// -- cuma DocumentReference tunggal yang didukung. Akibatnya baris itu SELALU
// gagal dengan error tipe SDK ("Expected type ... custom object lain") --
// bukan sesekali, tiap kali hapus pesanan lewat Detail Pesanan pasti gagal.
// Sekarang: daftar dokumen payments dibaca DI LUAR transaksi lebih dulu
// (query biasa, bukan tx.get()) untuk tahu ID-ID-nya, baru masing-masing
// referensinya dihapus DI DALAM transaksi bersama pesanan induknya.
// Konsekuensi: kalau ada pembayaran baru masuk PERSIS di jendela waktu
// sangat sempit (hitungan milidetik) antara baca daftar ini dan transaksi
// selesai, pembayaran itu berisiko jadi "yatim" (payment ada tapi order
// induknya sudah terhapus) -- risiko sangat kecil, cuma memengaruhi 1
// dokumen kecil, dan ini batasan bawaan SDK Web Firestore itu sendiri
// (tidak bisa dihindari sepenuhnya dari sisi klien tanpa Cloud Function).
async function deleteOrderCascade(id) {
  const orderRef = db.collection("orders").doc(id);
  const paymentsSnap = await orderRef.collection("payments").get();
  await db.runTransaction(async (tx) => {
    const orderDoc = await tx.get(orderRef);
    if (!orderDoc.exists) return; // sudah terhapus lebih dulu (mis. tab lain)
    const order = orderDoc.data();

    paymentsSnap.docs.forEach((d) => tx.delete(d.ref));
    tx.delete(orderRef);

    // Rekap stats/produk_cabang & stats/produk_gelombang: kurangi qty
    // pesanan yang dihapus ini dari kedua rekap sekaligus.
    applyProdukCabangStatsDelta(tx, order.cabang_id, negateQtyMap(aggregateQtyByProduct(order.items)));
    applyProdukGelombangStatsDelta(tx, negateQtyMap(aggregateQtyByWave(order.items)));
  });
}

// ---------- Serialisasi Timestamp Firestore untuk file Backup Arsip PO ----------
// File backup disimpan sebagai JSON biasa (supaya bisa dibuka & diperiksa
// user), tapi field tanggal di pesanan (tanggal, created_at, tanggal_ambil,
// edit_log[].at, dst) tersimpan sebagai objek Timestamp Firestore, BUKAN
// string -- JSON.stringify() bawaan tidak tahu cara mengubahnya balik jadi
// Timestamp saat di-restore. Makanya sebelum disimpan ke file, semua
// Timestamp diubah dulu jadi bentuk { __ts:true, iso:"..." } (dikenali balik
// oleh tsPlainToFirestore() saat restore), jalan rekursif ke semua
// object/array supaya field manapun (termasuk yang bersarang di dalam
// edit_log) ikut ketemu tanpa perlu daftar nama field secara manual.
function tsFirestoreToPlain(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && typeof value.toDate === "function" && typeof value.seconds === "number") {
    return { __ts: true, iso: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(tsFirestoreToPlain);
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((k) => (out[k] = tsFirestoreToPlain(value[k])));
    return out;
  }
  return value;
}

function tsPlainToFirestore(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "object" && value.__ts === true && typeof value.iso === "string") {
    return firebase.firestore.Timestamp.fromDate(new Date(value.iso));
  }
  if (Array.isArray(value)) return value.map(tsPlainToFirestore);
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((k) => (out[k] = tsPlainToFirestore(value[k])));
    return out;
  }
  return value;
}

function applyProdukCabangStatsDelta(tx, cabangId, deltaMap) {
  const keys = Object.keys(deltaMap || {}).filter((pid) => deltaMap[pid] !== 0);
  if (keys.length === 0) return;
  const cabangKey = cabangId || "__tanpa_cabang__";
  const ref = db.collection("stats").doc("produk_cabang");
  const update = {};
  keys.forEach((productId) => {
    update[productId] = { [cabangKey]: firebase.firestore.FieldValue.increment(deltaMap[productId]) };
  });
  tx.set(ref, update, { merge: true });
}

// Rekap qty per KOMBINASI produk+gelombang (bukan per cabang) -- dipakai
// untuk peringatan "Kuota" di halaman Input Pesanan & Produk & Batch (lihat
// aggregateQtyByWave() di bawah). Key-nya berbentuk "productId::waveId",
// disimpan flat (bukan object bersarang seperti produk_cabang) karena cukup
// 1 angka per kombinasi, tidak perlu breakdown lagi per sub-kategori lain.
function aggregateQtyByWave(items) {
  const map = {};
  (items || []).forEach((it) => {
    if (!it.product_id || !it.wave_id) return;
    const key = `${it.product_id}::${it.wave_id}`;
    const qty = Number(it.jumlah) || 0;
    map[key] = (map[key] || 0) + qty;
  });
  return map;
}

function applyProdukGelombangStatsDelta(tx, deltaMap) {
  const keys = Object.keys(deltaMap || {}).filter((k) => deltaMap[k] !== 0);
  if (keys.length === 0) return;
  const ref = db.collection("stats").doc("produk_gelombang");
  const update = {};
  keys.forEach((key) => {
    update[key] = firebase.firestore.FieldValue.increment(deltaMap[key]);
  });
  tx.set(ref, update, { merge: true });
}

// Kontrol paginasi bergaya sama, dipakai bersama oleh Daftar Pesanan &
// Laporan & Export. gotoFnName adalah NAMA fungsi (string) yang sudah
// didefinisikan global di halaman masing-masing (mis. "goToPage" di
// pesanan.js, "goToLapPage" di laporan.js) -- dipanggil lewat onclick, jadi
// tiap halaman bebas menyimpan state currentPage/pageSize-nya sendiri.
function renderPaginationControls(currentPage, pageSize, totalItems, gotoFnName) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) {
    return `<p style="text-align:center; font-size:12.5px; color:var(--gray-400); margin-top:10px;">${totalItems} data</p>`;
  }

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + 4);
  start = Math.max(1, end - 4);
  const pageNumbers = [];
  for (let p = start; p <= end; p++) pageNumbers.push(p);

  return `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-top:14px;">
      <span style="font-size:12.5px; color:var(--gray-500);">Menampilkan ${startItem}–${endItem} dari ${totalItems} data</span>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="btn-secondary btn-sm" onclick="${gotoFnName}(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}><i class="ph-bold ph-caret-left"></i></button>
        ${start > 1 ? `<button class="btn-secondary btn-sm" onclick="${gotoFnName}(1)">1</button>${start > 2 ? '<span style="color:var(--gray-400);">…</span>' : ""}` : ""}
        ${pageNumbers
          .map(
            (p) =>
              `<button class="btn-sm" style="min-width:32px; ${p === currentPage ? "background:var(--brand-600); color:#fff; border-color:var(--brand-600);" : "background:#fff; border:1px solid var(--gray-200); color:var(--gray-700);"}" onclick="${gotoFnName}(${p})">${p}</button>`
          )
          .join("")}
        ${end < totalPages ? `${end < totalPages - 1 ? '<span style="color:var(--gray-400);">…</span>' : ""}<button class="btn-secondary btn-sm" onclick="${gotoFnName}(${totalPages})">${totalPages}</button>` : ""}
        <button class="btn-secondary btn-sm" onclick="${gotoFnName}(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}><i class="ph-bold ph-caret-right"></i></button>
      </div>
    </div>
  `;
}

// Dipakai saat menyimpan pesanan (baru maupun edit) di js/input-pesanan.js,
// supaya format Nama & Alamat konsisten di SEMUA tampilan (Daftar Pesanan,
// Laporan, Nota, Dashboard, export Excel/PDF) -- karena semuanya menampilkan
// nilai field ini apa adanya dari database, cukup diformat sekali saat
// disimpan, tidak perlu diformat ulang di tiap halaman yang menampilkannya.
function formatNamaPembeli(str) {
  return (str || "").trim().toUpperCase();
}

function formatAlamat(str) {
  return (str || "")
    .trim()
    .toLowerCase()
    .replace(/(^|\s)([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());
}

// Modal konfirmasi kustom BERSAMA (dimuat lewat utils.js di semua halaman)
// -- menggantikan confirm() bawaan browser yang tampilannya beda-beda tiap
// browser/OS dan tidak bisa diberi gaya. bodyHtml boleh HTML biasa (dipakai
// input-pesanan.js untuk peringatan "belum lunas" yang perlu format lebih
// kaya, bukan cuma teks polos). Mengembalikan Promise<boolean> (true = user
// klik tombol konfirmasi).
function ensureConfirmModal() {
  if (document.getElementById("shared-confirm-modal")) return;
  const div = document.createElement("div");
  div.innerHTML = `
    <div class="modal-backdrop" id="shared-confirm-modal" style="display:none;">
      <div class="modal-box" style="max-width:420px;">
        <div id="shared-confirm-modal-body" style="font-size:14px; color:var(--gray-700);"></div>
        <div style="display:flex; gap:10px; margin-top:18px;">
          <button type="button" id="shared-confirm-modal-ok" style="flex:1; justify-content:center;">Lanjutkan</button>
          <button type="button" class="btn-secondary" id="shared-confirm-modal-cancel">Batal</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(div.firstElementChild);
}

// opts.okLabel: teks tombol konfirmasi (default "Lanjutkan").
// opts.danger: true untuk aksi yang merusak/tidak bisa dibatalkan (mis.
// hapus) -- tombolnya jadi merah (.btn-danger) alih-alih hijau (.btn-primary).
function showConfirmModal(bodyHtml, opts) {
  opts = opts || {};
  ensureConfirmModal();
  return new Promise((resolve) => {
    const modal = document.getElementById("shared-confirm-modal");
    document.getElementById("shared-confirm-modal-body").innerHTML = bodyHtml;
    modal.style.display = "flex";

    const okBtn = document.getElementById("shared-confirm-modal-ok");
    const cancelBtn = document.getElementById("shared-confirm-modal-cancel");
    okBtn.textContent = opts.okLabel || "Lanjutkan";
    okBtn.className = opts.danger ? "btn-danger" : "btn-primary";

    const cleanup = (result) => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ---------- Mode Gelap / Terang ----------
// Preferensi disimpan per perangkat (localStorage), tidak disinkron ke akun.
// Anti-flash: atribut data-theme di <html> sudah diset lebih dulu lewat
// script kecil di <head> tiap halaman (sebelum CSS sempat dirender), fungsi
// di sini cuma menangani toggle & sinkronisasi ikon/switch setelah itu.
function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch (e) {
    // Diamkan -- kalau localStorage diblokir, tema tetap jalan untuk sesi ini saja.
  }
  updateThemeToggleUI(theme);
}

function toggleTheme() {
  applyTheme(getCurrentTheme() === "dark" ? "light" : "dark");
}

function updateThemeToggleUI(theme) {
  document.querySelectorAll("[data-theme-toggle-icon]").forEach((el) => {
    el.className = theme === "dark" ? "ph-bold ph-sun" : "ph-bold ph-moon";
  });
  document.querySelectorAll("[data-theme-toggle-label]").forEach((el) => {
    el.textContent = theme === "dark" ? "Mode Terang" : "Mode Gelap";
  });
  const sw = document.getElementById("sidebar-theme-switch");
  if (sw) sw.classList.toggle("on", theme === "dark");
}

// ---------- (Dihapus) Blokir klik kanan ----------
// PERBAIKAN: sebelumnya semua halaman mematikan klik kanan lewat
// `document.addEventListener("contextmenu", (e) => e.preventDefault())`.
// Ini dihapus karena cuma mengganggu pemakaian normal (kasir jadi tidak
// bisa klik kanan > copy nomor HP/alamat pembeli untuk ditempel ke WhatsApp
// atau aplikasi lain) tanpa memberi proteksi keamanan yang nyata -- siapa
// pun yang paham teknis tetap bisa buka DevTools lewat keyboard shortcut
// atau menu browser, klik kanan cuma satu dari banyak cara masuk ke situ.

// ---------- Hutang Usaha: pembayaran per TANGGAL BAYAR ----------
// Dipakai bersama halaman Pengeluaran (js/pengeluaran.js) dan Laporan Keuangan
// (js/laporan-keuangan.js) supaya aturan pencatatannya cuma ada di 1 tempat.
// Tiap pembayaran = 1 dokumen di pengeluaran/{id}/pembayaran (dasar Buku Kas
// kas keluar). Field paid_amount di dokumen pengeluaran tetap dijaga sebagai TOTAL
// dibayar (dipakai status & Hutang Usaha) lewat transaksi di bawah.
function hutangPaid(e) {
  return e.paid_amount !== undefined ? Number(e.paid_amount) || 0 : Number(e.jumlah) || 0;
}

// Riwayat pembayaran 1 pengeluaran. Pengeluaran LAMA (belum punya riwayat) yang
// sudah ada bagian dibayar ditampilkan sebagai 1 baris "sebelumnya" (virtual) --
// otomatis dicatat jadi riwayat begitu ada pembayaran baru.
async function hutangAmbilRiwayat(expense) {
  const snap = await db.collection("pengeluaran").doc(expense.id).collection("pembayaran").orderBy("tanggal", "asc").get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const paid = hutangPaid(expense);
  const virtual = !expense.riwayat_bayar && paid > 0 ? [{ virtual: true, tanggal: expense.tanggal, jumlah: paid, catatan: "Dibayar saat dicatat (data lama)" }] : [];
  return [...virtual, ...rows];
}

// Catat 1 pembayaran hutang (tanggal bayar sendiri). Melempar Error dengan pesan
// siap tampil kalau jumlah tidak valid (mis. melebihi sisa).
async function hutangCatatBayar(expenseId, tglVal, jumlah, profile) {
  const ref = db.collection("pengeluaran").doc(expenseId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("Catatan pengeluaran tidak ditemukan.");
    const e = snap.data();
    const total = Number(e.jumlah) || 0;
    const paid = hutangPaid(e);
    if (jumlah > total - paid) throw new Error(`Jumlah bayar melebihi sisa hutang (${formatRupiah(total - paid)}).`);
    const base = { kategori: e.kategori, keterangan: e.keterangan || "", created_by: profile.uid, created_by_name: profile.full_name, created_at: firebase.firestore.FieldValue.serverTimestamp() };
    // Pengeluaran lama yang sudah ada bagian dibayar: catat dulu sebagai pembayaran
    // awal di tanggal pengeluarannya (persis seperti perhitungan Buku Kas sebelumnya).
    if (!e.riwayat_bayar && paid > 0) {
      tx.set(ref.collection("pembayaran").doc(), { ...base, tanggal: e.tanggal, jumlah: paid, awal: true, catatan: "Dibayar saat dicatat (data lama)" });
    }
    tx.set(ref.collection("pembayaran").doc(), { ...base, tanggal: new Date(tglVal + "T00:00:00"), jumlah, catatan: "Bayar hutang" });
    const newPaid = paid + jumlah;
    tx.update(ref, { paid_amount: newPaid, status_bayar: computeStatusBayar(total, newPaid), riwayat_bayar: true });
  });
}

// Hapus 1 pembayaran (koreksi salah input) -- sisa hutang bertambah lagi.
async function hutangHapusBayar(expenseId, paymentId) {
  const ref = db.collection("pengeluaran").doc(expenseId);
  const pref = ref.collection("pembayaran").doc(paymentId);
  await db.runTransaction(async (tx) => {
    const pSnap = await tx.get(pref);
    const eSnap = await tx.get(ref);
    if (!pSnap.exists || !eSnap.exists) return;
    const e = eSnap.data();
    const total = Number(e.jumlah) || 0;
    const newPaid = Math.max(0, hutangPaid(e) - (Number(pSnap.data().jumlah) || 0));
    tx.delete(pref);
    tx.update(ref, { paid_amount: newPaid, status_bayar: computeStatusBayar(total, newPaid) });
  });
}
