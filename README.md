# Penilaian Projek

Aplikasi web penilaian projek produk (olahan nanas, makanan ringan, olahan minuman, dll.)
untuk kelas 7, 8, 9. Berbasis web (HP & laptop), data tersimpan di database SQLite.

**Stack:** Bun + Hono + `bun:sqlite` — sama seperti GezyForm, jalan di VPS Pak Gun.

## Fitur

- **Data master**: kelas, cabang produk (dinamis — bisa tambah: olahan nanas, makanan ringan,
  olahan minuman, dll.), kelompok (nama kelompok + 4–10 nama murid), juri (kode + PIN).
- **Impor CSV massal** untuk 150 kelompok sekaligus
  (format: `nama_kelompok,kelas,tingkat,cabang,nama_produk,murid` — murid dipisah `;`).
- **Kriteria per kategori** (kreativitas, kemasan, rasa, kolaborasi): tiap kategori punya
  4 kriteria dengan rentang skor 0–100; juri memilih kriteria lalu mengisi skor
  (default = skor tengah kriteria, terkunci dalam rentangnya). Bisa diubah admin.
- **Alur juri (HP-friendly)**: login kode+PIN → pilih kelas → pilih kelompok →
  isi 4 kategori → **langsung upload foto produk** (1+ foto, maks 8 MB/file).
- **Hasil**: rekap per kelas + peringkat otomatis (rata-rata per kategori dari semua juri,
  total maks 400; seri = peringkat sama), ekspor CSV.
- **Berita acara** per kelas: nomor/tanggal/penandatangan → cetak via browser.

## Struktur

```
src/
  index.ts    # entrypoint (PORT, DATA_DIR)
  app.ts      # rakit Hono + CSP + route
  db.ts       # migrasi idempoten + seed kategori/kriteria/cabang
  auth.ts     # sesi admin (cookie, rate-limit login)
  judge.ts    # login juri (kode + PIN)
  admin.ts    # CRUD kelas/cabang/kelompok/siswa/juri/kriteria + impor CSV
  scoring.ts  # penilaian juri, upload foto, hasil/peringkat, CSV, berita acara
public/       # frontend vanilla (index, juri, admin)
tests/        # bun test (17 test)
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
