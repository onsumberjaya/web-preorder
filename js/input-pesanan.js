let products = [];
let waveStatsMap = {}; // { "productId::waveId": totalQtyTerpakai } -- real-time dari stats/produk_gelombang
let lineItems = [];
let lineKeyCounter = 0;
let editOrderId = null;
let editOrderData = null;
let formReady = false;
let allCabangInput = [];
let cabangReady = false;

// ensureConfirmModal()/showConfirmModal() sekarang di js/utils.js (dipakai
// bersama semua halaman, supaya gaya popup konsisten di mana pun).

function emptyLine() {
  return { key: lineKeyCounter++, product_id: "", wave_id: "", jumlah: "1" };
}

let productsListReady = false;

window.onAuthReady = async function (profile) {
  const params = new URLSearchParams(location.search);
  editOrderId = params.get("edit");

  if (editOrderId) {
    // PERBAIKAN: sebelumnya halaman ini (item/total/data pembeli) khusus
    // Owner -- sekarang Admin Kasir & Karyawan cabang juga boleh, selama
    // pesanannya ada di cabang yang boleh mereka akses (dijaga otomatis
    // lewat Firestore Rules: percobaan buka pesanan cabang lain akan gagal
    // di db.collection("orders").doc(editOrderId).get() di bawah dan masuk
    // ke blok catch). Hapus pesanan tetap khusus Owner -- lihat pesanan.js
    // (tombol "Hapus" cuma muncul untuk Owner) & firestore.rules ("allow
    // delete: if isOwner()", tidak berubah oleh perbaikan ini).
    document.getElementById("page-heading").textContent = "Edit Pesanan";
    try {
      const orderDoc = await db.collection("orders").doc(editOrderId).get();
      if (!orderDoc.exists) {
        showToast("Pesanan tidak ditemukan.", "error");
        window.location.href = "pesanan.html";
        return;
      }
      editOrderData = { id: orderDoc.id, ...orderDoc.data() };
      lineItems = (editOrderData.items || []).map((it) => ({
        key: lineKeyCounter++,
        product_id: it.product_id,
        wave_id: it.wave_id,
        jumlah: String(it.jumlah),
      }));
      originalItemLookup = {};
      (editOrderData.items || []).forEach((it) => {
        originalItemLookup[originalItemKey(it.product_id, it.wave_id)] = {
          product_name: it.product_name,
          wave_label: it.wave_label,
          harga_satuan: it.harga_satuan,
        };
      });
    } catch (err) {
      // Bisa gagal karena macam-macam sebab (pesanan dari cabang lain yang
      // ditolak Rules, koneksi putus, dll) -- jangan lanjut render form
      // dengan editOrderData kosong (bisa crash halaman putih), langsung
      // arahkan balik ke Daftar Pesanan dengan pesan yang jelas.
      showToast("Gagal membuka pesanan ini: " + friendlyFirebaseError(err), "error");
      window.location.href = "pesanan.html";
      return;
    }
  }

  // Daftar cabang -- dipakai buat dropdown pilih cabang (Owner/Admin Kasir)
  // atau buat menampilkan nama cabang yang terkunci (Karyawan cabang).
  db.collection("cabang")
    .orderBy("nama")
    .onSnapshot(
      (snap) => {
        allCabangInput = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        cabangReady = true;
        // Render ulang PENUH (bukan cuma refresh ringan) tiap kali data
        // cabang berubah -- supaya kalau Owner menonaktifkan cabang SAAT
        // karyawannya sedang membuka halaman ini, blokirnya langsung
        // muncul real-time, tidak nunggu mereka klik Simpan dulu baru gagal.
        if (formReady) {
          renderForm();
        } else {
          tryRenderOrRefreshForm();
        }
      },
      (err) => {
        showToast("Gagal memuat cabang: " + friendlyFirebaseError(err), "error");
      }
    );

  // Real-time: kalau Owner ubah harga/gelombang/stok produk SAAT halaman ini
  // masih terbuka, harga & peringatan stok di form otomatis ikut ter-update
  // tanpa perlu refresh manual -- tapi pilihan produk/gelombang/jumlah yang
  // sedang diisi TIDAK direset, cuma harga & tampilannya yang menyesuaikan.
  db.collection("products")
    .orderBy("nama")
    .onSnapshot(
      (snap) => {
        products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        productsListReady = true;
        tryRenderOrRefreshForm();
      },
      (err) => {
        showToast("Gagal memuat produk: " + friendlyFirebaseError(err), "error");
      }
    );

  // Real-time: jumlah terpakai per gelombang, dipakai peringatan Kuota
  // (mirip peringatan Stok) di form Input Pesanan.
  db.collection("stats")
    .doc("produk_gelombang")
    .onSnapshot((doc) => {
      waveStatsMap = doc.exists ? doc.data() : {};
      if (formReady) renderLineItems();
    });
};

function tryRenderOrRefreshForm() {
  if (!productsListReady || !cabangReady) return;
  if (!formReady) {
    if (lineItems.length === 0) lineItems = [emptyLine()];
    formReady = true;
    renderForm();
  } else {
    renderLineItems();
    updateTotalDisplay();
  }
}

function cabangNamaFor(cabangId) {
  const c = allCabangInput.find((x) => x.id === cabangId);
  return c ? c.nama : "-";
}

