# Panduan Setup — Aplikasi Manajemen Pesanan Benih (Versi Web Gratis)

Aplikasi ini murni HTML/CSS/JavaScript — **tidak perlu install Python, Node, atau server apapun**
di komputer Anda. Database dan login memakai **Firebase** (gratis dari Google, tanpa kartu kredit).
Hosting online memakai **GitHub Pages** (gratis).

Ikuti langkah-langkah ini secara berurutan.

---

## BAGIAN 1 — Buat Project Firebase (gratis, ±10 menit)

1. Buka https://console.firebase.google.com, login pakai akun Google Anda.
2. Klik **Add project** / **Tambahkan project**.
3. Beri nama, misalnya `preorder-benih`. Klik **Continue**.
4. Kalau ditawari Google Analytics, boleh **dimatikan saja** (tidak perlu). Klik **Create project**.
5. Tunggu sampai selesai, klik **Continue**.

### 1a. Aktifkan Authentication (untuk login)
1. Di menu kiri, klik **Build → Authentication**.
2. Klik **Get started**.
3. Pilih tab **Sign-in method** → klik **Email/Password** → aktifkan toggle-nya → **Save**.

### 1b. Aktifkan Firestore Database (untuk data)
1. Di menu kiri, klik **Build → Firestore Database**.
2. Klik **Create database**.
3. Pilih lokasi server, misalnya `asia-southeast2 (Jakarta)` atau `asia-southeast1 (Singapore)` — pilih yang terdekat.
4. Pilih mode **Start in production mode** → **Enable**.

### 1c. Pasang Aturan Keamanan
1. Masih di halaman Firestore, klik tab **Rules**.
2. **Hapus semua isi kotak teks itu**, lalu buka file `firestore.rules` yang ada di folder project ini,
   **copy semua isinya**, dan **paste** ke kotak tadi.
3. Klik **Publish**.

### 1d. (Opsional) Aktifkan Realtime Database untuk fitur "Karyawan Online"
Fitur "Karyawan Online" di halaman **Akun Pengguna** (menampilkan siapa yang sedang online) pakai
layanan **terpisah** dari Firestore, namanya **Realtime Database**. Lewati bagian ini kalau fitur
ini tidak diperlukan -- aplikasi tetap jalan normal tanpanya.
1. Di menu kiri, klik **Build → Realtime Database** (BUKAN "Firestore Database", ini layanan lain).
2. Klik **Create Database**, pilih lokasi server, klik **Enable**.
3. Klik tab **Rules**. **Hapus semua isi kotak teks itu**, buka file `database.rules.json` dari folder
   project ini, **copy semua isinya**, **paste** ke kotak tadi, lalu klik **Publish**.
4. Salin URL database yang muncul di bagian atas halaman (bentuknya seperti
   `https://NAMA-PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app`), lalu isikan ke
   `databaseURL` di `js/firebase-config.js` (lihat komentar di file itu).

> ⚠️ Setelah Rules-nya dipasang, akun **Owner pertama** perlu 1 langkah tambahan supaya bisa melihat
> siapa yang online -- lihat **Bagian 2c** di bawah (dilakukan sekali saja, sesudah Bagian 2b).

