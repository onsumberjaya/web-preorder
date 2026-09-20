# Catatan Rilis: Pengetatan Firestore Rules (tahap 8)

Semua muat di tier gratis (Spark) -- tidak butuh Cloud Functions.

## Apa yang berubah di `firestore.rules`

| # | Perubahan | Aktif kapan |
|---|-----------|-------------|
| 1 | **Counter nomor nota** hanya boleh naik tepat +1 (dan baru mulai dari 1). Lompatan bebas hanya Owner. | Langsung |
| 2 | **Payment pesanan wajib punya pesanan induk** (`existsAfter`), tidak ada lagi payment "yatim" yang bisa masuk Buku Kas. | Langsung |
| 3 | **Pembayaran pengeluaran (hutang) wajib punya induk** yang ada. | Langsung |
| 4 | **Whitelist field** untuk update `pengeluaran` dan `arsip_log`. | Langsung |
| 5 | **Kenaikan `paid_amount` wajib ditopang 1 dokumen payment baru** senilai selisihnya (via field `last_payment_id`). Berlaku untuk Admin Kasir & Karyawan; Owner dikecualikan. | Setelah saklar `paymentLinkEnforced()` diubah jadi `true` |

Batas yang tersisa (butuh server, tidak ada di tier gratis): akun lain masih bisa "membuang" nomor nota satu per satu (nomor bolong, tidak bisa loncat/bentrok), dan harga per item tidak bisa divalidasi server.

## Langkah rilis (urut, jangan dilompati)

1. **Publish `firestore.rules`** dari zip ini (saklar `paymentLinkEnforced()` masih `false`).
   Aturan #5 belum berlaku, jadi perangkat yang masih memakai versi aplikasi lama tetap normal.
2. **Upload seluruh isi zip ke GitHub Pages**, lalu di semua perangkat tutup & buka ulang aplikasi
   (PWA) supaya memuat versi terbaru. Versi baru menulis `last_payment_id` di tiap pembayaran.
3. **Tes** memakai akun **Karyawan** (bukan Owner), sebaiknya saat toko sepi:
   - Input pesanan **tanpa** uang muka -> berhasil
   - Input pesanan **dengan** uang muka -> berhasil
   - Detail pesanan -> Catat Pembayaran -> berhasil
   - Edit pesanan (ubah jumlah item) -> berhasil
   - Tandai diambil -> berhasil
   Lalu login Owner: Laporan Keuangan -> Buku Kas tampil tanpa banner merah.
4. Kalau semua lolos, **ubah `paymentLinkEnforced()` jadi `return true;`**, publish lagi, dan
   **ulangi tes langkah 3**.

## Kalau ada yang gagal ("permission-denied" / "Missing or insufficient permissions")

Firebase Console -> Firestore -> Rules -> **Riwayat (History)** -> pilih versi sebelumnya -> **Publish**.
Rollback instan. Kalau yang gagal baru setelah langkah 4, cukup kembalikan saklar ke `false`.

## Catatan teknis

- Rules yang melibatkan banyak dokumen sekaligus (`getAfter`/`existsAfter` dalam transaksi) TIDAK bisa
  diuji di "Rules Playground" console -- ujinya langsung seperti langkah 3, atau lewat Firebase Emulator.
- `get()/exists()/getAfter()` di rules ikut dihitung sebagai pembacaan dokumen dan punya batas jumlah
  panggilan per permintaan (10 untuk tulis tunggal, 20 untuk transaksi/batch). Rilis ini menambah
  beberapa panggilan pada penyimpanan pesanan baru + uang muka; kalau tes langkah 3 gagal hanya di
  "input pesanan dengan uang muka" setelah saklar `true`, kembalikan saklar ke `false`.