function getProduct(id) {
  return products.find((p) => p.id === id);
}
function getWave(product, waveId) {
  return product ? (product.waves || []).find((w) => w.id === waveId) : null;
}

// Untuk mode Edit: dipetakan dari item pesanan ASLI (data yang tersimpan
// saat pesanan ini dibuat) -- dipakai sebagai cadangan kalau suatu baris
// merujuk produk/gelombang yang SUDAH DIHAPUS dari katalog sejak pesanan ini
// dibuat (jadi getProduct()/getWave() di bawah tidak ketemu apa-apa lagi).
// Tanpa ini, baris seperti itu akan bikin handleSubmit() error diam-diam
// (baca properti dari undefined/null) SEBELUM sempat masuk try/catch --
// form gagal tersimpan tanpa pesan error apapun ke Owner. Cuma relevan untuk
// baris LAMA yang tidak disentuh usernya; baris baru/yang diganti selalu
// merujuk produk yang masih ada di dropdown (tidak mungkin ghost).
let originalItemLookup = {};
function originalItemKey(productId, waveId) {
  return `${productId}::${waveId}`;
}

// Info tampilan (nama produk, label gelombang, harga satuan) untuk 1 baris
// pesanan -- utamakan data produk yang LIVE (masih ada di katalog), baru
// fallback ke data historis pesanan aslinya kalau produk/gelombangnya sudah
// dihapus. isGhost=true menandakan baris ini pakai data historis (fallback).
function resolveLineInfo(line) {
  const prod = getProduct(line.product_id);
  const wave = getWave(prod, line.wave_id);
  if (wave) {
    return { productName: prod.nama, waveLabel: wave.label, hargaSatuan: wave.harga, isGhost: false };
  }
  const fallback = originalItemLookup[originalItemKey(line.product_id, line.wave_id)];
  if (fallback) {
    return { productName: fallback.product_name, waveLabel: fallback.wave_label, hargaSatuan: fallback.harga_satuan, isGhost: true };
  }
  // Betul-betul tidak ada info sama sekali (kasus sangat jarang, mis. baris
  // baru yang produknya keburu dihapus admin lain sebelum sempat disimpan)
  // -- anggap harga 0 supaya tidak crash, bukan berarti aman/wajar.
  return { productName: prod ? prod.nama : "(Produk sudah dihapus)", waveLabel: "(Gelombang sudah dihapus)", hargaSatuan: 0, isGhost: true };
}

function lineSubtotal(line) {
  if (!line.product_id || !line.wave_id) return 0;
  const jumlah = Number(line.jumlah) || 0;
  return resolveLineInfo(line).hargaSatuan * jumlah;
}
function grandTotal() {
  return lineItems.reduce((sum, l) => sum + lineSubtotal(l), 0);
}

