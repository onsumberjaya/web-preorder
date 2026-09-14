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

  document.getElementById("pengeluaran-table").innerHTML = `<div class="loading-center"><div class="spinner"></div></div>`;
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
  document.getElementById("pengeluaran-summary").innerHTML = `
    <div class="stat-card brand" style="max-width:280px;">
      <span class="stat-icon"><i class="ph-bold ph-wallet"></i></span>
      <div class="stat-body">
        <div class="stat-label">Total Pengeluaran (${pengExpenses.length} catatan)</div>
        <div class="stat-value">${formatRupiah(total)}</div>
      </div>
    </div>`;

  const container = document.getElementById("pengeluaran-table");
  if (pengExpenses.length === 0) {
    container.innerHTML = `<div class="card empty-state">Belum ada pengeluaran di rentang tanggal ini.</div>`;
    return;
  }
  const rows = pengExpenses
    .map(
      (e) => `
    <tr>
      <td style="white-space:nowrap;">${formatTanggal(e.tanggal)}</td>
      <td>${escapeHtml(e.kategori)}</td>
      <td>${escapeHtml(e.keterangan || "")}</td>
      <td style="text-align:right; white-space:nowrap;">${formatRupiah(e.jumlah)}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="icon-btn" title="Edit" onclick='openPengeluaranModal(${JSON.stringify(e).replace(/'/g, "&#39;")})'><i class="ph ph-pencil-simple"></i></button>
        <button class="icon-btn" title="Hapus" onclick="deletePengeluaran('${e.id}')"><i class="ph ph-trash"></i></button>
      </td>
    </tr>`
    )
    .join("");
  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Tanggal</th><th>Kategori</th><th>Keterangan</th><th style="text-align:right;">Jumlah</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------- Modal tambah/edit pengeluaran ----------
function openPengeluaranModal(item) {
  document.getElementById("pengeluaran-modal-title").textContent = item ? "Edit Pengeluaran" : "Catat Pengeluaran";
  document.getElementById("peng-id").value = item ? item.id : "";
  document.getElementById("peng-tanggal").value = item ? localYmd(item.tanggal.toDate ? item.tanggal.toDate() : new Date(item.tanggal)) : todayInputValue();
  document.getElementById("peng-keterangan").value = item ? item.keterangan || "" : "";
  document.getElementById("peng-jumlah").value = item ? Number(item.jumlah).toLocaleString("id-ID") : "";
  renderKategoriDropdowns();
  if (item) document.getElementById("peng-kategori").value = item.kategori;
  document.getElementById("pengeluaran-modal").style.display = "flex";
}
function closePengeluaranModal() {
  document.getElementById("pengeluaran-modal").style.display = "none";
  document.getElementById("pengeluaran-form").reset();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pengeluaran-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("peng-id").value;
    const tanggalVal = document.getElementById("peng-tanggal").value;
    const kategori = document.getElementById("peng-kategori").value;
    const keterangan = document.getElementById("peng-keterangan").value.trim();
    const jumlah = parseFormattedNumber(document.getElementById("peng-jumlah").value);

    if (!kategori) {
      showToast("Pilih kategori dulu (atau tambah lewat \"Kelola Kategori\").", "error");
      return;
    }
    if (jumlah <= 0) {
      showToast("Jumlah harus lebih dari 0.", "error");
      return;
    }

    const data = {
      tanggal: new Date(tanggalVal + "T00:00:00"),
      kategori,
      keterangan,
      jumlah,
    };

    try {
      if (id) {
        await db.collection("pengeluaran").doc(id).update(data);
      } else {
        await db.collection("pengeluaran").add({
          ...data,
          created_by: pengProfile.uid,
          created_by_name: pengProfile.full_name,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
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
  if (!(await showConfirmModal("Hapus catatan pengeluaran ini?", { okLabel: "Ya, Hapus", danger: true }))) return;
  try {
    await db.collection("pengeluaran").doc(id).delete();
    showToast("Pengeluaran dihapus.", "success");
    applyPengeluaranFilter();
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