### 1e. Ambil Firebase Config (kunci penghubung)
1. Klik ikon **gerigi (⚙️)** di pojok kiri atas → **Project settings**.
2. Scroll ke bawah ke bagian **Your apps**. Klik ikon **`</>`** (Web).
3. Beri nama app, misalnya `preorder-benih-web` → klik **Register app**.
4. Akan muncul kode seperti ini — **copy bagian `firebaseConfig` saja**:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "preorder-benih.firebaseapp.com",
     projectId: "preorder-benih",
     storageBucket: "preorder-benih.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef123456"
   };
   ```
5. Buka file `js/firebase-config.js` di folder project ini pakai Notepad.
6. Ganti bagian `firebaseConfig` di file itu dengan yang baru saja Anda copy. Simpan file.

### 1f. (Opsional, SANGAT disarankan) Aktifkan App Check
`firebaseConfig` di atas (termasuk `apiKey`) memang publik dan itu wajar untuk aplikasi Firebase
manapun -- keamanan sesungguhnya ada di Rules, bukan di kerahasiaan `apiKey`. TAPI tanpa App Check,
siapa pun yang menyalin `apiKey` itu dari "View Source" bisa memakainya mengirim request langsung ke
Firestore Anda dari LUAR aplikasi ini (skrip sendiri, bukan lewat halaman web ini) -- bukan untuk
mencuri/mengubah data (Rules tetap menahan itu), tapi bisa dipakai untuk SPAM baca/tulis sampai kuota
gratis harian Firebase habis. App Check menutup celah itu.

> ⚠️ **Ikuti urutan ini PERSIS.** Kalau langkah "Enforce" di bagian akhir dilakukan TERLALU CEPAT
> (sebelum kode dengan site key sungguhan sudah online & semua staf sempat buka ulang aplikasinya),
> Anda berisiko mengunci akses SEMUA ORANG termasuk diri Anda sendiri, karena request tanpa App Check
> yang valid akan ditolak Firebase -- termasuk dari browser yang masih memuat versi lama halaman ini.

1. **Daftarkan reCAPTCHA v3.** Buka [google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create).
   - Label: bebas, mis. `Preorder Benih Web`.
   - Jenis reCAPTCHA: pilih **reCAPTCHA v3**.
   - Domain: isi domain GitHub Pages Anda (mis. `namaanda.github.io`) -- kalau mau coba lokal juga,
     tambah baris domain lagi: `localhost`.
   - Setujui Persyaratan Layanan → **Submit**.
   - Akan muncul 2 kunci: **Site Key** (publik) dan **Secret Key** (rahasia, JANGAN taruh di kode).
     Salin keduanya, akan dipakai di langkah 2 & 3.
2. **Daftarkan ke Firebase Console.** Menu kiri → **Build → App Check** → klik app web Anda →
   pilih provider **reCAPTCHA v3** → tempel **Secret Key** dari langkah 1 → **Save**.
3. **Isi Site Key ke kode.** Buka `js/firebase-config.js`, cari baris
   `const RECAPTCHA_V3_SITE_KEY = "GANTI_DENGAN_RECAPTCHA_V3_SITE_KEY";`, ganti isinya dengan
   **Site Key** (bukan Secret Key!) dari langkah 1. Simpan file.
4. **Upload & tunggu.** Ikuti Bagian 5 (atau 5c kalau ini update, bukan instalasi baru) untuk
   mengunggah perubahan ini ke GitHub Pages seperti biasa. **Rules TIDAK berubah di langkah ini**,
   jadi tidak perlu publish ulang Rules -- cukup upload kodenya saja.
5. **Pantau dulu, JANGAN langsung di-enforce.** Balik ke Firebase Console → **App Check** → tab
   **Apps**, lihat metrik "Verified requests" untuk Firestore (dan Realtime Database kalau dipakai).
   Biarkan **minimal 1-2 hari** supaya semua staf sempat membuka ulang aplikasinya (otomatis dapat
   versi baru) dan grafiknya didominasi "Verified". Selama masa ini App Check baru MEMANTAU, belum
   MEMBLOKIR apa pun -- aplikasi tetap 100% jalan normal seperti biasa.
6. **Baru aktifkan "Enforce".** Setelah yakin verified request sudah dominan: App Check → pilih
   **Firestore Database** → toggle **Enforce**. Kalau Anda pakai Realtime Database (fitur "Karyawan
   Online"), ulangi untuk **Realtime Database** juga. Mulai titik ini, request tanpa App Check yang
   valid akan ditolak.

> Catatan: kalau nanti pindah/tambah domain (mis. beli domain sendiri seperti `tokobenih.com`, lihat
> "Batasan yang Perlu Diketahui" di bawah), domain baru itu WAJIB ditambahkan ke daftar domain
> reCAPTCHA di langkah 1 juga (edit lewat halaman reCAPTCHA admin) -- kalau lupa, App Check akan
> menolak pengunjung dari domain baru itu meski kodenya sama persis.
>
> Lewati seluruh bagian ini kalau belum siap -- aplikasi tetap berjalan penuh tanpa App Check, cuma
> tanpa pagar tambahan ini (lihat komentar `RECAPTCHA_V3_SITE_KEY` di `js/firebase-config.js`).

---

## BAGIAN 2 — Buat Akun Owner Pertama (manual, sekali saja)

Karena ini akun **pertama**, harus dibuat manual lewat Firebase Console (setelah itu, akun baru bisa
dibuat langsung dari dalam aplikasi lewat menu **Akun Pengguna**).

### 2a. Buat akun login-nya
1. Firebase Console → **Authentication** → tab **Users** → klik **Add user**.
2. **Email**: ketik `admin@benihpreorder.local`
   *(catatan: "benihpreorder.local" harus SAMA PERSIS dengan `FAKE_EMAIL_DOMAIN` di file `js/firebase-config.js` — defaultnya sudah sama, tidak perlu diubah kalau Anda belum mengubah file itu)*
3. **Password**: buat password, misalnya `admin123` (nanti bisa diganti dari dalam aplikasi).
4. Klik **Add user**.
5. Setelah user muncul di daftar, **klik usernya**, lalu **copy "User UID"** yang muncul (contoh: `aB3dEfGh...`).

### 2b. Buat profil datanya di Firestore
1. Firebase Console → **Firestore Database** → tab **Data**.
2. Klik **Start collection**. Collection ID: `users` → **Next**.
3. **Document ID**: paste User UID yang Anda copy tadi (JANGAN pakai "Auto-ID").
4. Tambahkan field-field berikut (klik **Add field** untuk masing-masing):
   | Field | Type | Value |
   |---|---|---|
   | username | string | admin |
   | full_name | string | Owner |
   | role | string | owner |
   | is_active | boolean | true |
5. Klik **Save**.

Selesai! Akun pertama Anda: **username `admin`, password `admin123`**.

### 2c. (Cuma kalau Anda mengaktifkan Realtime Database di Bagian 1d) Daftarkan Owner ke node "roles"
Fitur "Karyawan Online" membatasi siapa yang boleh melihat status online (cuma Owner) lewat sebuah
node kecil bernama `roles/` di Realtime Database, terpisah dari data role di Firestore. Akun-akun
BARU yang dibuat lewat menu **Akun Pengguna** akan otomatis terdaftar di sini, tapi Owner **pertama**
ini (dibuat manual) perlu didaftarkan manual juga, sekali saja:
1. Firebase Console → **Realtime Database** → tab **Data**.
2. Klik ikon **+** di samping nama database Anda (root), Key: `roles`.
3. Di dalam `roles`, klik **+** lagi, Key: **paste User UID Owner** dari langkah 2a, Value: ketik `owner` (jangan pakai tanda kutip, pilih tipe string kalau diminta) → **Add**.

Lewati langkah ini kalau Anda tidak mengaktifkan Realtime Database di Bagian 1d.

---

## BAGIAN 3 — Setup Cabang & Role Baru (Admin Kasir / Karyawan Cabang)

Aplikasi ini sekarang mendukung banyak toko cabang dengan 3 tingkat akses. Siapkan dulu sebelum dipakai sehari-hari.

### 3a. Buat cabang pertama
1. Login sebagai Owner, buka menu **Kelola Cabang** di sidebar.
2. Klik **+ Cabang Baru**, isi nama (contoh: `Toko Pusat` untuk toko utama Anda), simpan.
3. Ulangi untuk tiap toko cabang yang Anda punya (misalnya `Toko Cabang Wonosari`).

### 3b. Migrasi data lama (LEWATI kalau ini instalasi baru / belum pernah ada pesanan sebelumnya)
Kalau sebelumnya Anda sudah pakai aplikasi ini (sudah ada pesanan & akun karyawan dari sebelum fitur cabang ada):
1. Buka menu **Kelola Cabang** — kalau memang ada yang perlu dimigrasi, akan muncul kotak kuning **"Data Lama Belum Punya Cabang"**.
2. Di kotak itu, pilih cabang tujuan untuk pesanan-pesanan lama (biasanya `Toko Pusat`).
3. Klik **Migrasikan Sekarang**. Ini otomatis akan:
   - Mengisi cabang pada semua pesanan lama dengan cabang yang Anda pilih.
   - Mengubah semua akun **"Karyawan"** versi lama menjadi role **"Admin Kasir"** (tetap akses semua cabang seperti sebelumnya) — sesuai permintaan Anda mengganti nama akun karyawan lama jadi Admin Kasir.
4. Aman diulang kapan saja — data yang sudah benar tidak akan disentuh lagi, dan tidak akan salah mengubah akun Karyawan cabang yang baru Anda buat setelah ini.

### 3c. Ringkasan 3 role yang tersedia

| Role | Lihat pesanan | Edit isi pesanan | Tandai Lunas / Ambil | Input Pesanan | Laporan & Export | Kelola Produk | Akun / Toko / Cabang |
|---|---|---|---|---|---|---|---|
| **Owner** | Semua cabang | Ya | Semua cabang | Semua cabang (pilih cabang) | Semua cabang | Ya (termasuk hapus) | Ya |
| **Admin Kasir** | Semua cabang | Ya | Semua cabang | Semua cabang (pilih cabang) | Semua cabang | Ya (termasuk hapus) | Tidak |
| **Karyawan** (per cabang) | Cabang sendiri saja | Ya, pesanan cabang sendiri | Cabang sendiri saja | Cabang sendiri (terkunci) | Cabang sendiri saja | Tidak (cuma lihat) | Tidak |

> ⚠️ Baik Admin Kasir maupun Karyawan cabang BOLEH mengedit isi pesanan sepenuhnya (item, total,
> data pembeli) untuk pesanan yang boleh mereka akses -- bukan cuma tandai lunas/ambil. Hapus
> pesanan tetap khusus Owner. Kalau Anda butuh batasan yang lebih ketat dari ini (mis. Admin Kasir
> tidak boleh menghapus produk), itu perlu diubah langsung di `firestore.rules` (match /products/{productId})
> dan `js/input-pesanan.js` -- tabel di atas menggambarkan kode APA ADANYA, bukan rekomendasi.

Buat akun barunya lewat menu **Akun Pengguna** seperti biasa. Untuk role **Karyawan**, akan muncul field tambahan untuk memilih cabang mana yang dikunci ke akun itu — sekali dipilih & disimpan, akun itu selamanya hanya bisa mengakses pesanan cabang tersebut, bahkan Firestore sendiri (bukan cuma tampilannya) yang menolak permintaan datanya kalau mencoba mengakses cabang lain.

### 3d. Kalau muncul pesan error berbau "index" (biasanya saat akun Karyawan pertama kali login)
Firestore kadang perlu "index" tambahan untuk query yang dibatasi per cabang (dipakai di halaman Dashboard, Daftar Pesanan, dan Laporan). Kalau ada Karyawan yang login lalu melihat data tidak muncul disertai pesan error, cek isi errornya (bisa lewat tombol F12 di browser → tab Console):
1. Cari link yang formatnya seperti `https://console.firebase.google.com/.../firestore/indexes?create_composite=...` di pesan error itu.
2. Buka link itu sambil login sebagai pemilik project Firebase (Owner).
3. Klik **Create Index**, tunggu beberapa menit sampai statusnya berubah jadi **Enabled**.
4. Refresh halaman aplikasinya — error akan hilang dan tidak akan muncul lagi untuk query yang sama.

