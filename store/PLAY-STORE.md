# Capsa Banting Online · Google Play

Bahan dan jawaban untuk Play Console. File gambar ada di folder ini, file rilis ada di
`app/android/app/build/outputs/bundle/release/app-release.aab` (buat ulang dengan `cd app && npm run aab`).

## 1. Detail aplikasi

| Kolom | Isi |
|---|---|
| Nama aplikasi (maks. 30) | Capsa Banting Online |
| Package name | id.capsabanting.online (tidak bisa diganti setelah upload pertama) |
| Kategori | Game · Kartu |
| Gratis / berbayar | Gratis · tanpa iklan · tanpa pembelian dalam aplikasi |
| Email developer | (email kontak kamu, sama dengan `CONTACT_EMAIL` di Render) |
| Kebijakan privasi | https://capsa-banting-online.onrender.com/privasi |
| Hapus akun (web) | https://capsa-banting-online.onrender.com/hapus-akun |

**Deskripsi singkat (maks. 80 karakter)**

> Main Capsa Banting online bareng teman: meja pribadi, voice chat, dan poin.

**Deskripsi lengkap**

> Capsa Banting Online adalah game kartu Capsa Banting untuk dimainkan bersama teman-temanmu, kapan saja dan dari mana saja.
>
> 🃏 MEJA PRIBADI
> Buat meja, bagikan kode atau link, dan main berdua, bertiga, atau berempat. Kursi kosong bisa diisi bot.
>
> 🎤 VOICE CHAT & REAKSI
> Ngobrol langsung di meja dengan voice chat, kirim reaksi dan chat singkat.
>
> 📋 ATURAN BISA DIATUR
> Pakai Aturan Default atau atur sendiri: waktu giliran, urutan jenis kartu, aturan ceki, flush berisi 2, poin menang, sisa kartu, bonus paket, sampai aturan dan poin tambahan buatan sendiri. Simpan sebagai preset untuk dipakai lagi.
>
> 🏆 POIN & RIWAYAT
> Setiap game dihitung poinnya otomatis (semakin rendah semakin bagus), lengkap dengan kartu penutup, rincian per pemain, dan skor akhir per sesi. Semua riwayat tersimpan di akunmu.
>
> 👥 TEMAN
> Tambah teman lewat username, lihat siapa yang online, undang ke meja, dan kirim pesan.
>
> 🛡️ AMAN & NYAMAN
> Blokir dan laporkan pemain yang mengganggu. Akun bisa dihapus kapan saja dari aplikasi.
>
> Game ini gratis dan hanya untuk hiburan. Tidak ada koin, pembelian, atau hadiah. Poin tidak bernilai uang dan tidak bisa ditukar. Dilarang memakai aplikasi ini untuk taruhan uang.

**Gambar**

| Aset | File |
|---|---|
| Ikon 512×512 | `icon-512.png` |
| Feature graphic 1024×500 | `feature-graphic-1024x500.png` |
| Screenshot ponsel (16:9) | `screenshot-1-beranda.png` … `screenshot-5-aturan.png` |

Buat ulang gambar: `cd app && node store-assets.js`.

## 2. Konten aplikasi (App content)

- **Akses aplikasi**: sebagian fitur perlu login. Buat satu akun khusus reviewer di aplikasi
  (misalnya `reviewer_capsa`), lalu isi username & password-nya di formulir ini. Jelaskan: "Login, ketuk SANTAI (x250), tambah Bot di kursi kosong, lalu Mulai Main."
- **Iklan**: Tidak ada iklan.
- **Rating konten (IARC)**: kategori Game. Jawab jujur:
  - Simulasi perjudian: **Ya** (game kartu bergaya kasino, tanpa uang asli, tanpa hadiah).
  - Interaksi pengguna: **Ya** (chat, pesan, voice chat antar pengguna).
  - Berbagi lokasi: Tidak. Pembelian digital: Tidak.
  - Hasil yang diharapkan: rating dewasa / 18+.