function renderForm() {
  const container = document.getElementById("form-container");
  const isEdit = !!editOrderId;

  // Karyawan cabang yang cabangnya sudah dinonaktifkan Owner (lihat halaman
  // Kelola Cabang) tidak boleh lagi input pesanan BARU -- riwayat pesanan
  // lama tetap bisa dilihat seperti biasa lewat Daftar Pesanan, cuma
  // halaman ini (input pesanan BARU) yang diblokir.
  //
  // CATATAN: blokir ini SENGAJA cuma berlaku untuk `!isEdit` (pesanan baru),
  // BUKAN untuk Edit Pesanan pada pesanan yang sudah ada. Karyawan cabang
  // yang cabangnya sudah nonaktif tetap BISA membuka & menyimpan Edit
  // Pesanan untuk pesanan lama miliknya sendiri (lihat juga catatan di
  // window.onAuthReady di atas soal Edit Pesanan yang sekarang tidak lagi
  // khusus Owner) -- ini kesengajaan, bukan celah yang lolos: menonaktifkan
  // cabang cuma berarti "tutup untuk transaksi BARU", bukan "riwayat
  // dibekukan total", jadi mengoreksi pesanan lama (mis. salah ketik alamat)
  // tetap harus bisa dilakukan staf cabang itu sendiri tanpa perlu minta
  // Owner turun tangan. Firestore Rules juga sengaja tidak membatasi update
  // berdasarkan status aktif cabang (cuma create yang dibatasi) -- lihat
  // firestore.rules bagian "allow create" pada match /orders/{orderId}.
  if (!isEdit) {
    const profile = window.currentUserProfile;
    if (profile && profile.role === "karyawan" && profile.cabang_id) {
      const myCabang = allCabangInput.find((c) => c.id === profile.cabang_id);
      if (myCabang && myCabang.is_active === false) {
        container.innerHTML = `
          <div class="card" style="text-align:center; padding:40px 24px;">
            <i class="ph-bold ph-storefront" style="font-size:36px; color:var(--gray-300);"></i>
            <h3 style="margin:14px 0 6px;">Cabang "${escapeHtml(myCabang.nama)}" Sedang Nonaktif</h3>
            <p style="color:var(--gray-500); font-size:13.5px; max-width:420px; margin:0 auto;">
              Owner sudah menonaktifkan cabang ini, jadi input pesanan baru sementara ditutup.
              Riwayat pesanan lama tetap bisa dilihat lewat menu Daftar Pesanan.
            </p>
            <a href="pesanan.html" class="btn-secondary" style="margin-top:16px; display:inline-flex;">Ke Daftar Pesanan</a>
          </div>`;
        return;
      }
    }
  }

  const namaVal = isEdit ? editOrderData.nama_pembeli : "";
  const alamatVal = isEdit ? editOrderData.alamat || "" : "";
  const noHpVal = isEdit ? editOrderData.no_hp || "" : "";
  const catatanVal = isEdit ? editOrderData.catatan || "" : "";
  const tanggalVal = isEdit && editOrderData.tanggal
    ? localYmd(editOrderData.tanggal.toDate ? editOrderData.tanggal.toDate() : new Date(editOrderData.tanggal))
    : todayInputValue();

  const profile = window.currentUserProfile;
  const isKaryawanCabang = profile && profile.role === "karyawan";
  // Cabang terkunci (tidak bisa dipilih ulang) kalau: (1) yang input Karyawan
  // cabang -- selalu terkunci ke cabangnya sendiri, atau (2) sedang Edit
  // Pesanan -- cabang_id sudah permanen sejak pesanan dibuat, tidak bisa
  // dipindah cabang lain lewat form ini.
  const cabangLocked = isKaryawanCabang || isEdit;
  const lockedCabangId = isKaryawanCabang ? profile.cabang_id : isEdit ? editOrderData.cabang_id : "";
  // Untuk akun Owner/Admin Kasir (yang boleh pilih cabang manapun) saat BUAT
  // BARU: otomatis pilihkan cabang yang namanya mengandung "pusat" (kalau
  // ada) supaya tidak perlu klik ekstra untuk kasus paling umum -- tetap
  // bisa diganti manual ke cabang lain sebelum disimpan.
  const cabangAktif = allCabangInput.filter((c) => c.is_active !== false);
  const defaultCabang = !cabangLocked ? cabangAktif.find((c) => /pusat/i.test(c.nama)) : null;
  const cabangFieldHtml = cabangLocked
    ? `<div class="field">
        <label>Cabang</label>
        <div style="background:var(--gray-50); border-radius:var(--radius-sm); padding:10px 12px; font-weight:600;">${escapeHtml(cabangNamaFor(lockedCabangId))}</div>
        <p style="font-size:12px; color:var(--gray-500); margin:4px 0 0;">${isKaryawanCabang ? "Pesanan otomatis tercatat untuk cabang Anda." : "Cabang tidak bisa diubah setelah pesanan dibuat."}</p>
      </div>`
    : `<div class="field">
        <label>Cabang *</label>
        <select id="f-cabang" required>
          <option value="">Pilih Cabang</option>
          ${cabangAktif
            .map((c) => `<option value="${c.id}" ${defaultCabang && defaultCabang.id === c.id ? "selected" : ""}>${escapeHtml(c.nama)}</option>`)
            .join("")}
        </select>
      </div>`;

  container.innerHTML = `
    <div class="order-layout">
      <div class="card order-form-col">
        <form id="order-form">
          ${cabangFieldHtml}
          <div class="field">
            <label>Tanggal *</label>
            <input type="date" id="f-tanggal" required value="${tanggalVal}" />
          </div>
          <div class="field">
            <label>Nama Pembeli *</label>
            <input type="text" id="f-nama" required minlength="3" value="${escapeHtml(namaVal)}" />
          </div>
          <div class="field">
            <label>Alamat *</label>
            <input type="text" id="f-alamat" required minlength="3" value="${escapeHtml(alamatVal)}" />
          </div>
          <div class="field">
            <label>No. HP</label>
            <input type="text" id="f-nohp" value="${escapeHtml(noHpVal)}" />
          </div>
          <div class="field">
            <label>Catatan</label>
            <textarea id="f-catatan" rows="2" placeholder="Catatan tambahan (opsional)">${escapeHtml(catatanVal)}</textarea>
          </div>

          <div class="field">
            <label style="margin-bottom:8px;">Produk Dipesan</label>
            <div id="line-items"></div>
            <button type="button" class="btn-secondary btn-sm" onclick="addLine()" style="margin-top:6px;">+ Tambah Produk Lain</button>
          </div>

          <div class="field">
            ${
              isEdit
                ? `<label>Sudah Dibayar</label>
                   <div style="background:var(--gray-50); border-radius:var(--radius-sm); padding:10px 12px; font-weight:600;">${formatRupiah(editOrderData.paid_amount || 0)}</div>
                   <p style="font-size:12px; color:var(--gray-500); margin:4px 0 0;">Tidak bisa diubah di sini supaya riwayat pembayaran tetap tercatat rapi. Untuk mencatat pembayaran baru atau melihat riwayatnya, gunakan tombol "Detail / Bayar" di Daftar Pesanan.</p>`
                : `<label>Uang Muka / Bayar Sekarang (Rp) *</label>
                   <input type="number" id="f-bayar" min="0" value="0" required />
                   <p style="font-size:12px; color:var(--gray-500); margin:4px 0 0;">Isi 0 jika belum bayar sama sekali, atau isi sesuai total untuk status Lunas.</p>`
            }
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--gray-200); padding-top:14px; margin-top:6px;">
            <span style="font-size:16px; font-weight:600;">Total Pesanan</span>
            <span id="f-total" style="font-size:20px; font-weight:700; color:var(--brand-700);">Rp 0</span>
          </div>

          <div id="order-form-alert" style="margin-top:12px;"></div>

          <div style="display:flex; gap:10px; margin-top:16px;">
            <button type="submit" class="btn-primary" style="flex:1; justify-content:center; padding:12px;" id="submit-btn">
              ${isEdit ? "Simpan Perubahan" : "Simpan Pesanan"}
            </button>
            ${isEdit ? `<a href="pesanan.html" class="btn-secondary" style="padding:12px 18px;">Batal</a>` : ""}
          </div>
        </form>
      </div>

      <div class="card order-summary-col">
        <h3 style="margin-top:0; margin-bottom:14px; font-size:15px;">Ringkasan Pesanan</h3>
        <div id="summary-body"></div>
      </div>
    </div>

    <div id="mobile-sticky-total">
      <span style="font-size:13px; color:var(--gray-500); font-weight:600;">Total Pesanan</span>
      <strong id="f-total-mobile" style="font-size:17px; color:var(--brand-700);">Rp 0</strong>
    </div>
  `;

  renderLineItems();
  document.getElementById("order-form").addEventListener("submit", handleSubmit);
  const bayarInput = document.getElementById("f-bayar");
  if (bayarInput) bayarInput.addEventListener("input", updateTotalDisplay);
  document.getElementById("f-nama").addEventListener("input", updateSummaryPanel);
  // PERBAIKAN: sebelumnya di sini cuma updateSummaryPanel() -- #f-total (&
  // #f-total-mobile) baru terisi angka yang benar setelah ada interaksi
  // (ubah jumlah/ubah bayar), jadi kalau baru buka Edit Pesanan untuk
  // pesanan yang totalnya BUKAN Rp 0, sekilas malah kelihatan "Rp 0" dulu
  // sebelum sempat disentuh. updateTotalDisplay() memanggil
  // updateSummaryPanel() juga di dalamnya, jadi ini pengganti langsung,
  // bukan tambahan panggilan baru.
  updateTotalDisplay();
}