Ini cukup dilakukan **sekali** per halaman (biasanya total 2-3 index untuk seluruh aplikasi), bukan berulang tiap ada Karyawan baru.

> **(Opsional) Cara lain lewat file `firestore.indexes.json`.** Folder project ini juga menyertakan
> `firestore.indexes.json` & `firebase.json` -- isinya definisi index yang sama seperti di atas
> (`orders`: `cabang_id` + `tanggal`), cuma dalam bentuk file. Kegunaannya cuma buat yang sudah
> pasang [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`,
> butuh Node.js) -- kalau ya, tinggal jalankan `firebase deploy --only firestore:indexes` sekali dari
> folder project ini dan index-nya langsung terpasang otomatis, tidak perlu mancing error dulu satu
> per satu. **Anda TIDAK WAJIB pakai cara ini** -- kalau tidak familiar dengan CLI/Node.js, cara klik
> link error di atas sudah cukup dan tidak akan pernah ketinggalan, jadi boleh dilewati sepenuhnya.
> Berguna terutama kalau nanti Anda pindah ke project Firebase baru (mis. migrasi akun Google) dan
> mau semua index langsung siap tanpa perlu login-mancing-error ulang di tiap halaman.

---

## BAGIAN 4 — Coba Dulu di Komputer (tanpa install apapun)

Karena file-nya HTML biasa, Anda bisa buka langsung:
1. Buka folder project ini di File Explorer.
2. Klik dua kali file `index.html` — akan terbuka di browser.
3. Login dengan `admin` / `admin123`.

> Catatan: sebagian browser membatasi fitur tertentu saat membuka file HTML langsung (`file://`).
> Kalau ada kejanggalan, lanjut saja ke Bagian 5 (hosting online) — di sana semua akan berjalan normal.
> App Check (Bagian 1f) khususnya TIDAK bisa diverifikasi lewat `file://` sama sekali (perlu domain
> asli) -- kalau Anda mengaktifkannya, wajar kalau App Check baru terlihat berfungsi setelah online
> di GitHub Pages (Bagian 5), bukan pas dicoba dengan cara klik dua kali ini.

Setelah login, langsung isi dulu:
- **Profil Toko** — nama, alamat, no HP toko Anda
- **Kelola Cabang** — daftar toko cabang Anda (lihat Bagian 3 di atas)
- **Produk & Gelombang** — tambahkan produk dan harga per gelombang (dipakai bersama oleh semua cabang)
- **Akun Pengguna** — buat akun Admin Kasir / Karyawan untuk tim Anda

---

## BAGIAN 5 — Online-kan Gratis lewat GitHub Pages

### 5a. Upload ke GitHub
1. Buat akun gratis di https://github.com kalau belum punya.
2. Install **GitHub Desktop** (https://desktop.github.com/), login dengan akun GitHub Anda.
3. Buat repository baru di GitHub Desktop:
   - **File → New Repository**
   - Name: `preorder-benih-web`
   - Local Path: pilih folder project ini
   - Klik **Create Repository**
4. Klik **Publish repository** (pastikan **tidak dicentang** "Keep this code private" kalau ingin akses gratis penuh dari GitHub Pages — repo publik tidak masalah karena `firebaseConfig` memang aman untuk terbuka, keamanan sesungguhnya ada di Firestore Rules yang sudah kita pasang).

### 5b. Aktifkan GitHub Pages
1. Buka repository Anda di browser (github.com).
2. Klik tab **Settings** → menu kiri **Pages**.
3. Di bagian **Build and deployment → Source**, pilih **Deploy from a branch**.
4. **Branch**: pilih `main`, folder `/ (root)` → **Save**.
5. Tunggu 1-2 menit, refresh halaman itu — akan muncul URL seperti:
   ```
   https://namaanda.github.io/preorder-benih-web/
   ```
   Itu alamat aplikasi Anda yang sudah online dan bisa diakses dari mana saja (HP, komputer lain, dll).

### 5c. Update ke depannya
Setiap kali Anda edit file (misalnya minta saya tambah fitur lagi), tinggal:
1. Buka GitHub Desktop
2. Akan muncul daftar perubahan file
3. Isi ringkasan singkat di kolom bawah kiri, klik **Commit to main**
4. Klik **Push origin**
5. Tunggu ±1 menit, situs online otomatis ter-update

> ⚠️ **PENTING kalau update-nya menyertakan perubahan pada file `firestore.rules` ATAU `database.rules.json`**
> (misalnya saat fitur **Arsip PO** ditambahkan, atau saat pembatasan akses "Karyawan Online" ke
> Owner-saja ditambahkan): push kode saja LEWAT GITHUB DESKTOP TIDAK CUKUP, karena Rules Firestore
> maupun Rules Realtime Database DISIMPAN TERPISAH di Firebase, bukan ikut ter-upload lewat GitHub Pages.
> Anda perlu publish ulang manual untuk file yang berubah:
> - `firestore.rules` berubah → ulangi langkah **1c**: copy isinya, paste ke Firebase Console →
>   **Firestore Database** → tab **Rules** → **Publish**.
> - `database.rules.json` berubah → ulangi langkah **1d**: copy isinya, paste ke Firebase Console →
>   **Realtime Database** → tab **Rules** → **Publish**. Kalau ini baru pertama kali dipasang di
>   instalasi yang SUDAH PUNYA akun Owner sebelumnya, jangan lupa juga langkah **2c** (daftarkan
>   Owner ke node `roles/`) -- tanpa itu, Owner sendiri akan ikut tidak bisa melihat "Karyawan Online"
>   sampai node itu dibuat.
>
> Kalau langkah ini terlewat, fitur baru yang butuh perubahan Rules (mis. Backup/Restore di Arsip PO,
> atau "Karyawan Online") akan gagal dengan pesan error "Missing or insufficient permissions" / "Permission denied".

---

## Batasan yang Perlu Diketahui

- **"1 sesi login per perangkat" cuma PERINGATAN, bukan KUNCI sungguhan.** Kalau akun yang sama
  login di HP/laptop baru, sesi di perangkat lama akan dapat pesan "Sesi Anda Diakhiri" dan diarahkan
  keluar -- ini cukup untuk mencegah kejadian tidak sengaja (kasir lupa sudah pernah login di HP lain)
  dan berjalan hampir seketika (real-time). TAPI ini murni pengecekan di APLIKASI (browser), BUKAN di
  Firestore Rules -- secara teknis, kalau seseorang SUDAH TERLANJUR membuka DevTools browser di
  perangkat lama SEBELUM pesan itu muncul (atau sengaja menutup paksa notifikasinya), token login di
  perangkat itu SECARA TEKNIS masih sah menurut Firebase dan bisa dipakai baca/tulis data lewat
  Console browser, sampai orang itu logout manual atau tokennya kedaluwarsa sendiri.
  Kenapa tidak bisa dikunci lebih ketat: Firestore Rules cuma bisa membaca *siapa* yang login
  (`request.auth.uid`), bukan *dari sesi/perangkat mana* request itu dikirim -- membedakan itu perlu
  "custom claim" di token, yang cuma bisa diset lewat Firebase Admin SDK (artinya wajib ada server/
  Cloud Function). Aplikasi ini sengaja dibuat 100% tanpa server supaya bisa gratis selamanya di
  GitHub Pages, jadi batasan ini diterima sebagai konsekuensinya -- BUKAN sesuatu yang lupa
  dikerjakan. Risikonya juga tergolong rendah: ini bukan celah yang bisa dipakai ORANG ASING dari
  luar (tetap wajib sudah pernah login sah di perangkat itu duluan) -- risikonya lebih ke arah
  "mantan karyawan yang HP kerjanya belum sempat di-logout sebelum resign". Kalau itu jadi
  kekhawatiran nyata di toko Anda: nonaktifkan akunnya (halaman Akun Pengguna) begitu orangnya
  resign/lepas tugas -- begitu `is_active` dimatikan, Rules-nya SUNGGUH menolak SEMUA akses akun itu
  (ini BUKAN batasan seperti di atas, ini benar-benar tertutup, dicek di Rules setiap request).
- **Ganti password**: Owner tidak bisa langsung mengatur ulang password akun karyawan lain (batasan
  keamanan Firebase tanpa server backend). Tiap orang ganti password sendiri lewat menu
  "Ganti Password Saya" di sidebar. Kalau karyawan lupa password, solusinya: nonaktifkan akun lama,
  buat akun baru untuknya.
- **Domain**: alamat `namaanda.github.io/...` gratis selamanya. Kalau nanti ingin domain sendiri
  seperti `tokobenih.com`, itu perlu beli domain (~Rp150rb/tahun) lalu dihubungkan ke GitHub Pages
  (saya bisa bantu kalau saatnya tiba). Kalau App Check (Bagian 1f) sudah diaktifkan, jangan lupa
  tambahkan domain baru itu ke daftar domain reCAPTCHA juga -- lihat catatan di Bagian 1f.
- **Batas gratis Firebase**: sangat longgar untuk toko kecil-menengah (50.000 baca data per hari,
  20.000 tulis per hari) — kemungkinan besar tidak akan pernah tersentuh untuk pemakaian normal.
