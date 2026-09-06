let allProducts = [];
let waveStatsMap = {}; // { "productId::waveId": totalQtyTerpakai } -- lihat js/input-pesanan.js utk cara diisi

window.onAuthReady = function () {
  listenProducts();
  // Real-time: jumlah terpakai per gelombang (dihitung dari pesanan yang
  // masuk lewat Input Pesanan) supaya tabel di bawah selalu menampilkan
  // "Terpakai X / Kuota Y" terkini tanpa perlu refresh manual.
  db.collection("stats")
    .doc("produk_gelombang")
    .onSnapshot((doc) => {
      waveStatsMap = doc.exists ? doc.data() : {};
      renderProducts();
    });
};

function listenProducts() {
  db.collection("products").orderBy("nama").onSnapshot(
    (snap) => {
      allProducts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderProducts();
    },
    (err) => {
      console.error(err);
      showToast("Gagal memuat produk: " + friendlyFirebaseError(err), "error");
    }
  );
}

function renderProducts() {
  const container = document.getElementById("product-list");
  if (allProducts.length === 0) {
    container.innerHTML = `<div class="card empty-state">Belum ada produk. Klik "Tambah Produk" untuk mulai.</div>`;
    return;
  }
  container.innerHTML = allProducts
    .map((p) => {
      const waves = p.waves || [];
      const waveRows = waves
        .map((w) => {
          const terpakai = waveStatsMap[`${p.id}::${w.id}`] || 0;
          const kuotaInfo = w.kuota !== null && w.kuota !== undefined && w.kuota !== "" ? `<div style="font-size:11.5px; color:var(--gray-500);">Kuota: ${terpakai}/${w.kuota}${terpakai >= w.kuota ? ' <span class="badge badge-yellow">Penuh</span>' : ""}</div>` : "";
          const sudahTutup = w.tanggal_tutup && new Date() > new Date(w.tanggal_tutup + "T23:59:59");
          const tutupInfo = w.tanggal_tutup ? `<div style="font-size:11.5px; color:var(--gray-500);">Tutup: ${formatTanggal(new Date(w.tanggal_tutup + "T00:00:00"))}${sudahTutup ? ' <span class="badge badge-yellow">Lewat</span>' : ""}</div>` : "";
          return `
        <tr>
          <td>${escapeHtml(w.label)} ${w.aktif ? '<span class="badge badge-green">Aktif</span>' : ""}${kuotaInfo}${tutupInfo}</td>
          <td>${formatRupiah(w.harga)}</td>
          <td style="text-align:right; white-space:nowrap;">
            ${!w.aktif ? `<button class="btn-secondary btn-sm" onclick="setActiveWave('${p.id}','${w.id}')">Jadikan Aktif</button>` : ""}
            <button class="btn-secondary btn-sm" onclick='openWaveModal("${p.id}", ${JSON.stringify(w).replace(/'/g, "&#39;")})'>Edit</button>
            <button class="btn-danger btn-sm" onclick="deleteWave('${p.id}','${w.id}')">Hapus</button>
          </td>
        </tr>`;
        })
        .join("");
      return `
      <div class="card" style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0 0 4px;">${escapeHtml(p.nama)}</h3>
            <p style="margin:0; color:var(--gray-500); font-size:13.5px;">${escapeHtml(p.deskripsi || "")}</p>
            ${p.stok !== null && p.stok !== undefined ? `<p style="margin:4px 0 0; font-size:12.5px; color:var(--gray-500);">Stok: ${p.stok}</p>` : ""}
          </div>
          <div style="display:flex; gap:8px; flex-shrink:0;">
            <button class="btn-secondary btn-sm" onclick='openProductModal(${JSON.stringify(p).replace(/'/g, "&#39;")})'>Edit</button>
            <button class="btn-danger btn-sm" onclick="deleteProduct('${p.id}')">Hapus</button>
          </div>
        </div>
        <div class="table-wrap" style="margin-top:14px;">
          <table>
            <thead><tr><th>Gelombang</th><th>Harga</th><th></th></tr></thead>
            <tbody>${waveRows || '<tr><td colspan="3" style="color:var(--gray-400);">Belum ada gelombang harga</td></tr>'}</tbody>
          </table>
        </div>
        <button class="btn-secondary btn-sm" style="margin-top:10px;" onclick="openWaveModal('${p.id}')">+ Tambah Gelombang</button>
      </div>`;
    })
    .join("");
}