function updateSummaryPanel() {
  const panel = document.getElementById("summary-body");
  if (!panel) return;

  const namaEl = document.getElementById("f-nama");
  const nama = namaEl ? namaEl.value.trim() : "";
  const total = grandTotal();
  const isEdit = !!editOrderId;
  const bayarInput = document.getElementById("f-bayar");
  const paidAmount = isEdit ? editOrderData.paid_amount || 0 : bayarInput ? Number(bayarInput.value) || 0 : 0;
  const sisa = total - paidAmount;
  const status = computeStatusBayar(total, paidAmount);

  const validLines = lineItems.filter((l) => l.product_id && l.wave_id && Number(l.jumlah) > 0);
  const itemsHtml = validLines.length
    ? validLines
        .map((l) => {
          const info = resolveLineInfo(l);
          return `
        <div class="summary-item-row">
          <span style="color:var(--gray-700);">
            ${escapeHtml(info.productName)} <span style="color:var(--gray-400);">x${escapeHtml(l.jumlah)}</span>
            <div style="font-size:11px; color:var(--brand-600);">${escapeHtml(info.waveLabel)}</div>
          </span>
          <span style="font-weight:600; white-space:nowrap;">${formatRupiah(lineSubtotal(l))}</span>
        </div>`;
        })
        .join("")
    : `<div style="font-size:12.5px; color:var(--gray-400); padding:8px 0;">Belum ada produk dipilih.</div>`;

  panel.innerHTML = `
    <div style="font-size:12.5px; color:var(--gray-500); margin-bottom:2px;">Pemesan</div>
    <div style="font-weight:700; margin-bottom:10px; color:var(--gray-900);">${escapeHtml(nama || "-")}</div>
    ${itemsHtml}
    <div style="display:flex; justify-content:space-between; margin-top:12px; padding-top:10px; border-top:1px solid var(--gray-200); font-size:14px;">
      <span>Total</span><strong>${formatRupiah(total)}</strong>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:13px; color:var(--gray-500); margin-top:4px;">
      <span>${isEdit ? "Sudah Dibayar" : "Bayar Sekarang"}</span><span>${formatRupiah(paidAmount)}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:13px; margin-top:2px; ${sisa > 0 ? "color:var(--red-600); font-weight:600;" : "color:var(--gray-500);"}">
      <span>Sisa</span><span>${formatRupiah(sisa)}</span>
    </div>
    <div style="margin-top:10px;"><span class="badge ${STATUS_BAYAR_BADGE[status]}">${STATUS_BAYAR_LABEL[status].toUpperCase()}</span></div>
  `;
}

// Peringatan LEMBUT saja, bukan larangan: stok cuma catatan kasar dari Owner
// (bisa berubah kapan saja karena ada barang yang laku cash duluan di luar
// sistem ini), jadi tidak pernah memblokir penyimpanan pesanan. Kalau field
// stok produk dikosongkan, tidak ada peringatan sama sekali.
function stockWarningHtml(prod, jumlah) {
  if (!prod || prod.stok === null || prod.stok === undefined || prod.stok === "") return "";
  const qty = Number(jumlah) || 0;
  if (qty <= prod.stok) return "";
  return `<p style="font-size:12px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:5px 8px; margin:6px 0 0;">⚠️ Melebihi stok tercatat untuk ${escapeHtml(prod.nama)} (stok: ${prod.stok}). Tetap bisa disimpan — cek dulu stok fisiknya kalau perlu.</p>`;
}

