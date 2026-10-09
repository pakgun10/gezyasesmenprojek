# DEPLOY.md — Penilaian Projek di VPS

Panduan untuk Pak Gun. Aplikasi: Bun + Hono + SQLite, port **3023**.

## 1. Persiapan awal (sekali saja)

```bash
sudo mkdir -p /opt/nilaiproyek/data /opt/nilaiproyek/backup
sudo chown -R $USER:$USER /opt/nilaiproyek
cd /opt/nilaiproyek
git clone git@github-gezymuse-nilai-projek:pakgun10/gezymuse-nilai-projek.git
# (atau: git clone https://github.com/pakgun10/gezymuse-nilai-projek.git)
cd gezymuse-nilai-projek
bun install
```

## 2. Environment

```bash
cp deploy/.env.example .env
nano .env   # isi ADMIN_PASSWORD yang kuat, pastikan COOKIE_SECURE=1
```

## 3. Systemd

```bash
sudo cp deploy/nilaiproyek.service /etc/systemd/system/
sudo nano /etc/systemd/system/nilaiproyek.service  # ganti USER_VPS
# (password admin TIDAK perlu diset di file service — cukup di .env, langkah 2)
sudo systemctl daemon-reload
sudo systemctl enable --now nilaiproyek
sudo systemctl status nilaiproyek   # pastikan active (running)
```

Password admin pertama: kalau `ADMIN_PASSWORD` dikosongkan,
password acak tampil sekali di `sudo journalctl -u nilaiproyek`.

## 4. Nginx

Tempel isi `deploy/nginx.conf` ke blok `server` domain yang dipakai
(mis. `nilai.gezytech.web.id`), lalu:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Pastikan domain sudah HTTPS (certbot) agar cookie sesi aman.

## 5. Backup harian

```bash
chmod +x deploy/backup.sh
crontab -e
# tambah baris:
0 2 * * * /opt/nilaiproyek/gezymuse-nilai-projek/deploy/backup.sh >> /opt/nilaiproyek/backup/backup.log 2>&1
```

Catatan: foto produk tersimpan di `/opt/nilaiproyek/data/uploads/`.
Backup database saja tidak mencakup foto — sinkronkan folder uploads
secara berkala (mis. `rsync`) bila foto dianggap penting.

## 6. Update (rutin)

```bash
cd /opt/nilaiproyek/gezymuse-nilai-projek
git pull
bun install
sudo systemctl restart nilaiproyek
```

Migrasi database otomatis & idempoten — aman dijalankan ulang.

## 7. Alur pakai (setelah live)

1. Buka `https://nilai.gezytech.web.id/admin.html`, login sebagai admin.
2. Tab **Cabang Produk**: tambah cabang bila perlu (default: Olahan Nanas,
   Makanan Ringan, Olahan Minuman).
3. Tab **Kelas**: buat kelas (mis. 7A, 7B, ...; tingkat 7/8/9).
4. Tab **Kelompok**: impor CSV massal (150 kelompok sekaligus) atau tambah manual;
   isi daftar murid tiap kelompok (4–10 nama).
5. Tab **Juri**: buat akun juri (kode + PIN 4–8 digit), bagikan ke masing-masing juri.
6. Tab **Kriteria**: sesuaikan nama/deskripsi/rentang skor bila perlu
   (default 4 kriteria per kategori, rentang 0–100).
7. Juri membuka `https://nilai.gezytech.web.id/juri.html` di HP/laptop,
   login kode+PIN, menilai tiap kelompok, lalu langsung upload foto produk.
8. Tab **Hasil**: pilih kelas → peringkat otomatis → unduh CSV / cetak berita acara.