- **Target audiens**: 18 tahun ke atas saja. Bukan untuk anak-anak.
- **Aplikasi berita / pemerintah / keuangan / kesehatan**: Tidak.
- **Keamanan data (Data safety)**:
  - Mengumpulkan data: Ya. Dienkripsi saat dikirim: Ya. Pengguna bisa meminta penghapusan: Ya (di aplikasi dan di /hapus-akun).
  - Data dibagikan ke pihak ketiga: **Tidak** (Render dan Supabase adalah penyedia layanan, bukan "berbagi").
  - Jenis data yang dikumpulkan:

    | Kategori Play | Data | Wajib? | Tujuan |
    |---|---|---|---|
    | Info pribadi · Nama | nama tampilan | Wajib | Fungsi aplikasi, Manajemen akun |
    | Info pribadi · ID pengguna | username, ID akun | Wajib | Fungsi aplikasi, Manajemen akun |
    | Foto dan video · Foto | foto profil | Opsional | Fungsi aplikasi |
    | Pesan · Pesan dalam aplikasi | pesan teman, chat meja | Opsional | Fungsi aplikasi, Keamanan (laporan) |
    | Audio · Rekaman suara | voice chat, **diproses sementara, tidak disimpan** | Opsional | Fungsi aplikasi |
    | Aktivitas aplikasi · Interaksi / konten lain buatan pengguna | hasil game, riwayat, aturan tersimpan, laporan | Wajib | Fungsi aplikasi, Keamanan |

- **Penghapusan akun**: isi URL https://capsa-banting-online.onrender.com/hapus-akun
- **Izin**: `RECORD_AUDIO` hanya untuk voice chat di meja (dinyalakan pemain sendiri).

## 3. Urutan rilis

1. Buat akun Play Console (US$25) dan selesaikan verifikasi identitas.
2. Buat aplikasi baru, isi bagian 1 dan 2 di atas.
3. **Pengujian tertutup** (Closed testing): buat jalur, upload `app-release.aab`, tambahkan minimal **12 email Gmail** tester,
   bagikan link opt-in ke mereka, dan pastikan mereka memasang serta memainkannya. Tunggu **14 hari berturut-turut**.
4. Ajukan **akses produksi** (Production access) dari dashboard, jawab pertanyaannya tentang pengujian.
5. Setelah disetujui, buat rilis Produksi dari build yang sama (atau versi baru dengan `versionCode` lebih tinggi).

## 4. Catatan penting

- **Kunci upload** ada di `C:\Users\TRITON 14 AI\.capsa-signing\` (file `capsa-upload.jks` + `KEYSTORE-INFO.txt` berisi password).
  Simpan cadangannya di tempat aman. Saat upload pertama, pakai **Play App Signing** (default): Google menyimpan kunci aplikasinya,
  dan kunci upload ini bisa di-reset lewat dukungan Play kalau hilang.
- Setiap update ke Play: naikkan `versionCode` di `app/android/app/build.gradle`. Update game biasa (server) **tidak** perlu
  rilis baru, karena aplikasi memuat server online.
- APK yang dibagikan langsung (sideload) dan versi Play ditandatangani dengan kunci berbeda. Pemain yang pindah dari APK ke
  versi Play perlu menghapus aplikasi lama dulu.

## 5. Notifikasi undangan di aplikasi Android (Firebase, sekali saja)

Di browser (Chrome / Edge / Firefox, iPhone yang dipasang ke Layar Utama) notifikasi sudah langsung jalan.
Untuk aplikasi Android dibutuhkan Firebase Cloud Messaging (gratis):

1. Buka https://console.firebase.google.com → **Create a project** → nama `capsa-banting` → Analytics boleh dimatikan.
2. Di project itu: **Add app → Android** → package name `id.capsabanting.online` → nama `Capsa Banting` → **Register app**.
3. **Download google-services.json** → simpan di `app/android/app/google-services.json` (lalu build ulang .aab / .apk).
4. ⚙️ **Project settings → Service accounts → Generate new private key** → file JSON terunduh.
   File ini rahasia: jangan dibagikan atau dimasukkan ke git.
5. Render → Environment → tambah `FIREBASE_SERVICE_ACCOUNT` = isi file JSON itu (tempel semuanya) → **Save, rebuild, and deploy**.
6. Data safety Play Store: tambahkan **Device or other IDs** (token notifikasi) · Wajib bila notifikasi aktif · Fungsi aplikasi.