// Sama seperti stockWarningHtml() di atas -- peringatan LEMBUT saja, bukan
// larangan: Kuota & Tanggal Tutup gelombang cuma catatan (bisa diatur di
// halaman Produk & Batch), owner tetap bisa lanjut menyimpan pesanan yang
// melebihi kuota atau sudah lewat tanggal tutup kalau memang itu kebijakannya
// (mis. ada tambahan pesanan dadakan di luar rencana awal).
function gelombangWarningHtml(prod, wave, jumlah) {
  if (!prod || !wave) return "";
  const pesan = [];
  const qty = Number(jumlah) || 0;

  if (wave.tanggal_tutup && new Date() > new Date(wave.tanggal_tutup + "T23:59:59")) {
    pesan.push(`sudah lewat tanggal tutup (${formatTanggal(new Date(wave.tanggal_tutup + "T00:00:00"))})`);
  }
  if (wave.kuota !== null && wave.kuota !== undefined && wave.kuota !== "") {
    const terpakai = waveStatsMap[`${prod.id}::${wave.id}`] || 0;
    if (terpakai + qty > wave.kuota) {
      pesan.push(`kuota terpakai ${terpakai}/${wave.kuota}`);
    }
  }
  if (pesan.length === 0) return "";
  return `<p style="font-size:12px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:5px 8px; margin:6px 0 0;">⚠️ Gelombang "${escapeHtml(wave.label)}" ${pesan.join("; ")}. Tetap bisa disimpan sesuai kebijakan Owner.</p>`;
}

// Peringatan kalau baris ini merujuk produk/gelombang yang sudah dihapus
// dari katalog (khusus mode Edit pesanan lama) -- jelaskan bahwa harga yang
// dipakai adalah data historis pesanan ini, bukan harga yang aktif sekarang.
function ghostLineWarningHtml(info) {
  if (!info.isGhost) return "";
  return `<p style="font-size:12px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:5px 8px; margin:6px 0 0;">⚠️ "${escapeHtml(info.productName)} — ${escapeHtml(info.waveLabel)}" sudah dihapus dari katalog produk. Harga satuan memakai data terakhir yang tersimpan di pesanan ini (${formatRupiah(info.hargaSatuan)}). Kalau perlu, ganti ke produk yang masih aktif lewat dropdown di atas.</p>`;
}

function renderLineItems() {
  const wrap = document.getElementById("line-items");
  wrap.innerHTML = lineItems
    .map((line) => {
      const prod = getProduct(line.product_id);
      const wave = getWave(prod, line.wave_id);
      const info = resolveLineInfo(line);
      const productOptions = products
        .map((p) => `<option value="${p.id}" ${p.id === line.product_id ? "selected" : ""}>${escapeHtml(p.nama)}</option>`)
        .join("");
      const waveOptions = (prod ? prod.waves || [] : [])
        .map((w) => `<option value="${w.id}" ${w.id === line.wave_id ? "selected" : ""}>${escapeHtml(w.label)}</option>`)
        .join("");
      return `
      <div style="background:var(--gray-50); border-radius:10px; padding:10px; margin-bottom:8px;">
        <div class="grid" style="grid-template-columns: 2fr 1.2fr 0.8fr; gap:8px;">
          <select onchange="updateLine(${line.key}, 'product_id', this.value)">
            <option value="">Pilih Produk</option>
            ${productOptions}
          </select>
          <select onchange="updateLine(${line.key}, 'wave_id', this.value)" ${!prod ? "disabled" : ""}>
            <option value="">Gelombang</option>
            ${waveOptions}
          </select>
          <input type="number" min="1" placeholder="Jumlah" value="${escapeHtml(line.jumlah)}" oninput="updateLine(${line.key}, 'jumlah', this.value)" />
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:12.5px; color:var(--gray-500);">
          <span>Harga satuan: ${line.product_id && line.wave_id ? formatRupiah(info.hargaSatuan) : "-"}</span>
          <span style="display:flex; gap:10px; align-items:center;">
            <strong id="subtotal-${line.key}" style="color:var(--gray-700);">Subtotal: ${formatRupiah(lineSubtotal(line))}</strong>
            ${lineItems.length > 1 ? `<a href="#" onclick="removeLine(${line.key}); return false;" style="color:var(--red-600);">Hapus</a>` : ""}
          </span>
        </div>
        <div id="stock-warning-${line.key}">${stockWarningHtml(prod, line.jumlah)}${gelombangWarningHtml(prod, wave, line.jumlah)}</div>
        ${line.product_id && line.wave_id ? ghostLineWarningHtml(info) : ""}
      </div>`;
    })
    .join("");
  updateTotalDisplay();
}

function updateLine(key, field, value) {
  const line = lineItems.find((l) => l.key === key);
  if (!line) return;
  line[field] = value;
  if (field === "product_id") {
    const prod = getProduct(value);
    const activeWave = prod ? (prod.waves || []).find((w) => w.aktif) || (prod.waves || [])[0] : null;
    line.wave_id = activeWave ? activeWave.id : "";
  }
  if (field === "jumlah") {
    const subtotalEl = document.getElementById(`subtotal-${key}`);
    if (subtotalEl) subtotalEl.textContent = `Subtotal: ${formatRupiah(lineSubtotal(line))}`;
    const warnEl = document.getElementById(`stock-warning-${key}`);
    if (warnEl) {
      const prod = getProduct(line.product_id);
      warnEl.innerHTML = stockWarningHtml(prod, line.jumlah) + gelombangWarningHtml(prod, getWave(prod, line.wave_id), line.jumlah);
    }
    updateTotalDisplay();
    return;
  }
  renderLineItems();
}

