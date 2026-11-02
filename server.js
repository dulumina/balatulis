"use strict";
/**
 * Ayo Menulis! - server Node.js (tanpa library tambahan, butuh Node 22+)
 * - Menyimpan GEMINI_API_KEY di server (tidak terlihat di browser)
 * - Menyimpan tema dan teks di database SQLite (data/app.db)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

/* ---------- Baca file .env (tanpa library) ---------- */
(function muatEnv() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  for (const baris of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || baris.trim().startsWith("#")) continue;
    let nilai = m[2];
    if (/^(['"]).*\1$/.test(nilai)) nilai = nilai.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = nilai;
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL_UTAMA = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MODEL_CADANGAN = "gemini-flash-latest";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "app.db");
const MAKS_SIMPAN = 12;

const TEMA_BAWAAN = [
  ["hewan", "🐱 Hewan"],
  ["keluarga", "👨‍👩‍👧 Keluarga"],
  ["sekolah", "🏫 Sekolah"],
  ["buah", "🍎 Buah"],
  ["alam", "🌳 Alam"],
  ["mainan", "🧸 Mainan"],
];

const TEKS_CADANGAN = {
  hewan: [
    "Aku punya kucing.",
    "Kucingku suka tidur.",
    "Bulunya putih dan halus.",
    "Aku sayang kucingku.",
    "Adik punya ikan kecil.",
    "Ikan itu berenang cepat.",
    "Burung berkicau di pohon.",
    "Kami memberi makan kelinci.",
  ],
  keluarga: [
    "Ini ibuku.",
    "Ibu memasak nasi.",
    "Ayah membaca buku.",
    "Aku sayang keluargaku.",
    "Kakak membantu ibu.",
    "Adik bermain di rumah.",
    "Kami makan bersama.",
    "Rumahku selalu ramai.",
  ],
  sekolah: [
    "Aku pergi ke sekolah.",
    "Bu guru menulis di papan.",
    "Aku duduk dengan temanku.",
    "Belajar itu seru.",
    "Kami bernyanyi bersama.",
    "Aku membawa pensil baru.",
    "Teman-teman bermain di halaman.",
    "Bel berbunyi tanda pulang.",
  ],
  buah: [
    "Aku suka buah.",
    "Apel itu merah.",
    "Pisang itu kuning.",
    "Buah baik untuk badan.",
    "Mangga rasanya manis.",
    "Ibu membeli jeruk.",
    "Aku mencuci buah dulu.",
    "Kami makan buah bersama.",
  ],
  alam: [
    "Matahari bersinar terang.",
    "Burung terbang di langit.",
    "Pohon itu tinggi.",
    "Aku suka bermain di taman.",
    "Bunga di halaman berwarna merah.",
    "Angin bertiup sejuk.",
    "Kupu-kupu hinggap di bunga.",
    "Aku melihat awan putih.",
  ],
  mainan: [
    "Aku punya bola.",
    "Bola itu bulat.",
    "Aku bermain dengan adik.",
    "Kami tertawa bersama.",
    "Adik punya boneka baru.",
    "Aku menyusun balok tinggi.",
    "Kami bermain mobil-mobilan.",
    "Mainan disimpan setelah bermain.",
  ],
  umum: [
    "Aku suka belajar hari ini.",
    "Aku membaca buku baru.",
    "Teman-temanku baik sekali.",
    "Kami bermain di halaman.",
    "Ibu guru tersenyum ramah.",
    "Aku menulis dengan rapi.",
    "Hari ini menyenangkan.",
    "Aku pulang dengan senang.",
  ],
};

/* ---------- Database SQLite (modul bawaan Node) ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS tema (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    urutan INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tersimpan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tema TEXT NOT NULL,
    baris TEXT NOT NULL,
    kunci TEXT NOT NULL UNIQUE,
    waktu INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app (
    kunci TEXT PRIMARY KEY,
    nilai TEXT NOT NULL
  );
`);

function ambilTema() {
  return db.prepare("SELECT id, label FROM tema ORDER BY urutan, id").all();
}

function simpanCurrent(tema, baris) {
  db.prepare(
    "INSERT INTO app (kunci, nilai) VALUES ('current', ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai"
  ).run(JSON.stringify({ tema, baris }));
}

function ambilState() {
  const current = db.prepare("SELECT nilai FROM app WHERE kunci = 'current'").get();
  const saved = db
    .prepare("SELECT id, tema, baris FROM tersimpan ORDER BY waktu DESC, id DESC LIMIT ?")
    .all(MAKS_SIMPAN)
    .map((s) => ({ id: s.id, tema: s.tema, baris: JSON.parse(s.baris) }));
  return { tema: ambilTema(), current: current ? JSON.parse(current.nilai) : null, saved };
}

function simpanTeks(tema, baris) {
  db.prepare(
    "INSERT OR IGNORE INTO tersimpan (tema, baris, kunci, waktu) VALUES (?, ?, ?, ?)"
  ).run(tema, JSON.stringify(baris), baris.join("\n"), Date.now());
  db.prepare(
    "DELETE FROM tersimpan WHERE id NOT IN (SELECT id FROM tersimpan ORDER BY waktu DESC, id DESC LIMIT ?)"
  ).run(MAKS_SIMPAN);
  simpanCurrent(tema, baris);
}

function hapusTeks(id) {
  db.prepare("DELETE FROM tersimpan WHERE id = ?").run(id);
}

function tambahTema(label) {
  const bersih = String(label || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!bersih) return null;
  const dasar = bersih.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tema";
  const ada = db.prepare("SELECT 1 FROM tema WHERE id = ?");
  let id = dasar;
  for (let n = 2; ada.get(id); n++) id = `${dasar}-${n}`;
  const urutan = db.prepare("SELECT COALESCE(MAX(urutan), -1) + 1 AS n FROM tema").get().n;
  db.prepare("INSERT INTO tema (id, label, urutan) VALUES (?, ?, ?)").run(id, bersih, urutan);
  return { id, label: bersih };
}

/* Impor sekali dari data/data.json versi lama, lalu file-nya diganti nama. */
function imporDataLama() {
  const lamaFile = path.join(DATA_DIR, "data.json");
  if (!fs.existsSync(lamaFile)) return;
  try {
    const lama = JSON.parse(fs.readFileSync(lamaFile, "utf8"));
    const tambah = db.prepare(
      "INSERT OR IGNORE INTO tersimpan (tema, baris, kunci, waktu) VALUES (?, ?, ?, ?)"
    );
    (Array.isArray(lama.saved) ? lama.saved : []).forEach((s, i) => {
      if (typeof s.tema === "string" && barisValid(s.baris)) {
        tambah.run(s.tema, JSON.stringify(s.baris), s.baris.join("\n"), Date.now() - i);
      }
    });
    if (lama.current && barisValid(lama.current.baris)) {
      simpanCurrent(lama.current.tema, lama.current.baris);
    }
    fs.renameSync(lamaFile, lamaFile + ".migrasi");
    console.log("[db] data.json lama sudah dipindahkan ke SQLite");
  } catch (e) {
    console.warn("[db] gagal impor data.json:", e.message);
  }
}

if (db.prepare("SELECT COUNT(*) AS n FROM tema").get().n === 0) {
  const tambah = db.prepare("INSERT INTO tema (id, label, urutan) VALUES (?, ?, ?)");
  TEMA_BAWAAN.forEach(([id, label], i) => tambah.run(id, label, i));
}
imporDataLama();

function barisValid(baris) {
  return (
    Array.isArray(baris) &&
    baris.length >= 1 &&
    baris.length <= 8 &&
    baris.every((b) => typeof b === "string" && b.length > 0 && b.length <= 200)
  );
}

/* ---------- Gemini ---------- */
function buatPrompt(labelTema, jumlahBaris, jumlahKata) {
  return [
    "Kamu guru kelas 1 SD di Indonesia.",
    `Tulis teks pendek bertema "${labelTema}" untuk latihan menyalin tulisan anak kelas 1 SD.`,
    "Aturan:",
    `- Tepat ${jumlahBaris} baris, satu kalimat pendek per baris.`,
    `- Setiap kalimat ${jumlahKata ? `tepat ${jumlahKata} kata` : "3 sampai 6 kata"}.`,
    "- Kata sederhana yang dikenal anak umur 6-7 tahun, tanpa kata sulit.",
    "- Gunakan huruf kapital di awal kalimat dan titik di akhir.",
    "- Tanpa nomor, tanpa tanda bintang, tanpa emoji, tanpa judul.",
    "- Hanya tulis baris-baris itu, tidak ada kalimat pembuka atau penutup.",
    `- Buat berbeda dari sebelumnya (variasi acak: ${Math.floor(Math.random() * 100000)}).`,
  ].join("\n");
}

function bersihkan(teks, maksBaris) {
  return teks
    .split(/\r?\n/)
    .map((b) => b.replace(/^[\s>*\-•\d.)]+/, "").replace(/[*_`#]/g, "").trim())
    .filter((b) => b.length > 0 && b.length <= 200)
    .slice(0, maksBaris);
}

async function panggilModel(model, prompt, maksBaris, batasWaktu) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0 },
    }),
    signal: AbortSignal.timeout(batasWaktu),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const teks = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
  const baris = bersihkan(teks, maksBaris);
  if (baris.length < 1) throw new Error("Jawaban Gemini kosong");
  return baris;
}

async function buatTeks(tema, labelTema, jumlahBaris, jumlahKata) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY belum diisi di file .env");
  const prompt = buatPrompt(labelTema, jumlahBaris, jumlahKata);
  try {
    return await panggilModel(MODEL_UTAMA, prompt, jumlahBaris, 60000);
  } catch (e) {
    console.warn("[gemini] model utama gagal:", e.message);
    return await panggilModel(MODEL_CADANGAN, prompt, jumlahBaris, 20000);
  }
}

/* ---------- Helper HTTP ---------- */
function batasi(nilai, min, maks, bawaan) {
  const n = Math.round(Number(nilai));
  return Number.isFinite(n) ? Math.min(maks, Math.max(min, n)) : bawaan;
}

function kirimJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function bacaBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const potongan = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > 100_000) {
        reject(new Error("Data terlalu besar"));
        req.destroy();
        return;
      }
      potongan.push(c);
    });
    req.on("end", () => {
      try {
        const teks = Buffer.concat(potongan).toString("utf8");
        resolve(teks ? JSON.parse(teks) : {});
      } catch {
        reject(new Error("JSON tidak valid"));
      }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function kirimFile(req, res) {
  const url = new URL(req.url, "http://localhost");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Dilarang");
  }
  fs.readFile(target, (err, isi) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Tidak ditemukan");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(isi);
  });
}

/* ---------- Router ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    // Ambil semua data (tema, teks sekarang, daftar tersimpan)
    if (req.method === "GET" && p === "/api/state") {
      return kirimJSON(res, 200, ambilState());
    }

    // Tambah tema baru
    if (req.method === "POST" && p === "/api/tema") {
      const { label } = await bacaBody(req);
      const baru = tambahTema(label);
      if (!baru) return kirimJSON(res, 400, { error: "Nama tema kosong" });
      return kirimJSON(res, 200, { tema: ambilTema(), baru });
    }

    // Buat teks baru dengan Gemini
    if (req.method === "POST" && p === "/api/generate") {
      const body = await bacaBody(req);
      const tema = body.tema;
      const temaDb = db.prepare("SELECT label FROM tema WHERE id = ?").get(tema);
      if (!temaDb) return kirimJSON(res, 400, { error: "Tema tidak dikenal" });
      const jumlahBaris = batasi(body.baris, 1, 8, 4);
      const jumlahKata = Number(body.kata) > 0 ? batasi(body.kata, 2, 8, 4) : 0;
      let baris;
      let cadangan = false;
      try {
        baris = await buatTeks(tema, temaDb.label, jumlahBaris, jumlahKata);
      } catch (e) {
        console.error("[generate]", e.message);
        baris = (TEKS_CADANGAN[tema] || TEKS_CADANGAN.umum).slice(0, jumlahBaris);
        cadangan = true;
      }
      simpanCurrent(tema, baris);
      return kirimJSON(res, 200, { tema, baris, cadangan });
    }

    // Simpan teks ke daftar
    if (req.method === "POST" && p === "/api/saved") {
      const { tema, baris } = await bacaBody(req);
      if (!db.prepare("SELECT 1 FROM tema WHERE id = ?").get(tema) || !barisValid(baris)) {
        return kirimJSON(res, 400, { error: "Data tidak valid" });
      }
      simpanTeks(tema, baris);
      return kirimJSON(res, 200, ambilState());
    }

    // Jadikan teks tersimpan sebagai teks yang sedang dibuka
    if (req.method === "POST" && p === "/api/current") {
      const { tema, baris } = await bacaBody(req);
      if (!db.prepare("SELECT 1 FROM tema WHERE id = ?").get(tema) || !barisValid(baris)) {
        return kirimJSON(res, 400, { error: "Data tidak valid" });
      }
      simpanCurrent(tema, baris);
      return kirimJSON(res, 200, ambilState());
    }

    // Hapus satu teks tersimpan
    const hapus = p.match(/^\/api\/saved\/(\d+)$/);
    if (req.method === "DELETE" && hapus) {
      hapusTeks(Number(hapus[1]));
      return kirimJSON(res, 200, ambilState());
    }

    if (p.startsWith("/api/")) return kirimJSON(res, 404, { error: "Tidak ditemukan" });

    if (req.method === "GET" || req.method === "HEAD") return kirimFile(req, res);

    res.writeHead(405);
    res.end();
  } catch (e) {
    console.error(e);
    kirimJSON(res, 500, { error: e.message || "Kesalahan server" });
  }
});

server.listen(PORT, () => {
  console.log(`Ayo Menulis! berjalan di http://localhost:${PORT}`);
  if (!API_KEY) console.warn("PERINGATAN: GEMINI_API_KEY belum diisi. Aplikasi memakai teks cadangan.");
});