// ---------- Produk ----------
function openProductModal(product) {
  document.getElementById("product-modal-title").textContent = product ? "Edit Produk" : "Tambah Produk";
  document.getElementById("product-id").value = product ? product.id : "";
  document.getElementById("product-nama").value = product ? product.nama : "";
  document.getElementById("product-deskripsi").value = product ? product.deskripsi || "" : "";
  document.getElementById("product-stok").value = product && product.stok !== null && product.stok !== undefined ? product.stok : "";
  document.getElementById("product-modal").style.display = "flex";
}
function closeProductModal() {
  document.getElementById("product-modal").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("product-id").value;
    const nama = document.getElementById("product-nama").value.trim();
    const deskripsi = document.getElementById("product-deskripsi").value.trim();
    const stokVal = document.getElementById("product-stok").value;
    const stok = stokVal === "" ? null : Number(stokVal);

    try {
      if (id) {
        await db.collection("products").doc(id).update({ nama, deskripsi, stok });
      } else {
        await db.collection("products").add({
          nama,
          deskripsi,
          stok,
          waves: [],
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      showToast("Produk tersimpan.", "success");
      closeProductModal();
    } catch (err) {
      showToast(friendlyFirebaseError(err), "error");
    }
  });

  document.getElementById("wave-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const productId = document.getElementById("wave-product-id").value;
    const waveId = document.getElementById("wave-id").value;
    const label = document.getElementById("wave-label").value.trim();
    const harga = Number(document.getElementById("wave-harga").value);
    const kuotaVal = document.getElementById("wave-kuota").value;
    const kuota = kuotaVal === "" ? null : Number(kuotaVal);
    const tanggalTutupVal = document.getElementById("wave-tanggal-tutup").value;
    const tanggal_tutup = tanggalTutupVal === "" ? null : tanggalTutupVal;

    try {
      // Pakai transaksi: baca array "waves" TERBARU dari server tepat saat
      // menyimpan (bukan dari allProducts yang sudah dibuka sejak halaman ini
      // dibuka/snapshot terakhir). Ini mencegah 2 admin yang mengedit gelombang
      // produk yang sama nyaris bersamaan saling menimpa perubahan satu sama
      // lain (race condition / lost update) -- lihat juga setActiveWave() dan
      // deleteWave() di bawah yang punya masalah & solusi yang sama.
      await db.runTransaction(async (tx) => {
        const ref = db.collection("products").doc(productId);
        const freshDoc = await tx.get(ref);
        if (!freshDoc.exists) throw new Error("Produk tidak ditemukan (mungkin baru saja dihapus).");
        let waves = [...(freshDoc.data().waves || [])];

        if (waveId) {
          if (!waves.some((w) => w.id === waveId)) {
            throw new Error("Gelombang ini sudah tidak ada (mungkin baru saja dihapus rekan kerja). Muat ulang halaman.");
          }
          waves = waves.map((w) => (w.id === waveId ? { ...w, label, harga, kuota, tanggal_tutup } : w));
        } else {
          const newWave = {
            id: "w_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            label,
            harga,
            kuota,
            tanggal_tutup,
            aktif: waves.length === 0, // gelombang pertama otomatis aktif
          };
          waves.push(newWave);
        }

        tx.update(ref, { waves });
      });
      showToast("Gelombang tersimpan.", "success");
      closeWaveModal();
    } catch (err) {
      showToast(err.message || friendlyFirebaseError(err), "error");
    }
  });
});

async function deleteProduct(id) {
  if (!(await showConfirmModal("Hapus produk ini beserta semua gelombang harganya? Pesanan lama yang sudah ada tidak akan terhapus.", { okLabel: "Ya, Hapus", danger: true }))) return;
  try {
    await db.collection("products").doc(id).delete();
    showToast("Produk dihapus.", "success");
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
  }
}

// ---------- Gelombang ----------
function openWaveModal(productId, wave) {
  document.getElementById("wave-modal-title").textContent = wave ? "Edit Gelombang" : "Tambah Gelombang";
  document.getElementById("wave-product-id").value = productId;
  document.getElementById("wave-id").value = wave ? wave.id : "";
  document.getElementById("wave-label").value = wave ? wave.label : "";
  document.getElementById("wave-harga").value = wave ? wave.harga : "";
  document.getElementById("wave-kuota").value = wave && wave.kuota !== null && wave.kuota !== undefined ? wave.kuota : "";
  document.getElementById("wave-tanggal-tutup").value = wave && wave.tanggal_tutup ? wave.tanggal_tutup : "";
  document.getElementById("wave-modal").style.display = "flex";
}
function closeWaveModal() {
  document.getElementById("wave-modal").style.display = "none";
}

// Sama seperti submit form gelombang di atas: pakai transaksi & baca ulang
// "waves" TERBARU dari server, bukan dari allProducts di memori -- supaya
// klik "Jadikan Aktif" tidak menimpa perubahan rekan kerja lain yang baru
// saja mengedit/menghapus gelombang produk yang sama (race condition / lost
// update pada array "waves").
async function setActiveWave(productId, waveId) {
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection("products").doc(productId);
      const freshDoc = await tx.get(ref);
      if (!freshDoc.exists) throw new Error("Produk tidak ditemukan (mungkin baru saja dihapus).");
      const freshWaves = freshDoc.data().waves || [];
      if (!freshWaves.some((w) => w.id === waveId)) {
        throw new Error("Gelombang ini sudah tidak ada (mungkin baru saja dihapus rekan kerja). Muat ulang halaman.");
      }
      const waves = freshWaves.map((w) => ({ ...w, aktif: w.id === waveId }));
      tx.update(ref, { waves });
    });
    showToast("Gelombang aktif diperbarui.", "success");
  } catch (err) {
    showToast(err.message || friendlyFirebaseError(err), "error");
  }
}

// Sama seperti setActiveWave() di atas -- baca ulang "waves" TERBARU dari
// server di dalam transaksi supaya penghapusan tidak menimpa perubahan
// rekan kerja lain yang bersamaan mengedit gelombang produk yang sama.
async function deleteWave(productId, waveId) {
  if (!(await showConfirmModal("Hapus gelombang harga ini?", { okLabel: "Ya, Hapus", danger: true }))) return;
  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection("products").doc(productId);
      const freshDoc = await tx.get(ref);
      if (!freshDoc.exists) throw new Error("Produk tidak ditemukan (mungkin baru saja dihapus).");
      const waves = (freshDoc.data().waves || []).filter((w) => w.id !== waveId);
      tx.update(ref, { waves });
    });
    showToast("Gelombang dihapus.", "success");
  } catch (err) {
    showToast(err.message || friendlyFirebaseError(err), "error");
  }
}