function addLine() {
  lineItems.push(emptyLine());
  renderLineItems();
}
function removeLine(key) {
  if (lineItems.length <= 1) return;
  lineItems = lineItems.filter((l) => l.key !== key);
  renderLineItems();
}

function updateTotalDisplay() {
  const total = grandTotal();
  const totalEl = document.getElementById("f-total");
  if (totalEl) totalEl.textContent = formatRupiah(total);
  // Bar total mengambang khusus layar sempit (<980px) -- lihat CSS
  // #mobile-sticky-total di css/style.css. Diperbarui bersamaan dengan
  // #f-total supaya keduanya selalu sinkron, walau cuma satu yang
  // kelihatan tergantung lebar layar.
  const totalMobileEl = document.getElementById("f-total-mobile");
  if (totalMobileEl) totalMobileEl.textContent = formatRupiah(total);
  updateSummaryPanel();
}

// Riwayat perubahan (mini log) -- ringkasan singkat apa yang berubah tiap
// kali Owner edit pesanan (item/total/data pembeli), buat ditampilkan di
// Detail Pesanan. Berguna untuk audit kalau ada beda pendapat soal "siapa
// yang ubah apa", apalagi sekarang sudah multi-cabang & multi-akun.
function buildEditSummary(oldData, newData) {
  const parts = [];
  if ((oldData.total || 0) !== newData.total) {
    parts.push(`Total: ${formatRupiah(oldData.total || 0)} → ${formatRupiah(newData.total)}`);
  }
  const oldItemsKey = JSON.stringify((oldData.items || []).map((it) => [it.product_id, it.wave_id, it.jumlah]));
  const newItemsKey = JSON.stringify((newData.items || []).map((it) => [it.product_id, it.wave_id, it.jumlah]));
  if (oldItemsKey !== newItemsKey) parts.push("Item pesanan diubah");
  if ((oldData.nama_pembeli || "") !== newData.nama_pembeli) parts.push("Nama pembeli diubah");
  if ((oldData.alamat || "") !== newData.alamat) parts.push("Alamat diubah");
  if ((oldData.no_hp || "") !== newData.no_hp) parts.push("No. HP diubah");
  if ((oldData.catatan || "") !== newData.catatan) parts.push("Catatan diubah");
  return parts.length ? parts.join(", ") : "Pesanan disimpan ulang (tidak ada perubahan data terdeteksi)";
}

