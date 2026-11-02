# Ayo Menulis!

Aplikasi latihan menulis untuk anak kelas 1 SD. Teks dibuat oleh Gemini AI,
bisa disimpan, dan tidak hilang saat halaman di-reload.

Jumlah baris dan kata per baris bisa diatur sebelum membuat teks. Setiap kata
bisa diketuk untuk didengarkan suaranya; suara bisa dimatikan lewat saklar
"Bacakan kata (TTS)" di popup Pengaturan (pilihannya diingat peramban).

## Cara menjalankan
1. Pasang Node.js versi 22 atau lebih baru (https://nodejs.org).
2. Buka terminal di folder ini, lalu jalankan:

       npm start

3. Buka http://localhost:3000 di browser.

Untuk membuka dari HP/tablet di jaringan Wi-Fi yang sama, pakai alamat IP
komputer, misalnya http://192.168.1.10:3000

## Pengaturan
Semua pengaturan ada di file `.env`:
- `GEMINI_API_KEY` : kunci API Gemini (hanya dibaca server, tidak terlihat di browser)
- `PORT`           : nomor port (bawaan 3000)
- `GEMINI_MODEL`   : model Gemini (bawaan gemini-3.5-flash-lite)

## Data
Tema dan teks yang disimpan ada di database SQLite `data/app.db` (dibuat otomatis).
Hapus file itu untuk mengosongkan semuanya. Kalau masih ada `data/data.json` dari
versi lama, isinya dipindahkan otomatis sekali saat server dijalankan.

## Struktur
- `server.js`          server Node.js (API + file statis, tanpa library tambahan)
- `public/index.html`  tampilan aplikasi
- `.env`               kunci API (jangan dibagikan)
