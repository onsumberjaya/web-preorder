// Halaman PUBLIK (tanpa login) yang dibuka lewat scan QR code di nota A4 --
// lihat js/nota.js (pembuat QR) & buildPublicOrderStatusData() di js/utils.js
// (data apa saja yang boleh dibaca di sini). SENGAJA TIDAK memuat
// js/auth-guard.js -- halaman ini memang harus bisa diakses siapa saja
// tanpa perlu login sama sekali.

let statusToko = { nama: "Toko Benih", no_hp: "" };

document.addEventListener("DOMContentLoaded", init);

async function init() {
  const loadingEl = document.getElementById("status-loading");
  const contentEl = document.getElementById("status-content");

  const params = new URLSearchParams(location.search);
  const orderId = params.get("id");
  if (!orderId) {
    renderNotFound(loadingEl, contentEl, "Link tidak lengkap -- ID pesanan tidak ditemukan di URL.");
    return;
  }

  try {
    const [orderSnap, tokoSnap] = await Promise.all([
      db.collection("orders_public").doc(orderId).get(),
      db.collection("config").doc("toko").get(), // lihat firestore.rules -- dibuka publik cuma utk doc ini
    ]);
    if (tokoSnap.exists) statusToko = tokoSnap.data();

    if (!orderSnap.exists) {
      renderNotFound(loadingEl, contentEl, "Pesanan tidak ditemukan. Kemungkinan link sudah tidak berlaku atau salah scan.");
      return;
    }
    const data = orderSnap.data();
    loadingEl.style.display = "none";
    contentEl.style.display = "block";

    // Verifikasi 4 digit terakhir HP CUMA relevan kalau pesanan memang
    // punya no_hp -- kalau kosong (pelanggan tanpa HP saat pesan), langsung
    // tampilkan status tanpa diminta apa-apa (lihat pembahasan fitur ini:
    // ID pesanan sendiri sudah acak/tidak bisa ditebak, jadi tetap aman).
    if (data.no_hp_last4 && data.no_hp_last4.length > 0) {
      renderVerifikasi(contentEl, data);
    } else {
      renderDetail(contentEl, data);
    }
  } catch (err) {
    renderNotFound(loadingEl, contentEl, friendlyFirebaseError(err));
  }
}

// Logo toko -- SVG yang sama persis dengan yang dipakai di tentang.html,
// disalin ke sini karena status.html adalah halaman publik yang berdiri
// sendiri (tidak lewat auth-guard/layout utama).
function storeHeaderHtml() {
  return `
    <div class="store-header">
      <div class="store-logo">
        <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="statusLogoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#16a34a;" />
              <stop offset="100%" style="stop-color:#86efac;" />
            </linearGradient>
          </defs>
          <path d="M60 8 L6 66 C6 76 14 82 24 82 Q60 145 96 82 C106 82 114 76 114 66 Z" fill="url(#statusLogoGrad)" />
          <circle cx="60" cy="86" r="24" fill="#fff" stroke="url(#statusLogoGrad)" stroke-width="3" />
          <text x="60" y="93" text-anchor="middle" font-family="Inter, sans-serif" font-weight="800" font-size="22" fill="url(#statusLogoGrad)">SJ</text>
        </svg>
      </div>
      <div class="store-name">${escapeHtml(statusToko.nama || "Toko Benih")}</div>
    </div>`;
}

