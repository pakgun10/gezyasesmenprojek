import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

let _db: Database | null = null;
let _dataDir = "";

const BOOTSTRAP = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')))`;

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS kelas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT UNIQUE NOT NULL,
    tingkat TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS kelompok (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
    nama_kelompok TEXT NOT NULL,
    jenis_produk TEXT NOT NULL DEFAULT 'olahan_nanas',
    nama_produk TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kelas_id, nama_kelompok))`,
  `CREATE INDEX IF NOT EXISTS idx_kelompok_kelas ON kelompok(kelas_id)`,
  `CREATE TABLE IF NOT EXISTS siswa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES kelompok(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_siswa_kelompok ON siswa(kelompok_id, urutan)`,
  `CREATE TABLE IF NOT EXISTS juri (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    keterangan TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS judge_sessions (
    id TEXT PRIMARY KEY,
    juri_id INTEGER NOT NULL REFERENCES juri(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_judge_sessions_juri ON judge_sessions(juri_id)`,
  `CREATE TABLE IF NOT EXISTS kategori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS kriteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kategori_id INTEGER NOT NULL REFERENCES kategori(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    deskripsi TEXT NOT NULL DEFAULT '',
    skor_min INTEGER NOT NULL DEFAULT 0,
    skor_max INTEGER NOT NULL DEFAULT 100,
    skor_default INTEGER NOT NULL DEFAULT 0,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_kriteria_kategori ON kriteria(kategori_id, urutan)`,
  `CREATE TABLE IF NOT EXISTS penilaian (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES kelompok(id) ON DELETE CASCADE,
    juri_id INTEGER NOT NULL REFERENCES juri(id) ON DELETE CASCADE,
    kategori_id INTEGER NOT NULL REFERENCES kategori(id) ON DELETE CASCADE,
    kriteria_id INTEGER NOT NULL REFERENCES kriteria(id),
    skor REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(kelompok_id, juri_id, kategori_id))`,
  `CREATE INDEX IF NOT EXISTS idx_penilaian_kelompok ON penilaian(kelompok_id)`,
  `CREATE INDEX IF NOT EXISTS idx_penilaian_juri ON penilaian(juri_id)`,
  `CREATE TABLE IF NOT EXISTS foto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES kelompok(id) ON DELETE CASCADE,
    juri_id INTEGER NOT NULL REFERENCES juri(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    caption TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_foto_kelompok ON foto(kelompok_id)`,
  `CREATE TABLE IF NOT EXISTS berita_acara (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER UNIQUE NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
    nomor TEXT NOT NULL DEFAULT '',
    tempat TEXT NOT NULL DEFAULT '',
    tanggal TEXT NOT NULL DEFAULT '',
    mengetahui_nama TEXT NOT NULL DEFAULT '',
    mengetahui_nip TEXT NOT NULL DEFAULT '',
    mengetahui_jabatan TEXT NOT NULL DEFAULT '',
    dibuat_nama TEXT NOT NULL DEFAULT '',
    updated_at TEXT)`,
  // Cabang produk dinamis (dulu: jenis_produk hardcoded 2 nilai).
  `CREATE TABLE IF NOT EXISTS cabang_produk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT UNIQUE NOT NULL,
    nama TEXT UNIQUE NOT NULL,
    deskripsi TEXT NOT NULL DEFAULT '',
    urutan INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `INSERT OR IGNORE INTO cabang_produk (kode, nama, urutan) VALUES
    ('olahan_nanas', 'Olahan Nanas', 1),
    ('makanan_ringan', 'Makanan Ringan', 2),
    ('olahan_minuman', 'Olahan Minuman', 3)`,
  `ALTER TABLE kelompok ADD COLUMN cabang_id INTEGER REFERENCES cabang_produk(id)`,
  `UPDATE kelompok SET cabang_id = (SELECT id FROM cabang_produk WHERE kode = 'olahan_nanas')
    WHERE cabang_id IS NULL AND (jenis_produk = 'olahan_nanas' OR jenis_produk = '' OR jenis_produk IS NULL)`,
  `UPDATE kelompok SET cabang_id = (SELECT id FROM cabang_produk WHERE kode = 'makanan_ringan')
    WHERE cabang_id IS NULL AND jenis_produk = 'makanan_ringan'`,
  `UPDATE kelompok SET cabang_id = (SELECT id FROM cabang_produk WHERE kode = 'olahan_nanas')
    WHERE cabang_id IS NULL`,
];

export function initDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
  const db = new Database(join(dataDir, "nilai-projek.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(BOOTSTRAP);
  const applied = new Set(
    (db.query("SELECT version FROM schema_migrations").all() as { version: number }[]).map(
      (r) => r.version
    )
  );
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (!applied.has(v)) {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version) VALUES (?)").run(v);
    }
  });
  _db = db;
  _dataDir = dataDir;
  return db;
}

export function getDb(): Database {
  if (!_db) throw new Error("Database belum diinisialisasi");
  return _db;
}

export function getDataDir(): string {
  return _dataDir;
}

// ---------------------------------------------------------------------------
// Seed: admin + 4 kategori + kriteria default (rentang 0–100 per kategori)
// ---------------------------------------------------------------------------

type KriteriaSeed = {
  nama: string;
  deskripsi: string;
  min: number;
  max: number;
  def: number;
};

const KATEGORI_SEED: { kode: string; nama: string; kriteria: KriteriaSeed[] }[] = [
  {
    kode: "kreativitas",
    nama: "Kreativitas",
    kriteria: [
      { nama: "Sangat kreatif", deskripsi: "Ide orisinal, belum pernah ada, modifikasi berani dan unik", min: 90, max: 100, def: 95 },
      { nama: "Kreatif", deskripsi: "Ada ide/modifikasi baru dari contoh yang sudah ada", min: 78, max: 89, def: 84 },
      { nama: "Cukup kreatif", deskripsi: "Sedikit modifikasi, masih mirip contoh umum", min: 65, max: 77, def: 71 },
      { nama: "Kurang kreatif", deskripsi: "Meniru persis tanpa modifikasi berarti", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "kemasan",
    nama: "Kemasan",
    kriteria: [
      { nama: "Sangat menarik", deskripsi: "Rapi, bersih, higienis, informatif (nama produk, komposisi, tanggal), sangat menarik", min: 90, max: 100, def: 95 },
      { nama: "Menarik", deskripsi: "Rapi dan cukup informatif", min: 78, max: 89, def: 84 },
      { nama: "Cukup", deskripsi: "Kurang rapi atau kurang informatif", min: 65, max: 77, def: 71 },
      { nama: "Kurang", deskripsi: "Tidak rapi, tidak higienis, tanpa informasi produk", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "rasa",
    nama: "Rasa",
    kriteria: [
      { nama: "Sangat enak", deskripsi: "Rasa seimbang, tekstur pas, aroma menggugah, disukai", min: 90, max: 100, def: 95 },
      { nama: "Enak", deskripsi: "Rasa baik, sedikit kurang pas di satu aspek", min: 78, max: 89, def: 84 },
      { nama: "Cukup", deskripsi: "Rasa standar, kurang seimbang", min: 65, max: 77, def: 71 },
      { nama: "Kurang", deskripsi: "Rasa tidak enak / produk gagal", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "kolaborasi",
    nama: "Kolaborasi (saat membuat)",
    kriteria: [
      { nama: "Sangat kompak", deskripsi: "Semua anggota terlibat aktif, pembagian tugas jelas dan adil", min: 90, max: 100, def: 95 },
      { nama: "Kompak", deskripsi: "Sebagian besar terlibat, ada 1–2 anggota kurang aktif", min: 78, max: 89, def: 84 },
      { nama: "Cukup", deskripsi: "Hanya beberapa anggota yang bekerja", min: 65, max: 77, def: 71 },
      { nama: "Kurang", deskripsi: "Dikerjakan 1–2 orang saja, anggota lain pasif", min: 0, max: 64, def: 50 },
    ],
  },
];

export function seedKategori(): void {
  const db = getDb();
  const count = (db.query("SELECT COUNT(*) AS n FROM kategori").get() as { n: number }).n;
  if (count > 0) return;
  const insKat = db.query("INSERT INTO kategori (kode, nama, urutan) VALUES (?, ?, ?)");
  const insKri = db.query(
    "INSERT INTO kriteria (kategori_id, nama, deskripsi, skor_min, skor_max, skor_default, urutan) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  KATEGORI_SEED.forEach((k, ki) => {
    const res = insKat.run(k.kode, k.nama, ki + 1);
    const katId = Number(res.lastInsertRowid);
    k.kriteria.forEach((kr, kri) => {
      insKri.run(katId, kr.nama, kr.deskripsi, kr.min, kr.max, kr.def, kri + 1);
    });
  });
}

export async function ensureAdmin(): Promise<{ username: string; generatedPassword: string | null }> {
  const db = getDb();
  const existing = db.query("SELECT id FROM users LIMIT 1").get();
  if (existing) return { username: "admin", generatedPassword: null };
  let password = process.env.ADMIN_PASSWORD || "";
  let generated: string | null = null;
  if (!password) {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    password = Array.from(bytes, (b) => "0123456789abcdefghjkmnpqrstuvwxyz"[b % 34]).join("");
    generated = password;
  }
  const hash = await Bun.password.hash(password);
  db.query("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')").run(hash);
  return { username: "admin", generatedPassword: generated };
}
