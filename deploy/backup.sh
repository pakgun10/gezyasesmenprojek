#!/usr/bin/env bash
# Backup harian database Penilaian Projek (VACUUM INTO = salinan konsisten,
# aman dijalankan saat aplikasi sedang berjalan). Retensi 14 hari.
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/nilaiproyek/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/nilaiproyek/backup}"
RETENSI=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)
sqlite3 "$DATA_DIR/nilai-projek.db" "VACUUM INTO '$BACKUP_DIR/nilai-projek-$STAMP.db'"
find "$BACKUP_DIR" -name 'nilai-projek-*.db' -mtime +$RETENSI -delete
echo "Backup OK: $BACKUP_DIR/nilai-projek-$STAMP.db"

# Contoh cron harian (jalankan sebagai user aplikasi):
# 0 2 * * * /opt/nilaiproyek/gezyasesmenprojek/deploy/backup.sh >> /opt/nilaiproyek/backup/backup.log 2>&1
#
# CATATAN: foto produk di $DATA_DIR/uploads TIDAK ikut ter-backup di sini.
# Tambahkan rsync berkala bila perlu, mis.:
# 30 2 * * * rsync -a --delete /opt/nilaiproyek/data/uploads/ /opt/nilaiproyek/backup/uploads/
