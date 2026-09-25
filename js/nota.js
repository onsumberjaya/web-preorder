let notaOrder = null;
let notaToko = { nama: "Toko Benih", alamat: "", no_hp: "" };

window.onAuthReady = async function () {
  const params = new URLSearchParams(location.search);
  const orderId = params.get("id");
  if (!orderId) {
    document.getElementById("nota-container").innerHTML = `<div class="alert alert-error no-print" style="margin:20px;">ID pesanan tidak ditemukan di URL.</div>`;
    return;
  }
  try {
    const [orderDoc, tokoDoc] = await Promise.all([
      db.collection("orders").doc(orderId).get(),
      db.collection("config").doc("toko").get(),
    ]);
    if (!orderDoc.exists) {
      document.getElementById("nota-container").innerHTML = `<div class="alert alert-error no-print" style="margin:20px;">Pesanan tidak ditemukan.</div>`;
      return;
    }
    notaOrder = { id: orderDoc.id, ...orderDoc.data() };
    if (tokoDoc.exists) notaToko = tokoDoc.data();

    // Kop nota pakai ALAMAT & NO. HP dari CABANG tempat pesanan ini dibuat
    // (supaya pembeli di cabang dapat nota dengan alamat yang benar-benar
    // sesuai lokasi cabang itu) -- TAPI nama tokonya selalu pakai Profil
    // Toko utama untuk semua cabang (bukan nama cabangnya), supaya branding
    // di nota tetap konsisten "TOKO SUMBER JAYA" di mana pun pesanan dibuat.
    // Kalau pesanan belum punya cabang_id (data lama sebelum fitur cabang
    // ada) atau cabang-nya sudah dihapus, alamat/no.HP juga tetap pakai
    // Profil Toko utama seperti biasa (fallback aman).
    if (notaOrder.cabang_id) {
      try {
        const cabangDoc = await db.collection("cabang").doc(notaOrder.cabang_id).get();
        if (cabangDoc.exists) {
          const c = cabangDoc.data();
          notaToko = {
            nama: notaToko.nama,
            alamat: c.alamat || notaToko.alamat,
            no_hp: c.no_hp || notaToko.no_hp,
          };
        }
      } catch (err) {
        // Gagal ambil data cabang (mis. karena hak akses) tidak boleh
        // menggagalkan seluruh nota -- tetap tampil pakai Profil Toko utama.
      }
    }

    renderNota();
  } catch (err) {
    document.getElementById("nota-container").innerHTML = `<div class="alert alert-error no-print" style="margin:20px;">${friendlyFirebaseError(err)}</div>`;
  }
};

