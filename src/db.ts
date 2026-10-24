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
  // ------------------------------------------------------------------
  // Modul Asesmen Senam: tabel sejajar senam_* (audit 2026-10-22).
  // Sengaja TIDAK memakai tabel kategori/kelompok/penilaian/foto/
  // berita_acara milik asesmen projek, agar kedua asesmen tidak bentrok.
  // Yang dipakai bersama hanya kelas, juri, dan akun admin.
  `CREATE TABLE IF NOT EXISTS senam_kategori (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS senam_kriteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kategori_id INTEGER NOT NULL REFERENCES senam_kategori(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    deskripsi TEXT NOT NULL DEFAULT '',
    skor_min INTEGER NOT NULL DEFAULT 0,
    skor_max INTEGER NOT NULL DEFAULT 100,
    skor_default INTEGER NOT NULL DEFAULT 0,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_senam_kriteria_kategori ON senam_kriteria(kategori_id, urutan)`,
  `CREATE TABLE IF NOT EXISTS senam_kelompok (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
    nama_kelompok TEXT NOT NULL,
    judul_penampilan TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kelas_id, nama_kelompok))`,
  `CREATE INDEX IF NOT EXISTS idx_senam_kelompok_kelas ON senam_kelompok(kelas_id)`,
  `CREATE TABLE IF NOT EXISTS senam_anggota (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES senam_kelompok(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    urutan INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_senam_anggota_kelompok ON senam_anggota(kelompok_id, urutan)`,
  `CREATE TABLE IF NOT EXISTS senam_penilaian (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES senam_kelompok(id) ON DELETE CASCADE,
    juri_id INTEGER NOT NULL REFERENCES juri(id) ON DELETE CASCADE,
    kategori_id INTEGER NOT NULL REFERENCES senam_kategori(id) ON DELETE CASCADE,
    kriteria_id INTEGER NOT NULL REFERENCES senam_kriteria(id),
    skor REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(kelompok_id, juri_id, kategori_id))`,
  `CREATE INDEX IF NOT EXISTS idx_senam_penilaian_kelompok ON senam_penilaian(kelompok_id)`,
  `CREATE INDEX IF NOT EXISTS idx_senam_penilaian_juri ON senam_penilaian(juri_id)`,
  `CREATE TABLE IF NOT EXISTS senam_foto (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelompok_id INTEGER NOT NULL REFERENCES senam_kelompok(id) ON DELETE CASCADE,
    juri_id INTEGER NOT NULL REFERENCES juri(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL DEFAULT 0,
    caption TEXT NOT NULL DEFAULT '',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_senam_foto_kelompok ON senam_foto(kelompok_id)`,
  `CREATE TABLE IF NOT EXISTS senam_berita_acara (
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
  // Log Aktivitas (2026-10-23): satu tabel pengamat untuk semua modul.
  // Ditambahkan di AKHIR daftar migrasi agar nomor versi DB lama tidak geser.
  `CREATE TABLE IF NOT EXISTS aktivitas_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aktor TEXT NOT NULL DEFAULT '',
    peran TEXT NOT NULL DEFAULT '',
    aksi TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_aktivitas_log_waktu ON aktivitas_log(created_at DESC)`,
  // ------------------------------------------------------------------
  // Master data Murid (2026-10-24, keputusan Pak Gun): satu daftar induk
  // murid per rombel, dipakai bersama modul projek & senam. Anggota
  // kelompok tidak lagi diketik bebas — siswa/senam_anggota menaut ke
  // murid lewat murid_id (kolom nama lama dipertahankan sebagai snapshot
  // cadangan). Migrasi ditempel di AKHIR agar nomor versi lama tidak geser.
  `CREATE TABLE IF NOT EXISTS murid (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kelas_id INTEGER NOT NULL REFERENCES kelas(id) ON DELETE CASCADE,
    nama TEXT NOT NULL,
    nis TEXT NOT NULL DEFAULT '',
    nama_norm TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_murid_kelas ON murid(kelas_id, nama_norm)`,
  `ALTER TABLE siswa ADD COLUMN murid_id INTEGER REFERENCES murid(id) ON DELETE SET NULL`,
  `ALTER TABLE senam_anggota ADD COLUMN murid_id INTEGER REFERENCES murid(id) ON DELETE SET NULL`,
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

// Kriteria berikut dipakai bersama oleh seed (instalasi baru) dan migrasi
// rubrik berbasis Dimensi Profil Lulusan (DB lama) — satu sumber kebenaran.
const KRITERIA_PENALARAN_KRITIS: KriteriaSeed[] = [
  { nama: "Sangat kritis", deskripsi: "Mampu menganalisis masalah secara mendalam, menghubungkan berbagai informasi (bahan, biaya, selera konsumen), mengambil keputusan produk yang logis, serta mengevaluasi hasil dan menjelaskan perbaikan", min: 90, max: 100, def: 95 },
  { nama: "Kritis", deskripsi: "Mampu menganalisis masalah dan mengambil keputusan dengan alasan yang masuk akal; ada evaluasi sederhana terhadap hasil", min: 78, max: 89, def: 84 },
  { nama: "Cukup kritis", deskripsi: "Analisis masalah masih dangkal; keputusan diambil dengan alasan terbatas; evaluasi sebatas kesan umum", min: 65, max: 77, def: 71 },
  { nama: "Kurang kritis", deskripsi: "Tidak tampak analisis; keputusan tanpa alasan yang jelas; tidak mampu menjelaskan atau mengevaluasi hasil kerjanya", min: 0, max: 64, def: 50 },
];

const KRITERIA_KUALITAS_PRODUK: KriteriaSeed[] = [
  { nama: "Sangat baik", deskripsi: "Rasa seimbang, tekstur pas, aroma menggugah; kemasan rapi, bersih, higienis, dan informatif (nama produk, komposisi, tanggal)", min: 90, max: 100, def: 95 },
  { nama: "Baik", deskripsi: "Rasa baik dan kemasan rapi serta cukup informatif; ada kekurangan kecil pada satu aspek", min: 78, max: 89, def: 84 },
  { nama: "Cukup", deskripsi: "Rasa standar atau kurang seimbang; kemasan kurang rapi atau kurang informatif", min: 65, max: 77, def: 71 },
  { nama: "Kurang", deskripsi: "Rasa tidak enak atau produk gagal; kemasan tidak rapi, tidak higienis, tanpa informasi produk", min: 0, max: 64, def: 50 },
];

const KRITERIA_KOLABORASI_SENAM: KriteriaSeed[] = [
  { nama: "Sangat kolaboratif", deskripsi: "Seluruh anggota bekerja sama secara gotong royong dengan pembagian peran yang jelas, saling mendukung dan menghargai kontribusi setiap anggota hingga penampilan selesai", min: 90, max: 100, def: 95 },
  { nama: "Kolaboratif", deskripsi: "Anggota bekerja sama dengan baik; pembagian peran ada meski belum merata; tetap saling mendukung", min: 78, max: 89, def: 84 },
  { nama: "Cukup kolaboratif", deskripsi: "Kerja sama belum merata; peran didominasi beberapa anggota; ada anggota yang kurang terlibat atau kurang didukung", min: 65, max: 77, def: 71 },
  { nama: "Kurang kolaboratif", deskripsi: "Tidak tampak kerja sama; anggota tampil sendiri-sendiri; pembagian peran tidak jelas; ada anggota yang dibiarkan pasif", min: 0, max: 64, def: 50 },
];

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
    kode: "penalaran_kritis",
    nama: "Penalaran Kritis",
    kriteria: KRITERIA_PENALARAN_KRITIS,
  },
  {
    kode: "kolaborasi",
    nama: "Kolaborasi (saat membuat)",
    kriteria: [
      { nama: "Sangat kompak", deskripsi: "Semua anggota terlibat aktif, pembagian tugas jelas dan adil, saling menghargai kontribusi setiap anggota", min: 90, max: 100, def: 95 },
      { nama: "Kompak", deskripsi: "Sebagian besar terlibat, ada 1–2 anggota kurang aktif", min: 78, max: 89, def: 84 },
      { nama: "Cukup", deskripsi: "Hanya beberapa anggota yang bekerja", min: 65, max: 77, def: 71 },
      { nama: "Kurang", deskripsi: "Dikerjakan 1–2 orang saja, anggota lain pasif", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "kualitas_produk",
    nama: "Kualitas Produk",
    kriteria: KRITERIA_KUALITAS_PRODUK,
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

// ---------------------------------------------------------------------------
// Seed kategori senam: 4 kategori x 4 kriteria (pola rentang sama dengan
// asesmen projek: 90-100 / 78-89 / 65-77 / 0-64, default 95/84/71/50).
// Hanya menyentuh tabel senam_* — seed projek di atas tidak berubah.
// ---------------------------------------------------------------------------

const SENAM_KATEGORI_SEED: { kode: string; nama: string; kriteria: KriteriaSeed[] }[] = [
  {
    kode: "kekompakan",
    nama: "Kekompakan & Sinkronisasi Gerakan",
    kriteria: [
      { nama: "Sangat kompak", deskripsi: "Seluruh gerakan serentak dan seragam, tempo tepat mengikuti iringan, transisi antar gerakan dan formasi mulus", min: 90, max: 100, def: 95 },
      { nama: "Kompak", deskripsi: "Gerakan umumnya serentak, hanya 1–2 momen kurang seragam", min: 78, max: 89, def: 84 },
      { nama: "Cukup kompak", deskripsi: "Beberapa bagian tidak serentak, tempo kadang meleset dari iringan", min: 65, max: 77, def: 71 },
      { nama: "Kurang kompak", deskripsi: "Gerakan sering tidak serentak, banyak anggota tidak mengikuti tempo", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "teknik",
    nama: "Penguasaan Teknik Gerakan",
    kriteria: [
      { nama: "Sangat menguasai", deskripsi: "Teknik gerakan benar dan aman, sikap awal/akhir jelas, rangkaian tuntas tanpa kesalahan berarti", min: 90, max: 100, def: 95 },
      { nama: "Menguasai", deskripsi: "Teknik umumnya benar, ada kesalahan kecil yang tidak mengganggu rangkaian", min: 78, max: 89, def: 84 },
      { nama: "Cukup menguasai", deskripsi: "Beberapa gerakan kurang tepat atau tidak tuntas", min: 65, max: 77, def: 71 },
      { nama: "Kurang menguasai", deskripsi: "Banyak gerakan salah atau tidak tuntas, ada gerakan yang kurang aman", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "kreativitas_senam",
    nama: "Kreativitas & Variasi Gerakan/Formasi",
    kriteria: [
      { nama: "Sangat kreatif", deskripsi: "Variasi gerakan kaya, pola lantai/formasi berubah menarik, ada unsur orisinal dari kelompok", min: 90, max: 100, def: 95 },
      { nama: "Kreatif", deskripsi: "Ada variasi gerakan dan perubahan formasi, cukup menarik", min: 78, max: 89, def: 84 },
      { nama: "Cukup kreatif", deskripsi: "Variasi terbatas, formasi jarang berubah", min: 65, max: 77, def: 71 },
      { nama: "Kurang kreatif", deskripsi: "Gerakan monoton, satu formasi dari awal sampai akhir", min: 0, max: 64, def: 50 },
    ],
  },
  {
    kode: "kolaborasi",
    nama: "Kolaborasi & Kerja Sama Tim",
    kriteria: KRITERIA_KOLABORASI_SENAM,
  },
];

export function seedSenamKategori(): void {
  const db = getDb();
  const count = (db.query("SELECT COUNT(*) AS n FROM senam_kategori").get() as { n: number }).n;
  if (count > 0) return;
  const insKat = db.query("INSERT INTO senam_kategori (kode, nama, urutan) VALUES (?, ?, ?)");
  const insKri = db.query(
    "INSERT INTO senam_kriteria (kategori_id, nama, deskripsi, skor_min, skor_max, skor_default, urutan) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  SENAM_KATEGORI_SEED.forEach((k, ki) => {
    const res = insKat.run(k.kode, k.nama, ki + 1);
    const katId = Number(res.lastInsertRowid);
    k.kriteria.forEach((kr, kri) => {
      insKri.run(katId, kr.nama, kr.deskripsi, kr.min, kr.max, kr.def, kri + 1);
    });
  });
}

// ---------------------------------------------------------------------------
// Penyesuaian rubrik berbasis Dimensi Profil Lulusan (keputusan Pak Gun,
// 2026-10-23). Projek menargetkan dimensi Kreativitas, Penalaran Kritis, dan
// Kolaborasi; senam menargetkan Kreativitas dan Kolaborasi.
//
// Fungsi ini hanya bekerja pada DB berstruktur LAMA (masih ada kategori
// 'kemasan'/'rasa' pada projek atau 'penampilan' pada senam); pada DB baru
// tidak mengubah apa pun dan aman dipanggil setiap boot.
//
// Cara kerja: baris kategori & kriteria yang sama DIPAKAI ULANG (kode, nama,
// dan deskripsi diganti), sehingga baris penilaian yang sudah ada tidak
// hilang dan nilai angkanya tetap tersimpan:
// - projek: 'kemasan' -> Kualitas Produk (penilaian kemasan terbawa wajar),
//   'rasa' -> Penalaran Kritis (barisnya dipakai ulang; nilai rasa lama
//   tetap tersimpan pada kategori barunya),
//   urutan diselaraskan 1 Kreativitas, 2 Penalaran Kritis, 3 Kolaborasi,
//   4 Kualitas Produk.
// - senam: 'penampilan' -> Kolaborasi & Kerja Sama Tim, kriteria diganti
//   dengan kriteria berbasis dimensi Kolaborasi.
// ---------------------------------------------------------------------------

function gantiKriteriaInPlace(
  db: Database,
  tabel: "kriteria" | "senam_kriteria",
  kategoriId: number,
  set: KriteriaSeed[]
): void {
  const upd = db.query(
    `UPDATE ${tabel} SET nama = ?, deskripsi = ?, skor_min = ?, skor_max = ?, skor_default = ?
     WHERE kategori_id = ? AND urutan = ?`
  );
  set.forEach((kr, i) => upd.run(kr.nama, kr.deskripsi, kr.min, kr.max, kr.def, kategoriId, i + 1));
}

export function sesuaikanRubrikDimensi(): void {
  const db = getDb();

  // --- projek ---
  const rasa = db.query("SELECT id FROM kategori WHERE kode = 'rasa'").get() as { id: number } | null;
  const kemasan = db.query("SELECT id FROM kategori WHERE kode = 'kemasan'").get() as { id: number } | null;
  if (rasa || kemasan) {
    const tx = db.transaction(() => {
      if (rasa) {
        db.query("UPDATE kategori SET kode = 'penalaran_kritis', nama = 'Penalaran Kritis', urutan = 2 WHERE id = ?").run(rasa.id);
        gantiKriteriaInPlace(db, "kriteria", rasa.id, KRITERIA_PENALARAN_KRITIS);
      }
      if (kemasan) {
        db.query("UPDATE kategori SET kode = 'kualitas_produk', nama = 'Kualitas Produk', urutan = 4 WHERE id = ?").run(kemasan.id);
        gantiKriteriaInPlace(db, "kriteria", kemasan.id, KRITERIA_KUALITAS_PRODUK);
      }
      db.query("UPDATE kategori SET urutan = 1 WHERE kode = 'kreativitas'").run();
      db.query("UPDATE kategori SET urutan = 3 WHERE kode = 'kolaborasi'").run();
      const kol = db.query("SELECT id FROM kategori WHERE kode = 'kolaborasi'").get() as { id: number } | null;
      if (kol) {
        db.query("UPDATE kriteria SET deskripsi = ? WHERE kategori_id = ? AND urutan = 1").run(
          "Semua anggota terlibat aktif, pembagian tugas jelas dan adil, saling menghargai kontribusi setiap anggota",
          kol.id
        );
      }
    });
    tx();
  }

  // --- senam ---
  const penampilan = db
    .query("SELECT id FROM senam_kategori WHERE kode = 'penampilan'")
    .get() as { id: number } | null;
  if (penampilan) {
    const tx = db.transaction(() => {
      db.query("UPDATE senam_kategori SET kode = 'kolaborasi', nama = 'Kolaborasi & Kerja Sama Tim' WHERE id = ?").run(penampilan.id);
      gantiKriteriaInPlace(db, "senam_kriteria", penampilan.id, KRITERIA_KOLABORASI_SENAM);
    });
    tx();
  }
}

// ---------------------------------------------------------------------------
// Master Murid: normalisasi nama untuk pencocokan (keputusan Pak Gun,
// 2026-10-24): spasi depan/belakang dibuang, spasi ganda disatukan, huruf
// besar/kecil diabaikan — di luar itu ejaan harus sama persis.
// ---------------------------------------------------------------------------

export function normalisasiNama(nama: string): string {
  return String(nama || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function namaRapi(nama: string): string {
  return String(nama || "").trim().replace(/\s+/g, " ");
}

// Isi awal menu Murid dari nama-nama yang SUDAH terdaftar di kelompok
// projek & senam, lalu tautkan baris siswa/senam_anggota lama ke murid-nya.
// Idempoten: hanya memproses baris yang murid_id-nya masih NULL, jadi aman
// dipanggil setiap boot. Nama hasil isian mengikuti kemunculan pertama;
// salah eja lama yang terbawa cukup dikoreksi sekali di menu Murid.
export function isiMuridDariDataLama(): void {
  const db = getDb();
  const sumber: { nama: string; kelas_id: number }[] = [
    ...(db
      .query(
        `SELECT s.nama AS nama, kel.kelas_id AS kelas_id FROM siswa s
         JOIN kelompok kel ON kel.id = s.kelompok_id WHERE s.murid_id IS NULL`
      )
      .all() as { nama: string; kelas_id: number }[]),
    ...(db
      .query(
        `SELECT s.nama AS nama, kel.kelas_id AS kelas_id FROM senam_anggota s
         JOIN senam_kelompok kel ON kel.id = s.kelompok_id WHERE s.murid_id IS NULL`
      )
      .all() as { nama: string; kelas_id: number }[]),
  ];
  if (!sumber.length) return;
  const cari = db.query("SELECT id FROM murid WHERE kelas_id = ? AND nama_norm = ?");
  const ins = db.query("INSERT INTO murid (kelas_id, nama, nis, nama_norm) VALUES (?, ?, '', ?)");
  const tautSiswa = db.query(
    `UPDATE siswa SET murid_id = (SELECT m.id FROM murid m
       JOIN kelompok kel ON kel.kelas_id = m.kelas_id
       WHERE kel.id = siswa.kelompok_id AND m.nama_norm = ?)
     WHERE id = ? AND murid_id IS NULL`
  );
  const tautSenam = db.query(
    `UPDATE senam_anggota SET murid_id = (SELECT m.id FROM murid m
       JOIN senam_kelompok kel ON kel.kelas_id = m.kelas_id
       WHERE kel.id = senam_anggota.kelompok_id AND m.nama_norm = ?)
     WHERE id = ? AND murid_id IS NULL`
  );
  const tx = db.transaction(() => {
    for (const r of sumber) {
      const norm = normalisasiNama(r.nama);
      if (!norm) continue;
      if (!cari.get(r.kelas_id, norm)) ins.run(r.kelas_id, namaRapi(r.nama), norm);
    }
    const siswaLama = db
      .query("SELECT id, nama FROM siswa WHERE murid_id IS NULL")
      .all() as { id: number; nama: string }[];
    for (const s of siswaLama) tautSiswa.run(normalisasiNama(s.nama), s.id);
    const anggotaLama = db
      .query("SELECT id, nama FROM senam_anggota WHERE murid_id IS NULL")
      .all() as { id: number; nama: string }[];
    for (const s of anggotaLama) tautSenam.run(normalisasiNama(s.nama), s.id);
  });
  tx();
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