async function handleSubmit(e) {
  e.preventDefault();
  const alertBox = document.getElementById("order-form-alert");
  alertBox.innerHTML = "";

  const namaCek = document.getElementById("f-nama").value.trim();
  const alamatCek = document.getElementById("f-alamat").value.trim();
  if (namaCek.length < 3) {
    alertBox.innerHTML = `<div class="alert alert-error">Nama Pembeli wajib diisi, minimal 3 karakter.</div>`;
    document.getElementById("f-nama").focus();
    return;
  }
  if (alamatCek.length < 3) {
    alertBox.innerHTML = `<div class="alert alert-error">Alamat wajib diisi, minimal 3 karakter.</div>`;
    document.getElementById("f-alamat").focus();
    return;
  }
  const noHpCek = document.getElementById("f-nohp").value.trim();
  if (!isValidNoHp(noHpCek)) {
    alertBox.innerHTML = `<div class="alert alert-error">Format No. HP tidak valid. Contoh yang benar: 08123456789 (boleh dikosongkan kalau memang tidak ada).</div>`;
    document.getElementById("f-nohp").focus();
    return;
  }

  const validLines = lineItems.filter((l) => l.product_id && l.wave_id && Number(l.jumlah) > 0);
  if (validLines.length === 0) {
    alertBox.innerHTML = `<div class="alert alert-error">Minimal pilih 1 produk dengan jumlah yang valid.</div>`;
    return;
  }

  const profileForCabang = window.currentUserProfile;
  const isKaryawanCabangSubmit = profileForCabang && profileForCabang.role === "karyawan";
  const cabangIdBaru = !editOrderId
    ? isKaryawanCabangSubmit
      ? profileForCabang.cabang_id
      : document.getElementById("f-cabang").value
    : null;
  if (!editOrderId && !cabangIdBaru) {
    alertBox.innerHTML = `<div class="alert alert-error">Pilih cabang untuk pesanan ini.</div>`;
    return;
  }

  const total = grandTotal();
  // Untuk mode edit, ini masih pakai editOrderData.paid_amount yang mungkin
  // sudah basi (diambil saat form dibuka) -- ini cuma validasi cepat di sisi
  // klien untuk feedback awal. Pengecekan yang SEBENARNYA (pakai data fresh
  // dari server) terjadi di dalam transaksi saat submit, lihat handleSubmit().
  const paidAmount = editOrderId ? editOrderData.paid_amount || 0 : Number(document.getElementById("f-bayar").value) || 0;
  if (paidAmount > total) {
    alertBox.innerHTML = editOrderId
      ? `<div class="alert alert-error">Total pesanan baru (${formatRupiah(total)}) lebih kecil dari yang sudah dibayar (${formatRupiah(paidAmount)}). Kurangi jumlah dulu, atau sesuaikan pembayarannya lewat Detail Pesanan di Daftar Pesanan.</div>`
      : `<div class="alert alert-error">Jumlah bayar tidak boleh melebihi total pesanan.</div>`;
    return;
  }

  // Nonaktifkan tombol Simpan dari sini (sebelum modal konfirmasi di bawah
  // ini muncul, bukan sesudahnya) -- supaya tidak ada celah waktu di mana
  // tombolnya masih bisa diklik lagi sebelum modal benar-benar tertutup.
  const btn = document.getElementById("submit-btn");
  const btnTextAsal = btn.textContent;
  btn.disabled = true;

  // Pesanan baru dengan bayar 0 atau kurang dari total = nota tempo/belum
  // lunas -- beri jendela konfirmasi (di tengah layar) supaya tidak kelewatan
  // tanpa sadar sebelum benar-benar tersimpan.
  if (!editOrderId && paidAmount < total) {
    const sisaBelum = total - paidAmount;
    const bodyHtml =
      paidAmount <= 0
        ? `<div class="card-heading" style="margin-bottom:10px;"><span class="card-heading-icon" style="background:#fef3c7; color:#b45309;"><i class="ph-bold ph-warning"></i></span><h3 style="font-size:16px;">Simpan sebagai Nota Tempo?</h3></div>
           <p style="font-size:14px; color:var(--gray-700); margin:0 0 12px;">Pesanan ini belum dibayar sama sekali (Rp 0), akan tersimpan dengan status <strong>Belum Bayar</strong> (nota tempo).</p>
           <div style="background:var(--gray-50); border-radius:var(--radius-sm); padding:10px 12px; font-size:14px; display:flex; justify-content:space-between;"><span>Total Tagihan</span><strong>${formatRupiah(total)}</strong></div>`
        : `<div class="card-heading" style="margin-bottom:10px;"><span class="card-heading-icon" style="background:#fef3c7; color:#b45309;"><i class="ph-bold ph-warning"></i></span><h3 style="font-size:16px;">Simpan sebagai Belum Lunas?</h3></div>
           <p style="font-size:14px; color:var(--gray-700); margin:0 0 12px;">Jumlah bayar kurang dari total pesanan, akan tersimpan dengan status <strong>Bayar Sebagian</strong> (sisa jadi tempo).</p>
           <div style="background:var(--gray-50); border-radius:var(--radius-sm); padding:10px 12px; font-size:14px; display:grid; gap:4px;">
             <div style="display:flex; justify-content:space-between;"><span>Total Tagihan</span><strong>${formatRupiah(total)}</strong></div>
             <div style="display:flex; justify-content:space-between;"><span>Dibayar</span><span>${formatRupiah(paidAmount)}</span></div>
             <div style="display:flex; justify-content:space-between; color:var(--red-600);"><span>Sisa / Tempo</span><strong>${formatRupiah(sisaBelum)}</strong></div>
           </div>`;
    const lanjut = await showConfirmModal(bodyHtml, { okLabel: "Lanjutkan Simpan" });
    if (!lanjut) {
      btn.disabled = false;
      btn.textContent = btnTextAsal;
      return;
    }
  }

  const itemsData = validLines.map((l) => {
    const jumlah = Number(l.jumlah);
    const info = resolveLineInfo(l);
    return {
      product_id: l.product_id,
      product_name: info.productName,
      wave_id: l.wave_id,
      wave_label: info.waveLabel,
      harga_satuan: info.hargaSatuan,
      jumlah,
      subtotal: info.hargaSatuan * jumlah,
    };
  });

  btn.textContent = "Menyimpan...";

  const tanggal = new Date(document.getElementById("f-tanggal").value);
  const namaPembeli = formatNamaPembeli(document.getElementById("f-nama").value);
  const alamat = formatAlamat(document.getElementById("f-alamat").value);
  const noHp = document.getElementById("f-nohp").value.trim();
  const catatan = document.getElementById("f-catatan").value.trim();
  const profile = window.currentUserProfile;

  try {
    if (editOrderId) {
      const orderRef = db.collection("orders").doc(editOrderId);
      await db.runTransaction(async (tx) => {
        // Baca ulang paid_amount TERBARU dari server tepat saat menyimpan --
        // bukan dari editOrderData yang sudah dibuka sejak form ini dibuka.
        // Ini mencegah pembayaran baru yang dicatat rekan kerja (lewat
        // Daftar Pesanan) selagi Owner masih mengedit pesanan yang sama
        // jadi tertimpa/hilang dari paid_amount.
        const freshDoc = await tx.get(orderRef);
        if (!freshDoc.exists) {
          throw new Error("Pesanan tidak ditemukan (mungkin baru saja dihapus).");
        }
        const freshPaidAmount = freshDoc.data().paid_amount || 0;
        if (freshPaidAmount > total) {
          throw new Error(
            `Total pesanan baru (${formatRupiah(total)}) lebih kecil dari yang sudah dibayar SAAT INI (${formatRupiah(freshPaidAmount)}) -- kemungkinan ada pembayaran baru yang tercatat oleh rekan kerja selagi Anda mengedit. Muat ulang halaman ini dan cek Detail Pesanan dulu sebelum menyimpan lagi.`
          );
        }
        const freshOrder = freshDoc.data();
        const newDataForLog = { nama_pembeli: namaPembeli, alamat, no_hp: noHp, catatan, items: itemsData, total };
        const ringkasan = buildEditSummary(freshOrder, newDataForLog);

        // PERBAIKAN: sebelumnya pakai FieldValue.arrayUnion() tanpa batas --
        // dokumen Firestore maksimal ~1 MB, jadi pesanan yang sudah diedit
        // puluhan-ratusan kali berisiko GAGAL tersimpan gara-gara edit_log-nya
        // sendiri yang membengkak, bukan datanya. Sekarang dibaca manual dari
        // freshOrder (sudah dibaca di atas) lalu dipotong maksimal 30 entri
        // TERBARU sebelum ditulis balik -- riwayat edit yang sangat lama
        // hilang, tapi itu wajar (30 kali edit untuk 1 pesanan sudah sangat
        // jarang terjadi dalam pemakaian normal).
        const existingEditLog = Array.isArray(freshOrder.edit_log) ? freshOrder.edit_log : [];
        const editLog = [
          ...existingEditLog,
          { by: profile.uid, by_name: profile.full_name || profile.username || "-", at: new Date(), ringkasan },
        ].slice(-30);

        // Rekap stats/produk_cabang & stats/produk_gelombang: sesuaikan
        // selisih qty lama -> baru (bisa saja Owner ganti produk/gelombang/
        // jumlah di form Edit Pesanan penuh ini).
        applyProdukCabangStatsDelta(
          tx,
          freshOrder.cabang_id,
          diffQtyByProduct(aggregateQtyByProduct(freshOrder.items), aggregateQtyByProduct(itemsData))
        );
        applyProdukGelombangStatsDelta(tx, diffQtyByProduct(aggregateQtyByWave(freshOrder.items), aggregateQtyByWave(itemsData)));

        tx.update(orderRef, {
          tanggal,
          nama_pembeli: namaPembeli,
          alamat,
          no_hp: noHp,
          catatan,
          items: itemsData,
          total,
          paid_amount: freshPaidAmount,
          status_bayar: computeStatusBayar(total, freshPaidAmount),
          edit_log: editLog,
        });
      });
      showToast("Pesanan berhasil diperbarui.", "success");
      window.location.href = "pesanan.html";
      return;
    }

    // Digabung jadi SATU transaksi (penomoran nota + simpan pesanan +
    // pembayaran awal) -- sebelumnya getNextOrderIdentifiers() jalan sebagai
    // transaksi terpisah SEBELUM newOrderRef.set(), jadi kalau penyimpanan
    // pesanan gagal di tengah jalan (mis. koneksi putus), nomor nota yang
    // sudah terlanjur diambil jadi "terbuang" (tidak dipakai ulang, counter
    // sudah kadung naik). Dengan satu transaksi, counter cuma naik kalau
    // pesanannya benar-benar berhasil tersimpan.
    const year = new Date().getFullYear();
    const globalCounterRef = db.collection("counters").doc("orders");
    const yearCounterRef = db.collection("counters").doc("nota-" + year);
    const newOrderRef = db.collection("orders").doc();
    const paymentRef = paidAmount > 0 ? newOrderRef.collection("payments").doc() : null;

    await db.runTransaction(async (tx) => {
      const [globalDoc, yearDoc] = await Promise.all([tx.get(globalCounterRef), tx.get(yearCounterRef)]);
      const orderNo = (globalDoc.exists ? globalDoc.data().seq || 0 : 0) + 1;
      const notaSeq = (yearDoc.exists ? yearDoc.data().seq || 0 : 0) + 1;

      tx.set(globalCounterRef, { seq: orderNo }, { merge: true });
      tx.set(yearCounterRef, { seq: notaSeq }, { merge: true });

      tx.set(newOrderRef, {
        cabang_id: cabangIdBaru,
        order_no: orderNo,
        nota_tahun: year,
        nota_seq: notaSeq,
        tanggal,
        nama_pembeli: namaPembeli,
        alamat,
        no_hp: noHp,
        catatan,
        items: itemsData,
        total,
        paid_amount: paidAmount,
        status_bayar: computeStatusBayar(total, paidAmount),
        is_diambil: false,
        tanggal_ambil: null,
        created_by: profile.uid,
        created_by_name: profile.full_name,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });

      if (paymentRef) {
        tx.set(paymentRef, {
          tanggal: firebase.firestore.FieldValue.serverTimestamp(),
          jumlah: paidAmount,
          catatan: "Pembayaran awal saat pesan",
          created_by: profile.uid,
          created_by_name: profile.full_name,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Rekap stats/produk_cabang & stats/produk_gelombang: tambahkan qty
      // pesanan baru ini.
      applyProdukCabangStatsDelta(tx, cabangIdBaru, aggregateQtyByProduct(itemsData));
      applyProdukGelombangStatsDelta(tx, aggregateQtyByWave(itemsData));
    });

    showToast("Pesanan berhasil disimpan.", "success");
    document.getElementById("form-container").style.display = "none";
    const successBox = document.getElementById("success-box");
    successBox.style.display = "block";
    document.getElementById("btn-cetak-nota").onclick = () => {
      window.open(`nota.html?id=${newOrderRef.id}`, "_blank");
    };
    document.getElementById("btn-input-lagi").onclick = () => {
      window.location.reload();
    };
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = editOrderId ? "Simpan Perubahan" : "Simpan Pesanan";
  }
}
