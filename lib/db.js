'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { kodeBaru, kodeKhusus, KODE_KHUSUS } = require('./kode');

const DB_PATH = process.env.CANVASING_DB || path.join(__dirname, '..', 'data.sqlite');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

/**
 * Bootstrap schema. Semua statement idempoten, jadi dibungkus SATU transaksi
 * supaya tidak satu fsync per statement pada setiap request.
 */
function bootstrap() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS produk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      merek TEXT NOT NULL DEFAULT '',
      ukuran TEXT NOT NULL DEFAULT '',
      harga INTEGER NOT NULL DEFAULT 0,
      aktif INTEGER NOT NULL DEFAULT 1,
      urutan INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE,
      aktif INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sesi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      sales_nama TEXT NOT NULL DEFAULT '',
      catatan TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      kode_unik TEXT NOT NULL DEFAULT '',   -- kode surat jalan unik per sales (mis. ZA001)
      dikunci_at TEXT,
      rekap_at TEXT,
      selesai_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS sesi_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesi_id INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
      produk_id INTEGER NOT NULL,
      kode TEXT NOT NULL,
      nama TEXT NOT NULL,
      merek TEXT NOT NULL DEFAULT '',
      b INTEGER NOT NULL DEFAULT 0,
      t INTEGER NOT NULL DEFAULT 0,
      k INTEGER NOT NULL DEFAULT 0,
      s INTEGER DEFAULT NULL, -- NULL = otomatis (b + t - k)
      p INTEGER NOT NULL DEFAULT 0, -- jumlah barang yang DIJUAL menurut sales (diisi di layar penjualan)
      urutan INTEGER NOT NULL DEFAULT 0,
      UNIQUE (sesi_id, produk_id)
    );

    CREATE TABLE IF NOT EXISTS petugas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL UNIQUE,
      pin_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      aktif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS petugas_login (
      token TEXT PRIMARY KEY,
      petugas_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      waktu TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      petugas_id INTEGER,
      petugas_nama TEXT NOT NULL DEFAULT '',
      peran TEXT NOT NULL DEFAULT '',
      aksi TEXT NOT NULL,
      entitas TEXT NOT NULL,
      entitas_id INTEGER,
      ringkas TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS scan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesi_id INTEGER NOT NULL,
      kode TEXT NOT NULL,
      tahap TEXT NOT NULL,
      hasil TEXT NOT NULL,
      waktu TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    /*
     * HASIL "FIX" REKAP STOK (permintaan user revisi ke-162: *"ada tombol fix, setelah tekan fix, hasil
     * rekap pindah ke bawah, cetak pdf itu data yang sudah fix"*).
     *
     * Satu baris = satu barang yang sudah ditekan **Fix** oleh petugas: angka stok tiap sales disimpan
     * sebagai snapshot JSON (kolom sales_json = [{nama, qty}, ...] URUT nomor kolom 1..N supaya dokumen
     * bisa mencetak angka sesuai nomor), plus Total Stok di Gudang, Stok Kledo, dan Selisih hasil
     * hitungan (**Total Stok di Sales + Total Stok di Gudang - Stok Kledo**, revisi ke-168) yang
     * DIHITUNG ULANG di server, bukan dipercaya dari browser.
     *
     * Kolom 'gudang' DULU bernama 'fisik' (label lamanya "Stok Fisik") — di-rename lewat migrasi di
     * bootstrap() karena permintaan user: *"Stok fisik terbagi jadi 2, 1 total stok di sales, otomatis,
     * 2 total stok di gudang manual"*. Angka yang sudah tersimpan TIDAK diubah (kolom yang sama, hanya
     * namanya).
     *
     * Dipakai halaman /rekap-stok (daftar "Hasil Rekap" di bawah tabel) dan dokumen PDF
     * /cetak/rekap-stok-pdf — hanya data yang sudah difix yang dicetak.
     */
    CREATE TABLE IF NOT EXISTS stok_fix (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      produk_id INTEGER NOT NULL,
      kode TEXT NOT NULL DEFAULT '',
      nama TEXT NOT NULL DEFAULT '',
      sales_json TEXT NOT NULL DEFAULT '',
      total_sales INTEGER NOT NULL DEFAULT 0,
      gudang INTEGER NOT NULL DEFAULT 0,
      kledo INTEGER NOT NULL DEFAULT 0,
      selisih INTEGER NOT NULL DEFAULT 0,
      petugas TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    /*
     * PENGINPUTAN TAMBAHAN (entri) — permintaan user:
     * "setiap penginputan tambahan jika jamnya berbeda maka masuk penginputan baru, saat penginputan baru
     *  dilakukan penginputan sebelumnya sudah terkunci, dan data diulangi ke 0, jumlah penginputan
     *  sebelumnya berada di sampingnya, namun di laporan setiap penambahan tetap terakumulasi di kolom T".
     * Revisi lanjutan (permintaan user): "saat penginputan barang tambahan, ketika disimpan langsung
     *  terkunci" — jadi entri bersifat APPEND-ONLY: sekali disimpan langsung terkunci dan tidak pernah
     *  diubah lagi; setiap penyimpanan berikutnya (jam berapa pun) membuat entri + memo + baris catatan
     *  BARU. Karena itu TIDAK ada lagi kunci unik (sesi_id, tanggal, jam) — beberapa entri boleh berada
     *  pada jam yang sama. Kolom 'jam' tetap penanda jam ('08') & dipakai untuk mengurutkan.
     * Kolom sesi_item.t tetap berisi AKUMULASI semua entri (dipakai laporan/cetak), sedangkan rincian per
     * entri disimpan di tabel tambahan_item (dipakai view memo PDF).
     */
    CREATE TABLE IF NOT EXISTS tambahan_batch (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesi_id INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
      tanggal TEXT NOT NULL,                       -- YYYY-MM-DD (tanggal penginputan)
      jam TEXT NOT NULL,                           -- 'HH' penanda jam penginputan (untuk pengurutan)
      jam_mulai TEXT NOT NULL,                     -- 'HH:MM' penginputan (waktu entri dibuat)
      jam_akhir TEXT NOT NULL,                     -- 'HH:MM' perubahan terakhir di entri ini
      petugas TEXT NOT NULL DEFAULT '',
      terkunci_at TEXT,                            -- diisi saat entri disimpan (semua entri terkunci)
      sumber TEXT NOT NULL DEFAULT 'gudang',       -- 'gudang' atau NAMA SALES (barang diambil dari sales lain)
      sumber_sesi_id INTEGER NOT NULL DEFAULT 0,   -- perjalanan sales yang dikurangi kolom B-nya (0 = tidak ada)
      sumber_qty INTEGER NOT NULL DEFAULT 0,       -- jumlah yang BENAR-BENAR dikurangi dari perjalanan itu
      catatan_baris TEXT NOT NULL DEFAULT '',      -- baris catatan otomatis (dibangun ulang, lihat server.js)
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tambahan_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES tambahan_batch(id) ON DELETE CASCADE,
      produk_id INTEGER NOT NULL,
      kode TEXT NOT NULL DEFAULT '',
      nama TEXT NOT NULL DEFAULT '',
      qty INTEGER NOT NULL DEFAULT 0,
      -- Jumlah yang BENAR-BENAR dipotong dari kolom Dibawa (B) perjalanan LAIN (sumber pengambilan).
      -- Bisa lebih kecil dari qty kalau surat jalan sumbernya tidak punya cukup barang. Dipakai supaya
      -- saat penginputan ini DIHAPUS administrator, angka yang dikembalikan persis seperti yang tadi
      -- dipotong. Entri lama (sebelum kolom ini ada) nilainya 0 → pemulihannya memakai perkiraan
      -- berurutan dari sumber_qty (lihat server.js).
      kurangi_b INTEGER NOT NULL DEFAULT 0,
      UNIQUE (batch_id, produk_id)
    );

    /*
     * PENGATURAN APLIKASI (kunci/nilai) — dipakai fitur "Edit Logo & Layout Surat" di menu Setting
     * (permintaan user: bisa unggah logo sendiri + mengatur judul/garis/tanda tangan surat).
     * Nilainya disimpan sebagai TEKS; daftar kunci & nilai bawaannya ada di lib/setelan.js.
     */
    CREATE TABLE IF NOT EXISTS pengaturan (
      kunci TEXT PRIMARY KEY,
      nilai TEXT NOT NULL DEFAULT '',
      diubah_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_item_sesi ON sesi_item(sesi_id);
    CREATE INDEX IF NOT EXISTS idx_scan_sesi ON scan_log(sesi_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entitas ON audit_log(entitas, entitas_id);
    CREATE INDEX IF NOT EXISTS idx_produk_kode ON produk(kode);
    CREATE INDEX IF NOT EXISTS idx_tambahan_batch ON tambahan_batch(sesi_id, tanggal, jam);
    CREATE INDEX IF NOT EXISTS idx_tambahan_item ON tambahan_item(batch_id);
  `);

  // migrasi ringan untuk database lama (aman dijalankan berulang)
  const kolom = (tabel) => db.prepare(`PRAGMA table_info(${tabel})`).all().map((c) => c.name);
  const tambah = (tabel, nama, def) => {
    if (!kolom(tabel).includes(nama)) db.exec(`ALTER TABLE ${tabel} ADD COLUMN ${nama} ${def}`);
  };
  tambah('produk', 'urutan', 'INTEGER NOT NULL DEFAULT 0');
  tambah('produk', 'arsip', 'INTEGER NOT NULL DEFAULT 0');   // barang yang sudah ada transaksi tidak dihapus, tapi diarsipkan
  tambah('sesi_item', 'urutan', 'INTEGER NOT NULL DEFAULT 0');
  /*
   * KOLOM P = jumlah barang yang DIJUAL menurut sales (permintaan user: *"Pada status surat jalan ongoing,
   * sales harus memasukkan dulu jumlah barang yang di jual mereka ke surat jalan yang ongoing … selisih
   * di hitung dari s dikurangi p"*). Diisi lewat halaman penginputan penjualan (`/sesi/:id/jual`) yang
   * hanya bisa dibuka saat status `kirim`/`jual`; setelah disimpan statusnya menjadi `jual`
   * ("Menunggu Rekap"). Selisih penjualan = S − P (kolom `p`), sedangkan selisih lama (B+T−K−S) tetap
   * ditampilkan sebagai keterangan tambahan.
   */
  tambah('sesi_item', 'p', 'INTEGER NOT NULL DEFAULT 0');
  // barang yang BARU ditambahkan dari halaman rekap: tidak ikut perjalanan yang sedang direkap, jadi
  // kolom B/T/K/S-nya tidak boleh diisi (hanya boleh diisi kolom "B Berikutnya") — permintaan user.
  tambah('sesi_item', 'baru', 'INTEGER NOT NULL DEFAULT 0');
  // rencana "B Berikutnya": jumlah barang yang akan dibawa pada surat jalan berikutnya (disimpan supaya
  // angka yang sudah diisi tidak hilang saat halaman dimuat ulang), dipakai POST /sesi/:id/lanjut.
  tambah('sesi_item', 'nb', 'INTEGER NOT NULL DEFAULT 0');
  tambah('sesi', 'kode_unik', "TEXT NOT NULL DEFAULT ''");
  /*
   * BIODATA SALES (permintaan user: "bisa mengisi biodata sales beserta fotonya").
   * `foto` = URL dari penyimpanan media platform (bukan berkas di server) — sama seperti logo aplikasi.
   */
  tambah('sales', 'foto', "TEXT NOT NULL DEFAULT ''");
  tambah('sales', 'alamat', "TEXT NOT NULL DEFAULT ''");
  tambah('sales', 'telepon', "TEXT NOT NULL DEFAULT ''");
  tambah('sales', 'email', "TEXT NOT NULL DEFAULT ''");
  tambah('sales', 'catatan', "TEXT NOT NULL DEFAULT ''");
  tambah('sesi', 'rekap_oleh', "TEXT NOT NULL DEFAULT ''");
  tambah('sesi', 'dibuat_oleh', "TEXT NOT NULL DEFAULT ''");
  /*
   * Nama petugas yang MENGINPUT jumlah penjualan (kolom P) — permintaan user: keterangan "REKAP SELESAI &
   * DIKUNCI" pada dokumen laporan harus menyebut **penjualan diinput oleh siapa**. Diisi setiap kali
   * `POST /sesi/:id/jual` menyimpan (fungsi `sesiSetJualOleh()`).
   */
  tambah('sesi', 'jual_oleh', "TEXT NOT NULL DEFAULT ''");
  tambah('petugas', 'peran', "TEXT NOT NULL DEFAULT 'admin_gudang'");
  // sumber pengambilan barang: gudang atau sales lain (permintaan user)
  tambah('tambahan_batch', 'sumber', "TEXT NOT NULL DEFAULT 'gudang'");
  tambah('tambahan_batch', 'sumber_sesi_id', 'INTEGER NOT NULL DEFAULT 0');
  tambah('tambahan_batch', 'sumber_qty', 'INTEGER NOT NULL DEFAULT 0');
  /*
   * Jumlah yang BENAR-BENAR dipotong dari kolom B surat jalan sumber, per barang (permintaan user:
   * "Administrator bisa menghapus barang tambahan" dengan pemulihan angka). Tanpa kolom ini, saat entri
   * dihapus kita tidak bisa tahu berapa yang harus dikembalikan ke surat jalan sumber.
   */
  tambah('tambahan_item', 'kurangi_b', 'INTEGER NOT NULL DEFAULT 0');

  /*
   * RENAME kolom `stok_fix.fisik` → `stok_fix.gudang` (permintaan user revisi ke-168: "Stok fisik terbagi
   * jadi 2, 1 total stok di sales, otomatis, 2 total stok di gudang manual").
   *
   * Ini GANTI NAMA saja — angka yang sudah tersimpan (hasil fix lama) tetap dipakai apa adanya, karena
   * nilainya memang "total stok yang ada (di gudang)" pada lembar kertas toko. Database yang dibuat
   * sebelum perubahan punya kolom `fisik`; yang baru sudah punya `gudang` sejak CREATE TABLE, sehingga
   * migrasi ini hanya berlaku di satu arah dan idempoten.
   */
  if (kolom('stok_fix').includes('fisik') && !kolom('stok_fix').includes('gudang')) {
    db.exec('ALTER TABLE stok_fix RENAME COLUMN fisik TO gudang');
  }

  // Pastikan selalu ada administrator: kalau belum ada (database lama), petugas terlama dinaikkan.
  const adaAdmin = db.prepare("SELECT COUNT(*) c FROM petugas WHERE peran = 'administrator'").get().c;
  if (!adaAdmin) {
    const terlama = db.prepare('SELECT id FROM petugas ORDER BY id ASC LIMIT 1').get();
    if (terlama) db.prepare("UPDATE petugas SET peran = 'administrator' WHERE id = ?").run(terlama.id);
  }

  /*
   * Migrasi kode unik surat jalan untuk perjalanan lama (permintaan user: "setiap buat surat jalan, sales
   * mengeluarkan kode unik sendiri"). Dijalankan urut id supaya nomor keluarnya mengikuti urutan aslinya.
   */
  const belumKode = db.prepare("SELECT * FROM sesi WHERE kode_unik = '' ORDER BY id ASC").all();
  if (belumKode.length) {
    const sudah = db.prepare("SELECT sales_nama, kode_unik FROM sesi WHERE kode_unik <> '' ORDER BY id ASC").all();
    belumKode.forEach((s) => {
      const kode = kodeBaru(s.sales_nama, sudah);
      db.prepare('UPDATE sesi SET kode_unik = ? WHERE id = ?').run(kode, s.id);
      sudah.push({ sales_nama: s.sales_nama, kode_unik: kode });
    });
  }

  /*
   * KODE KHUSUS per sales (permintaan user: "Kode Haris menjadi HRS, kode Umam Jack menjadi UMJ").
   * Surat jalan lama milik sales tersebut ditulis ulang mengikuti kode khususnya, urut id supaya nomor
   * keluarnya tetap berurutan (HAR001 → HRS001, UJ001 → UMJ001, dan seterusnya). Idempoten: sesi yang
   * kodenya sudah sesuai tidak disentuh, dan sales tanpa kode khusus tidak dipengaruhi.
   */
  if (Object.keys(KODE_KHUSUS).length) {
    const punyaKhusus = db
      .prepare('SELECT id, sales_nama, kode_unik FROM sesi ORDER BY id ASC')
      .all()
      .filter((x) => kodeKhusus(x.sales_nama));
    if (punyaKhusus.length) {
      const nomorTerakhir = new Map();
      punyaKhusus.forEach((x) => {
        const awalan = kodeKhusus(x.sales_nama);
        const n = (nomorTerakhir.get(awalan) || 0) + 1;
        nomorTerakhir.set(awalan, n);
        const kode = awalan + String(n).padStart(3, '0');
        if (String(x.kode_unik || '').toUpperCase() !== kode) {
          db.prepare('UPDATE sesi SET kode_unik = ? WHERE id = ?').run(kode, x.id);
        }
      });
    }
  }

  /*
   * Migrasi tambahan barang lama → entri (tambahan_batch).
   * Database yang sudah berjalan punya angka di kolom sesi_item.t tapi belum punya entri. Supaya angka itu
   * tidak hilang (dan tetap muncul di overview + bisa dilihat memonya), dibuat SATU entri terkunci per
   * perjalanan, bertanggal/jam saat perjalanan dikunci (atau saat dibuat, kalau belum pernah dikunci).
   */
  const perluMigrasi = db
    .prepare(
      `SELECT s.id FROM sesi s
       WHERE (SELECT COALESCE(SUM(t),0) FROM sesi_item WHERE sesi_id = s.id) > 0
         AND NOT EXISTS (SELECT 1 FROM tambahan_batch b WHERE b.sesi_id = s.id)`
    )
    .all();
  for (const s of perluMigrasi) {
    const sesi = db.prepare('SELECT * FROM sesi WHERE id = ?').get(s.id);
    const waktu = String(sesi.dikunci_at || sesi.created_at || db.prepare("SELECT datetime('now','localtime') w").get().w);
    const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(waktu);
    const tanggal = m ? m[1] : new Date().toISOString().slice(0, 10);
    const jamMulai = m ? `${m[2]}:${m[3]}` : '00:00';
    const jam = jamMulai.slice(0, 2);
    const info = db
      .prepare(
        `INSERT INTO tambahan_batch (sesi_id, tanggal, jam, jam_mulai, jam_akhir, petugas, terkunci_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))`
      )
      .run(s.id, tanggal, jam, jamMulai, jamMulai, String(sesi.dibuat_oleh || sesi.rekap_oleh || ''));
    const batchId = info.lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO tambahan_item (batch_id, produk_id, kode, nama, qty) VALUES (?, ?, ?, ?, ?)');
    db.prepare('SELECT produk_id, kode, nama, t FROM sesi_item WHERE sesi_id = ? AND t > 0').all(s.id).forEach((it) => {
      ins.run(batchId, it.produk_id, it.kode, it.nama, it.t);
    });
  }

  /*
   * STATUS LAMA `kirim` → `tunggu_jual` (label "Ongoing").
   * Artinya sama (surat jalan sudah terbit tetapi penjualan belum diisi) dan SEMUA penjagaan di kode
   * menerima keduanya, jadi penulisan ulang ini hanya menyelaraskan label yang dilihat pengguna.
   * Idempoten (tanpa baris `kirim` lagi, UPDATE ini tidak mengubah apa pun) dan dijalankan di dalam
   * transaksi bootstrap, jadi tidak menambah biaya fsync.
   */
  db.prepare("UPDATE sesi SET status = 'tunggu_jual' WHERE status = 'kirim'").run();

  /*
   * BACKFILL `sesi.jual_oleh` dari JEJAK AUDIT untuk transaksi LAMA (permintaan user: keterangan
   * "REKAP SELESAI & DIKUNCI" di dokumen laporan menyebut penjualan diinput oleh siapa).
   *
   * Sumbernya catatan audit `penjualan-diisi`/`penjualan-diubah` (ditulis rute `/sesi/:id/jual` sejak
   * fitur penjualan ada), diambil yang PALING AKHIR per perjalanan. Dijalankan **sekali saja** dengan
   * penanda di tabel `pengaturan` karena `bootstrap()` berjalan pada setiap permintaan — tanpa penanda
   * ini, query ke `audit_log` (yang bisa besar di produksi) ikut dieksekusi terus-menerus. Idempoten:
   * transaksi yang `jual_oleh`-nya sudah terisi TIDAK ditimpa.
   */
  const sudahBackfill = db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'migrasi_jual_oleh'").get();
  if (!sudahBackfill) {
    const jejak = db
      .prepare(
        `SELECT s.id, (
           SELECT a.petugas_nama FROM audit_log a
            WHERE a.entitas = 'sesi' AND a.entitas_id = s.id
              AND a.aksi IN ('penjualan-diisi','penjualan-diubah')
            ORDER BY a.id DESC LIMIT 1
         ) nama
           FROM sesi s
          WHERE COALESCE(s.jual_oleh, '') = ''`
      )
      .all()
      .filter((r) => r.nama);
    const set = db.prepare("UPDATE sesi SET jual_oleh = ? WHERE id = ? AND COALESCE(jual_oleh, '') = ''");
    jejak.forEach((r) => set.run(String(r.nama), r.id));
    db.prepare(
      `INSERT INTO pengaturan (kunci, nilai, diubah_at) VALUES ('migrasi_jual_oleh', ?, datetime('now','localtime'))
       ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_at = excluded.diubah_at`
    ).run(String(jejak.length));
    if (jejak.length) console.log(`[db] penjualan (P) lama: nama penginput diisi dari audit untuk ${jejak.length} perjalanan`);
  }
}

const runBootstrap = db.transaction(bootstrap);
runBootstrap();

/*
 * Migrasi khusus: entri penambahan barang sekarang APPEND-ONLY (setiap penyimpanan langsung terkunci dan
 * penyimpanan berikutnya membuat entri BARU), jadi kunci unik lama `UNIQUE (sesi_id, tanggal, jam)` harus
 * dilepas — kalau tidak, dua penyimpanan pada jam yang sama akan gagal ("UNIQUE constraint failed").
 * SQLite tidak bisa menghapus constraint tanpa membangun ulang tabel, dan tabelnya harus dibangun ulang
 * dengan `foreign_keys` OFF: kalau tidak, DROP TABLE akan menghapus seluruh isi `tambahan_item`
 * lewat ON DELETE CASCADE. Pragma itu hanya berlaku di luar transaksi, jadi migrasi ini dijalankan
 * terpisah setelah bootstrap.
 */
function lepasKunciUnikEntri() {
  const tabel = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tambahan_batch'").get();
  if (!tabel || !/UNIQUE\s*\(\s*sesi_id\s*,\s*tanggal\s*,\s*jam\s*\)/i.test(String(tabel.sql || ''))) return false;
  db.exec(`
    CREATE TABLE tambahan_batch_baru (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesi_id INTEGER NOT NULL REFERENCES sesi(id) ON DELETE CASCADE,
      tanggal TEXT NOT NULL,
      jam TEXT NOT NULL,
      jam_mulai TEXT NOT NULL,
      jam_akhir TEXT NOT NULL,
      petugas TEXT NOT NULL DEFAULT '',
      terkunci_at TEXT,
      sumber TEXT NOT NULL DEFAULT 'gudang',
      sumber_sesi_id INTEGER NOT NULL DEFAULT 0,
      sumber_qty INTEGER NOT NULL DEFAULT 0,
      catatan_baris TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    INSERT INTO tambahan_batch_baru
      (id, sesi_id, tanggal, jam, jam_mulai, jam_akhir, petugas, terkunci_at, sumber, sumber_sesi_id, sumber_qty, catatan_baris, created_at)
      SELECT id, sesi_id, tanggal, jam, jam_mulai, jam_akhir, petugas, terkunci_at, sumber, sumber_sesi_id, sumber_qty, catatan_baris, created_at
        FROM tambahan_batch;
    DROP TABLE tambahan_batch;
    ALTER TABLE tambahan_batch_baru RENAME TO tambahan_batch;
    CREATE INDEX IF NOT EXISTS idx_tambahan_batch ON tambahan_batch(sesi_id, tanggal, jam);
  `);
  return true;
}

{
  const fkAwal = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    lepasKunciUnikEntri();
  } finally {
    db.pragma(`foreign_keys = ${fkAwal ? 'ON' : 'OFF'}`);
  }
}

/**
 * BANGUN ULANG catatan otomatis SEMUA perjalanan (permintaan user: "perubahan di format catatan belum
 * berfungsi di surat jalan yang sudah dibuat").
 *
 * Teks catatan otomatis DISIMPAN di `sesi.catatan` (dicampur dengan catatan manual), jadi perjalanan
 * yang dibuat SEBELUM formatnya berubah masih memakai teks lama (mis. "… dari ZA001 (sales ZAINAL ARDI) …"
 * tanpa "(dicatat oleh …)"). Fungsi ini menghitung ulang dari data `tambahan_batch` memakai aturan yang
 * SAMA dengan `server.js → barisAutoSesi()` + `lib/util.js` (barisPengambilan/barisDiambil/susunCatatan),
 * lalu menulisnya hanya kalau memang BERBEDA (idempoten, tidak menyentuh catatan manual).
 *
 * Dijalankan sekali saat aplikasi dimuat (lihat pemanggilan setelah blok migrasi di bawah).
 */
function segarkanSemuaCatatan() {
  const util = require('./util');
  const semuaSesi = db.prepare('SELECT id, catatan FROM sesi').all();
  const entriSesi = db.prepare(
    `SELECT b.id, b.sesi_id, b.tanggal, b.jam_mulai, b.petugas, b.sumber, b.sumber_qty,
            src.kode_unik kode_sumber,
            (SELECT COALESCE(SUM(qty),0) FROM tambahan_item i WHERE i.batch_id = b.id) total
       FROM tambahan_batch b LEFT JOIN sesi src ON src.id = b.sumber_sesi_id
      ORDER BY b.sesi_id, b.tanggal, b.jam_mulai, b.id`
  );
  const diambilSesi = db.prepare(
    `SELECT b.id batch_id, b.sumber_sesi_id sesi_id, b.tanggal, b.jam_mulai, b.petugas, s.sales_nama pengambil,
            CASE WHEN b.sumber_qty > 0 THEN b.sumber_qty
                 ELSE (SELECT COALESCE(SUM(qty),0) FROM tambahan_item i WHERE i.batch_id = b.id) END total
       FROM tambahan_batch b JOIN sesi s ON s.id = b.sesi_id
      WHERE b.sumber_sesi_id > 0
      ORDER BY b.sumber_sesi_id, b.tanggal, b.jam_mulai, b.id`
  );
  /*
   * Daftar barang per entri penginputan — dipakai catatan PENGEMBALIAN supaya nama barang yang
   * dikembalikan ikut dicantumkan (permintaan user). Tanpa ini, catatan perjalanan LAMA yang dibangun
   * ulang saat aplikasi dimuat akan kehilangan daftar barangnya lagi.
   */
  const itemEntri = db.prepare(
    `SELECT batch_id, nama, qty, kurangi_b FROM tambahan_item WHERE qty > 0 ORDER BY id ASC`
  );
  const rincian = new Map();
  itemEntri.all().forEach((i) => {
    if (!rincian.has(i.batch_id)) rincian.set(i.batch_id, []);
    rincian.get(i.batch_id).push({ nama: i.nama, qty: i.qty, kurangi_b: Number(i.kurangi_b) || 0 });
  });
  /* Daftar barang untuk "telah diambil barangnya oleh …": pakai kurangi_b bila ada (lihat server.js). */
  const itemsDiambil = (daftar) => {
    const asli = daftar || [];
    const adaKurangi = asli.some((x) => Number(x.kurangi_b) > 0);
    return asli.map((x) => ({ nama: x.nama, qty: adaKurangi ? Number(x.kurangi_b) || 0 : x.qty }));
  };
  const per = new Map();
  const tambah = (id, baris) => {
    if (!per.has(id)) per.set(id, []);
    per.get(id).push(baris);
  };
  entriSesi.all().forEach((b) => {
    const kembali = String(b.sumber || '').toLowerCase() === 'kembali-gudang';
    tambah(b.sesi_id, {
      tanggal: b.tanggal,
      jam: b.jam_mulai,
      teks: kembali
        ? util.barisPengembalian({
            tanggalPendek: util.tanggalPendek(b.tanggal),
            jam: b.jam_mulai,
            total: b.total,
            petugas: b.petugas,
            items: rincian.get(b.id) || [],
          })
        : util.barisPengambilan({
            tanggalPendek: util.tanggalPendek(b.tanggal),
            jam: b.jam_mulai,
            sumber: b.sumber,
            kodeSumber: b.kode_sumber,
            total: b.total,
            petugas: b.petugas,
            items: rincian.get(b.id) || [],
          }),
    });
  });
  diambilSesi.all().forEach((b) =>
    tambah(b.sesi_id, {
      tanggal: b.tanggal,
      jam: b.jam_mulai,
      teks: util.barisDiambil({
        tanggalPendek: util.tanggalPendek(b.tanggal),
        jam: b.jam_mulai,
        oleh: b.pengambil,
        total: b.total,
        petugas: b.petugas,
        items: itemsDiambil(rincian.get(b.batch_id)),
      }),
    })
  );
  const simpan = db.prepare('UPDATE sesi SET catatan = ? WHERE id = ?');
  let diubah = 0;
  const kerja = db.transaction(() => {
    semuaSesi.forEach((s) => {
      const baru = util.susunCatatan(s.catatan, per.get(s.id) || []);
      if (baru !== String(s.catatan || '').trim()) {
        simpan.run(baru, s.id);
        diubah++;
      }
    });
  });
  kerja();
  return diubah;
}

// Dijalankan sekali saat aplikasi dimuat: catatan otomatis perjalanan LAMA ikut memakai format terbaru
// (nama pencatat + kode perjalanan dalam kurung). Hanya menulis kalau isinya memang berbeda.
try {
  const jml = segarkanSemuaCatatan();
  if (jml) console.log(`[db] catatan otomatis diperbarui untuk ${jml} perjalanan (format terbaru)`);
} catch (e) {
  console.error('[db] gagal memperbarui catatan otomatis:', e && e.message);
}

/*
 * TANGGAL ACUAN LAPORAN & GRAFIK = tanggal REKAP.
 * Permintaan user: "rekap penjualan mengikuti tanggal rekap saat rekap, bukan tanggal canvasing".
 * Dipakai BERSAMA oleh `laporanSales()`, `grafikSales()`, dan `grafikHarian()` supaya angka di laporan,
 * grafik per sales, dan grafik per hari selalu sinkron. Fallback ke tanggal canvasing hanya untuk data
 * lama yang belum punya cap waktu rekap sama sekali.
 */
const TANGGAL_REKAP = `date(COALESCE(ss.selesai_at, ss.rekap_at, ss.tanggal))`;

const q = {
  // ---------- produk ----------
  /**
   * Daftar barang. `tampilArsip = false` (bawaan) menyembunyikan barang yang diarsipkan,
   * karena barang ber-arsip = sudah punya transaksi dan tidak boleh dihapus (permintaan user).
   */
  produkAll: (cari = '', hanyaAktif = false, tampilArsip = false) => {
    const like = '%' + cari.toLowerCase() + '%';
    let sql = `SELECT * FROM produk WHERE 1=1`;
    if (hanyaAktif) sql += ` AND aktif = 1`;
    if (!tampilArsip) sql += ` AND arsip = 0`;
    if (cari) sql += ` AND (lower(kode) LIKE ? OR lower(nama) LIKE ? OR lower(merek) LIKE ?)`;
    sql += ` ORDER BY arsip ASC, urutan ASC, id ASC`;
    return cari ? db.prepare(sql).all(like, like, like) : db.prepare(sql).all();
  },
  produkArsipJumlah: () => db.prepare('SELECT COUNT(*) c FROM produk WHERE arsip = 1').get().c,
  produkArsipJumlahAktif: () => db.prepare('SELECT COUNT(*) c FROM produk WHERE arsip = 1 AND aktif = 1').get().c,
  produkSetArsip: (id, arsip) => db.prepare('UPDATE produk SET arsip = ? WHERE id = ?').run(arsip ? 1 : 0, id),
  /**
   * Id barang yang SUDAH ada transaksi (→ diarsipkan, tidak boleh dihapus).
   * Patokan "ada transaksi" = barang BENAR-BENAR bergerak di perjalanan (b+t+k > 0), bukan sekadar
   * ikut tersalin ke daftar sesi (`itemSinkron` menyalin semua produk dengan jumlah 0).
   */
  produkDipakai: () =>
    db.prepare('SELECT DISTINCT produk_id FROM sesi_item WHERE (b + t + k) > 0').all().map((r) => r.produk_id),
  produkPunyaTransaksi: (id) =>
    db.prepare('SELECT COUNT(*) c FROM sesi_item WHERE produk_id = ? AND (b + t + k) > 0').get(Number(id)).c > 0,
  produkById: (id) => db.prepare('SELECT * FROM produk WHERE id = ?').get(id),
  produkByKode: (kode) =>
    db.prepare('SELECT * FROM produk WHERE upper(kode) = upper(?)').get(String(kode || '').trim()),
  produkByNama: (nama) =>
    db.prepare('SELECT * FROM produk WHERE lower(nama) = lower(?) LIMIT 1').get(String(nama || '').trim()),
  produkInsert: (p) =>
    db
      .prepare(
        `INSERT INTO produk (kode, nama, merek, ukuran, harga, aktif, urutan, created_at)
         VALUES (@kode, @nama, @merek, @ukuran, @harga, @aktif, @urutan, datetime('now','localtime'))`
      )
      .run(p),
  produkUpdate: (p) =>
    db
      .prepare(
        `UPDATE produk SET kode=@kode, nama=@nama, merek=@merek, ukuran=@ukuran, harga=@harga, aktif=@aktif
         WHERE id=@id`
      )
      .run(p),
  produkUpsert: (p) =>
    db
      .prepare(
        `INSERT INTO produk (kode, nama, merek, ukuran, harga, aktif, created_at)
         VALUES (@kode, @nama, @merek, @ukuran, @harga, 1, datetime('now','localtime'))
         ON CONFLICT(kode) DO UPDATE SET
           nama   = CASE WHEN excluded.nama   <> '' THEN excluded.nama   ELSE produk.nama   END,
           merek  = CASE WHEN excluded.merek  <> '' THEN excluded.merek  ELSE produk.merek  END,
           ukuran = CASE WHEN excluded.ukuran <> '' THEN excluded.ukuran ELSE produk.ukuran END,
           harga  = CASE WHEN excluded.harga  >  0  THEN excluded.harga  ELSE produk.harga  END,
           aktif  = 1,
           arsip  = 0`
      )
      .run(p),
  produkHapus: (id) => db.prepare('DELETE FROM produk WHERE id = ?').run(id),
  produkCount: () => db.prepare('SELECT COUNT(*) c FROM produk WHERE aktif = 1 AND arsip = 0').get().c,
  urutanMax: () => db.prepare('SELECT COALESCE(MAX(urutan),0) m FROM produk').get().m,

  // ---------- sales ----------
  salesAll: () => db.prepare('SELECT * FROM sales WHERE aktif = 1 ORDER BY nama ASC').all(),
  salesTambah: (nama) => db.prepare('INSERT OR IGNORE INTO sales (nama) VALUES (?)').run(nama),
  salesHapus: (id) => db.prepare('DELETE FROM sales WHERE id = ?').run(id),
  salesById: (id) => db.prepare('SELECT * FROM sales WHERE id = ?').get(Number(id)),
  /** Simpan biodata sales. `foto` hanya ditulis kalau memang dikirim (biar foto lama tidak terhapus). */
  salesUbah: (id, { nama, alamat = '', telepon = '', email = '', catatan = '', foto = null } = {}) => {
    if (foto === null) {
      return db
        .prepare('UPDATE sales SET nama = ?, alamat = ?, telepon = ?, email = ?, catatan = ? WHERE id = ?')
        .run(String(nama || ''), String(alamat || ''), String(telepon || ''), String(email || ''), String(catatan || ''), Number(id));
    }
    return db
      .prepare('UPDATE sales SET nama = ?, alamat = ?, telepon = ?, email = ?, catatan = ?, foto = ? WHERE id = ?')
      .run(String(nama || ''), String(alamat || ''), String(telepon || ''), String(email || ''), String(catatan || ''), String(foto || ''), Number(id));
  },
  /** Cari sales berdasarkan NAMA (dipakai saat mengubah nama supaya perjalanan ikut diperbarui). */
  salesByNama: (nama) => db.prepare('SELECT * FROM sales WHERE lower(TRIM(nama)) = lower(TRIM(?))').get(String(nama || '')),
  /** Ganti nama sales di SEMUA perjalanannya (permintaan user: nama di daftar sales & surat jalan harus sama). */
  salesGantiNamaDiSesi: (lama, baru) => db.prepare('UPDATE sesi SET sales_nama = ? WHERE lower(TRIM(COALESCE(sales_nama,\'\'))) = lower(TRIM(?))').run(String(baru || ''), String(lama || '')),
  /** Berapa perjalanan yang memakai nama sales ini (dipakai untuk melindungi penghapusan data). */
  salesJumlahSesi: (nama) => db.prepare('SELECT COUNT(*) c FROM sesi WHERE lower(TRIM(COALESCE(sales_nama,\'\'))) = lower(TRIM(?))').get(String(nama || '')).c,
  /**
   * Perjalanan milik satu sales pada TANGGAL tertentu (dipakai saat barang "diambil dari sales lain":
   * permintaan user — "perjalanan sales itu pada TANGGAL yang sama dikurangi kolom Dibawa (B)-nya").
   * Perjalanan yang belum selesai diutamakan, lalu yang terbaru.
   */
  sesiBySalesTanggal: (nama, tanggal) =>
    db
      .prepare(
        `SELECT * FROM sesi
         WHERE lower(TRIM(COALESCE(sales_nama,''))) = lower(TRIM(?)) AND tanggal = ?
         ORDER BY (CASE WHEN status = 'selesai' THEN 1 ELSE 0 END) ASC, id DESC LIMIT 1`
      )
      .get(String(nama || ''), String(tanggal || '')),

  // ---------- petugas (login) ----------
  petugasCount: () => db.prepare('SELECT COUNT(*) c FROM petugas WHERE aktif = 1').get().c,
  petugasAll: () =>
    db
      .prepare(
        `SELECT id, nama, peran, aktif, created_at FROM petugas WHERE aktif = 1
         ORDER BY CASE peran WHEN 'administrator' THEN 0 WHEN 'admin_gudang' THEN 1 ELSE 2 END, nama ASC`
      )
      .all(),
  petugasSetPeran: (id, peran) => db.prepare('UPDATE petugas SET peran = ? WHERE id = ?').run(peran, id),
  petugasJumlahPeran: (peran) => db.prepare('SELECT COUNT(*) c FROM petugas WHERE peran = ? AND aktif = 1').get(peran).c,
  petugasById: (id) => db.prepare('SELECT * FROM petugas WHERE id = ?').get(id),
  petugasByNama: (nama) =>
    db.prepare('SELECT * FROM petugas WHERE lower(nama) = lower(?) LIMIT 1').get(String(nama || '').trim()),
  petugasTambah: (nama, pinHash, salt) =>
    db.prepare('INSERT INTO petugas (nama, pin_hash, salt) VALUES (?, ?, ?)').run(nama, pinHash, salt),
  petugasSetPin: (id, pinHash, salt) =>
    db.prepare('UPDATE petugas SET pin_hash = ?, salt = ? WHERE id = ?').run(pinHash, salt, id),
  petugasHapus: (id) => db.prepare('DELETE FROM petugas WHERE id = ?').run(id),
  petugasJumlahLogin: (id) => db.prepare('SELECT COUNT(*) c FROM petugas_login WHERE petugas_id = ?').get(id).c,

  loginBuat: (token, petugasId, hari) =>
    db
      .prepare(
        `INSERT INTO petugas_login (token, petugas_id, expires_at)
         VALUES (?, ?, datetime('now','localtime', ?))`
      )
      .run(token, petugasId, `+${Number(hari) || 30} days`),
  loginByToken: (token) =>
    db
      .prepare(
        `SELECT l.token, l.petugas_id, p.nama, p.peran
         FROM petugas_login l JOIN petugas p ON p.id = l.petugas_id
         WHERE l.token = ? AND p.aktif = 1 AND l.expires_at > datetime('now','localtime')`
      )
      .get(String(token || '')),
  loginHapus: (token) => db.prepare('DELETE FROM petugas_login WHERE token = ?').run(String(token || '')),
  loginHapusPetugas: (id) => db.prepare('DELETE FROM petugas_login WHERE petugas_id = ?').run(id),
  loginBersih: () => db.prepare("DELETE FROM petugas_login WHERE expires_at <= datetime('now','localtime')").run(),

  // ---------- sesi ----------
  /**
   * Perjalanan berstatus draft yang BELUM diisi barang apa pun (B+T+K semuanya 0) dan sudah berumur
   * lebih dari `menit` (permintaan user: "hapus otomatis transaksi kosong").
   * Umur dipakai sebagai pengaman supaya transaksi yang BARU dibuat (dan sedang dibuka di layar input)
   * tidak ikut terhapus.
   */
  draftKosong: (menit = 30) =>
    db
      .prepare(
        `SELECT s.id, s.kode_unik, s.sales_nama, s.created_at
           FROM sesi s
          WHERE s.status = 'draft'
            AND COALESCE((SELECT SUM(i.b + i.t + i.k) FROM sesi_item i WHERE i.sesi_id = s.id), 0) = 0
            AND datetime(s.created_at, '+' || @menit || ' minutes') <= datetime('now','localtime')
          ORDER BY s.id`
      )
      .all({ menit: Math.max(0, Number(menit) || 0) }),

  sesiAll: () =>
    db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM sesi_item i WHERE i.sesi_id = s.id AND (i.b+i.t)>0) jml_item,
                (SELECT COALESCE(SUM(i.b),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_b,
                (SELECT COALESCE(SUM(i.t),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_t,
                (SELECT COALESCE(SUM(i.k),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_k,
                (SELECT COALESCE(SUM(CASE WHEN i.s IS NULL THEN max(0, i.b + i.t - i.k) ELSE i.s END),0)
                   FROM sesi_item i WHERE i.sesi_id = s.id) tot_s,
                -- total PENJUALAN (kolom P): dipakai menu baris untuk memilih label "Undo …"
                (SELECT COALESCE(SUM(i.p),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_p
         FROM sesi s ORDER BY s.id DESC`
      )
      .all(),
  sesiById: (id) => db.prepare('SELECT * FROM sesi WHERE id = ?').get(id),
  sesiInsert: (s) =>
    db
      .prepare(
        `INSERT INTO sesi (tanggal, sales_nama, catatan, status, kode_unik)
         VALUES (@tanggal, @sales_nama, @catatan, 'draft', @kode_unik)`
      )
      .run({ tanggal: s.tanggal, sales_nama: s.sales_nama, catatan: s.catatan, kode_unik: String(s.kode_unik || '') }),
  sesiSetKode: (id, kode) => db.prepare('UPDATE sesi SET kode_unik = ? WHERE id = ?').run(String(kode || ''), Number(id)),
  sesiByKode: (kode) =>
    db.prepare('SELECT * FROM sesi WHERE upper(kode_unik) = upper(?) LIMIT 1').get(String(kode || '').trim()),
  /** Kode unik yang sudah terpakai (dipakai supaya nomor urut tiap sales tidak bentrok). */
  kodeTerpakai: () => db.prepare("SELECT kode_unik FROM sesi WHERE kode_unik <> ''").all().map((r) => r.kode_unik),
  sesiBySales: (nama) =>
    db
      .prepare(
        `SELECT * FROM sesi WHERE lower(TRIM(COALESCE(sales_nama,''))) = lower(TRIM(?)) ORDER BY id ASC`
      )
      .all(String(nama || '')),
  /**
   * Surat jalan milik satu sales yang BELUM SELESAI (permintaan user: "surat jalan yang selesai tidak
   * bisa diambil"). Dipakai untuk memilih sumber saat barang diambil dari sales lain.
   */
  sesiSumberSales: (nama, tanggal) =>
    db
      .prepare(
        `SELECT s.*, (SELECT COALESCE(SUM(i.b),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_b
         FROM sesi s
         WHERE lower(TRIM(COALESCE(s.sales_nama,''))) = lower(TRIM(?))
           AND s.status <> 'selesai'
           AND (@tanggal = '' OR s.tanggal = @tanggal)
         ORDER BY s.tanggal DESC, s.id DESC`
      )
      .all({ nama: String(nama || ''), tanggal: String(tanggal || '') }),
  /** Semua surat jalan yang belum selesai (untuk pemilih sumber), beserta total barang dibawanya. */
  sesiSumberSemua: (tanggal) =>
    db
      .prepare(
        `SELECT s.*, (SELECT COALESCE(SUM(i.b),0) FROM sesi_item i WHERE i.sesi_id = s.id) tot_b
         FROM sesi s
         WHERE s.status <> 'selesai' AND (@tanggal = '' OR s.tanggal = @tanggal)
         ORDER BY s.sales_nama ASC, s.tanggal DESC, s.id DESC`
      )
      .all({ tanggal: String(tanggal || '') }),
  sesiStatus: (id, status, kolom) => {
    const allowed = { dikunci_at: 1, rekap_at: 1, selesai_at: 1 };
    const col = allowed[kolom] ? kolom : null;
    if (col) {
      db.prepare(`UPDATE sesi SET status = ?, ${col} = datetime('now','localtime') WHERE id = ?`).run(
        status,
        id
      );
    } else {
      db.prepare(`UPDATE sesi SET status = ? WHERE id = ?`).run(status, id);
    }
  },
  /**
   * UNDO satu langkah status (permintaan user: administrator bisa meng-undo surat jalan).
   *
   * Angka B/T/K/S TIDAK disentuh (permintaan user: "hanya statusnya yang berubah, angka B/T/K/S tetap
   * seperti sekarang") — hanya statusnya yang turun, dan **penanda waktu langkah yang dibatalkan
   * dikosongkan** (`selesai_at` saat selesai→rekap, `rekap_at` saat rekap→kirim, `dikunci_at` saat
   * kirim→draft). Alasannya: `TANGGAL_REKAP` (tanggal acuan laporan & grafik) memakai
   * `COALESCE(selesai_at, rekap_at, tanggal)`, jadi membiarkan cap waktu langkah yang sudah dibatalkan
   * membuat laporan memakai tanggal lama yang menyesatkan.
   */
  sesiUndoStatus: (id, status, kolomHapus) => {
    const allowed = { dikunci_at: 1, rekap_at: 1, selesai_at: 1 };
    const col = allowed[kolomHapus] ? kolomHapus : null;
    if (col) {
      db.prepare(`UPDATE sesi SET status = ?, ${col} = NULL WHERE id = ?`).run(String(status), Number(id));
    } else {
      db.prepare('UPDATE sesi SET status = ? WHERE id = ?').run(String(status), Number(id));
    }
  },
  sesiHapus: (id) => {
    db.prepare('DELETE FROM tambahan_item WHERE batch_id IN (SELECT id FROM tambahan_batch WHERE sesi_id = ?)').run(id);
    db.prepare('DELETE FROM tambahan_batch WHERE sesi_id = ?').run(id);
    db.prepare('DELETE FROM sesi_item WHERE sesi_id = ?').run(id);
    db.prepare('DELETE FROM scan_log WHERE sesi_id = ?').run(id);
    db.prepare('DELETE FROM sesi WHERE id = ?').run(id);
  },
  sesiSetCatatan: (id, catatan) => db.prepare('UPDATE sesi SET catatan = ? WHERE id = ?').run(catatan, id),
  sesiSetRekapOleh: (id, nama) => db.prepare('UPDATE sesi SET rekap_oleh = ? WHERE id = ?').run(String(nama || ''), id),
  /**
   * Simpan nama petugas yang menginput JUMLAH PENJUALAN (kolom P) — dipakai keterangan dokumen laporan
   * ("Penjualan diinput oleh: NAMA", permintaan user). Dipanggil rute `POST /sesi/:id/jual`.
   */
  sesiSetJualOleh: (id, nama) => db.prepare('UPDATE sesi SET jual_oleh = ? WHERE id = ?').run(String(nama || ''), id),

  // ---------- item sesi ----------
  itemBySesi: (sesiId) =>
    db.prepare('SELECT * FROM sesi_item WHERE sesi_id = ? ORDER BY urutan ASC, id ASC').all(sesiId),
  itemById: (id) => db.prepare('SELECT * FROM sesi_item WHERE id = ?').get(id),
  itemSinkron: (sesiId) => {
    // Tambahkan item baru untuk produk aktif yang belum ada di sesi ini (snapshot nama diambil saat itu)
    const rows = db.prepare('SELECT id, kode, nama, merek, urutan FROM produk WHERE aktif = 1').all();
    const ins = db.prepare(
      `INSERT OR IGNORE INTO sesi_item (sesi_id, produk_id, kode, nama, merek, urutan)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction(() => {
      for (const r of rows) ins.run(sesiId, r.id, r.kode, r.nama, r.merek, r.urutan);
    });
    tx();
  },
  itemTambahProduk: (sesiId, produkId) => {
    const p = db.prepare('SELECT * FROM produk WHERE id = ?').get(produkId);
    if (!p) return false;
    db.prepare(
      `INSERT OR IGNORE INTO sesi_item (sesi_id, produk_id, kode, nama, merek, urutan)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sesiId, p.id, p.kode, p.nama, p.merek, p.urutan);
    return true;
  },
  itemSetJumlah: (id, kolom, nilai) => {
    // kolom 's' boleh null -> kembali ke mode otomatis (b + t - k)
    // kolom 'p' = jumlah terjual menurut sales (layar penjualan /sesi/:id/jual)
    const allowed = { b: 1, t: 1, k: 1, s: 1, nb: 1, p: 1 };
    if (!allowed[kolom]) return;
    db.prepare(`UPDATE sesi_item SET ${kolom} = ? WHERE id = ?`).run(nilai, id);
  },
  /**
   * Setel kolom Dibawa (B) satu barang pada perjalanan berdasarkan produk_id — dipakai saat membuat
   * "surat jalan berikutnya" dari halaman rekap (angka kolom B Berikutnya).
   */
  /** Tandai / lepas tanda "barang baru ditambahkan di rekap" untuk satu barang di satu perjalanan. */
  itemSetBaru: (sesiId, produkId, nilai) =>
    db
      .prepare('UPDATE sesi_item SET baru = @nilai WHERE sesi_id = @sesiId AND produk_id = @produkId')
      .run({ sesiId: Number(sesiId), produkId: Number(produkId), nilai: nilai ? 1 : 0 }),
  itemSetBProduk: (sesiId, produkId, qty) =>
    db
      .prepare('UPDATE sesi_item SET b = @qty WHERE sesi_id = @sesiId AND produk_id = @produkId')
      .run({ sesiId: Number(sesiId), produkId: Number(produkId), qty: Math.max(0, Number(qty) || 0) }),
  /**
   * Kurangi kolom Dibawa (B) satu barang pada perjalanan sales lain (permintaan user saat barang
   * "diambil dari sales lain"). Tidak pernah negatif. Hasil `.changes` = 0 berarti barang itu tidak
   * ada di daftar perjalanan tersebut.
   */
  itemKurangiB: (sesiId, produkId, qty) =>
    db
      .prepare('UPDATE sesi_item SET b = MAX(0, b - @qty) WHERE sesi_id = @sesiId AND produk_id = @produkId')
      .run({ sesiId: Number(sesiId), produkId: Number(produkId), qty: Math.max(0, Number(qty) || 0) }),
  /**
   * Tambah kembali kolom Dibawa (B) satu barang — dipakai saat penginputan barang tambahan DIHAPUS
   * administrator (angka yang tadi dipotong dikembalikan; permintaan user).
   */
  itemTambahB: (sesiId, produkId, qty) =>
    db
      .prepare('UPDATE sesi_item SET b = b + @qty WHERE sesi_id = @sesiId AND produk_id = @produkId')
      .run({ sesiId: Number(sesiId), produkId: Number(produkId), qty: Math.max(0, Number(qty) || 0) }),
  itemTotals: (sesiId) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(b),0) b,
                COALESCE(SUM(t),0) t,
                COALESCE(SUM(k),0) k,
                COALESCE(SUM(p),0) p,
                COALESCE(SUM(CASE WHEN s IS NULL THEN max(0, b + t - k) ELSE s END),0) s
         FROM sesi_item WHERE sesi_id = ?`
      )
      .get(sesiId),

  /**
   * REKAP STOK per SALES (permintaan user: "tabelnya salah, seharusnya kolom yang pertama nama barang,
   * … stok di sales … kolom hitung di gudang (dulu 'stok fisik'), stok di aplikasi kledo, terakhir
   * selisih").
   *
   * Mengembalikan SATU BARIS PER (barang × sales) berisi **jumlah yang masih dibawa sales itu**
   * (kolom B + T, tidak dipisah lagi — permintaan user: "cukup satu angka Stok di Sales per sales").
   * Yang dihitung hanya surat jalan yang **BELUM SELESAI** (`status <> 'selesai'`): surat jalan yang
   * sudah selesai berarti barangnya sudah direkap/dikembalikan, jadi bukan lagi stok di sales.
   *
   * Pengelompokan nama sales tanpa membedakan huruf besar/kecil & spasi tepi (`lower(trim(...))`) supaya
   * "Haris" dan "haris " tidak jadi dua kolom; nama yang ditampilkan diambil dari `MIN(...)` di sini, lalu
   * view akan memakai nama baku dari tabel `sales` kalau ada.
   */
  rekapStokSales: () =>
    db
      .prepare(
        `SELECT i.produk_id AS produk_id,
                MIN(TRIM(COALESCE(s.sales_nama, ''))) AS sales,
                SUM(i.b + i.t) AS qty
           FROM sesi_item i
           JOIN sesi s ON s.id = i.sesi_id
          WHERE s.status <> 'selesai'
            AND (i.b + i.t) > 0
          GROUP BY i.produk_id, lower(TRIM(COALESCE(s.sales_nama, '')))`
      )
      .all(),

  /**
   * Pemetaan "barang → siapa saja yang masih membawanya" (permintaan user: di Inventory, nama barang
   * diklik/ditampilkan bersama daftar sales pembawanya). Datanya SAMA dengan Rekap Stok
   * (`rekapStokSales`: hanya surat jalan yang BELUM selesai, jumlah = B + T), dikembalikan sebagai
   * `Map(produkId → [{ sales, qty }])` urut nama sales supaya pemanggil tidak perlu mengelompokkan lagi.
   */
  pemetaanPembawa: () => {
    const peta = new Map();
    db.prepare(
      `SELECT i.produk_id AS produk_id,
              TRIM(COALESCE(s.sales_nama, '')) AS sales,
              SUM(i.b + i.t) AS qty
         FROM sesi_item i
         JOIN sesi s ON s.id = i.sesi_id
        WHERE s.status <> 'selesai'
          AND (i.b + i.t) > 0
        GROUP BY i.produk_id, lower(TRIM(COALESCE(s.sales_nama, '')))`
    )
      .all()
      .forEach((r) => {
        const id = Number(r.produk_id);
        const daftar = peta.get(id) || [];
        daftar.push({ sales: String(r.sales || '').trim(), qty: Number(r.qty) || 0 });
        peta.set(id, daftar);
      });
    peta.forEach((daftar) => daftar.sort((a, b) => String(a.sales).localeCompare(String(b.sales), 'id', { sensitivity: 'base' })));
    return peta;
  },

  // ---------- hasil "Fix" rekap stok ----------
  /**
   * Simpan satu hasil Fix (permintaan user: "ada tombol fix, setelah tekan fix, hasil rekap pindah ke
   * bawah, cetak pdf itu data yang sudah fix"). `selisih` DIHITUNG di server, bukan dikirim browser.
   * Kolomnya bernama `gudang` (dulu `fisik`) — lihat catatan migrasi di `bootstrap()`.
   */
  stokFixTambah: (s) =>
    db
      .prepare(
        `INSERT INTO stok_fix (produk_id, kode, nama, sales_json, total_sales, gudang, kledo, selisih, petugas)
         VALUES (@produk_id, @kode, @nama, @sales_json, @total_sales, @gudang, @kledo, @selisih, @petugas)`
      )
      .run({
        produk_id: Number(s.produk_id) || 0,
        kode: String(s.kode || ''),
        nama: String(s.nama || ''),
        sales_json: String(s.sales_json || ''),
        total_sales: Number(s.total_sales) || 0,
        gudang: Number(s.gudang) || 0,
        kledo: Number(s.kledo) || 0,
        selisih: Number(s.selisih) || 0,
        petugas: String(s.petugas || ''),
      }),
  stokFixById: (id) => db.prepare('SELECT * FROM stok_fix WHERE id = ?').get(Number(id)),
  /**
   * Hasil Fix satu barang — **urut waktu (paling lama di atas)**, bukan terbaru di atas: permintaan user
   * "stok yang sudah fix muncul di bawah, dan ketika memasukkan lagi muncul di bawahnya dst berapa pun
   * banyaknya" → tiap Fix baru MENYUSUL di baris paling bawah daftar.
   */
  stokFixByProduk: (produkId) =>
    db.prepare('SELECT * FROM stok_fix WHERE produk_id = ? ORDER BY id ASC').all(Number(produkId)),
  /** Semua hasil Fix (dipakai PDF "semua barang yang sudah difix") — urut nama, lalu urut waktu. */
  stokFixSemua: () => db.prepare('SELECT * FROM stok_fix ORDER BY nama COLLATE NOCASE ASC, id ASC').all(),
  stokFixHapus: (id) => db.prepare('DELETE FROM stok_fix WHERE id = ?').run(Number(id)),

  // ---------- entri penambahan barang (tambahan_batch) ----------
  tambahanBatchList: (sesiId) =>
    db
      .prepare(
        `SELECT b.*, src.kode_unik kode_sumber, src.tanggal tanggal_sumber,
                (SELECT COALESCE(SUM(qty),0) FROM tambahan_item i WHERE i.batch_id = b.id) total
         FROM tambahan_batch b LEFT JOIN sesi src ON src.id = b.sumber_sesi_id
         WHERE b.sesi_id = ? ORDER BY b.tanggal ASC, b.jam ASC, b.id ASC`
      )
      .all(sesiId),
  tambahanBatchById: (id) =>
    db
      .prepare(
        `SELECT b.*, s.tanggal tanggal_canvasing, s.sales_nama, s.status, s.kode_unik,
                src.kode_unik kode_sumber, src.sales_nama sales_sumber,
                (SELECT COALESCE(SUM(qty),0) FROM tambahan_item i WHERE i.batch_id = b.id) total
         FROM tambahan_batch b JOIN sesi s ON s.id = b.sesi_id
         LEFT JOIN sesi src ON src.id = b.sumber_sesi_id
         WHERE b.id = ?`
      )
      .get(Number(id)),
  tambahanBatchBuat: ({ sesi_id, tanggal, jam, jam_mulai, petugas, sumber, sumber_sesi_id }) =>
    db
      .prepare(
        `INSERT INTO tambahan_batch (sesi_id, tanggal, jam, jam_mulai, jam_akhir, petugas, sumber, sumber_sesi_id, terkunci_at)
         VALUES (@sesi_id, @tanggal, @jam, @jam_mulai, @jam_mulai, @petugas, @sumber, @sumber_sesi_id, datetime('now','localtime'))`
      )
      .run({
        sesi_id,
        tanggal,
        jam,
        jam_mulai,
        petugas: String(petugas || ''),
        sumber: String(sumber || 'gudang') || 'gudang',
        sumber_sesi_id: Number(sumber_sesi_id) || 0,
      }).lastInsertRowid,
  tambahanBatchSentuh: (id, jam) =>
    db.prepare('UPDATE tambahan_batch SET jam_akhir = ? WHERE id = ?').run(String(jam), Number(id)),
  tambahanBatchSetCatatan: (id, baris) =>
    db.prepare('UPDATE tambahan_batch SET catatan_baris = ? WHERE id = ?').run(String(baris || ''), Number(id)),
  /** Catat perjalanan sales yang dikurangi + jumlah yang BENAR-BENAR dikurangi (dipakai catatan otomatis). */
  tambahanBatchSetSumber: (id, sesiId, qty) =>
    db
      .prepare('UPDATE tambahan_batch SET sumber_sesi_id = ?, sumber_qty = ? WHERE id = ?')
      .run(Number(sesiId) || 0, Math.max(0, Number(qty) || 0), Number(id)),
  /**
   * Kunci SEMUA entri di perjalanan ini (permintaan user: "ketika disimpan langsung terkunci").
   * Entri bersifat append-only: setelah tersimpan tidak ada lagi yang bisa diubah.
   */
  tambahanBatchKunciSemua: (sesiId) =>
    db
      .prepare(
        `UPDATE tambahan_batch SET terkunci_at = COALESCE(terkunci_at, datetime('now','localtime'))
         WHERE sesi_id = ?`
      )
      .run(sesiId),
  /**
   * Entri dari perjalanan LAIN yang barangnya diambil untuk perjalanan ini (sumber_sesi_id = perjalanan
   * ini). Dipakai membuat catatan otomatis "… telah diambil barangnya oleh <nama sales> …".
   */
  tambahanBatchDariSesi: (sesiId) =>
    db
      .prepare(
        `SELECT b.*, s.sales_nama pengambil, s.kode_unik kode_pengambil,
                CASE WHEN b.sumber_qty > 0 THEN b.sumber_qty
                     ELSE (SELECT COALESCE(SUM(qty),0) FROM tambahan_item i WHERE i.batch_id = b.id) END total
         FROM tambahan_batch b JOIN sesi s ON s.id = b.sesi_id
         WHERE b.sumber_sesi_id = ? ORDER BY b.tanggal ASC, b.jam ASC, b.id ASC`
      )
      .all(Number(sesiId)),
  /** Rincian (barang qty > 0) SEMUA entri satu perjalanan sekaligus — menghindari query per entri. */
  tambahanItemSemuaSesi: (sesiId) =>
    db
      .prepare(
        `SELECT ti.* FROM tambahan_item ti JOIN tambahan_batch tb ON tb.id = ti.batch_id
         WHERE tb.sesi_id = ? AND ti.qty > 0 ORDER BY ti.id ASC`
      )
      .all(Number(sesiId)),
  /**
   * Rincian barang yang DIAMBIL SALES LAIN dari perjalanan ini (entri milik perjalanan pengambil, tetapi
   * `sumber_sesi_id`-nya = perjalanan ini). Dipakai catatan "telah diambil barangnya oleh …" supaya nama
   * barangnya ikut tercantum — `tambahanItemSemuaSesi()` tidak bisa dipakai karena filternya per
   * `tb.sesi_id` (pemilik entri), bukan perjalanan sumbernya.
   */
  tambahanItemDariSesi: (sesiId) =>
    db
      .prepare(
        `SELECT ti.* FROM tambahan_item ti JOIN tambahan_batch tb ON tb.id = ti.batch_id
         WHERE tb.sumber_sesi_id = ? AND ti.qty > 0 ORDER BY ti.id ASC`
      )
      .all(Number(sesiId)),
  tambahanItemBatch: (batchId) =>
    db
      .prepare('SELECT * FROM tambahan_item WHERE batch_id = ? AND qty > 0 ORDER BY id ASC')
      .all(Number(batchId)),
  tambahanItemBatchSemua: (batchId) =>
    db.prepare('SELECT * FROM tambahan_item WHERE batch_id = ?').all(Number(batchId)),
  /** Isi/ubah jumlah satu barang pada satu entri (qty 0 tetap disimpan supaya jelas "tidak ditambahkan"). */
  tambahanItemSet: (batchId, produkId, kode, nama, qty, kurangiB = 0) =>
    db
      .prepare(
        `INSERT INTO tambahan_item (batch_id, produk_id, kode, nama, qty, kurangi_b) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(batch_id, produk_id) DO UPDATE SET qty = excluded.qty, kode = excluded.kode, nama = excluded.nama,
           kurangi_b = excluded.kurangi_b`
      )
      .run(
        Number(batchId),
        Number(produkId),
        String(kode || ''),
        String(nama || ''),
        Math.max(0, Number(qty) || 0),
        Math.max(0, Number(kurangiB) || 0)
      ),
  /**
   * HAPUS satu penginputan barang tambahan (permintaan user: "Administrator bisa menghapus barang
   * tambahan"). Rincian barangnya dihapus lebih dulu (tidak mengandalkan ON DELETE CASCADE, karena
   * aplikasi ini mematikan `foreign_keys` di beberapa jalur migrasi).
   */
  tambahanBatchHapus: (id) => {
    const bid = Number(id) || 0;
    db.prepare('DELETE FROM tambahan_item WHERE batch_id = ?').run(bid);
    return db.prepare('DELETE FROM tambahan_batch WHERE id = ?').run(bid);
  },
  /** Jumlah per barang dari entri SELAIN `kecualiId` (kolom "sebelumnya" & total entri terkunci). */
  tambahanJumlahPerItem: (sesiId, kecualiId = 0) =>
    db
      .prepare(
        // kolom "Sbl" (jumlah penginputan sebelumnya) juga TIDAK menghitung entri pengembalian ke gudang
        `SELECT ti.produk_id, COALESCE(SUM(ti.qty),0) qty
         FROM tambahan_item ti JOIN tambahan_batch tb ON tb.id = ti.batch_id
         WHERE tb.sesi_id = ? AND tb.id <> ? AND COALESCE(tb.sumber,'') <> 'kembali-gudang'
         GROUP BY ti.produk_id`
      )
      .all(sesiId, Number(kecualiId) || 0),
  /** Jumlah per barang pada SATU entri (dipakai layar input untuk nilai awal). */
  tambahanJumlahBatch: (batchId) =>
    db
      .prepare('SELECT produk_id, qty FROM tambahan_item WHERE batch_id = ?')
      .all(Number(batchId)),
  /**
   * Sinkronkan kolom `sesi_item.t` = AKUMULASI semua entri (permintaan user: "tetap saat di laporan
   * setiap penambahan langsung terakumulasi di kolom T"). Cetak/laporan/rekap tidak perlu diubah.
   */
  tambahanSinkronKeSesi: (sesiId) =>
    db
      .prepare(
        // Entri PENGEMBALIAN KE GUDANG (tb.sumber = 'kembali-gudang') TIDAK menambah kolom T — barangnya
        // justru mengurangi kolom Dibawa (B). Karena itu barisnya dikecualikan dari akumulasi T.
        `UPDATE sesi_item SET t = COALESCE((
           SELECT SUM(ti.qty) FROM tambahan_item ti JOIN tambahan_batch tb ON tb.id = ti.batch_id
           WHERE tb.sesi_id = sesi_item.sesi_id AND ti.produk_id = sesi_item.produk_id
             AND COALESCE(tb.sumber,'') <> 'kembali-gudang'
         ), 0) WHERE sesi_id = ?`
      )
      .run(sesiId),

  // ---------- laporan ----------
  /**
   * Rekap per sales pada rentang tanggal (opsional difilter satu nama sales).
   * S = setoran efektif (manual kalau diisi, kalau tidak B+T-K).
   *
   * TANGGAL ACUAN = **tanggal REKAP** (`date(COALESCE(selesai_at, rekap_at))`), BUKAN tanggal canvasing —
   * permintaan user: "rekap penjualan mengikuti tanggal rekap saat rekap, bukan tanggal canvasing".
   * Aturan ini SAMA dengan `grafikSales()` supaya angka di grafik dan di laporan tidak pernah berbeda.
   */
  laporanSales: (dari, sampai, salesSaja) => {
    const param = {
      dari: dari || '0000-00-00',
      sampai: sampai || '9999-12-31',
      sales: String(salesSaja || '').trim(),
    };
    const kunci = `COALESCE(NULLIF(TRIM(ss.sales_nama), ''), '(tanpa nama)')`;
    const tanggalRekap = TANGGAL_REKAP;   // = date(COALESCE(selesai_at, rekap_at, tanggal))
    const filterSales = (kolom) => (param.sales ? ` AND lower(TRIM(${kolom})) = lower(@sales)` : '');
    const per = db
      .prepare(
        `SELECT ${kunci} sales,
                COUNT(DISTINCT ss.id) perjalanan,
                COALESCE(SUM(it.b),0) b,
                COALESCE(SUM(it.t),0) t,
                COALESCE(SUM(it.k),0) k,
                COALESCE(SUM(CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END),0) s
         FROM sesi ss JOIN sesi_item it ON it.sesi_id = ss.id
         WHERE ss.status IN ('rekap','selesai') AND ${tanggalRekap} BETWEEN @dari AND @sampai${filterSales('ss.sales_nama')}
         GROUP BY sales
         ORDER BY s DESC, sales ASC`
      )
      .all(param);
    const detail = db
      .prepare(
        `SELECT ${kunci} sales,
                ss.id sesi_id, ${tanggalRekap} tanggal_rekap, ss.tanggal, ss.kode_unik, it.kode, it.nama,
                CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END qty
         FROM sesi ss JOIN sesi_item it ON it.sesi_id = ss.id
         WHERE ss.status IN ('rekap','selesai') AND ${tanggalRekap} BETWEEN @dari AND @sampai${filterSales('ss.sales_nama')}
           AND (CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END) > 0
         ORDER BY ss.id DESC, it.urutan ASC, it.id ASC`
      )
      .all(param);
    return per.map((p) => ({
      ...p,
      selisih: p.b + p.t - p.k - p.s,
      detail: detail.filter((d) => d.sales === p.sales),
    }));
  },
  /**
   * Data GRAFIK dasbor: sebuah transaksi dihitung kalau tanggal SELESAI/REKAP-nya ada di rentang
   * (tanggal canvasing ikut dihitung kalau transaksinya MASIH dalam proses rekap/selesai di rentang itu).
   * Permintaan user: "saat transaksi selesai, tidak muncul di laporan dasbor" — dengan begini transaksi
   * yang baru diselesaikan selalu ikut tampil. Sejak revisi ke-65 laporan/rekap memakai aturan TANGGAL
   * REKAP yang sama (`laporanSales`), jadi angka grafik & laporan selalu sinkron.
   */
  grafikSales: (dari, sampai) => {
    const param = { dari: dari || '0000-00-00', sampai: sampai || '9999-12-31' };
    const kunci = `COALESCE(NULLIF(TRIM(ss.sales_nama), ''), '(tanpa nama)')`;
    // TANGGAL ACUAN = tanggal REKAP — sama persis dengan laporanSales() supaya grafik & laporan sinkron
    const rentang = `ss.status IN ('rekap','selesai') AND ${TANGGAL_REKAP} BETWEEN @dari AND @sampai`;
    const sales = db
      .prepare(
        `SELECT ${kunci} sales,
                COUNT(DISTINCT ss.id) perjalanan,
                COALESCE(SUM(it.b),0) b,
                COALESCE(SUM(it.t),0) t,
                COALESCE(SUM(it.k),0) k,
                COALESCE(SUM(CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END),0) s
         FROM sesi ss JOIN sesi_item it ON it.sesi_id = ss.id
         WHERE ${rentang}
         GROUP BY sales
         ORDER BY s DESC, sales ASC`
      )
      .all(param);
    // berapa transaksi yang tanggal CANVASING-nya di luar rentang (direkap pada periode ini)
    const tambahan = db
      .prepare(
        `SELECT COUNT(*) c FROM sesi ss
         WHERE ss.status IN ('rekap','selesai')
           AND ${TANGGAL_REKAP} BETWEEN @dari AND @sampai
           AND NOT (ss.tanggal BETWEEN @dari AND @sampai)`
      )
      .get(param).c;
    return { sales, tambahan };
  },
  /**
   * Data GRAFIK PER HARI (permintaan user): penjualan tiap hari di dalam rentang filter, dipecah per sales
   * supaya warnanya bisa sama dengan grafik per sales. Hari yang dipakai = **tanggal REKAP**
   * (sama dengan `grafikSales()` & `laporanSales()`).
   */
  grafikHarian: (dari, sampai) =>
    db
      .prepare(
        `SELECT hari, sales, SUM(s) s, COUNT(DISTINCT sesi_id) perjalanan FROM (
           SELECT ${TANGGAL_REKAP} hari,
                  ss.id sesi_id,
                  COALESCE(NULLIF(TRIM(ss.sales_nama), ''), '(tanpa nama)') sales,
                  CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END s
           FROM sesi ss JOIN sesi_item it ON it.sesi_id = ss.id
           WHERE ss.status IN ('rekap','selesai') AND ${TANGGAL_REKAP} BETWEEN @dari AND @sampai
         )
         GROUP BY hari, sales
         ORDER BY hari ASC, s DESC, sales ASC`
      )
      .all({ dari: dari || '0000-00-00', sampai: sampai || '9999-12-31' }),

  /**
   * BARANG PALING BANYAK TERJUAL pada rentang (permintaan user: "saat grafik terjual di klik, menampilkan
   * jenis barang dari yang paling banyak terjual hingga paling sedikit, formatnya no, nama barang,
   * jumlah terjual"). Jumlah terjual = setoran efektif per barang (sama dengan angka di laporan/cetak),
   * dikelompokkan per nama barang, urut dari terbesar.
   */
  grafikBarang: (dari, sampai) =>
    db
      .prepare(
        `SELECT it.nama,
                MIN(it.kode) kode,
                SUM(CASE WHEN it.s IS NULL THEN max(0, it.b + it.t - it.k) ELSE it.s END) qty
         FROM sesi ss JOIN sesi_item it ON it.sesi_id = ss.id
         WHERE ss.status IN ('rekap','selesai') AND ${TANGGAL_REKAP} BETWEEN @dari AND @sampai
         GROUP BY it.nama
         HAVING qty > 0
         ORDER BY qty DESC, it.nama ASC`
      )
      .all({ dari: dari || '0000-00-00', sampai: sampai || '9999-12-31' }),

  grafikSalesTotal: (sales) => ({
    perjalanan: sales.reduce((a, r) => a + r.perjalanan, 0),
    b: sales.reduce((a, r) => a + r.b, 0),
    t: sales.reduce((a, r) => a + r.t, 0),
    k: sales.reduce((a, r) => a + r.k, 0),
    s: sales.reduce((a, r) => a + r.s, 0),
  }),

  laporanSalesTotal: (rekap) => ({
    perjalanan: rekap.reduce((a, r) => a + r.perjalanan, 0),
    b: rekap.reduce((a, r) => a + r.b, 0),
    t: rekap.reduce((a, r) => a + r.t, 0),
    k: rekap.reduce((a, r) => a + r.k, 0),
    s: rekap.reduce((a, r) => a + r.s, 0),
    selisih: rekap.reduce((a, r) => a + r.selisih, 0),
  }),

  /**
   * Petugas MENGINPUT (yang merekap) untuk perjalanan dalam satu periode rekap.
   * Dipakai dokumen rekap penjualan per sales yang mencakup BANYAK perjalanan: nama tanda tangan admin
   * hanya ditulis kalau seluruh perjalanan periode itu direkap oleh SATU petugas yang sama — kalau
   * berbeda-beda, garis tanda tangannya dibiarkan kosong untuk diisi tangan. Yang TIDAK boleh: memakai
   * petugas yang sedang login/mencetak (permintaan user: "admin yang mengimput, bukan yang mencetak").
   * Mengembalikan daftar nama unik yang tidak kosong (urut abjad).
   */
  rekapOlehPeriode: (dari, sampai) => {
    const param = { dari: dari || '0000-00-00', sampai: sampai || '9999-12-31' };
    return db
      .prepare(
        `SELECT DISTINCT TRIM(COALESCE(NULLIF(TRIM(ss.rekap_oleh), ''), NULLIF(TRIM(ss.dibuat_oleh), ''))) nama
         FROM sesi ss
         WHERE ss.status IN ('rekap','selesai') AND ${TANGGAL_REKAP} BETWEEN @dari AND @sampai
         ORDER BY nama`
      )
      .all(param)
      .map((r) => r.nama)
      .filter(Boolean);
  },

  sesiSetDibuatOleh: (id, nama) => db.prepare('UPDATE sesi SET dibuat_oleh = ? WHERE id = ?').run(String(nama || ''), id),

  // ---------- pengaturan aplikasi (logo & layout surat) ----------
  pengaturanAll: () => {
    const hasil = {};
    db.prepare('SELECT kunci, nilai FROM pengaturan').all().forEach((r) => { hasil[r.kunci] = r.nilai; });
    return hasil;
  },
  pengaturanSet: (kunci, nilai) =>
    db
      .prepare(
        `INSERT INTO pengaturan (kunci, nilai, diubah_at) VALUES (?, ?, datetime('now','localtime'))
         ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai, diubah_at = excluded.diubah_at`
      )
      .run(String(kunci), String(nilai == null ? '' : nilai)),
  pengaturanHapus: (kunci) => db.prepare('DELETE FROM pengaturan WHERE kunci = ?').run(String(kunci)),

  // ---------- audit ----------
  auditInsert: (a) =>
    db
      .prepare(
        `INSERT INTO audit_log (petugas_id, petugas_nama, peran, aksi, entitas, entitas_id, ringkas, detail)
         VALUES (@petugas_id, @petugas_nama, @peran, @aksi, @entitas, @entitas_id, @ringkas, @detail)`
      )
      .run({
        petugas_id: a.petugas_id === undefined ? null : a.petugas_id,
        petugas_nama: a.petugas_nama || '',
        peran: a.peran || '',
        aksi: a.aksi,
        entitas: a.entitas,
        entitas_id: a.entitas_id === undefined ? null : a.entitas_id,
        ringkas: a.ringkas || '',
        detail: a.detail || '',
      }),
  auditSesi: (sesiId, limit = 300) =>
    db
      .prepare(
        `SELECT * FROM audit_log
         WHERE (entitas = 'sesi' AND entitas_id = ?) OR (entitas = 'item' AND entitas_id = ?)
         ORDER BY id DESC LIMIT ?`
      )
      .all(sesiId, sesiId, limit),
  auditSemua: (limit = 200) => db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit),
  /*
   * Tidak ada pemakainya lagi sejak opsi "Audit" dihapus dari menu baris DASBOR (permintaan user:
   * "Pada dasbor, tombol audit dan edit tidak usah tampilkan di ikon aksi") — route `/` juga tidak lagi
   * memanggilnya. Dibiarkan sebagai helper umum untuk keperluan lain; kalau memang tidak dipakai,
   * jangan dipanggil dari route supaya tidak ada query terbuang setiap dasbor dibuka.
   */
  auditRingkasPerSesi: () =>
    db
      .prepare(
        `SELECT entitas_id, COUNT(*) jml, MAX(waktu) terakhir FROM audit_log
         WHERE entitas IN ('sesi','item') GROUP BY entitas_id`
      )
      .all(),

  // ---------- scan log ----------
  scanInsert: (s) =>
    db
      .prepare(`INSERT INTO scan_log (sesi_id, kode, tahap, hasil) VALUES (@sesi_id, @kode, @tahap, @hasil)`)
      .run(s),
  scanTerakhir: (sesiId, limit = 12) =>
    db.prepare('SELECT * FROM scan_log WHERE sesi_id = ? ORDER BY id DESC LIMIT ?').all(sesiId, limit),
};

module.exports = { db, q, DB_PATH };