// Link "wa.me/<nomor>?text=<pesan>" -- nomor HP di Indonesia biasa ditulis
// diawali 0 (mis. 081234567890), sementara wa.me butuh format kode negara
// (62812...) tanpa tanda baca apa pun.
function waLink(noHp, message) {
  let digits = (noHp || "").replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  else if (!digits.startsWith("62")) digits = "62" + digits;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// Ringkasan "Produk x Jumlah" buat disisipkan ke pesan WhatsApp.
function ringkasItemsUntukWa(items) {
  return (items || []).map((it) => `${it.product_name} x${it.jumlah}`).join(", ") || "-";
}

function waBarHtml(message) {
  if (!statusToko.no_hp) return ""; // belum ada nomor WA toko dikonfigurasi -- jangan tampilkan tombol yang tidak bisa dipakai
  return `
    <div class="wa-bar">
      <a href="${waLink(statusToko.no_hp, message)}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff"><path d="M17.6 6.3A8.9 8.9 0 0 0 12.04 3.5 8.9 8.9 0 0 0 3.6 17l-1.1 4 4.1-1.1a8.9 8.9 0 0 0 5.4 1.8h0a8.9 8.9 0 0 0 8.9-8.9 8.9 8.9 0 0 0-2.3-6.2Zm-5.56 13.6h0a7.4 7.4 0 0 1-3.8-1l-.27-.16-2.3.6.6-2.2-.18-.28a7.4 7.4 0 0 1 6-11.4 7.4 7.4 0 0 1 7.4 7.4 7.4 7.4 0 0 1-7.4 6.9Zm4-5.5c-.2-.1-1.3-.6-1.5-.7-.2-.1-.3-.1-.5.1s-.6.7-.8.9c-.1.1-.3.2-.5.1a6 6 0 0 1-1.8-1.1 6.6 6.6 0 0 1-1.2-1.5c-.1-.2 0-.3.1-.4l.4-.4c.1-.1.2-.2.2-.4a.5.5 0 0 0 0-.4c-.1-.1-.5-1.3-.7-1.7-.2-.5-.4-.4-.5-.4h-.4a.9.9 0 0 0-.6.3 2.6 2.6 0 0 0-.8 1.9c0 1.1.8 2.2 1 2.4.1.1 1.7 2.6 4 3.6.6.2 1 .4 1.4.5.6.2 1.1.1 1.5.1.5-.1 1.3-.6 1.5-1.1.2-.5.2-.9.1-1l-.4-.2Z"/></svg>
        Chat Toko via WhatsApp
      </a>
    </div>`;
}

function renderNotFound(loadingEl, contentEl, message) {
  loadingEl.style.display = "none";
  contentEl.style.display = "block";
  contentEl.innerHTML = `
    ${storeHeaderHtml()}
    <h1>Cek Status Pesanan</h1>
    <div class="alert alert-error" style="margin-top:12px;">${escapeHtml(message)}</div>
    <p class="thanks-note">Kalau ini bukan link dari kami, abaikan saja. Kalau ini nota asli dari kami, hubungi kami di bawah.</p>
    ${waBarHtml("Halo, saya mau tanya soal pesanan saya, tapi link status pesanannya error.")}
  `;
}

function renderVerifikasi(contentEl, data) {
  contentEl.innerHTML = `
    ${storeHeaderHtml()}
    <h1>Verifikasi Diperlukan</h1>
    <p class="status-sub">Masukkan 4 digit TERAKHIR nomor HP yang dipakai saat memesan, untuk melihat status/detail pesanan ini.</p>
    <form id="verify-form">
      <input type="tel" inputmode="numeric" pattern="[0-9]*" maxlength="4" class="otp-input" id="verify-input" placeholder="0000" autocomplete="off" required />
      <div id="verify-alert"></div>
      <button type="submit" class="btn-primary" style="width:100%; justify-content:center; padding:11px;">Lihat Status</button>
    </form>
    ${waBarHtml("Halo, saya mau tanya soal status pesanan saya.")}
  `;
  const form = document.getElementById("verify-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("verify-input").value.trim();
    if (input === data.no_hp_last4) {
      renderDetail(contentEl, data);
    } else {
      document.getElementById("verify-alert").innerHTML = `<div class="alert alert-error" style="margin:8px 0;">4 digit tidak cocok. Coba lagi.</div>`;
    }
  });
}

function renderDetail(contentEl, data) {
  const sisa = (data.total || 0) - (data.paid_amount || 0);
  const badge = STATUS_BAYAR_BADGE[data.status_bayar] || "badge-gray";
  const label = STATUS_BAYAR_LABEL[data.status_bayar] || "-";

  const itemsHtml = (data.items || [])
    .map(
      (it) => `
      <div class="status-item-row">
        <span>${escapeHtml(it.product_name)} (${escapeHtml(it.wave_label || "-")}) &times; ${it.jumlah}</span>
        <span>${formatRupiah(it.subtotal)}</span>
      </div>`
    )
    .join("");

  contentEl.innerHTML = `
    ${storeHeaderHtml()}
    <h1>${escapeHtml(formatOrderNo(data))}</h1>
    <p class="status-sub">${escapeHtml(data.nama_pembeli || "-")} &middot; ${data.tanggal ? formatTanggal(data.tanggal) : "-"}</p>
    <div style="text-align:center; margin-bottom:14px;">
      <span class="badge ${badge}">${escapeHtml(label)}</span>
      ${data.is_diambil ? `<span class="badge badge-green" style="margin-left:6px;">Sudah Diambil</span>` : ""}
    </div>
    <div class="status-items">${itemsHtml || '<div class="status-item-row"><span>-</span></div>'}</div>
    <div class="status-row"><span>Total</span><span>${formatRupiah(data.total)}</span></div>
    <div class="status-row"><span>Sudah Dibayar</span><span>${formatRupiah(data.paid_amount || 0)}</span></div>
    <div class="status-row"><span>Sisa</span><span${data.status_bayar !== "lunas" ? ' style="color:#dc2626;"' : ""}>${formatRupiah(sisa)}</span></div>
    ${data.catatan ? `<div class="status-row"><span>Catatan</span><span style="text-align:right; font-weight:400;">${escapeHtml(data.catatan)}</span></div>` : ""}
    <div class="info-note">Kami akan menginformasikan lewat WhatsApp begitu barang pesanan Anda sudah datang / siap diambil.</div>
    <p class="thanks-note">Terima kasih atas pesanan Anda &#128591;</p>
    ${data.updated_at ? `<div class="updated-at">Diperbarui ${formatTanggalWaktu(data.updated_at)}</div>` : ""}
    ${waBarHtml(
      `Halo, saya mau tanya soal pesanan saya:\n` +
        `Nama: ${data.nama_pembeli || "-"}\n` +
        `Jumlah Pesanan: ${ringkasItemsUntukWa(data.items)}\n` +
        `Status Pembayaran: ${label}\n` +
        `Tanggal Pesan: ${data.tanggal ? formatTanggal(data.tanggal) : "-"}`
    )}
  `;
}