function renderNota() {
  const o = notaOrder;
  const items = o.items || [];
  const sisa = o.total - (o.paid_amount || 0);

  const MIN_BARIS_A4 = 5;
  const itemRowsA4Isi = items
    .map(
      (it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(it.product_name)}</td>
      <td>${escapeHtml(it.wave_label)}</td>
      <td style="text-align:center;">${it.jumlah}</td>
      <td style="text-align:right;">${formatRupiah(it.harga_satuan)}</td>
      <td style="text-align:right;">${formatRupiah(it.subtotal)}</td>
    </tr>`
    )
    .join("");
  const jumlahBarisKosong = Math.max(0, MIN_BARIS_A4 - items.length);
  const itemRowsA4Kosong = Array.from({ length: jumlahBarisKosong })
    .map(
      () => `
    <tr style="height:17px;">
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
    </tr>`
    )
    .join("");
  const itemRowsA4 = itemRowsA4Isi + itemRowsA4Kosong;

  // PROTEKSI OVERFLOW: tinggi nota A4 tetap (setengah halaman, lihat CSS
  // .nota-a4) -- kalau produknya lebih dari MIN_BARIS_A4 (10) baris, tabel
  // otomatis dipadatkan (font & padding sel diperkecil bertahap) supaya
  // tetap muat, alih-alih diam-diam terpotong di bagian bawah nota (CSS
  // .nota-a4 pakai overflow:hidden). Di atas ambang tertentu, tetap
  // ditampilkan peringatan di LAYAR (tidak ikut tercetak) supaya kasir sadar
  // dan bisa mempertimbangkan memecah pesanan itu jadi 2 nota.
  let notaA4DenseClass = "";
  let notaA4Peringatan = "";
  if (items.length > 24) {
    notaA4DenseClass = "nota-dense-3";
    notaA4Peringatan = `<div class="alert alert-error no-print" style="margin:10px auto; max-width:210mm;">Pesanan ini punya ${items.length} baris produk -- kemungkinan besar TIDAK muat rapi walau sudah dipadatkan maksimal. Pertimbangkan pecah jadi 2 nota terpisah.</div>`;
  } else if (items.length > 17) {
    notaA4DenseClass = "nota-dense-3";
    notaA4Peringatan = `<div class="alert alert-warning no-print" style="margin:10px auto; max-width:210mm;">Pesanan ini punya ${items.length} baris produk -- tabel sudah dipadatkan otomatis, cek dulu hasil preview sebelum benar-benar dicetak.</div>`;
  } else if (items.length > 10) {
    notaA4DenseClass = items.length > 13 ? "nota-dense-2" : "nota-dense-1";
  }

  const itemRowsDm = items
    .map(
      (it) => `
    <tr>
      <td colspan="2">${escapeHtml(it.product_name)} (${escapeHtml(it.wave_label)})</td>
    </tr>
    <tr>
      <td>${it.jumlah} x ${formatRupiah(it.harga_satuan)}</td>
      <td style="text-align:right;">${formatRupiah(it.subtotal)}</td>
    </tr>`
    )
    .join("");

  const notaA4Body = `
      <div style="text-align:center; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:8px;">
        <h2 style="margin:0; font-size:16px;">${escapeHtml(notaToko.nama || "Toko Benih")}</h2>
        <p style="margin:1px 0; font-size:11px;">${escapeHtml(notaToko.alamat || "")}</p>
        <p style="margin:1px 0; font-size:11px;">${escapeHtml(notaToko.no_hp || "")}</p>
        <p style="margin:4px 0 3px; font-weight:700; letter-spacing:1px; font-size:12px;">NOTA PREORDER</p>
      </div>
      <div style="display:flex; margin-bottom:8px;">
        <div style="width:35%; min-width:0;">
          <table style="border-collapse:collapse; width:100%;">
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">Nama</td><td style="padding:1px 0; word-break:break-word;">: ${escapeHtml(o.nama_pembeli)}</td></tr>
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">Alamat</td><td style="padding:1px 0; word-break:break-word;">: ${escapeHtml(o.alamat || "-")}</td></tr>
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">No. HP</td><td style="padding:1px 0; word-break:break-word;">: ${escapeHtml(o.no_hp || "-")}</td></tr>
          </table>
        </div>
        <div style="width:30%; min-width:0;"></div>
        <div style="width:35%; min-width:0;">
          <table style="border-collapse:collapse; width:100%;">
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">No. Nota</td><td style="padding:1px 0; word-break:break-word;">: ${formatOrderNo(o)}</td></tr>
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">Tanggal</td><td style="padding:1px 0; word-break:break-word;">: ${formatTanggal(o.tanggal)}</td></tr>
            <tr><td style="font-weight:700; padding:1px 6px 1px 0; white-space:nowrap; vertical-align:top;">Status</td><td style="padding:1px 0; word-break:break-word;">: ${STATUS_BAYAR_LABEL[o.status_bayar]}</td></tr>
          </table>
        </div>
      </div>
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #000;">
            <th style="text-align:left; padding:2px;">No</th>
            <th style="text-align:left; padding:2px;">Produk</th>
            <th style="text-align:left; padding:2px;">Gelombang</th>
            <th style="text-align:center; padding:2px;">Jml</th>
            <th style="text-align:right; padding:2px;">Harga</th>
            <th style="text-align:right; padding:2px;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemRowsA4}</tbody>
      </table>
      <div style="display:flex; border-top:1px solid #000; margin-top:6px; padding-top:6px;">
        <div style="width:55%; min-width:0; padding-right:14px; box-sizing:border-box;">
          ${o.catatan ? `<div style="font-weight:700; margin-bottom:2px;">Catatan</div><div style="word-break:break-word; white-space:pre-wrap;">${escapeHtml(o.catatan)}</div>` : ""}
        </div>
        <div style="width:45%; min-width:0;">
          <div style="display:flex; justify-content:space-between;"><span>Total</span><strong>${formatRupiah(o.total)}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span>Sudah Dibayar</span><span>${formatRupiah(o.paid_amount || 0)}</span></div>
          <div style="display:flex; justify-content:space-between; font-size:15px;${o.status_bayar !== "lunas" ? " color:#dc2626;" : ""}"><strong>Sisa</strong><strong>${formatRupiah(sisa)}</strong></div>
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:12px;">
        <div style="display:flex; gap:8mm;">
          <div style="width:38mm; text-align:center; font-size:9.5px; color:#555;">
            <div style="border-bottom:1px solid #999; height:11mm; margin-bottom:3px;"></div>
            Adm. Penjualan
          </div>
          <div style="width:38mm; text-align:center; font-size:9.5px; color:#555;">
            <div style="border-bottom:1px solid #999; height:11mm; margin-bottom:3px;"></div>
            Penerima
          </div>
        </div>
        <p style="margin:0; color:#555; font-size:11px;">Terima kasih atas pesanan Anda</p>
        ${
          typeof PUBLIC_STATUS_BASE_URL === "string" && PUBLIC_STATUS_BASE_URL && !PUBLIC_STATUS_BASE_URL.startsWith("GANTI_")
            ? `<div class="nota-qr-slot" data-order-id="${o.id}" style="text-align:center;">
                 <div class="nota-qr-box" style="width:16mm; height:16mm;"></div>
               </div>`
            : ""
        }
      </div>
  `;

  document.getElementById("nota-container").innerHTML = `
    ${notaA4Peringatan}
    <div class="nota-a4 ${notaA4DenseClass}">${notaA4Body}</div>

    <div class="nota-dm">
      <div style="text-align:center;">
        <div><strong>${escapeHtml(notaToko.nama || "Toko Benih")}</strong></div>
        <div>${escapeHtml(notaToko.alamat || "")}</div>
        <div>${escapeHtml(notaToko.no_hp || "")}</div>
        <div style="font-weight:700;">*** PREORDER ***</div>
      </div>
      <hr />
      <table class="info-table">
        <tr><td>No</td><td>: ${formatOrderNo(o)}</td></tr>
        <tr><td>Tgl</td><td>: ${formatTanggal(o.tanggal)}</td></tr>
        <tr><td>Nama</td><td>: ${escapeHtml(o.nama_pembeli)}</td></tr>
        <tr><td>HP</td><td>: ${escapeHtml(o.no_hp || "-")}</td></tr>
      </table>
      <hr />
      <table>${itemRowsDm}</table>
      <hr />
      <table>
        <tr><td>Total</td><td style="text-align:right;">${formatRupiah(o.total)}</td></tr>
        <tr><td>Bayar</td><td style="text-align:right;">${formatRupiah(o.paid_amount || 0)}</td></tr>
        <tr><td><strong>Sisa</strong></td><td style="text-align:right;"><strong>${formatRupiah(sisa)}</strong></td></tr>
      </table>
      ${o.catatan ? `<hr /><div><strong>Catatan:</strong> ${escapeHtml(o.catatan)}</div>` : ""}
      <hr />
      <div style="text-align:center;">Terima kasih</div>
    </div>
  `;

  renderNotaQrCodes();
}

// Menggambar QR code (kalau PUBLIC_STATUS_BASE_URL sudah diisi di
// js/firebase-config.js) ke setiap ".nota-qr-slot" yang ada di nota --
// dipisah dari template string di atas karena perlu memanggil library
// js/vendor/qrcode.js (butuh elemen DOM sudah ada di halaman, tidak bisa
// dijadikan bagian dari string HTML biasa). Isi QR: link ke status.html
// dengan ID pesanan (ID dokumen Firestore -- sudah acak/tidak bisa ditebak
// secara bawaan) sebagai parameter "id".
function renderNotaQrCodes() {
  document.querySelectorAll(".nota-qr-slot").forEach((slot) => {
    const orderId = slot.getAttribute("data-order-id");
    const box = slot.querySelector(".nota-qr-box");
    if (!orderId || !box || typeof qrcode !== "function") return;
    try {
      // Level "H" (bukan "M") -- toleransi kerusakan/tutupan naik jadi
      // ~30%, supaya aman dipasangi logo toko di tengah (di bawah) tanpa
      // bikin QR gagal discan.
      const qr = qrcode(0, "H");
      qr.addData(`${PUBLIC_STATUS_BASE_URL}?id=${encodeURIComponent(orderId)}`);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
      const svg = box.querySelector("svg");
      if (svg) {
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.display = "block";
        sisipkanLogoDiTengahQr(svg);
      }
    } catch (err) {
      console.warn("Gagal membuat QR code nota:", err);
    }
  });
}

// Menyisipkan logo toko (lingkaran putih + inisial "SJ") persis di tengah
// QR. Aman karena: (1) error correction sudah dinaikkan ke level H di atas,
// (2) logo dibatasi ~20% lebar QR, (3) posisinya tepat di tengah -- area
// paling toleran menampung kerusakan/tutupan, jauh dari 3 kotak "mata" di
// pojok yang krusial untuk orientasi pemindaian.
function sisipkanLogoDiTengahQr(svg) {
  const vb = (svg.getAttribute("viewBox") || "").split(" ").map(Number);
  const size = vb[2];
  if (!size) return;
  const logoSize = size * 0.2;
  const cx = size / 2;
  const cy = size / 2;
  const bgR = (logoSize / 2) * 1.25;
  const ns = "http://www.w3.org/2000/svg";

  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML =
    '<linearGradient id="notaQrLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" style="stop-color:#16a34a;" />' +
    '<stop offset="100%" style="stop-color:#86efac;" />' +
    "</linearGradient>";
  svg.appendChild(defs);

  const bgCircle = document.createElementNS(ns, "circle");
  bgCircle.setAttribute("cx", cx);
  bgCircle.setAttribute("cy", cy);
  bgCircle.setAttribute("r", bgR);
  bgCircle.setAttribute("fill", "#fff");
  svg.appendChild(bgCircle);

  const logoScale = logoSize / 120;
  const g = document.createElementNS(ns, "g");
  g.setAttribute("transform", `translate(${cx - logoSize / 2},${cy - logoSize / 2}) scale(${logoScale})`);
  g.innerHTML =
    '<path d="M60 8 L6 66 C6 76 14 82 24 82 Q60 145 96 82 C106 82 114 76 114 66 Z" fill="url(#notaQrLogoGrad)" />' +
    '<circle cx="60" cy="86" r="24" fill="#fff" stroke="url(#notaQrLogoGrad)" stroke-width="3" />' +
    '<text x="60" y="93" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="22" fill="url(#notaQrLogoGrad)">SJ</text>';
  svg.appendChild(g);
}

function doPrint(mode) {
  document.body.classList.remove("nota-mode-a4", "nota-mode-dm");
  document.body.classList.add(mode === "a4" ? "nota-mode-a4" : "nota-mode-dm");
  setTimeout(() => window.print(), 50);
}
