// Halaman Pengeluaran -- mencatat pengeluaran operasional (beli benih,
// ongkir, operasional, gaji, dll). Kategori disimpan sebagai TEKS biasa di
// tiap dokumen pengeluaran (bukan referensi id ke koleksi kategori) -- jadi
// koleksi "kategori_pengeluaran" cuma daftar pilihan untuk dropdown, dan
// menghapus/mengganti nama kategori di sana TIDAK mengubah catatan
// pengeluaran lama yang sudah memakai nama kategori itu.

const KATEGORI_DEFAULT = ["Beli Benih/Bibit", "Ongkir Kirim", "Operasional", "Gaji/Upah", "Lain-lain"];

let pengProfile = null;
let pengKategoriList = []; // [{id, nama}]
let pengExpenses = [];

function defaultPengDari() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return localYmd(d);
}

window.onAuthReady = async function (profile) {
  try {
    pengProfile = profile;
    document.getElementById("peng-dari").value = defaultPengDari();
    document.getElementById("peng-sampai").value = localYmd(new Date());
    document.getElementById("peng-tanggal").value = todayInputValue();

    // Realtime: daftar kategori dipakai bersama oleh dropdown filter, form
    // catat pengeluaran, dan modal kelola kategori -- sekali listen, ketiganya
    // otomatis ikut update begitu ada kategori ditambah/dihapus rekan kerja.
    db.collection("kategori_pengeluaran")
      .orderBy("nama")
      .onSnapshot(async (snap) => {
        pengKategoriList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Kalau daftar kategori masih kosong sama sekali (toko baru pertama
        // kali pakai fitur ini), isi otomatis dengan 5 kategori default --
        // cuma sekali (begitu ada 1 saja, tidak akan diisi ulang lagi).
        if (pengKategoriList.length === 0) {
          const batch = db.batch();
          KATEGORI_DEFAULT.forEach((nama) => {
            const ref = db.collection("kategori_pengeluaran").doc();
            batch.set(ref, { nama });
          });
          try {
            await batch.commit();
          } catch (e) {
            // Diamkan -- kalau gagal (mis. race dengan tab lain yang sama-sama
            // mengisi default bersamaan), snapshot berikutnya akan tetap benar.
          }
          return; // onSnapshot akan terpanggil lagi otomatis setelah batch commit
        }
        renderKategoriDropdowns();
        renderKategoriList();
      });

    await applyPengeluaranFilter();
  } catch (err) {
    document.getElementById("pengeluaran-table").innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
};

function renderKategoriDropdowns() {
  const filterSelect = document.getElementById("peng-filter-kategori");
  const formSelect = document.getElementById("peng-kategori");
  const filterCurrent = filterSelect.value;
  const formCurrent = formSelect.value;

  filterSelect.innerHTML = '<option value="">Semua Kategori</option>';
  formSelect.innerHTML = "";
  pengKategoriList.forEach((k) => {
    const opt1 = document.createElement("option");
    opt1.value = k.nama;
    opt1.textContent = k.nama;
    filterSelect.appendChild(opt1);
    const opt2 = document.createElement("option");
    opt2.value = k.nama;
    opt2.textContent = k.nama;
    formSelect.appendChild(opt2);
  });
  if (pengKategoriList.some((k) => k.nama === filterCurrent)) filterSelect.value = filterCurrent;
  if (pengKategoriList.some((k) => k.nama === formCurrent)) formSelect.value = formCurrent;
}

// ---------- Muat & tampilkan pengeluaran ----------
async function applyPengeluaranFilter() {
  const dari = document.getElementById("peng-dari").value;
  const sampai = document.getElementById("peng-sampai").value;
  const kategoriFilter = document.getElementById("peng-filter-kategori").value;

  document.getElementById("pengeluaran-table").innerHTML = skeletonRows(6);
  try {
    let q = db.collection("pengeluaran");
    if (dari) q = q.where("tanggal", ">=", new Date(dari + "T00:00:00"));
    if (sampai) q = q.where("tanggal", "<=", new Date(sampai + "T23:59:59"));
    q = q.orderBy("tanggal", "desc");
    const snap = await q.get();
    pengExpenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (kategoriFilter) pengExpenses = pengExpenses.filter((e) => e.kategori === kategoriFilter);
    renderPengeluaranTable();
  } catch (err) {
    document.getElementById("pengeluaran-table").innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

function renderPengeluaranTable() {
  const total = pengExpenses.reduce((s, e) => s + (Number(e.jumlah) || 0), 0);
  // FITUR HUTANG USAHA: dokumen /pengeluaran lama (belum punya paid_amount)
  // dianggap lunas -- lihat catatan yang sama di openPengeluaranModal().
  const totalHutang = pengExpenses.reduce((s, e) => {
    const paid = e.paid_amount !== undefined ? e.paid_amount : e.jumlah;
    return s + Math.max(0, (Number(e.jumlah) || 0) - (Number(paid) || 0));
  }, 0);
  document.getElementById("pengeluaran-summary").innerHTML = `
    <div class="stat-card brand" style="max-width:280px;">
      <span class="stat-icon"><i class="ph-bold ph-wallet"></i></span>
      <div class="stat-body">
        <div class="stat-label">Total Pengeluaran (${pengExpenses.length} catatan)</div>
        <div class="stat-value">${formatRupiah(total)}</div>
      </div>
    </div>
    ${
      totalHutang > 0
        ? `<div class="stat-card" style="max-width:280px;">
            <span class="stat-icon" style="background:var(--red-50); color:var(--red-600);"><i class="ph-bold ph-hand-coins"></i></span>
            <div class="stat-body">
              <div class="stat-label">Hutang Usaha (Belum Dibayar)</div>
              <div class="stat-value" style="color:var(--red-600);">${formatRupiah(totalHutang)}</div>
            </div>
          </div>`
        : ""
    }`;

  const container = document.getElementById("pengeluaran-table");
  if (pengExpenses.length === 0) {
    container.innerHTML = `<div class="card empty-state">Belum ada pengeluaran di rentang tanggal ini.</div>`;
    return;
  }
  const rows = pengExpenses
    .map((e) => {
      const paid = e.paid_amount !== undefined ? e.paid_amount : e.jumlah;
      const status = e.status_bayar || computeStatusBayar(e.jumlah, paid);
      const sisa = (Number(e.jumlah) || 0) - (Number(paid) || 0);
      // Tombol Bayar/Riwayat: muncul kalau masih ada hutang, atau kalau sudah punya riwayat pembayaran.
      const bayarBtn =
        sisa > 0 || e.riwayat_bayar
          ? `<button class="icon-btn" title="${sisa > 0 ? "Bayar hutang / lihat riwayat" : "Riwayat pembayaran"}" onclick="openBayarModal('${e.id}')"><i class="ph ph-coins"></i></button>`
          : "";
      return `
    <tr>
      <td style="white-space:nowrap;">${formatTanggal(e.tanggal)}</td>
      <td>${escapeHtml(e.kategori)}</td>
      <td>${escapeHtml(e.keterangan || "")}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(e.jumlah)}</td>
      <td style="text-align:center; white-space:nowrap;"><span class="badge ${STATUS_BAYAR_BADGE[status]}">${STATUS_BAYAR_LABEL[status]}</span></td>
      <td style="text-align:right; white-space:nowrap;">
        ${bayarBtn}
        <button class="icon-btn" title="Edit" onclick="openPengeluaranModal('${e.id}')"><i class="ph ph-pencil-simple"></i></button>
        <button class="icon-btn" title="Hapus" onclick="deletePengeluaran('${e.id}')"><i class="ph ph-trash"></i></button>
      </td>
    </tr>`;
    })
    .join("");
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th style="text-align:right;">Jumlah</th><th style="text-align:center;">Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------- Modal tambah/edit pengeluaran ----------
// PERBAIKAN: sebelumnya menerima seluruh objek pengeluaran langsung lewat
// parameter (dilempar dari onclick sebagai JSON.stringify(e) yang ditempel
// ke atribut HTML) -- field "tanggal" yang aslinya objek Timestamp Firestore
// jadi RUSAK setelah melewati JSON.stringify+dari-HTML-attribute (kehilangan
// method .toDate()-nya, cuma tersisa {seconds, nanoseconds} polos), bikin
// "new Date(item.tanggal)" di bawah menghasilkan "Invalid Date" -- field
// tanggal di modal Edit jadi kosong/salah tiap kali. Sekarang cuma menerima
// ID (teks biasa, aman ditempel ke onclick apa adanya), lalu objek pesanan
// ASLINYA (dengan Timestamp yang masih utuh) diambil dari pengExpenses yang
// sudah ada di memori -- sama seperti pola yang dipakai di seluruh halaman
// lain aplikasi ini (mis. deleteOrder(id) di js/pesanan.js).
// FITUR HUTANG USAHA: kalau user belum pernah menyentuh field "Jumlah
// Dibayar" secara manual, field itu otomatis ikut menyamai "Jumlah" tiap
// diketik (anggapan default: pengeluaran baru sudah lunas dibayar tunai,
// sama seperti perilaku sebelum fitur ini ada) -- begitu user MENGETIK
// LANGSUNG di field "Jumlah Dibayar" (mis. mengecilkannya karena masih
// hutang), auto-ikut ini berhenti sampai modal ditutup/dibuka lagi.
let pengDibayarManuallyEdited = false;
function syncPengBayarLunasDefault() {
  if (pengDibayarManuallyEdited) return;
  document.getElementById("peng-dibayar").value = document.getElementById("peng-jumlah").value;
}

function openPengeluaranModal(id) {
  const item = id ? pengExpenses.find((e) => e.id === id) : null;
  document.getElementById("pengeluaran-modal-title").textContent = item ? "Edit Pengeluaran" : "Catat Pengeluaran";
  document.getElementById("peng-id").value = item ? item.id : "";
  document.getElementById("peng-tanggal").value = item ? localYmd(item.tanggal.toDate ? item.tanggal.toDate() : new Date(item.tanggal)) : todayInputValue();
  document.getElementById("peng-keterangan").value = item ? item.keterangan || "" : "";
  document.getElementById("peng-jumlah").value = item ? Number(item.jumlah).toLocaleString("id-ID") : "";
  // Dokumen /pengeluaran LAMA (dibuat sebelum fitur Hutang Usaha ada) tidak
  // punya field paid_amount sama sekali -- dianggap sudah lunas (paid_amount
  // == jumlah) secara default, konsisten dengan perilaku sebelumnya.
  const pengDibayarVal = item ? (item.paid_amount !== undefined ? item.paid_amount : item.jumlah) : "";
  document.getElementById("peng-dibayar").value = item ? Number(pengDibayarVal).toLocaleString("id-ID") : "";
  pengDibayarManuallyEdited = !!item; // mode Edit: JANGAN auto-ikut jumlah (nilai lama sudah ditentukan), mode baru: auto-ikut sampai disentuh manual
  renderKategoriDropdowns();
  if (item) document.getElementById("peng-kategori").value = item.kategori;
  // Pengeluaran yang sudah punya RIWAYAT pembayaran: "Jumlah Dibayar" dikunci --
  // diubah lewat tombol Bayar/Riwayat (per tanggal bayar), bukan diketik langsung,
  // supaya total dibayar & riwayat tanggalnya tidak saling bertentangan.
  const locked = !!(item && item.riwayat_bayar);
  document.getElementById("peng-dibayar").readOnly = locked;
  document.getElementById("peng-dibayar-hint").style.display = locked ? "none" : "";
  document.getElementById("peng-dibayar-locked-note").style.display = locked ? "" : "none";
  document.getElementById("pengeluaran-modal").style.display = "flex";
}
function closePengeluaranModal() {
  document.getElementById("pengeluaran-modal").style.display = "none";
  document.getElementById("pengeluaran-form").reset();
  document.getElementById("peng-dibayar").readOnly = false;
  pengDibayarManuallyEdited = false;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("peng-dibayar").addEventListener("input", () => {
    pengDibayarManuallyEdited = true;
  });

  document.getElementById("bayar-form").addEventListener("submit", submitBayarHutang);

  document.getElementById("pengeluaran-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("peng-id").value;
    const tanggalVal = document.getElementById("peng-tanggal").value;
    const kategori = document.getElementById("peng-kategori").value;
    const keterangan = document.getElementById("peng-keterangan").value.trim();
    const jumlah = parseFormattedNumber(document.getElementById("peng-jumlah").value);
    const itemLama = id ? pengExpenses.find((x) => x.id === id) : null;
    const locked = !!(itemLama && itemLama.riwayat_bayar);
    const paidAmount = locked ? Number(itemLama.paid_amount) || 0 : parseFormattedNumber(document.getElementById("peng-dibayar").value);

    if (!kategori) {
      showToast("Pilih kategori dulu (atau tambah lewat \"Kelola Kategori\").", "error");
      return;
    }
    if (jumlah <= 0) {
      showToast("Jumlah harus lebih dari 0.", "error");
      return;
    }
    if (paidAmount > jumlah) {
      showToast(
        locked ? `Jumlah tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paidAmount)}).` : "Jumlah Dibayar tidak boleh lebih besar dari Jumlah.",
        "error"
      );
      return;
    }

    const data = {
      tanggal: new Date(tanggalVal + "T00:00:00"),
      kategori,
      keterangan,
      jumlah,
      paid_amount: paidAmount,
      status_bayar: computeStatusBayar(jumlah, paidAmount),
    };

    try {
      if (id && locked) {
        // Sudah punya riwayat pembayaran: perbarui data pengeluaran + salinan
        // kategori/keterangan di tiap pembayaran (dipakai Buku Kas), dan tanggal
        // pembayaran awal ikut kalau tanggal pengeluaran dikoreksi.
        const ref = db.collection("pengeluaran").doc(id);
        const subSnap = await ref.collection("pembayaran").get();
        const batch = db.batch();
        batch.update(ref, data);
        subSnap.docs.forEach((d) => {
          const upd = { kategori, keterangan };
          if (d.data().awal) upd.tanggal = data.tanggal;
          batch.update(d.ref, upd);
        });
        await batch.commit();
      } else if (id) {
        // Pengeluaran LAMA (belum punya riwayat pembayaran): perilaku seperti sebelumnya.
        await db.collection("pengeluaran").doc(id).update(data);
      } else {
        // Baru: langsung pakai riwayat pembayaran -- pembayaran awal (kalau ada)
        // dicatat di tanggal pengeluaran; cicilan/pelunasan berikutnya lewat tombol Bayar.
        const ref = db.collection("pengeluaran").doc();
        const batch = db.batch();
        batch.set(ref, {
          ...data,
          riwayat_bayar: true,
          created_by: pengProfile.uid,
          created_by_name: pengProfile.full_name,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (paidAmount > 0) {
          batch.set(ref.collection("pembayaran").doc(), {
            tanggal: data.tanggal,
            jumlah: paidAmount,
            kategori,
            keterangan,
            awal: true,
            catatan: "Pembayaran awal",
            created_by: pengProfile.uid,
            created_by_name: pengProfile.full_name,
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
      showToast("Pengeluaran tersimpan.", "success");
      closePengeluaranModal();
      applyPengeluaranFilter();
    } catch (err) {
      showToast(friendlyFirebaseError(err), "error");
    }
  });

  document.getElementById("kategori-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("kategori-baru");
    const nama = input.value.trim();
    if (!nama) return;
    if (pengKategoriList.some((k) => k.nama.toLowerCase() === nama.toLowerCase())) {
      showToast("Kategori ini sudah ada.", "error");
      return;
    }
    try {
      await db.collection("kategori_pengeluaran").add({ nama });
      input.value = "";
      showToast("Kategori ditambahkan.", "success");
    } catch (err) {
      showToast(friendlyFirebaseError(err), "error");
    }
  });
});

async function deletePengeluaran(id) {
  if (!(await showConfirmModal("Hapus catatan pengeluaran ini beserta riwayat pembayarannya?", { okLabel: "Ya, Hapus", danger: true }))) return;
  try {
    // Firestore tidak otomatis menghapus subcollection -- riwayat pembayaran harus
    // ikut dihapus, kalau tidak Buku Kas masih menghitungnya sebagai kas keluar.
    const ref = db.collection("pengeluaran").doc(id);
    const subSnap = await ref.collection("pembayaran").get();
    const batch = db.batch();
    subSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();
    showToast("Pengeluaran dihapus.", "success");
    applyPengeluaranFilter();
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
  }
}

// ---------- Bayar hutang & riwayat pembayaran ----------
// Tiap pembayaran (pengeluaran/{id}/pembayaran) punya TANGGAL BAYAR sendiri --
// dasar Buku Kas untuk kas keluar. Field paid_amount di dokumen pengeluaran tetap
// disimpan sebagai TOTAL dibayar (dipakai status & Hutang Usaha), dijaga sinkron
// lewat transaksi di bawah.
let bayarId = null;

function pengPaid(e) {
  return e.paid_amount !== undefined ? Number(e.paid_amount) || 0 : Number(e.jumlah) || 0;
}

async function openBayarModal(id) {
  bayarId = id;
  document.getElementById("bayar-tanggal").value = todayInputValue();
  document.getElementById("bayar-modal").style.display = "flex";
  await renderBayarModal();
}
function closeBayarModal() {
  document.getElementById("bayar-modal").style.display = "none";
  bayarId = null;
}

async function renderBayarModal() {
  const item = pengExpenses.find((e) => e.id === bayarId);
  if (!item) {
    closeBayarModal();
    return;
  }
  const total = Number(item.jumlah) || 0;
  const paid = pengPaid(item);
  const sisa = total - paid;
  document.getElementById("bayar-info").innerHTML = `
    <div style="font-weight:700;">${escapeHtml(item.kategori)}${item.keterangan ? ` -- ${escapeHtml(item.keterangan)}` : ""}</div>
    <div style="font-size:12.5px; color:var(--gray-500); margin-top:4px;">Jumlah ${formatRupiah(total)} &middot; Dibayar ${formatRupiah(paid)} &middot; <strong style="color:${sisa > 0 ? "var(--red-600)" : "var(--brand-ink)"};">Sisa ${formatRupiah(sisa)}</strong></div>`;
  document.getElementById("bayar-form-wrap").style.display = sisa > 0 ? "" : "none";
  document.getElementById("bayar-jumlah").value = sisa > 0 ? sisa.toLocaleString("id-ID") : "";

  const box = document.getElementById("bayar-riwayat");
  box.innerHTML = `<p style="font-size:12.5px; color:var(--gray-400);">Memuat riwayat...</p>`;
  try {
    const snap = await db.collection("pengeluaran").doc(bayarId).collection("pembayaran").orderBy("tanggal", "asc").get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Pengeluaran lama (belum punya riwayat) tapi sudah ada bagian yang dibayar:
    // tampilkan sebagai satu baris "sebelumnya" -- otomatis dicatat jadi riwayat begitu ada pembayaran baru.
    const virtual = !item.riwayat_bayar && paid > 0 ? [{ virtual: true, tanggal: item.tanggal, jumlah: paid, catatan: "Dibayar saat dicatat (data lama)" }] : [];
    const all = [...virtual, ...rows];
    box.innerHTML =
      all.length === 0
        ? `<p style="font-size:12.5px; color:var(--gray-400); margin:10px 0;">Belum ada pembayaran.</p>`
        : `<div style="margin:10px 0;">${all
            .map(
              (r) => `
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 0; border-bottom:1px solid var(--gray-100); font-size:13px;">
          <span>${formatTanggal(r.tanggal)}<br><span style="font-size:11.5px; color:var(--gray-500);">${escapeHtml(r.catatan || "Pembayaran")}</span></span>
          <span style="white-space:nowrap; font-weight:600;">${formatRupiah(r.jumlah)}
            ${r.virtual ? "" : `<button type="button" class="icon-btn" title="Hapus pembayaran ini" onclick="deleteBayarHutang('${r.id}')"><i class="ph ph-trash"></i></button>`}
          </span>
        </div>`
            )
            .join("")}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
  }
}

async function refreshSetelahBayar() {
  await applyPengeluaranFilter(); // memuat ulang pengExpenses (angka terbaru dari server)
  await renderBayarModal();
}

async function submitBayarHutang(ev) {
  ev.preventDefault();
  const tglVal = document.getElementById("bayar-tanggal").value;
  const jumlah = parseFormattedNumber(document.getElementById("bayar-jumlah").value);
  if (!tglVal) {
    showToast("Tanggal bayar wajib diisi.", "error");
    return;
  }
  if (jumlah <= 0) {
    showToast("Jumlah bayar harus lebih dari 0.", "error");
    return;
  }
  const ref = db.collection("pengeluaran").doc(bayarId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Catatan pengeluaran tidak ditemukan.");
      const e = snap.data();
      const total = Number(e.jumlah) || 0;
      const paid = pengPaid(e);
      if (jumlah > total - paid) throw new Error(`Jumlah bayar melebihi sisa hutang (${formatRupiah(total - paid)}).`);
      const base = { kategori: e.kategori, keterangan: e.keterangan || "", created_by: pengProfile.uid, created_by_name: pengProfile.full_name, created_at: firebase.firestore.FieldValue.serverTimestamp() };
      // Pengeluaran lama yang sudah ada bagian dibayar: catat dulu sebagai pembayaran
      // awal di tanggal pengeluarannya (persis seperti perhitungan Buku Kas sebelumnya).
      if (!e.riwayat_bayar && paid > 0) {
        tx.set(ref.collection("pembayaran").doc(), { ...base, tanggal: e.tanggal, jumlah: paid, awal: true, catatan: "Dibayar saat dicatat (data lama)" });
      }
      tx.set(ref.collection("pembayaran").doc(), { ...base, tanggal: new Date(tglVal + "T00:00:00"), jumlah, catatan: "Bayar hutang" });
      const newPaid = paid + jumlah;
      tx.update(ref, { paid_amount: newPaid, status_bayar: computeStatusBayar(total, newPaid), riwayat_bayar: true });
    });
    showToast("Pembayaran dicatat.", "success");
    await refreshSetelahBayar();
  } catch (err) {
    showToast(err && err.message && !err.code ? err.message : friendlyFirebaseError(err), "error");
  }
}

async function deleteBayarHutang(pid) {
  if (!(await showConfirmModal("Hapus pembayaran ini? Sisa hutang akan bertambah lagi sebesar jumlah pembayaran tersebut.", { okLabel: "Ya, Hapus", danger: true }))) return;
  const ref = db.collection("pengeluaran").doc(bayarId);
  const pref = ref.collection("pembayaran").doc(pid);
  try {
    await db.runTransaction(async (tx) => {
      const pSnap = await tx.get(pref);
      const eSnap = await tx.get(ref);
      if (!pSnap.exists || !eSnap.exists) return;
      const e = eSnap.data();
      const total = Number(e.jumlah) || 0;
      const newPaid = Math.max(0, pengPaid(e) - (Number(pSnap.data().jumlah) || 0));
      tx.delete(pref);
      tx.update(ref, { paid_amount: newPaid, status_bayar: computeStatusBayar(total, newPaid) });
    });
    showToast("Pembayaran dihapus.", "success");
    await refreshSetelahBayar();
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
  }
}

// ---------- Modal kelola kategori ----------
function openKategoriModal() {
  renderKategoriList();
  document.getElementById("kategori-modal").style.display = "flex";
}
function closeKategoriModal() {
  document.getElementById("kategori-modal").style.display = "none";
}
function renderKategoriList() {
  const box = document.getElementById("kategori-list");
  if (!box) return;
  if (pengKategoriList.length === 0) {
    box.innerHTML = `<p style="color:var(--gray-400); font-size:13px;">Belum ada kategori.</p>`;
    return;
  }
  box.innerHTML = pengKategoriList
    .map(
      (k) => `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--gray-100);">
      <span style="font-size:13.5px;">${escapeHtml(k.nama)}</span>
      <button type="button" class="icon-btn" title="Hapus kategori (catatan lama tidak ikut berubah)" onclick="deleteKategori('${k.id}')"><i class="ph ph-trash"></i></button>
    </div>`
    )
    .join("");
}
async function deleteKategori(id) {
  if (!(await showConfirmModal("Hapus kategori ini dari daftar pilihan? Catatan pengeluaran lama yang sudah memakai kategori ini TIDAK ikut berubah/hilang.", { okLabel: "Ya, Hapus", danger: true }))) return;
  try {
    await db.collection("kategori_pengeluaran").doc(id).delete();
    showToast("Kategori dihapus.", "success");
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
  }
}
