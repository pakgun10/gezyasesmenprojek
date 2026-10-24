# Asesmen Sumatif Kokurikuler

Aplikasi web Asesmen Sumatif Kokurikuler SMP Negeri 1 Punggur. Modulnya mencakup
asesmen projek untuk kelas VIII dan IX dengan tema **Potensi Lokal, Kreasi Global**,
serta asesmen senam untuk kelas VII dengan tema **Gerakan 7 Kebiasaan Anak Indonesia Hebat**.
Berbasis web (HP & laptop), data tersimpan di database SQLite.

**Stack:** Bun + Hono + `bun:sqlite` — sama seperti GezyForm, jalan di VPS Pak Gun.

## Fitur

- **Data master**: kelas, cabang produk (dinamis — bisa tambah: olahan nanas, makanan ringan,
  olahan minuman, dll.), **murid** (daftar induk per rombel — anggota kelompok hanya bisa
  dipilih dari daftar ini), kelompok (nama kelompok + 4–10 nama murid), penilai (kode + PIN).
- **Panel admin per tingkat**: Kelas 7 (asesmen senam), Kelas 8 & Kelas 9 (penilaian projek
  tersaring per tingkat, panel projek yang sama dipakai ulang; cabang produk & kriteria
  projek berlaku bersama untuk 8 dan 9).
- **Impor CSV massal** untuk 150 kelompok sekaligus
  (format: `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid` — murid dipisah `;`).
  Impor bersifat **ketat**: kelas harus sudah terdaftar dan setiap nama murid harus cocok
  dengan data induk Murid pada rombel itu — baris yang melanggar dilewati dan dilaporkan.
  Murid sendiri bisa diimpor massal (format: `kelas,nama,nis`; NIS opsional).
- **Kriteria per kategori** (kreativitas, penalaran kritis, kolaborasi, kualitas produk —
  selaras Dimensi Profil Lulusan): tiap kategori punya
  4 kriteria dengan rentang skor 0–100; penilai memilih kriteria lalu mengisi skor
  (default = skor tengah kriteria, terkunci dalam rentangnya). Bisa diubah admin.
- **Alur penilai (HP-friendly)**: login kode+PIN → pilih kelas → pilih kelompok →
  isi 4 kategori → **langsung upload foto produk** (1+ foto, maks 8 MB/file).
- **Hasil**: rekap per kelas + peringkat otomatis (rata-rata per kategori dari semua penilai,
  total maks 400; seri = peringkat sama), ekspor CSV.
- **Berita acara** per kelas: nomor/tanggal/penandatangan → cetak via browser.
- **Modul Asesmen Senam** (sejajar, terpisah penuh dari penilaian projek): kelompok senam
  + anggota 4–12 murid + judul penampilan; 4 kategori (kekompakan & sinkronisasi,
  teknik gerakan, kreativitas & variasi formasi, kolaborasi & kerja sama tim) dengan
  kriteria berjenjang pola yang sama; penilai memakai akun yang sama (halaman `senam.html`),
  foto penampilan opsional; hasil/peringkat/CSV/berita acara senam tersendiri.
  Data hidup di tabel `senam_*` — tidak bercampur dengan data projek sama sekali.
- **Log Aktivitas**: mencatat login/logout, login gagal, serta aktivitas admin dan penilai
  pada projek dan senam; tersedia di menu admin dengan pencarian, filter peran, dan
  penghapusan log yang berusia minimal 30 hari. Data tersimpan di tabel `aktivitas_log`.
- **Backup & Restore Data** (menu Akun): unduh satu berkas JSON berisi seluruh data
  (semua tabel + berkas foto terkode base64 di dalamnya) dan pulihkan kembali berkas itu
  — termasuk ke instalasi yang masih kosong. Restore mengganti seluruh data saat ini dan
  mengakhiri semua sesi login (route `/api/backup`, `/api/backup/restore`).
- **Footer global dan tampilan responsif**: identitas aplikasi disuntik ke semua halaman
  melalui `common.js` dan disembunyikan saat mencetak.

## Struktur

```
src/
  index.ts    # entrypoint (PORT, DATA_DIR)
  app.ts      # rakit Hono + CSP + route
  db.ts       # migrasi idempoten + seed kategori/kriteria/cabang
  auth.ts     # sesi admin (cookie, rate-limit login)
  judge.ts    # login penilai (kode + PIN)
  log.ts      # pencatatan Log Aktivitas admin dan penilai
  admin.ts    # CRUD kelas/cabang/kelompok/siswa/penilai/kriteria + impor CSV + log
  murid.ts    # master data Murid (route /api/murid/*, ceklis & validasi anggota bersama)
  backup.ts   # Backup & Restore seluruh data (route /api/backup*)
  scoring.ts  # penilaian penilai, upload foto, hasil/peringkat, CSV, berita acara
  senam.ts    # modul Asesmen Senam (route /api/senam/*, tabel senam_*)
public/       # frontend vanilla (index, admin, projek, senam, common.js)
tests/        # bun test (projek, senam, migrasi, dan Log Aktivitas)
deploy/       # DEPLOY.md, .env.example, systemd, nginx, backup.sh
```

## Pengembangan lokal

```bash
bun install
cp deploy/.env.example .env   # opsional; COOKIE_SECURE=0 untuk HTTP lokal
bun --watch run src/index.ts  # http://localhost:3023
bun test
```

Login admin pertama: username `admin`, password dari `ADMIN_PASSWORD`
(atau acak sekali tampil di log bila dikosongkan).

## Deploy

Lihat `deploy/DEPLOY.md` — pola sama dengan GezyForm
(systemd + nginx + backup cron harian).
