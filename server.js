'use strict';
// Jam dinding toko (permintaan user: "setiap penginputan otomatis tanggal dan jam saat penginputan").
// Server platform berjalan di UTC, jadi tanpa ini jam yang tercatat akan meleset dari jam toko.
// Permintaan user: pakai **WITA** (Asia/Makassar, UTC+8).
// Zona dipakai oleh Node (`new Date()`) DAN SQLite (`datetime('now','localtime')`) — keduanya membaca
// process.env.TZ. Bisa diubah lewat env `SC_TZ` (mis. SC_TZ=Asia/Jakarta) tanpa mengubah kode.
process.env.TZ = process.env.SC_TZ || 'Asia/Makassar';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

const { q } = require('./lib/db');
const {
  esc, rp, angka, tanggalPanjang, tanggalPendek, hariIni, jamSekarang, jamPenanda, sekarang,
  setoranEfektif, susunCatatan, pisahCatatan, barisPengambilan, barisDiambil, barisPengembalian,
  namaAdminSesi,
} = require('./lib/util');
const barcode = require('./lib/barcode');
const { layout, badge } = require('./views/layout');
const vLogin = require('./views/login');
const vPetugas = require('./views/petugas');
const auth = require('./lib/auth');
const vDashboard = require('./views/dashboard');
const vBarang = require('./views/barang');
const vSesi = require('./views/sesi');
const vInput = require('./views/input');
const vRekap = require('./views/rekap');
const vRetur = require('./views/retur');
const vLabel = require('./views/label');
const labelPdf = require('./lib/labelPdf');
const vThermal = require('./views/thermal');
const vLaporan = require('./views/laporan');
const vPrint = require('./views/print');
const vMemo = require('./views/memo');
const { memoEntri } = require('./lib/memoEntri');
const pdfF4 = require('./lib/pdfF4');
const { kodeBaru, noSurat } = require('./lib/kode');
const vSales = require('./views/sales');
const vSetting = require('./views/setting-logo');
const { semua: setelanSemua, simpan: setelanSimpan } = require('./lib/setelan');
/*
 * Pembuat IKON APLIKASI dari logo yang diunggah (ikon di layar utama HP). Dipakai dua tempat:
 * saat administrator mengunggah logo baru (`POST /setting/logo/unggah`) dan saat mengembalikan logo
 * bawaan (`POST /setting/logo/hapus`). Detailnya di `tools/ikon-dari-logo.js`.
 */
const ikonApp = require('./tools/ikon-dari-logo');
const JALUR_SUMBER_LOGO = ikonApp.SUMBER_LOGO;

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const TAHUN_DEFAULT = new Date().getFullYear();

// Base path publik + WAJIB LOGIN (semua halaman terkunci sampai petugas login)
app.use(auth.middleware);

/** Pembungkus layout: otomatis mengirim petugas yang login + hak ubah (untuk menu kotak) ke topbar. */
const H = (req, opsi) =>
  layout({ bolehUbah: auth.bolehUbah(req), setelan: setelanSemua(), ...opsi, petugas: req.petugas });
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));
/*
 * Berkas "pasang aplikasi di HP" (PWA): manifest, service worker, dan ikon.
 * Service worker + manifest TIDAK boleh di-cache lama oleh browser — kalau tidak, pengguna yang
 * sudah memasang aplikasi bisa terus memakai service worker versi lama dan tidak menerima pembaruan.
 */
app.use(['/sw.js', '/manifest.webmanifest'], (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.locals.layout = layout;
app.locals.badge = badge;

// ---------------------------------------------------------------- helper
function balik(req, res, target, pesan) {
  const u = req.BASE + target + (pesan ? (target.includes('?') ? '&' : '?') + 'pesan=' + encodeURIComponent(pesan) : '');
  res.redirect(u);
}

function ambilSesi(req, res) {
  const id = Number(req.params.id);
  const sesi = q.sesiById(id);
  if (!sesi) {
    res.status(404).send(H(req, { judul: 'Tidak ditemukan', base: req.BASE, isi: `<div class="card"><h1>Perjalanan tidak ditemukan</h1><p class="card-hint">Data yang Anda cari sudah dihapus atau belum pernah dibuat.</p><a class="btn btn-primary" href="${req.BASE}/">Kembali ke Dashboard</a></div>` }));
    return null;
  }
  q.itemSinkron(id);
  return sesi;
}

/** Hanya administrator. */
function hanyaAdmin(req, res, target = '/', pesan = 'Hanya administrator yang boleh melakukan ini') {
  if (auth.admin(req)) return true;
  balik(req, res, target, pesan);
  return false;
}

/** Sales hanya boleh melihat data (read-only). */
function bolehUbahAtau(req, res, target = '/') {
  if (auth.bolehUbah(req)) return true;
  balik(req, res, target, 'Peran ' + auth.peranInfo(req.petugas && req.petugas.peran).label + ' hanya bisa melihat data');
  return false;
}

/** Semua request yang mengubah data ditolak untuk peran Sales. */
const JALUR_BEBAS_UBAH = ['/login', '/logout'];
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (JALUR_BEBAS_UBAH.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
  if (!req.petugas) return res.status(401).json({ ok: false, pesan: 'Belum login' });
  if (auth.bolehUbah(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ ok: false, pesan: 'Peran Sales hanya bisa melihat data' });
  return balik(req, res, '/', 'Peran Sales hanya bisa melihat data — perubahan tidak diizinkan');
});

/** Simpan catatan audit (siapa, kapan, apa yang diubah). */
function audit(req, aksi, entitas, entitasId, ringkas, detail) {
  q.auditInsert({
    petugas_id: req.petugas ? req.petugas.id : null,
    petugas_nama: req.petugas ? req.petugas.nama : '(tanpa login)',
    peran: req.petugas ? req.petugas.peran : '',
    aksi,
    entitas,
    entitas_id: entitasId,
    ringkas: ringkas || '',
    detail: detail ? JSON.stringify(detail) : '',
  });
}

/** Bandingkan daftar item sebelum & sesudah; hasilkan detail perubahan per barang. */
function bedaItem(sebelum, sesudah) {
  const lama = new Map(sebelum.map((i) => [i.id, i]));
  const hasil = [];
  sesudah.forEach((baru) => {
    const old = lama.get(baru.id);
    if (!old) return;
    ['b', 't', 'k'].forEach((kol) => {
      const a = Number(old[kol]) || 0;
      const b = Number(baru[kol]) || 0;
      if (a !== b) hasil.push({ nama: baru.nama, kolom: kol.toUpperCase(), sebelum: a, sesudah: b });
    });
    const sLama = old.s === null || old.s === undefined ? null : Number(old.s);
    const sBaru = baru.s === null || baru.s === undefined ? null : Number(baru.s);
    if (sLama !== sBaru) hasil.push({ nama: baru.nama, kolom: 'S', sebelum: sLama === null ? 'otomatis' : sLama, sesudah: sBaru === null ? 'otomatis' : sBaru });
  });
  return hasil;
}

const boleB = (s) => s.status === 'draft';
const boleT = (s) => s.status === 'kirim' || s.status === 'rekap';
const boleKS = (s) => s.status === 'rekap';
const terkunci = (s) => s.status === 'selesai';

// ---------------------------------------------------------------- login & petugas
app.get('/login', (req, res) => {
  if (req.petugas) return balik(req, res, '/', `Sudah masuk sebagai ${req.petugas.nama}`);
  res.send(
    vLogin.render({
      base: req.BASE,
      pesan: req.query.pesan,
      daftar: q.petugasAll(),
      next: String(req.query.next || ''),
      setelan: setelanSemua(),
    })
  );
});

app.post('/login', (req, res) => {
  const p = q.petugasById(Number(req.body.petugas_id));
  const pin = String(req.body.pin || '');
  if (!p || !p.aktif) return balik(req, res, '/login', 'Pilih nama petugas dulu');
  if (!auth.pinSah(pin) || !auth.pinCocok(p, pin)) return balik(req, res, '/login', 'PIN salah — coba lagi');
  q.loginBersih();
  auth.kirimCookie(res, req, auth.buatLogin(p.id));
  const tujuan = String(req.body.next || '');
  res.redirect(req.BASE + (tujuan.startsWith('/') && !tujuan.startsWith('//') ? tujuan : '/'));
});

app.post('/login/petugas-pertama', (req, res) => {
  if (q.petugasCount() > 0) return balik(req, res, '/login', 'Petugas sudah ada — silakan masuk');
  const nama = String(req.body.nama || '').trim();
  const pin = String(req.body.pin || '');
  const pin2 = String(req.body.pin2 || '');
  if (!nama) return balik(req, res, '/login', 'Nama petugas wajib diisi');
  if (!auth.pinSah(pin)) return balik(req, res, '/login', 'PIN harus 4–8 angka');
  if (pin !== pin2) return balik(req, res, '/login', 'Ulangi PIN tidak sama');
  if (q.petugasByNama(nama)) return balik(req, res, '/login', 'Nama petugas sudah ada — silakan masuk');
  const id = auth.buatPetugas(nama, pin);
  q.petugasSetPeran(id, 'administrator');
  auth.kirimCookie(res, req, auth.buatLogin(id));
  q.auditInsert({ petugas_id: id, petugas_nama: nama, peran: 'administrator', aksi: 'petugas-baru', entitas: 'petugas', entitas_id: id, ringkas: `${nama} dibuat sebagai Administrator (petugas pertama)` });
  balik(req, res, '/', `Petugas pertama dibuat sebagai Administrator — selamat bekerja, ${nama}`);
});

app.get('/logout', (req, res) => {
  const token = auth.bacaCookie(req, auth.COOKIE);
  if (token) q.loginHapus(token);
  auth.hapusCookie(res, req);
  res.redirect(req.BASE + '/login?pesan=' + encodeURIComponent('Kamu sudah keluar dari aplikasi'));
});

app.get('/petugas', (req, res) => {
  res.send(
    H(req, {
      judul: 'Petugas',
      aktif: '/petugas',
      base: req.BASE,
      isi: vPetugas.render({
        daftar: q.petugasAll(),
        base: req.BASE,
        pesan: req.query.pesan,
        petugas: req.petugas,
        bolehKelola: auth.admin(req),
        peranInfo: auth.peranInfo,
      }),
    })
  );
});

app.post('/petugas/tambah', (req, res) => {
  if (!hanyaAdmin(req, res, '/petugas', 'Hanya administrator yang boleh menambah petugas')) return;
  const nama = String(req.body.nama || '').trim();
  const pin = String(req.body.pin || '');
  const peran = auth.PERAN[req.body.peran] ? req.body.peran : 'admin_gudang';
  if (!nama) return balik(req, res, '/petugas', 'Nama petugas wajib diisi');
  if (!auth.pinSah(pin)) return balik(req, res, '/petugas', 'PIN harus 4–8 angka');
  if (q.petugasByNama(nama)) return balik(req, res, '/petugas', 'Nama petugas sudah ada');
  const id = auth.buatPetugas(nama, pin);
  q.petugasSetPeran(id, peran);
  audit(req, 'petugas-baru', 'petugas', id, `${nama} ditambahkan sebagai ${auth.peranInfo(peran).label}`);
  balik(req, res, '/petugas', `Petugas ${nama} ditambahkan sebagai ${auth.peranInfo(peran).label}`);
});

app.post('/petugas/:id/peran', (req, res) => {
  const id = Number(req.params.id);
  if (!hanyaAdmin(req, res, '/petugas', 'Hanya administrator yang boleh mengubah peran')) return;
  const p = q.petugasById(id);
  const peran = auth.PERAN[req.body.peran] ? req.body.peran : '';
  if (!p || !peran) return balik(req, res, '/petugas', 'Peran tidak dikenal');
  if (p.peran === 'administrator' && peran !== 'administrator' && q.petugasJumlahPeran('administrator') <= 1) {
    return balik(req, res, '/petugas', 'Administrator terakhir tidak bisa diturunkan perannya');
  }
  q.petugasSetPeran(id, peran);
  audit(req, 'peran-diubah', 'petugas', id, `${p.nama}: ${auth.peranInfo(p.peran).label} → ${auth.peranInfo(peran).label}`);
  balik(req, res, '/petugas', `Peran ${p.nama} diubah menjadi ${auth.peranInfo(peran).label}`);
});

app.post('/petugas/:id/pin', (req, res) => {
  const id = Number(req.params.id);
  const p = q.petugasById(id);
  const pin = String(req.body.pin || '');
  if (!p) return balik(req, res, '/petugas', 'Petugas tidak ditemukan');
  const sendiri = req.petugas && req.petugas.id === id;
  if (!sendiri && !hanyaAdmin(req, res, '/petugas', 'Hanya administrator yang boleh mengganti PIN petugas lain')) return;
  if (!auth.pinSah(pin)) return balik(req, res, '/petugas', 'PIN harus 4–8 angka');
  auth.gantiPin(id, pin);
  q.loginHapusPetugas(id);
  audit(req, 'pin-diubah', 'petugas', id, `PIN ${p.nama} diganti`);
  if (req.petugas && req.petugas.id === id) {
    auth.hapusCookie(res, req);
    return balik(req, res, '/login', 'PIN diganti — silakan masuk lagi dengan PIN baru');
  }
  balik(req, res, '/petugas', `PIN petugas ${p.nama} diganti`);
});

app.post('/petugas/:id/hapus', (req, res) => {
  if (!hanyaAdmin(req, res, '/petugas', 'Hanya administrator yang boleh menghapus petugas')) return;
  const id = Number(req.params.id);
  const p = q.petugasById(id);
  if (!p) return balik(req, res, '/petugas', 'Petugas tidak ditemukan');
  if (q.petugasCount() <= 1) return balik(req, res, '/petugas', 'Petugas terakhir tidak bisa dihapus');
  if (p.peran === 'administrator' && q.petugasJumlahPeran('administrator') <= 1) {
    return balik(req, res, '/petugas', 'Administrator terakhir tidak bisa dihapus');
  }
  q.petugasHapus(id);
  q.loginHapusPetugas(id);
  audit(req, 'petugas-dihapus', 'petugas', id, `${p.nama} (${auth.peranInfo(p.peran).label}) dihapus`);
  if (req.petugas && req.petugas.id === id) {
    auth.hapusCookie(res, req);
    return balik(req, res, '/login', 'Petugas kamu dihapus — silakan masuk dengan petugas lain');
  }
  balik(req, res, '/petugas', `Petugas ${p.nama} dihapus`);
});

// ---------------------------------------------------------------- dashboard
/*
 * HAPUS OTOMATIS TRANSAKSI KOSONG (permintaan user) — transaksi draft yang belum diisi barang apa pun
 * (B+T+K = 0) dan sudah berumur > 30 menit dihapus sendiri. Dijalankan saat dasbor dibuka dan saat
 * transaksi baru dibuat. Umur 30 menit jadi pengaman: transaksi yang baru dibuat (layar input masih
 * dibuka pengguna) tidak ikut terhapus.
 */
const MENIT_DRAFT_KOSONG = 30;
function hapusDraftKosong(req) {
  const daftar = q.draftKosong(MENIT_DRAFT_KOSONG);
  daftar.forEach((s) => q.sesiHapus(s.id));
  if (daftar.length) {
    audit(
      req,
      'draft-kosong-dihapus',
      'sesi',
      0,
      `${daftar.length} transaksi kosong dihapus otomatis (belum diisi barang > ${MENIT_DRAFT_KOSONG} menit)`,
      daftar.map((s) => ({ kolom: 'Transaksi', sesudah: `${noSurat(s)} · ${s.sales_nama || '-'} · dibuat ${s.created_at}` }))
    );
  }
  return daftar.length;
}

app.get('/', (req, res) => {
  hapusDraftKosong(req);   // bersihkan transaksi kosong setiap kali dasbor dibuka (permintaan user)
  const daftar = q.sesiAll();
  /*
   * Catatan: ringkasan jumlah audit per perjalanan TIDAK lagi diambil di sini — opsi "Audit" sudah
   * dihapus dari menu baris dasbor (permintaan user: "tombol audit dan edit tidak usah tampilkan di
   * ikon aksi"), jadi query-nya tidak terpakai lagi. Halaman Audit tetap ada di halaman perjalanan.
   */
  res.send(
    H(req, {
      judul: 'Dasbor',
      aktif: '/',
      base: req.BASE,
      isi: vDashboard.render({
        daftar,
        base: req.BASE,
        pesan: req.query.pesan,
        bolehUbah: auth.bolehUbah(req),
        bolehHapus: auth.admin(req),
        // opsi "Buka/Lanjutkan perjalanan" di menu baris dasbor: administrator & admin gudang saja
        // (permintaan user revisi ke-140) — sales tidak. `auth.bolehUbah` = semua peran kecuali sales.
        bolehBuka: auth.bolehUbah(req),
      }),
    })
  );
});

// ---------------------------------------------------------------- laporan
app.get('/laporan', (req, res) => {
  res.send(
    H(req, {
      judul: 'Laporan',
      aktif: '/laporan',
      base: req.BASE,
      isi: vLaporan.hub({
        base: req.BASE,
        pesan: req.query.pesan,
        daftar: q.sesiAll(),
        jumlahBarang: q.produkCount(),
        jumlahSales: q.salesAll().length,
        daftarSales: q.salesAll(),
        bolehUbah: auth.bolehUbah(req),
        bolehHapus: auth.admin(req),   // opsi hapus laporan hanya administrator
      }),
    })
  );
});

app.get('/laporan/sales', (req, res) => {
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dari || '')) ? String(req.query.dari) : '';
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.sampai || '')) ? String(req.query.sampai) : '';
  const sales = String(req.query.sales || '').trim().slice(0, 60);
  const rekap = q.laporanSales(dari, sampai, sales);
  const v = vLaporan.sales({
    base: req.BASE,
    pesan: req.query.pesan,
    dari,
    sampai,
    sales,
    daftarSales: q.salesAll(),
    rekap,
    total: q.laporanSalesTotal(rekap),
  });
  res.send(H(req, { judul: 'Laporan Penjualan', aktif: '/laporan', base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

// ---------------------------------------------------------------- sales
app.get('/sales', (req, res) => {
  /*
   * Permintaan user (revisi ke-139): mengelola nama sales = hak ADMINISTRATOR. Halamannya tetap bisa
   * dibuka siapa pun yang punya alamatnya (hanya-baca untuk peran lain), jadi form tambah & tombol hapus
   * dirender hanya untuk administrator — bukan lagi `bolehUbah` (yang juga benar untuk admin gudang).
   */
  res.send(
    H(req, {
      judul: 'Sales',
      aktif: '/sales',
      base: req.BASE,
      isi: vSales.render({ daftar: q.salesAll(), base: req.BASE, pesan: req.query.pesan, bolehUbah: auth.admin(req) }),
    })
  );
});

app.post('/sales/tambah', (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh menambah nama sales')) return;
  const nama = String(req.body.nama || '').trim();
  if (nama) q.salesTambah(nama);
  balik(req, res, '/sales', 'Nama sales ditambahkan');
});

app.post('/sales/:id/hapus', (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh menghapus nama sales')) return;
  q.salesHapus(Number(req.params.id));
  balik(req, res, '/sales', 'Nama sales dihapus');
});

// ---------------------------------------------------------------- master barang
app.get('/barang', (req, res) => {
  const cari = String(req.query.q || '').trim();
  const tampilArsip = String(req.query.arsip || '') === '1';   // tombol "Barang diarsip"

  res.send(
    H(req, {
      judul: 'Inventory',
      aktif: '/barang',
      base: req.BASE,
      isi: vBarang.daftar({
        daftar: q.produkAll(cari, false, tampilArsip),
        cari,
        base: req.BASE,
        pesan: req.query.pesan,
        jumlahSemua: q.produkAll('', false, true).length,
        bolehUbah: auth.bolehUbah(req),
        tampilArsip,
        jumlahArsip: q.produkArsipJumlah(),
        dipakai: q.produkDipakai(),
      }),
    })
  );
});

app.get('/barang/baru', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  const edit = req.query.id ? q.produkById(Number(req.query.id)) : null;
  res.send(H(req, {
    judul: edit ? 'Ubah Barang' : 'Barang Baru',
    aktif: '/barang',
    base: req.BASE,
    isi: vBarang.form({ edit, base: req.BASE, kodeBerikut: bikinKode() }),
  }));
});

// --- edit barang keseluruhan (permintaan user)
app.get('/barang/edit', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  res.send(H(req, {
    judul: 'Edit Barang',
    aktif: '/barang',
    base: req.BASE,
    isi: vBarang.editSemua({ daftar: q.produkAll(''), base: req.BASE, pesan: req.query.pesan, dipakai: q.produkDipakai() }),
  }));
});

app.post('/barang/edit', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  /*
   * PENTING (pernah bikin "Internal Server Error"): daftar barang yang DIEDIT hanya barang yang tidak
   * diarsipkan (`q.produkAll('')` menyembunyikan `arsip = 1`), TETAPI kolom `produk.kode` UNIQUE untuk
   * SEMUA baris. Barang yang diarsipkan tetap memegang kodenya (di produksi: SKU-014, SKU-032, SKU-042),
   * sehingga penomoran ulang 001…N pasti menabrak salah satunya → `SqliteError: UNIQUE constraint failed`
   * (HTTP 500). Karena itu:
   *   - penomoran ulang memakai `semuaLengkap` (TERMASUK arsip) di dua tahap, dan
   *   - pemeriksaan kode ganda ikut memperhitungkan kode barang di luar payload (barang arsip).
   */
  const semua = q.produkAll('');                              // yang tampil/diedit (tanpa arsip)
  const semuaLengkap = q.produkAll('', false, true);           // termasuk arsip — untuk keperluan kode
  const aksi = String(req.body._aksi || 'simpan');

  if (aksi === 'sku') {
    // susun ulang semua kode berurutan SKU-001, SKU-002, … mengikuti urutan daftar
    // (yang tampil lebih dulu, barang arsip menyusul di belakang supaya nomor barang aktif tetap rapi)
    const sebelum = semuaLengkap.map((p) => `${p.kode}·${p.nama}`).join(', ');
    const tmp = prefiksSementara(semuaLengkap);
    try {
      const jalanSku = db().transaction(() => {
        // dua tahap: kode ditampung dulu (kolom kode UNIQUE, jadi tidak boleh tabrakan di tengah jalan)
        semuaLengkap.forEach((p) => {
          db().prepare('UPDATE produk SET kode = ? WHERE id = ?').run(tmp + p.id, p.id);
        });
        semuaLengkap.forEach((p, i) => {
          db().prepare('UPDATE produk SET kode = ? WHERE id = ?').run(kodeSku(i + 1), p.id);
        });
      });
      jalanSku();
    } catch (e) {
      return balik(req, res, '/barang/edit', 'Kode barang gagal disusun ulang: ' + (e && e.message ? e.message : 'kesalahan tidak diketahui'));
    }
    const sesudah = q.produkAll('').map((p) => p.kode).slice(0, 5).join(', ') + '…';
    const jmlArsip = semuaLengkap.length - semua.length;
    audit(req, 'barang-sku', 'produk', null, `Kode ${semuaLengkap.length} barang disusun ulang jadi SKU-001…${jmlArsip ? ` (termasuk ${jmlArsip} barang arsip)` : ''}`, [
      { kolom: 'Contoh sebelum', sebelum: sebelum.slice(0, 120), sesudah },
    ]);
    return balik(
      req,
      res,
      '/barang/edit',
      `Kode ${semuaLengkap.length} barang disusun ulang jadi SKU-001…${kodeSku(Math.max(1, semuaLengkap.length))}${jmlArsip ? ` (termasuk ${jmlArsip} barang arsip yang tetap memegang kodenya)` : ''}`
    );
  }

  // Barang bertanda: yang sudah ada transaksi DIARSIPKAN, yang belum ada transaksi DIHAPUS (permintaan user)
  const ditandai = semua.filter((p) => req.body['hapus_' + p.id] === '1' || req.body['arsip_' + p.id] === '1');
  const keArsip = ditandai.filter((p) => q.produkPunyaTransaksi(p.id));
  const dihapus = ditandai.filter((p) => !q.produkPunyaTransaksi(p.id));
  const tersisa = semua.filter((p) => !ditandai.some((d) => d.id === p.id));
  if (ditandai.length) {
    const jalanBuang = db().transaction(() => {
      for (const p of keArsip) q.produkSetArsip(p.id, 1);
      for (const p of dihapus) q.produkHapus(p.id);
    });
    jalanBuang();
    if (keArsip.length) audit(req, 'barang-diarsip-massal', 'produk', null, `${keArsip.length} barang diarsipkan dari halaman Edit Barang`, keArsip.map((p) => ({ nama: p.nama, kolom: 'Diarsipkan', sebelum: `${p.kode} · ${p.nama}`, sesudah: 'diarsipkan' })));
    if (dihapus.length) audit(req, 'barang-dihapus-massal', 'produk', null, `${dihapus.length} barang dihapus dari halaman Edit Barang`, dihapus.map((p) => ({ nama: p.nama, kolom: 'Dihapus', sebelum: `${p.kode} · ${p.nama}`, sesudah: 'terhapus' })));
  }

  // simpan semua perubahan; kode duplikat ditolak sebelum menyimpan apa pun
  const baru = tersisa.map((p) => ({
    id: p.id,
    kode: String(req.body['kode_' + p.id] || '').trim().toUpperCase().replace(/\s+/g, '-') || p.kode,
    nama: String(req.body['nama_' + p.id] || '').trim() || p.nama,
    aktif: Number(p.aktif),   // status "masuk canvasing" tidak diubah dari halaman ini
  }));
  /*
   * Kode yang MASIH TERPAKAI oleh baris di luar payload = barang yang sudah diarsipkan (tidak
   * ditampilkan di halaman ini) + barang yang baru saja diarsipkan pada aksi ini. Kalau tidak
   * diperhitungkan, mengetik kode yang sama dengan barang arsip akan gagal di tengah UPDATE
   * (`UNIQUE constraint failed`) dan pengguna cuma melihat "Internal Server Error".
   */
  const ditandaiIds = new Set(ditandai.map((p) => p.id));
  const kodeTerpakai = new Set(
    semuaLengkap
      .filter((p) => Number(p.arsip) === 1 && !ditandaiIds.has(p.id))
      .map((p) => String(p.kode || '').trim().toUpperCase())
  );
  keArsip.forEach((p) => kodeTerpakai.add(String(p.kode || '').trim().toUpperCase()));

  const dipakaiKode = new Set();
  const ganda = baru.filter((x) => {
    if (dipakaiKode.has(x.kode) || kodeTerpakai.has(x.kode)) return true;
    dipakaiKode.add(x.kode);
    return false;
  });
  if (ganda.length) {
    return balik(req, res, '/barang/edit', `Kode ganda: ${ganda.map((x) => x.kode).join(', ')} — kode itu masih dipakai barang lain (termasuk barang yang diarsipkan). Perbaiki dulu`);
  }

  const beda = [];
  const jalan = db().transaction(() => {
    for (const x of baru) {
      const lama = tersisa.find((p) => p.id === x.id);
      if (!lama) continue;
      if (lama.kode !== x.kode) beda.push({ nama: x.nama, kolom: 'Kode', sebelum: lama.kode, sesudah: x.kode });
      if (lama.nama !== x.nama) beda.push({ nama: x.kode, kolom: 'Nama', sebelum: lama.nama, sesudah: x.nama });
      db().prepare('UPDATE produk SET kode = ?, nama = ?, aktif = ? WHERE id = ?').run(x.kode, x.nama, x.aktif, x.id);
    }
  });
  try {
    jalan();
  } catch (e) {
    return balik(req, res, '/barang/edit', 'Perubahan gagal disimpan: ' + (e && e.message ? e.message : 'kesalahan tidak diketahui'));
  }
  if (beda.length) audit(req, 'barang-edit-massal', 'produk', null, `${beda.length} perubahan pada ${baru.length} barang disimpan sekaligus`, beda.slice(0, 60));
  const pesan = [
    beda.length ? `${beda.length} perubahan disimpan` : '',
    dihapus.length ? `${dihapus.length} barang dihapus` : '',
    keArsip.length ? `${keArsip.length} barang diarsipkan (sudah ada transaksi)` : '',
  ].filter(Boolean).join(' · ');
  balik(req, res, '/barang/edit', pesan || 'Tidak ada perubahan');
});

app.post('/barang/simpan', (req, res) => {
  const b = req.body;
  let kode = String(b.kode || '').trim().toUpperCase().replace(/\s+/g, '-');
  const nama = String(b.nama || '').trim();
  if (!nama) return balik(req, res, '/barang', 'Nama barang wajib diisi');
  if (!kode) kode = bikinKode();
  const data = { kode, nama, aktif: b.aktif === '0' ? 0 : 1 };
  const lamaBarang = b.id ? q.produkById(Number(b.id)) : null;
  try {
    if (b.id) {
      const bentrok = q.produkByKode(kode);
      if (bentrok && bentrok.id !== Number(b.id)) throw new Error('kode dipakai');
      db().prepare('UPDATE produk SET kode = ?, nama = ?, aktif = ? WHERE id = ?').run(kode, nama, data.aktif, Number(b.id));
    } else {
      db().prepare(
        `INSERT INTO produk (kode, nama, aktif, urutan, created_at)
         VALUES (?, ?, ?, ?, datetime('now','localtime'))`
      ).run(kode, nama, data.aktif, q.urutanMax() + 1);
    }
  } catch (e) {
    return balik(req, res, '/barang', 'Kode barang sudah dipakai barang lain');
  }
  if (lamaBarang) {
    const beda = [];
    if (lamaBarang.kode !== kode) beda.push({ kolom: 'Kode', sebelum: lamaBarang.kode, sesudah: kode });
    if (lamaBarang.nama !== nama) beda.push({ kolom: 'Nama', sebelum: lamaBarang.nama, sesudah: nama });
    if (Number(lamaBarang.aktif) !== Number(data.aktif)) beda.push({ kolom: 'Masuk daftar canvasing', sebelum: Number(lamaBarang.aktif) ? 'ya' : 'tidak', sesudah: Number(data.aktif) ? 'ya' : 'tidak' });
    if (beda.length) audit(req, 'barang-diubah', 'produk', lamaBarang.id, `Barang ${nama} diubah`, beda);
  } else {
    const baru = q.produkByKode(kode);
    audit(req, 'barang-baru', 'produk', baru ? baru.id : null, `Barang baru: ${kode} · ${nama}`, [{ kolom: 'Nama', sesudah: nama }]);
  }
  balik(req, res, '/barang', 'Barang disimpan');
});

app.post('/barang/:id/hapus', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  const id = Number(req.params.id);
  const p = q.produkById(id);
  if (!p) return balik(req, res, '/barang', 'Barang tidak ditemukan');
  // permintaan user: barang yang sudah punya transaksi TIDAK dihapus, tapi diarsipkan
  if (q.produkPunyaTransaksi(id)) {
    q.produkSetArsip(id, 1);
    audit(req, 'barang-diarsip', 'produk', id, `Barang ${p.kode} · ${p.nama} diarsipkan (sudah ada transaksi)`);
    return balik(req, res, '/barang', `${p.nama} sudah ada transaksi — diarsipkan, bukan dihapus`);
  }
  q.produkHapus(id);
  audit(req, 'barang-dihapus', 'produk', id, `Barang ${p.kode} · ${p.nama} dihapus (belum ada transaksi)`);
  balik(req, res, '/barang', 'Barang dihapus');
});

// --- arsip barang: simpan/keluarkan dari arsip
app.post('/barang/:id/arsip', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  const id = Number(req.params.id);
  const p = q.produkById(id);
  if (!p) return balik(req, res, '/barang', 'Barang tidak ditemukan');
  const jadiArsip = String(req.body.arsip || '1') !== '0';
  if (jadiArsip && !q.produkPunyaTransaksi(id)) {
    // belum ada transaksi → biarkan user memutuskan hapus permanen lewat tombol Hapus
    return balik(req, res, '/barang', `${p.nama} belum ada transaksi — bisa langsung dihapus`);
  }
  q.produkSetArsip(id, jadiArsip ? 1 : 0);
  audit(req, jadiArsip ? 'barang-diarsip' : 'barang-keluar-arsip', 'produk', id,
    `Barang ${p.kode} · ${p.nama} ${jadiArsip ? 'diarsipkan' : 'dikeluarkan dari arsip'}`);
  const ke = String(req.body.balik || '') || '';
  balik(req, res, ke === 'edit' ? '/barang/edit' : (jadiArsip ? '/barang' : '/barang?arsip=1'),
    jadiArsip ? `${p.nama} diarsipkan` : `${p.nama} kembali ke daftar aktif`);
});

/**
 * Format kode barang: **SKU-000** (SKU + tiga digit, permintaan user).
 * Nomor diambil dari urutan terbesar yang sudah dipakai supaya tidak bertabrakan.
 */
function kodeSku(nomor) {
  return 'SKU-' + String(nomor).padStart(3, '0');
}

/** Nomor SKU berikutnya (maksimal nomor yang sudah terpakai + 1). */
function nomorSkuBerikut() {
  let maks = 0;
  for (const p of q.produkAll('')) {
    const m = /^SKU-?0*(\d+)$/i.exec(String(p.kode || '').trim());
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return maks + 1;
}

/** Kode SKU baru yang belum dipakai. */
function bikinKode() {
  let n = nomorSkuBerikut();
  let kode = kodeSku(n);
  while (q.produkByKode(kode)) {
    n += 1;
    kode = kodeSku(n);
  }
  return kode;
}

/**
 * Prefiks sementara untuk penomoran ulang kode barang (penampung dua tahap).
 * `TMP-<id>` dipakai kalau belum ada kode yang berawalan itu; kalau ada (pengguna iseng pernah
 * mengetik "TMP-12"), prefiksnya digeser supaya tidak ada tabrakan UNIQUE di tengah proses.
 */
function prefiksSementara(daftar) {
  const dipakai = new Set(daftar.map((p) => String(p.kode || '').trim().toUpperCase()));
  const calon = ['TMP-', 'TMPX-', 'TMPZ-', 'SEMENTARA-'];
  for (const p of calon) {
    if (!Array.from(dipakai).some((k) => k.startsWith(p))) return p;
  }
  return 'TMP' + Date.now() + '-';
}

// ---------------------------------------------------------------- impor Excel
const CONTOH_IMPOR = [
  ['KODE', 'NAMA PRODUK'],
  ['PRADA-H503-SYMBOL', 'Prada H503 Symbol'],
  ['OAKLEY-HOLBROK', 'Oakley Holbrok'],
  ['RAYBAN-H511', 'Rayban H511'],
];

app.get('/impor/template.xlsx', (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet(CONTOH_IMPOR);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'MASTER BARANG');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set('Content-disposition', 'attachment; filename="template-master-barang.xlsx"');
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
});

app.get('/impor/template.csv', (req, res) => {
  const teks = CONTOH_IMPOR.map((r) => r.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')).join('\n');
  res.set('Content-disposition', 'attachment; filename="template-master-barang.csv"');
  res.type('text/csv; charset=utf-8').send('\ufeff' + teks);
});

app.get('/impor', (req, res) => {
  if (!auth.bolehUbah(req)) return balik(req, res, '/barang', 'Peran ini hanya bisa melihat data');
  const v = vBarang.impor({ base: req.BASE, pesan: req.query.pesan });
  res.send(H(req, { judul: 'Impor Excel', aktif: '/impor', base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

app.post('/api/impor/parse', upload.single('berkas'), (req, res) => {
  try {
    if (!req.file) return res.json({ ok: false, pesan: 'Berkas belum dipilih' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true, raw: false });
    const namaSheet = req.body.sheet && wb.SheetNames.includes(req.body.sheet) ? req.body.sheet : wb.SheetNames[0];
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[namaSheet], { header: 1, defval: '', blankrows: false });
    const bersih = grid.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
    const barisIsi = bersih.filter((r) => r.some((c) => c !== ''));
    if (!barisIsi.length) return res.json({ ok: false, pesan: 'Sheet kosong / tidak ada data terbaca' });
    const headers = barisIsi[0];
    const rows = barisIsi.slice(1);
    res.json({ ok: true, sheet: namaSheet, sheets: wb.SheetNames, headers, rows: rows.slice(0, 3000), total: rows.length });
  } catch (e) {
    res.json({ ok: false, pesan: 'Gagal membaca berkas: ' + e.message });
  }
});

app.post('/api/impor/commit', (req, res) => {
  try {
    const { rows = [], mapping = {}, mode = 'upsert' } = req.body || {};
    const idx = (k) => (mapping[k] === '' || mapping[k] === undefined ? -1 : Number(mapping[k]));
    const kKode = idx('kode'), kNama = idx('nama');
    if (kNama < 0) return res.json({ ok: false, pesan: 'Kolom NAMA PRODUK wajib dipetakan' });

    const dipakai = new Set();
    let masuk = 0, ubah = 0, lewat = 0;
    const jalan = db().transaction(() => {
      if (mode === 'ganti') {
        db().prepare('DELETE FROM produk').run();
      }
      for (const r of rows) {
        const nama = String(r[kNama] || '').trim();
        if (!nama) { lewat++; continue; }
        // kode dari Excel kalau ada, kalau tidak dibuat dari nama
        let kode = kKode >= 0 ? String(r[kKode] || '').trim().toUpperCase().replace(/\s+/g, '-') : '';
        if (!kode) kode = bikinKode();

        // cocokkan ke barang lama: lewat kode, atau lewat nama yang sama
        const ada = q.produkByKode(kode) || q.produkByNama(nama);
        if (ada) {
          ubah++;
          let kodeBaru = ada.kode;
          if (kKode >= 0 && kode) {
            const bentrok = q.produkByKode(kode);
            if (!bentrok || bentrok.id === ada.id) kodeBaru = kode;
          }
          db().prepare('UPDATE produk SET kode = ?, nama = ?, aktif = 1 WHERE id = ?').run(kodeBaru, nama, ada.id);
          dipakai.add(kodeBaru);
          continue;
        }

        while (dipakai.has(kode) || q.produkByKode(kode)) kode = kode + '-X';
        dipakai.add(kode);
        masuk++;
        db().prepare(
          `INSERT INTO produk (kode, nama, aktif, urutan, created_at)
           VALUES (?, ?, 1, ?, datetime('now','localtime'))`
        ).run(kode, nama, q.urutanMax() + 1);
      }
    });
    jalan();
    audit(req, 'impor-excel', 'impor', null, `Impor Excel: ${masuk} barang baru, ${ubah} diperbarui, ${lewat} dilewati`, [
      { kolom: 'Barang baru', sesudah: masuk },
      { kolom: 'Diperbarui', sesudah: ubah },
      { kolom: 'Dilewati', sesudah: lewat },
    ]);
    res.json({ ok: true, masuk, ubah, lewat, pesan: `Impor selesai: ${masuk} barang baru, ${ubah} diperbarui, ${lewat} baris dilewati.` });
  } catch (e) {
    res.json({ ok: false, pesan: 'Gagal impor: ' + e.message });
  }
});

function db() {
  return require('./lib/db').db;
}

// ---------------------------------------------------------------- perjalanan (sesi)
app.get('/sesi/baru', (req, res) => {
  res.send(H(req, { judul: 'Tambah Transaksi', aktif: '/sesi/baru', base: req.BASE, isi: vSesi.baru({ base: req.BASE, daftarSales: q.salesAll(), hariIni: hariIni(), pesan: req.query.pesan, bolehKelolaSales: auth.admin(req) }) }));
});

app.post('/sesi', (req, res) => {
  const tanggal = String(req.body.tanggal || '').trim() || hariIni();
  const pilihan = String(req.body.sales_nama || '').trim();
  const salesBaru = String(req.body.sales_baru || '').trim();
  const salesNama = salesBaru || (pilihan === '__baru__' ? '' : pilihan);
  const catatan = String(req.body.catatan || '').trim();
  if (!salesNama) return balik(req, res, '/sesi/baru', 'Pilih nama sales dari daftar, atau pilih "Nama sales baru" lalu ketik namanya');
  if (q.produkCount() === 0) return balik(req, res, '/sesi/baru', 'Master barang masih kosong — impor Excel / tambah barang dulu');
  // Transaksi kosong yang lama dibersihkan lebih dulu supaya tidak menumpuk (permintaan user) —
  // transaksi yang BARU dibuat tidak ikut terhapus karena umurnya masih 0 menit.
  hapusDraftKosong(req);
  // Kode unik surat jalan (permintaan user): inisial nama sales + nomor urut keluarnya surat jalan.
  const kode = kodeBaru(salesNama, q.sesiAll());
  const info = q.sesiInsert({ tanggal, sales_nama: salesNama, catatan, kode_unik: kode });
  const id = info.lastInsertRowid;
  q.itemSinkron(id);
  if (salesNama) q.salesTambah(salesNama);
  q.sesiSetDibuatOleh(id, req.petugas ? req.petugas.nama : '');
  audit(req, 'perjalanan-baru', 'sesi', id, `Surat jalan ${kode} dibuat — sales ${salesNama}, tanggal ${tanggal}`, [
    { kolom: 'Kode surat jalan', sesudah: kode },
    { kolom: 'Sales', sesudah: salesNama },
    { kolom: 'Tanggal', sesudah: tanggal },
    { kolom: 'Catatan', sesudah: catatan || '(kosong)' },
  ]);
  balik(req, res, `/sesi/${id}/ambil`, `Surat jalan ${kode} dibuat — silakan input jumlah barang yang dibawa`);
});

app.get('/sesi/:id', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  res.send(
    H(req, {
      judul: `Surat Jalan ${noSurat(sesi)}`,
      base: req.BASE,
      isi: vSesi.detail({
        sesi,
        items: q.itemBySesi(sesi.id),
        base: req.BASE,
        pesan: req.query.pesan,
        scan: q.scanTerakhir(sesi.id),
        // catatan PENGAMBILAN BARANG (entri) + rinciannya — permintaan user: tampil di halaman perjalanan
        // maupun Overview untuk semua status, sebagai daftar terkunci
        tambahan: q.tambahanBatchList(sesi.id),
        rincian: rincianPerEntri(sesi.id),
        // catatan otomatis "telah diambil barangnya oleh …" (kalau barang perjalanan ini diambil sales lain)
        ambilan: q.tambahanBatchDariSesi(sesi.id),
        bolehUbah: auth.bolehUbah(req),
        bolehHapus: auth.admin(req),
        bolehKelolaPetugas: auth.admin(req),
      }),
    })
  );
});

// Overview: tampilan laporan perjalanan (hanya baca) + opsi cetak
app.get('/sesi/:id/overview', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  res.send(
    H(req, {
      judul: `Overview Surat Jalan ${noSurat(sesi)}`,
      aktif: '/',
      base: req.BASE,
      isi: vSesi.overview({
        sesi,
        items: q.itemBySesi(sesi.id),
        base: req.BASE,
        pesan: req.query.pesan,
        tambahan: q.tambahanBatchList(sesi.id),
        rincian: rincianPerEntri(sesi.id),
        ambilan: q.tambahanBatchDariSesi(sesi.id),
      }),
    })
  );
});

// Audit: apa saja perubahan di perjalanan ini
app.get('/sesi/:id/audit', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  res.send(
    H(req, {
      judul: `Audit Surat Jalan ${noSurat(sesi)}`,
      aktif: '/',
      base: req.BASE,
      isi: vSesi.audit({
        sesi,
        catatan: q.auditSesi(sesi.id),
        base: req.BASE,
        pesan: req.query.pesan,
      }),
    })
  );
});

app.post('/sesi/:id/hapus', (req, res) => {
  // form bisa mengirim `balik` supaya setelah dihapus tetap di halaman asal (mis. /laporan)
  const balikKe = String(req.body.balik || '') === '/laporan' ? '/laporan' : '/';
  const sesi = q.sesiById(Number(req.params.id));
  if (!sesi) return balik(req, res, balikKe, 'Perjalanan tidak ditemukan');
  // permintaan user: hanya administrator yang boleh menghapus perjalanan
  if (!hanyaAdmin(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Perjalanan selesai hanya bisa dihapus administrator' : 'Hanya administrator yang boleh menghapus perjalanan')) return;
  const ringkas = `Surat jalan ${noSurat(sesi)} (${sesi.sales_nama || '-'}, ${sesi.tanggal}, status ${sesi.status}) dihapus`;
  const detail = q.itemBySesi(sesi.id).filter((i) => i.b + i.t + i.k > 0).map((i) => ({ nama: i.nama, kolom: 'B/T/K/S', sebelum: `${i.b}/${i.t}/${i.k}/${setoranEfektif(i)}`, sesudah: 'dihapus' }));
  q.sesiHapus(sesi.id);
  audit(req, 'perjalanan-dihapus', 'sesi', sesi.id, ringkas, detail);
  balik(req, res, balikKe, `Surat jalan ${noSurat(sesi)} dihapus`);
});

/**
 * Daftar id baris yang ditandai "tidak dibawa" (`_buang` dari views/input.js — diisi saat
 * user menggeser baris / klik 🗑 lalu menyetujui popup konfirmasi).
 * null = formulir lama/skrip uji: hanya kolom yang dikirim yang diubah, tidak ada yang dinolkan.
 */
function buangForm(req) {
  if (req.body._buang === undefined) return null;
  return String(req.body._buang)
    .split(',')
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Simpan kolom (b/t) untuk semua item yang dikirim, lalu nol-kan item yang ditandai "tidak dibawa". */
function simpanItem(req, sesiId, kolom) {
  const buang = buangForm(req);
  const awalan = kolom + '_';
  const jalan = db().transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (!k.startsWith(awalan)) continue;
      const m = /^(\d+)$/.exec(k.slice(awalan.length));
      if (!m) continue;
      const n = Math.max(0, parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0);
      q.itemSetJumlah(Number(m[1]), kolom, n);
    }
    if (buang) for (const id of buang) q.itemSetJumlah(id, kolom, 0);
  });
  jalan();
}

// --- input jumlah dibawa (boleh diubah hanya saat status draft)
app.get('/sesi/:id/ambil', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleB(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'Jumlah barang yang dibawa sudah dikunci dan tidak dapat diubah');
  const v = vInput.render({ sesi, items: q.itemBySesi(sesi.id), base: req.BASE, tahap: 'ambil', pesan: req.query.pesan });
  res.send(H(req, { judul: `Tambah Transaksi · ${noSurat(sesi)}`, base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

app.post('/sesi/:id/ambil', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleB(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'Sudah dikunci, perubahan ditolak');
  const sebelum = q.itemBySesi(sesi.id);
  simpanItem(req, sesi.id, 'b');
  const beda = bedaItem(sebelum, q.itemBySesi(sesi.id));
  if (beda.length) audit(req, 'ubah-barang-dibawa', 'sesi', sesi.id, `${beda.length} barang diubah jumlah dibawanya`, beda);
  const simpan = req.body._aksi === 'simpan';
  /*
   * Permintaan user: "jika tambahan transaksi barang yang dimasukkan kosong, belum bisa dimasukkan sebagai
   * draft surat jalan" → transaksi TANPA barang dibawa tidak bisa dilanjutkan (tetap di layar input
   * dengan pemberitahuan). Tombol "Simpan & Tetap di Sini" tetap boleh, karena tidak masuk ke surat jalan.
   * Penjagaan kedua ada di `sesi/:id/kunci` (B > 0) dan daftar dasbor (draft kosong tidak dihitung).
   */
  if (simpan && (q.itemTotals(sesi.id).b || 0) <= 0) {
    return balik(req, res, `/sesi/${sesi.id}/ambil`, 'Belum ada barang yang dibawa — isi jumlahnya dulu sebelum masuk surat jalan');
  }
  balik(req, res, simpan ? `/sesi/${sesi.id}` : `/sesi/${sesi.id}/ambil`, 'Jumlah barang dibawa tersimpan');
});

app.post('/sesi/:id/kunci', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status !== 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Perjalanan ini sudah dikunci');
  const tot = q.itemTotals(sesi.id);
  if (tot.b <= 0) return balik(req, res, `/sesi/${sesi.id}/ambil`, 'Belum ada barang yang dibawa — isi jumlahnya dulu');
  q.sesiStatus(sesi.id, 'kirim', 'dikunci_at');
  audit(req, 'dikunci', 'sesi', sesi.id, `Barang dibawa dikunci — total ${tot.b} barang (status: ongoing)`, [{ kolom: 'Total dibawa (B)', sesudah: tot.b }]);
  balik(req, res, `/sesi/${sesi.id}`, 'Data dikunci. Surat jalan siap dicetak.');
});

// --- tambahan (kolom T) hanya setelah surat jalan terbit
/**
 * Data penginputan (entri) yang AKAN dibuka di layar tambahan.
 * Permintaan user terbaru: "Saat penginputan barang tambahan, ketika disimpan langsung terkunci" — jadi
 * TIDAK ada lagi entri yang "sedang terbuka": setiap penyimpanan membuat entri baru yang langsung terkunci,
 * dan layar berikutnya selalu mulai dari 0. Kolom "Sebelumnya" = jumlah semua entri yang sudah ada.
 */
function dataEntri(sesiId) {
  const daftar = q.tambahanBatchList(sesiId);
  const sebelum = {};
  q.tambahanJumlahPerItem(sesiId, 0).forEach((r) => { sebelum[r.produk_id] = r.qty; });
  return { kini: sekarang(), daftar, sebelum, nilai: {}, nomor: daftar.length + 1 };
}

/**
 * Seluruh baris catatan OTOMATIS satu perjalanan (dibangun dari data, bukan dari teks catatan):
 *  - setiap penginputan (entri) di perjalanan ini  → "… mengambil barang dari gudang/sales X sebanyak N pcs"
 *  - penginputan perjalanan LAIN yang mengambil dari perjalanan ini → "… telah diambil barangnya oleh NAMA …"
 * `susunCatatan()` menaruh baris-baris ini di bawah catatan MANUAL dan membuang versi lamanya, sehingga
 * catatan otomatis selalu mengikuti data dan tidak pernah bisa diubah dari layar.
 */
function barisAutoSesi(sesiId) {
  const entries = q.tambahanBatchList(sesiId).map((b) => {
    // Permintaan user: pengembalian barang ke gudang punya catatan otomatis SENDIRI (bukan kalimat
    // pengambilan) karena barangnya keluar dari kolom Dibawa, bukan menambah kolom T.
    const kembali = String(b.sumber || '').toLowerCase() === 'kembali-gudang';
    return {
      tanggal: b.tanggal,
      jam: b.jam_mulai,
      teks: kembali
        ? barisPengembalian({
            tanggalPendek: tanggalPendek(b.tanggal),
            jam: b.jam_mulai,
            total: b.total,
            // permintaan user: setiap catatan menyebutkan siapa yang mencatatnya ("(dicatat oleh …)")
            petugas: b.petugas,
          })
        : barisPengambilan({
            tanggalPendek: tanggalPendek(b.tanggal),
            jam: b.jam_mulai,
            sumber: b.sumber,
            kodeSumber: b.kode_sumber,
            total: b.total,
            petugas: b.petugas,
          }),
    };
  });
  const ambilan = q.tambahanBatchDariSesi(sesiId).map((b) => ({
    tanggal: b.tanggal,
    jam: b.jam_mulai,
    teks: barisDiambil({
      tanggalPendek: tanggalPendek(b.tanggal),
      jam: b.jam_mulai,
      oleh: b.pengambil,
      total: b.total,
      petugas: b.petugas,
    }),
  }));
  return entries.concat(ambilan);
}

/** Tulis ulang catatan satu perjalanan = catatan manual + baris otomatis (urut tanggal + jam). */
function segarkanCatatan(sesiId) {
  const sesi = q.sesiById(sesiId);
  if (!sesi) return '';
  const baru = susunCatatan(sesi.catatan, barisAutoSesi(sesiId));
  if (baru !== String(sesi.catatan || '').trim()) q.sesiSetCatatan(sesiId, baru);
  return baru;
}

/** Rincian (barang qty > 0) per entri, dikelompokkan menurut batch_id. */
function rincianPerEntri(sesiId) {
  const peta = new Map();
  q.tambahanItemSemuaSesi(sesiId).forEach((it) => {
    if (!peta.has(it.batch_id)) peta.set(it.batch_id, []);
    peta.get(it.batch_id).push({ kode: it.kode, nama: it.nama, qty: it.qty });
  });
  return peta;
}

app.get('/sesi/:id/tambahan', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleT(sesi)) return balik(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Perjalanan sudah selesai — tidak bisa diubah' : 'Tambahan bisa diisi setelah data barang dibawa dikunci');
  const entri = dataEntri(sesi.id);
  /*
   * Pilihan sumber pengambilan (permintaan user: "ketika sales lain mengambil barang dari sales lainnya
   * maka dipilih mengambil di surat jalan yang mana, surat jalan yang selesai tidak bisa diambil"):
   * daftar SURAT JALAN milik sales lain yang belum selesai, dipilih lewat kode uniknya.
   * Permintaan user terbaru: surat jalan yang masih DRAFT juga TIDAK bisa diambil barangnya (barang
   * bawaannya belum dikunci), jadi draft tidak ditawarkan di daftar ini — penjagaan sisi server ada di
   * POST /sesi/:id/tambahan (pesan "masih DRAFT …").
   */
  const daftarSumber = q
    .sesiSumberSemua('')
    .filter(
      (x) =>
        x.id !== sesi.id &&
        x.status !== 'draft' &&
        String(x.sales_nama || '').trim().toLowerCase() !== String(sesi.sales_nama || '').trim().toLowerCase()
    )
    .map((x) => ({ id: x.id, kode: noSurat(x), sales: x.sales_nama || '-', tanggal: x.tanggal, status: x.status, b: x.tot_b || 0 }));
  const v = vInput.render({
    sesi,
    items: q.itemBySesi(sesi.id),
    base: req.BASE,
    tahap: 'tambahan',
    pesan: req.query.pesan,
    entri,
    daftarSumber,
    // permintaan user: "pada keterangan penginputan tambah catatan ditambah oleh (nama admin yang menambah)"
    petugas: req.petugas ? req.petugas.nama : '',
  });
  res.send(H(req, { judul: `Barang Tambahan · ${noSurat(sesi)}`, base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

app.post('/sesi/:id/tambahan', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  // Pesan disesuaikan: draft belum bisa diisi tambahan/pengembalian (kunci barang bawaan dulu),
  // sedangkan status selesai memang terkunci permanen.
  if (!boleT(sesi))
    return balik(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Perjalanan sudah selesai — tidak bisa diubah' : 'Tambahan bisa diisi setelah data barang dibawa dikunci');

  const sebelumT = q.itemBySesi(sesi.id);
  const idItem = new Map(sebelumT.map((i) => [String(i.id), i]));
  const kini = sekarang();
  const dibuang = new Set((buangForm(req) || []).map(String));

  // Nilai yang diposting = angka penginputan BARU (selalu mulai 0, karena setiap penyimpanan membuat
  // penginputan baru & langsung mengunci).
  const nilai = [];
  for (const [k, v] of Object.entries(req.body)) {
    const m = /^t_(\d+)$/.exec(k);
    if (!m) continue;
    const it = idItem.get(m[1]);
    if (!it) continue;
    const n = dibuang.has(m[1]) ? 0 : Math.max(0, parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0);
    nilai.push({ it, n });
  }
  const totalBaru = nilai.reduce((a, x) => a + x.n, 0);
  if (totalBaru <= 0) {
    return balik(req, res, `/sesi/${sesi.id}/tambahan`, 'Belum ada jumlah barang yang diisi — penginputan tidak dibuat');
  }

  /*
   * Sumber pengambilan: gudang (menambah barang) atau SURAT JALAN sales lain yang belum selesai —
   * dipilih lewat kode uniknya (permintaan user). Kolom Dibawa (B) surat jalan sumber itu dikurangi.
   */
  const minta = String(req.body.sumber || 'gudang').trim();
  /*
   * PENGEMBALIAN BARANG KE GUDANG (permintaan user: "buat opsi pengembalian barang ke gudang di surat
   * jalan ongoing, formatnya sama dengan barang yang di ambil, bedanya kolom b berkurang karena
   * dikembalikan ke gudang, ada catatan otomatis juga").
   * Bedanya dengan pengambilan: barangnya TIDAK masuk kolom T, melainkan mengurangi kolom **B**
   * perjalanan ini sendiri, dan catatan otomatisnya "… mengembalikan barang ke gudang sebanyak N pcs".
   */
  const mintaKecil = minta.toLowerCase();
  const kembaliGudang = mintaKecil === 'kembali-gudang' || mintaKecil === 'kembalikan-ke-gudang' || mintaKecil === 'kembali';
  let target = null;
  if (kembaliGudang) {
    // jumlah yang dikembalikan tidak boleh melebihi barang yang masih dibawa (kolom B perjalanan ini)
    const adaB = new Map(sebelumT.map((i) => [i.produk_id, i.b || 0]));
    const lebih = nilai.filter(({ it, n }) => n > (adaB.get(it.produk_id) || 0));
    if (lebih.length) {
      const rinci = lebih.slice(0, 3).map(({ it, n }) => `${it.nama} (minta ${n}, dibawa ${adaB.get(it.produk_id) || 0})`).join('; ');
      return balik(
        req,
        res,
        `/sesi/${sesi.id}/tambahan`,
        `Jumlah pengembalian melebihi barang yang dibawa — ${rinci}${lebih.length > 3 ? ` dan ${lebih.length - 3} barang lain` : ''}`
      );
    }
  } else if (minta && mintaKecil !== 'gudang') {
    const kandidat = q.sesiByKode(minta);
    if (kandidat && kandidat.id !== sesi.id) {
      // Permintaan user: surat jalan yang SELESAI maupun yang masih DRAFT tidak bisa diambil barangnya.
      if (kandidat.status === 'selesai') {
        return balik(req, res, `/sesi/${sesi.id}/tambahan`, `Surat jalan ${noSurat(kandidat)} sudah SELESAI — tidak bisa diambil`);
      }
      if (kandidat.status === 'draft') {
        return balik(req, res, `/sesi/${sesi.id}/tambahan`, `Surat jalan ${noSurat(kandidat)} masih DRAFT (barang bawaannya belum dikunci) — tidak bisa diambil`);
      }
      target = kandidat;
    }
  }
  const sumber = kembaliGudang
    ? 'kembali-gudang'
    : target
      ? String(target.sales_nama || '').trim() || 'gudang'
      : 'gudang';
  const bTarget = new Map(target ? q.itemBySesi(target.id).map((i) => [i.produk_id, i.b || 0]) : []);

  let entriId = 0;
  let dikurangi = 0;
  let tidakAda = 0;
  let kurang = 0;
  const jalan = db().transaction(() => {
    entriId = q.tambahanBatchBuat({
      sesi_id: sesi.id,
      tanggal: kini.tanggal,
      jam: kini.jamPenanda,
      jam_mulai: kini.jam,
      petugas: req.petugas ? req.petugas.nama : '',
      sumber,
      sumber_sesi_id: target ? target.id : 0,
    });
    // permintaan user: "ketika disimpan langsung terkunci" → seluruh entri perjalanan ini terkunci
    q.tambahanBatchKunciSemua(sesi.id);
    nilai.forEach(({ it, n }) => q.tambahanItemSet(entriId, it.produk_id, it.kode, it.nama, n));
    // kolom T tetap AKUMULASI semua penginputan (permintaan user) — entri pengembalian dikecualikan
    // di dalam query-nya, jadi aman dipanggil di sini.
    q.tambahanSinkronKeSesi(sesi.id);
    if (kembaliGudang) {
      // kolom Dibawa (B) perjalanan INI berkurang karena barangnya kembali ke gudang
      nilai.filter((x) => x.n > 0).forEach((x) => q.itemKurangiB(sesi.id, x.it.produk_id, x.n));
    }
    if (target) {
      nilai
        .filter((x) => x.n > 0)
        .forEach((x) => {
          const adaB = bTarget.get(x.it.produk_id);
          if (adaB === undefined) { tidakAda++; return; }
          if (adaB < x.n) kurang++;
          q.itemKurangiB(target.id, x.it.produk_id, x.n);
          dikurangi += Math.min(adaB, x.n);
        });
      // jumlah yang benar-benar dikurangi dipakai untuk catatan otomatis di perjalanan sales itu
      q.tambahanBatchSetSumber(entriId, target.id, dikurangi);
    }
  });
  jalan();

  const bedaT = bedaItem(sebelumT, q.itemBySesi(sesi.id));
  if (bedaT.length) audit(req, 'ubah-tambahan', 'sesi', sesi.id, `${bedaT.length} barang diubah kolom tambahan (T)`, bedaT);
  audit(
    req,
    kembaliGudang ? 'barang-dikembalikan-gudang' : 'tambahan-entri-baru',
    'sesi',
    sesi.id,
    kembaliGudang
      ? `Pengembalian barang ke gudang #${entriId} (${kini.tanggalPendek} ${kini.jam} WITA) — ${totalBaru} barang, kolom Dibawa dikurangi, langsung terkunci`
      : `Pengambilan barang #${entriId} (${kini.tanggalPendek} ${kini.jam} WITA) dari ${
          target ? `${noSurat(target)} (sales ${sumber})` : 'Gudang'
        } — ${totalBaru} barang, langsung terkunci`,
    [
      { kolom: 'Penginputan', sesudah: `${kini.tanggalPendek} ${kini.jam}` },
      { kolom: kembaliGudang ? 'Dikembalikan ke' : 'Diambil dari', sesudah: kembaliGudang ? 'Gudang' : target ? `${noSurat(target)} · ${sumber}` : 'Gudang' },
      { kolom: 'Jumlah', sesudah: totalBaru },
    ]
  );
  if (target && dikurangi) {
    audit(req, 'barang-diambil-sales', 'sesi', target.id, `Barang diambil oleh ${sesi.sales_nama || '-'} (surat jalan ${noSurat(sesi)}) — kolom Dibawa dikurangi ${dikurangi} barang`, [
      { kolom: 'Diambil oleh', sesudah: String(sesi.sales_nama || '-') },
      { kolom: 'Jumlah dikurangi (B)', sesudah: dikurangi },
    ]);
  }

  // catatan otomatis dibangun ulang di KEDUA perjalanan (yang mengambil & yang barangnya diambil)
  const catatanBaru = segarkanCatatan(sesi.id);
  if (target) segarkanCatatan(target.id);
  const entri = q.tambahanBatchById(entriId);
  if (catatanBaru !== String(sesi.catatan || '').trim()) {
    audit(req, 'catatan-tambahan-otomatis', 'sesi', sesi.id, `Catatan otomatis diperbarui (${entri ? entri.total : 0} barang pada penginputan ${kini.jam})`, [
      { kolom: 'Catatan', sebelum: sesi.catatan || '(kosong)', sesudah: catatanBaru },
    ]);
  }

  let pesan = kembaliGudang
    ? `Pengembalian barang (${kini.tanggalPendek} ${kini.jam} WITA) tersimpan & langsung TERKUNCI · ${angka(totalBaru)} barang dikembalikan ke Gudang · ` +
      `kolom Dibawa (B) sekarang ${angka(q.itemTotals(sesi.id).b)}`
    : `Pengambilan barang (${kini.tanggalPendek} ${kini.jam} WITA) tersimpan & langsung TERKUNCI · ${angka(totalBaru)} barang dari ${target ? noSurat(target) : 'Gudang'} · ` +
      `akumulasi kolom T ${angka(q.itemTotals(sesi.id).t)}`;
  if (target) {
    pesan += ` · surat jalan ${noSurat(target)} (sales ${sumber}, ${tanggalPendek(target.tanggal)}) dikurangi ${angka(
      dikurangi
    )} barang pada kolom Dibawa${tidakAda ? ` · ${tidakAda} jenis barang tidak ada di surat jalan itu` : ''}${
      kurang ? ` · ${kurang} jenis barang tidak cukup di surat jalan itu (dikurangi sampai 0)` : ''
    }`;
  }
  balik(req, res, `/sesi/${sesi.id}`, pesan);
});

/*
 * RETUR / PENGEMBALIAN BARANG KE GUDANG — HALAMAN KHUSUS (permintaan user):
 * "tambah ikon khusus retur … ketika di klik, langsung menuju halaman khusus mengimput barang yang akan
 *  di retur … hanya barang yang sedang dibawa (kolom B) yang bisa diretur, dengan kolom B berkurang".
 * Bedanya dengan layar tambahan: daftarnya HANYA barang yang masih dibawa (B > 0), dan menyimpan di sini
 * selalu berarti mengembalikan barang ke gudang (kolom B berkurang; kolom T tidak bertambah).
 */
app.get('/sesi/:id/retur', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleT(sesi))
    return balik(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Perjalanan sudah selesai — tidak bisa diubah' : 'Retur bisa diisi setelah data barang dibawa dikunci');
  const v = vRetur.render({
    sesi,
    items: q.itemBySesi(sesi.id).filter((i) => (Number(i.b) || 0) > 0),
    base: req.BASE,
    pesan: req.query.pesan,
  });
  res.send(H(req, { judul: v.judul, base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

app.post('/sesi/:id/retur', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleT(sesi))
    return balik(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Perjalanan sudah selesai — tidak bisa diubah' : 'Retur bisa diisi setelah data barang dibawa dikunci');

  const sebelum = q.itemBySesi(sesi.id);
  const idItem = new Map(sebelum.map((i) => [String(i.id), i]));
  const nilai = [];
  for (const [k, v] of Object.entries(req.body)) {
    const m = /^r_(\d+)$/.exec(k);
    if (!m) continue;
    const it = idItem.get(m[1]);
    if (!it) continue;
    const n = Math.max(0, parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0);
    if (n > 0) nilai.push({ it, n });
  }
  const total = nilai.reduce((a, x) => a + x.n, 0);
  if (total <= 0) return balik(req, res, `/sesi/${sesi.id}/retur`, 'Belum ada jumlah barang yang akan diretur');

  // hanya barang yang SEDANG DIBawa yang boleh diretur, dan jumlahnya tidak boleh melebihi kolom B
  const lebih = nilai.filter((x) => x.n > (Number(x.it.b) || 0));
  if (lebih.length) {
    const rinci = lebih.slice(0, 3).map((x) => `${x.it.nama} (minta ${x.n}, dibawa ${Number(x.it.b) || 0})`).join('; ');
    return balik(req, res, `/sesi/${sesi.id}/retur`, `Jumlah retur melebihi barang yang dibawa — ${rinci}${lebih.length > 3 ? ` dan ${lebih.length - 3} barang lain` : ''}`);
  }

  const kini = sekarang();
  let entriId = 0;
  const jalan = db().transaction(() => {
    entriId = q.tambahanBatchBuat({
      sesi_id: sesi.id,
      tanggal: kini.tanggal,
      jam: kini.jamPenanda,
      jam_mulai: kini.jam,
      petugas: req.petugas ? req.petugas.nama : '',
      sumber: 'kembali-gudang',
      sumber_sesi_id: 0,
    });
    q.tambahanBatchKunciSemua(sesi.id);
    nilai.forEach(({ it, n }) => q.tambahanItemSet(entriId, it.produk_id, it.kode, it.nama, n));
    // kolom T TIDAK bertambah (entri 'kembali-gudang' dikecualikan di dalam query-nya)
    q.tambahanSinkronKeSesi(sesi.id);
    // kolom Dibawa (B) perjalanan ini berkurang karena barangnya kembali ke gudang
    nilai.forEach(({ it, n }) => q.itemKurangiB(sesi.id, it.produk_id, n));
  });
  jalan();

  const beda = bedaItem(sebelum, q.itemBySesi(sesi.id));
  if (beda.length) audit(req, 'ubah-barang-dibawa', 'sesi', sesi.id, `${beda.length} barang dikurangi kolom Dibawa karena diretur ke gudang`, beda);
  audit(req, 'barang-dikembalikan-gudang', 'sesi', sesi.id,
    `Retur ke gudang (${kini.tanggalPendek} ${kini.jam} WITA) — ${total} barang, kolom Dibawa dikurangi, langsung terkunci`,
    [
      { kolom: 'Penginputan', sesudah: `${kini.tanggalPendek} ${kini.jam}` },
      { kolom: 'Dikembalikan ke', sesudah: 'Gudang' },
      { kolom: 'Jumlah', sesudah: total },
    ]);

  segarkanCatatan(sesi.id);
  const tetap = String(req.body._aksi || '') === 'tetap';
  const pesan =
    `Retur ke gudang (${kini.tanggalPendek} ${kini.jam} WITA) tersimpan & langsung TERKUNCI · ${angka(total)} barang · ` +
    `kolom Dibawa (B) sekarang ${angka(q.itemTotals(sesi.id).b)}`;
  balik(req, res, tetap ? `/sesi/${sesi.id}/retur` : `/sesi/${sesi.id}`, pesan);
});

// --- rekap: hitung barang kembali
app.post('/sesi/:id/rekap/mulai', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status === 'selesai') return balik(req, res, `/sesi/${sesi.id}`, 'Perjalanan sudah selesai');
  if (sesi.status === 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Kunci data barang dibawa dulu sebelum rekap');
  if (sesi.status === 'kirim') q.sesiStatus(sesi.id, 'rekap', 'rekap_at');
  if (req.petugas) q.sesiSetRekapOleh(sesi.id, req.petugas.nama);
  audit(req, 'rekap-dimulai', 'sesi', sesi.id, `Rekap dimulai oleh ${req.petugas ? req.petugas.nama : '-'}`);
  balik(req, res, `/sesi/${sesi.id}/rekap`, 'ReKap dimulai — scan barcode barang yang dikembalikan');
});

app.get('/sesi/:id/rekap', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleKS(sesi)) return balik(req, res, `/sesi/${sesi.id}`, terkunci(sesi) ? 'Rekap sudah selesai dikunci' : 'Klik "Mulai Rekap" dulu');
  /*
   * permintaan user: "pada halaman rekap, admin bisa memasukkan data langsung untuk barang yang akan
   * dibawa selanjutnya dan langsung buat surat jalan baru" → halaman rekap punya kartu "Surat Jalan
   * Berikutnya" (khusus peran yang boleh mengubah) yang mengirim ke POST /sesi seperti biasa.
   */
  const v = vRekap.render({
    sesi,
    items: q.itemBySesi(sesi.id),
    base: req.BASE,
    pesan: req.query.pesan,
    scan: q.scanTerakhir(sesi.id, 15),
    hariIni: hariIni(),
    bolehTambah: auth.bolehUbah(req),
    // pilihan "Tambah barang": dari MASTER data (bukan membuat barang baru)
    daftarMaster: q.produkAll(''),
  });
  res.send(H(req, { judul: `ReKap Barang Kembali · ${noSurat(sesi)}`, base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

/**
 * Simpan angka rekap yang sedang dibuka: kolom Kembali (K) + koreksi Setoran (S, `''` = kembali otomatis).
 * Dipakai POST /sesi/:id/rekap DAN POST /sesi/:id/kunci-lanjut (kunci rekap + membuat surat jalan
 * berikutnya) supaya angka
 * yang sudah diisi petugas tidak hilang saat berpindah ke surat jalan baru.
 */
function simpanRekap(req, sesi) {
  const sebelum = q.itemBySesi(sesi.id);
  // barang yang BARU ditambahkan tidak ikut perjalanan ini → kolom B/T/K/S-nya TIDAK boleh berubah
  // (hanya kolom "B Berikutnya" yang boleh diisi). Dijaga di server, bukan cuma di layar.
  const terkunci = new Set(sebelum.filter((i) => Number(i.baru) === 1).map((i) => String(i.id)));
  const jalan = db().transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      let m = /^k_(\d+)$/.exec(k);
      if (m) {
        if (!terkunci.has(m[1])) q.itemSetJumlah(Number(m[1]), 'k', Math.max(0, parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0));
        continue;
      }
      m = /^s_(\d+)$/.exec(k);
      if (m) {
        if (!terkunci.has(m[1])) {
          const t = String(v).trim();
          q.itemSetJumlah(Number(m[1]), 's', t === '' ? null : Math.max(0, parseInt(t.replace(/[^\d-]/g, ''), 10) || 0));
        }
        continue;
      }
      // "B Berikutnya": rencana jumlah barang untuk surat jalan berikutnya (disimpan supaya tidak hilang)
      m = /^nb_(\d+)$/.exec(k);
      if (m) q.itemSetJumlah(Number(m[1]), 'nb', Math.max(0, parseInt(String(v).replace(/[^\d-]/g, ''), 10) || 0));
    }
  });
  jalan();
  const beda = bedaItem(sebelum, q.itemBySesi(sesi.id));
  if (beda.length) audit(req, 'ubah-rekap', 'sesi', sesi.id, `${beda.length} angka diubah saat rekap (K/S)`, beda);
  return beda;
}

app.post('/sesi/:id/rekap', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!boleKS(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'ReKap tidak bisa diubah lagi');
  simpanRekap(req, sesi);
  balik(req, res, `/sesi/${sesi.id}/rekap`, 'Hitungan tersimpan');
});

/*
 * TAMBAH BARANG dari halaman rekap (permintaan user: "tambahan barang pada rekap penjualan bukan untuk
 * membuat barang baru, tapi memilih di master data; barang yang sudah di bawa pada perjalanan yang di
 * rekap, tidak muncul lagi").
 * Jadi: barang dipilih dari MASTER (tidak dibuat baru di sini), lalu ditandai `sesi_item.baru = 1` supaya
 * di layar rekap kolom B/T/K/S-nya terkunci dan hanya kolom "B Berikutnya" yang bisa diisi.
 * Barang yang sudah bergerak (b+t+k > 0) di perjalanan ini DITOLAK (sudah punya barisnya sendiri).
 */
app.post('/sesi/:id/tambah-barang', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!auth.bolehUbah(req)) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Peran kamu hanya melihat data — perubahan tidak disimpan');
  if (!boleKS(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'Halaman ini cuma untuk tahap rekap');
  const produk = q.produkById(Number(req.body.produk_id || 0));
  if (!produk) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Pilih dulu barangnya dari master data');
  if (Number(produk.arsip) === 1) return balik(req, res, `/sesi/${sesi.id}/rekap`, `${produk.nama} sedang diarsipkan — keluarkan dulu dari arsip di Inventory`);

  const ada = q.itemBySesi(sesi.id).find((i) => Number(i.produk_id) === Number(produk.id));
  if (ada && Number(ada.b) + Number(ada.t) + Number(ada.k) > 0) {
    return balik(
      req,
      res,
      `/sesi/${sesi.id}/rekap`,
      `${produk.nama} sudah dibawa pada perjalanan yang direkap — tidak perlu ditambahkan lagi`
    );
  }
  q.itemSinkron(sesi.id);                       // pastikan barangnya ada di daftar perjalanan ini
  q.itemTambahProduk(sesi.id, produk.id);
  q.itemSetBaru(sesi.id, produk.id, 1);
  audit(req, 'barang-ditambah-ke-rekap', 'sesi', sesi.id, `Barang ${produk.nama} diambil dari master & ditambahkan di rekap ${noSurat(sesi)} — hanya kolom B Berikutnya yang bisa diisi`, [
    { kolom: 'Barang', sesudah: `${produk.kode} · ${produk.nama}` },
    { kolom: 'Asal', sesudah: 'master data' },
  ]);
  balik(
    req,
    res,
    `/sesi/${sesi.id}/rekap`,
    `${produk.nama} ditambahkan dari master data — kolom B/T/K/S-nya terkunci, isi kolom B Berikutnya kalau akan dibawa`
  );
});

/*
 * HAPUS barang yang salah ditambahkan dari master di halaman rekap (permintaan user: "ada opsi hapus
 * jika salah memasukkan barang yang di tambah").
 * Hanya boleh untuk baris yang masih ber-tanda `baru = 1` (belum ikut perjalanan apa pun) — barang master
 * TIDAK dihapus, cuma tanda barunya dilepas sehingga barisnya tidak lagi tampil di daftar rekap
 * (dan barangnya kembali muncul di pilihan "Tambah barang").
 */
app.post('/sesi/:id/hapus-barang', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!auth.bolehUbah(req)) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Peran kamu hanya melihat data — perubahan tidak disimpan');
  if (!boleKS(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'Halaman ini cuma untuk tahap rekap');
  const item = q.itemById(Number(req.body.item_id || 0));
  if (!item || Number(item.sesi_id) !== Number(sesi.id)) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Barang tidak ditemukan di rekap ini');
  if (Number(item.baru) !== 1) return balik(req, res, `/sesi/${sesi.id}/rekap`, `${item.nama} bukan barang yang baru ditambahkan — tidak bisa dihapus dari sini`);
  q.itemSetBaru(sesi.id, item.produk_id, 0);
  q.itemSetJumlah(item.id, 'nb', 0);
  audit(req, 'barang-dihapus-dari-rekap', 'sesi', sesi.id, `${item.nama} dihapus dari daftar rekap ${noSurat(sesi)} (salah memasukkan)`, [
    { kolom: 'Barang', sebelum: `${item.kode} · ${item.nama}`, sesudah: 'dihapus dari rekap' },
  ]);
  balik(req, res, `/sesi/${sesi.id}/rekap`, `${item.nama} dihapus dari daftar rekap`);
});

/*
 * KUNCI REKAP & BUAT SURAT JALAN SEKALIGUS (permintaan user: "Di halaman rekap, tombol kunci rekap dan
 * buat surat jalan gabung menjadi satu, yang otomatis mengunci setoran dan membuat surat jalan baru").
 *
 * Satu tombol mengerjakan tiga hal:
 *   1. angka K/S yang sedang terbuka disimpan dulu (simpanRekap) — "otomatis mengunci setoran",
 *   2. **surat jalan BARU dibuat** dari kolom "B Berikutnya", atas nama sales yang direkap, tanggal hari ini,
 *   3. rekap ini DIKUNCI (status selesai) — angka tidak bisa diubah lagi.
 *
 * Urutan 2 lalu 3 (bukan sebaliknya) disengaja: kalau pembuatan surat jalan gagal — mis. kolom
 * "B Berikutnya" masih kosong — rekap TIDAK terlanjur terkunci. Kalau kolom itu kosong seluruhnya,
 * permintaan DITOLAK (keputusan user: "wajib isi minimal 1 barang di kolom B Berikutnya dulu, rekap
 * belum bisa dikunci"), jadi tidak ada lagi jalan mengunci rekap tanpa membuat surat jalan baru.
 */
app.post('/sesi/:id/kunci-lanjut', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (!auth.bolehUbah(req)) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Peran kamu hanya melihat data — perubahan tidak disimpan');
  if (!boleKS(sesi)) return balik(req, res, `/sesi/${sesi.id}`, 'Kunci rekap & surat jalan berikutnya hanya bisa dari halaman rekap');
  // angka K/S (dan kolom "B Berikutnya") yang sedang terbuka ikut disimpan — satu form yang sama
  simpanRekap(req, sesi);

  const nilai = q
    .itemBySesi(sesi.id)
    .filter((i) => (i.nb || 0) > 0)
    .map((i) => ({ it: i, n: i.nb }));
  if (!nilai.length) {
    return balik(
      req,
      res,
      `/sesi/${sesi.id}/rekap`,
      'Isi dulu kolom "B Berikutnya" untuk barang yang akan dibawa sales berikutnya — rekap belum bisa dikunci'
    );
  }

  const salesNama = String(sesi.sales_nama || '').trim();
  if (!salesNama) return balik(req, res, `/sesi/${sesi.id}/rekap`, 'Perjalanan ini belum punya nama sales');
  const tanggal = hariIni();

  const kode = kodeBaru(salesNama, q.sesiAll());
  const info = q.sesiInsert({ tanggal, sales_nama: salesNama, catatan: '', kode_unik: kode });
  const id = info.lastInsertRowid;
  q.itemSinkron(id);
  const jalan = db().transaction(() => {
    nilai.forEach((x) => {
      q.itemSetBProduk(id, x.it.produk_id, x.n);
      q.itemSetJumlah(x.it.id, 'nb', 0);   // rencana sudah dipakai → kolom B Berikutnya dikosongkan lagi
    });
  });
  jalan();
  q.salesTambah(salesNama);
  q.sesiSetDibuatOleh(id, req.petugas ? req.petugas.nama : '');
  const total = nilai.reduce((a, x) => a + x.n, 0);
  audit(req, 'perjalanan-baru', 'sesi', id, `Surat jalan ${kode} dibuat dari REKAP ${noSurat(sesi)} — sales ${salesNama}, tanggal ${tanggal}, ${angka(total)} barang dibawa`, [
    { kolom: 'Kode surat jalan', sesudah: kode },
    { kolom: 'Dibuat dari rekap', sesudah: noSurat(sesi) },
    { kolom: 'Sales', sesudah: salesNama },
    { kolom: 'Tanggal', sesudah: tanggal },
    { kolom: 'Jumlah barang dibawa', sesudah: total },
  ]);

  // baru sesudah surat jalannya benar-benar dibuat: kunci rekapnya
  q.sesiStatus(sesi.id, 'selesai', 'selesai_at');
  if (req.petugas) q.sesiSetRekapOleh(sesi.id, req.petugas.nama);
  const totAkhir = q.itemTotals(sesi.id);
  audit(
    req,
    'selesai',
    'sesi',
    sesi.id,
    `ReKap ${noSurat(sesi)} selesai & dikunci oleh ${req.petugas ? req.petugas.nama : '-'} — B ${totAkhir.b}, T ${totAkhir.t}, K ${totAkhir.k}, S ${totAkhir.s} (surat jalan ${kode} dibuat)`,
    [
      { kolom: 'B (dibawa)', sesudah: totAkhir.b },
      { kolom: 'T (tambahan)', sesudah: totAkhir.t },
      { kolom: 'K (kembali)', sesudah: totAkhir.k },
      { kolom: 'S (setoran)', sesudah: totAkhir.s },
      { kolom: 'Surat jalan berikutnya', sesudah: kode },
    ]
  );
  balik(
    req,
    res,
    `/sesi/${id}`,
    `ReKap ${noSurat(sesi)} selesai & dikunci. Surat jalan ${kode} dibuat untuk sales ${salesNama} — ${angka(total)} barang sudah terisi di kolom Dibawa (B).`
  );
});

app.post('/sesi/:id/selesai', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status !== 'rekap') return balik(req, res, `/sesi/${sesi.id}`, 'Perjalanan belum masuk tahap rekap');
  /*
   * Tombol "Selesai & Kunci Rekap" di halaman rekap sekarang satu baris dengan "Simpan Hitungan"
   * (satu form, `formaction` ke sini) supaya sejajar & sama ukuran. Angka K/S yang sedang terbuka
   * ikut disimpan dulu — kalau tidak, perubahan yang belum disimpan akan hilang saat dikunci.
   * Dipanggil dari halaman perjalanan (tanpa field k_/s_) juga aman: tidak ada yang berubah.
   */
  simpanRekap(req, sesi);
  q.sesiStatus(sesi.id, 'selesai', 'selesai_at');
  if (req.petugas) q.sesiSetRekapOleh(sesi.id, req.petugas.nama);
  const totAkhir = q.itemTotals(sesi.id);
  audit(req, 'selesai', 'sesi', sesi.id, `Rekap selesai & dikunci oleh ${req.petugas ? req.petugas.nama : '-'} — B ${totAkhir.b}, T ${totAkhir.t}, K ${totAkhir.k}, S ${totAkhir.s}`, [
    { kolom: 'B (dibawa)', sesudah: totAkhir.b },
    { kolom: 'T (tambahan)', sesudah: totAkhir.t },
    { kolom: 'K (kembali)', sesudah: totAkhir.k },
    { kolom: 'S (setoran)', sesudah: totAkhir.s },
  ]);
  balik(req, res, `/sesi/${sesi.id}`, 'ReKap selesai & dikunci. Laporan lengkap siap dicetak.');
});

app.post('/sesi/:id/catatan', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  // Yang dikirim formulir hanya catatan MANUAL; baris otomatis (pengambilan barang) selalu dipertahankan
  // dan dibangun ulang dari data — permintaan user: "catatan yang muncul otomatis tidak bisa di edit".
  const catatanBaru = susunCatatan(String(req.body.catatan || '').trim(), barisAutoSesi(sesi.id));
  audit(req, 'ubah-catatan', 'sesi', sesi.id, 'Catatan perjalanan diubah', [{ kolom: 'Catatan', sebelum: sesi.catatan || '(kosong)', sesudah: catatanBaru || '(kosong)' }]);
  q.sesiSetCatatan(sesi.id, catatanBaru);
  balik(req, res, `/sesi/${sesi.id}`, 'Catatan disimpan');
});

// ---------------------------------------------------------------- API grafik penjualan
/** Data grafik penjualan per sales pada rentang tanggal (default: hari ini). */
app.get('/api/grafik', (req, res) => {
  const tgl = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
  const dari = tgl(req.query.dari) || hariIni();
  const sampai = tgl(req.query.sampai) || dari;
  // grafik memakai tanggal canvasing ATAU tanggal selesai/rekap (lihat q.grafikSales)
  const { sales, tambahan } = q.grafikSales(dari, sampai);
  // penjualan per HARI (permintaan user: "ada grafik penjualan perhari juga")
  const harian = q.grafikHarian(dari, sampai);
  // barang paling banyak terjual (permintaan user: tab "Terjual" menampilkan daftar jenis barang)
  const barang = q.grafikBarang(dari, sampai);
  res.json({
    ok: true,
    dari,
    sampai,
    hariIni: hariIni(),
    total: q.grafikSalesTotal(sales),
    tambahan,
    harian: harian.map((r) => ({ tanggal: r.hari, nama: r.sales, s: r.s, perjalanan: r.perjalanan })),
    barang: barang.map((r) => ({ kode: r.kode, nama: r.nama, qty: r.qty })),
    sales: sales.map((r) => ({
      nama: r.sales,
      perjalanan: r.perjalanan,
      b: r.b,
      t: r.t,
      k: r.k,
      s: r.s,
    })),
  });
});

// ---------------------------------------------------------------- API scan
app.get('/api/cari', (req, res) => {
  const kode = String(req.query.kode || '').trim();
  const sesiId = Number(req.query.sesi || 0);
  if (!kode) return res.json({ ok: false, pesan: 'Kode kosong' });

  let produk = q.produkByKode(kode);
  if (!produk && sesiId) {
    produk = db()
      .prepare('SELECT * FROM sesi_item WHERE sesi_id = ? AND (lower(kode) = lower(?) OR lower(nama) = lower(?)) LIMIT 1')
      .get(sesiId, kode, kode);
  }
  if (!produk) return res.json({ ok: false, pesan: 'Kode tidak dikenal' });

  let item = null;
  if (sesiId) {
    item = db().prepare('SELECT * FROM sesi_item WHERE sesi_id = ? AND produk_id = ?').get(sesiId, produk.id);
  }
  res.json({
    ok: true,
    item: { produk_id: produk.id, kode: produk.kode, nama: produk.nama, merek: produk.merek || '' },
    id: item ? item.id : null,
    adaDiSesi: !!item,
  });
});

app.post('/api/sesi/:id/tambah-item', (req, res) => {
  const sesi = q.sesiById(Number(req.params.id));
  if (!sesi) return res.json({ ok: false, pesan: 'Perjalanan tidak ditemukan' });
  if (terkunci(sesi)) return res.json({ ok: false, pesan: 'Perjalanan sudah selesai' });
  const ok = q.itemTambahProduk(sesi.id, Number(req.body.produk_id));
  const item = db().prepare('SELECT * FROM sesi_item WHERE sesi_id = ? AND produk_id = ?').get(sesi.id, Number(req.body.produk_id));
  if (ok && item) audit(req, 'barang-ditambah-ke-perjalanan', 'sesi', sesi.id, `${item.nama} dimasukkan ke surat jalan ${noSurat(sesi)}`, [{ kolom: 'Baris baru', sesudah: `${item.kode} · ${item.nama}` }]);
  res.json({ ok, id: item ? item.id : null });
});

app.get('/api/produk/cari', (req, res) => {
  const cari = String(req.query.q || '').trim();
  const hasil = q.produkAll(cari, true).slice(0, 15);
  res.json({ ok: true, hasil });
});

// ---------------------------------------------------------------- barcode svg / png
app.get('/barcode.svg', (req, res) => {
  const kode = String(req.query.kode || '');
  const tipe = req.query.tipe === 'qr' ? 'qr' : 'code128';
  const svg = barcode.svg(kode, tipe, { height: Number(req.query.tinggi) || 11 });
  if (!svg) return res.status(400).type('text/plain').send('barcode gagal dibuat');
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

/**
 * Barcode PNG untuk printer thermal.
 *
 * Ukuran ditentukan dalam DOT printer (bukan skala bebas), supaya bar-nya tajam:
 *  - `lebar`  : lebar maksimal yang tersedia di kertas (dot). Modul barcode dibulatkan ke bawah.
 *  - `tinggi` : tinggi bar yang diinginkan (dot, 203 dpi -> 8 dot = 1 mm).
 *  - `modul`  : lebar modul minimum yang masih bisa dipindai (default 2 dot).
 *  - `tipe`   : 'code128' | 'qr' | 'auto' (default). Mode auto memakai QR kalau Code128
 *               terlalu rapat sehingga pasti tidak terbaca (kode panjang di kertas 58 mm).
 *  - `maks`   : batas LEBAR QR (dot). Kalau tidak diisi dipakai 60% lebar kertas — QR kecil
 *               (dulu dipatok 128 dot = 16 mm di semua kertas) modulnya cuma 0,25 mm sehingga
 *               kamera HP harus sangat dekat & fokus; 60% kertas membuat modulnya ~2,5× lebih besar.
 *  - `ec`     : tingkat koreksi galat QR (default 'M').
 *
 * Balasan diberi header X-Barcode-* supaya klien bisa memberi tahu pengguna.
 */
const BWIP_PX_PER_MM = 5.8; // bwip-js menggambar ~5,8 px per mm (terukur)
const QR_MAKS_DOT = 288;    // batas aman (36 mm pada 203 dpi); batas sebenarnya = `maks` dari klien
const QR_PAD_MATI = 8;      // padding bwip-js = 4 modul zona sunyi (lihat lib/barcode.js → QR_PAD)
const ukuranBarcodeSatu = new Map(); // cache pengukuran skala 1

function ukurBarcode(tipe, kode, ec, cb) {
  const kunci = tipe + '|' + kode + '|' + ec;
  if (ukuranBarcodeSatu.has(kunci)) return cb(null, ukuranBarcodeSatu.get(kunci));
  const opsi = tipe === 'qr'
    ? { bcid: 'qrcode', text: kode, scale: 1, paddingwidth: QR_PAD_MATI, paddingheight: QR_PAD_MATI, eclevel: ec }
    : { bcid: 'code128', text: kode, scale: 1, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 };
  barcode.png(opsi, (err, buf) => {
    if (err || !buf) return cb(err || new Error('gagal'));
    const lebar = buf.readUInt32BE(16);
    ukuranBarcodeSatu.set(kunci, lebar);
    cb(null, lebar);
  });
}

app.get('/barcode.png', (req, res) => {
  const kode = String(req.query.kode || '').trim();
  if (!kode) return res.status(400).type('text/plain').send('kode kosong');
  const lebarTersedia = Math.max(60, Number(req.query.lebar) || 384);
  const tinggiDot = Math.max(16, Number(req.query.tinggi) || 64);
  const modulMin = Math.max(1, Number(req.query.modul) || 2);
  const diminta = ['code128', 'qr', 'auto'].includes(req.query.tipe) ? req.query.tipe : 'auto';
  const ec = ['L', 'M', 'Q', 'H'].includes(String(req.query.ec || '').toUpperCase())
    ? String(req.query.ec).toUpperCase()
    : barcode.QR_EC;
  /*
   * Batas lebar QR. Dulu dipatok 128 dot (16 mm) untuk SEMUA kertas, sehingga di kertas 80 mm
   * QR-nya tetap kecil (modul 0,25 mm). Sekarang: `maks` dari klien (pilihan "Ukuran QR"),
   * kalau tidak ada dipakai 60% lebar kertas (dan tetap dibatasi QR_MAKS_DOT).
   */
  const maksQr = Math.min(QR_MAKS_DOT, Math.max(96, Number(req.query.maks) || Math.round(lebarTersedia * 0.6)));

  const kirim = (tipe, skala, catatan) => {
    const opsi = tipe === 'qr'
      ? { bcid: 'qrcode', text: kode, scale: skala, paddingwidth: QR_PAD_MATI, paddingheight: QR_PAD_MATI, eclevel: ec }
      : { bcid: 'code128', text: kode, scale: skala, height: Math.max(3, tinggiDot / BWIP_PX_PER_MM), includetext: false, paddingwidth: 0, paddingheight: 0 };
    barcode.png(opsi, (err, buf) => {
      if (err || !buf) return res.status(400).type('text/plain').send('barcode gagal dibuat');
      res
        .type('image/png')
        .set('Cache-Control', 'public, max-age=86400')
        .set('X-Barcode-Tipe', tipe)
        .set('X-Barcode-Skala', String(skala))
        .set('X-Barcode-Lebar', String(buf.readUInt32BE(16)))
        .set('X-Barcode-Tinggi', String(buf.readUInt32BE(20)))
        .set('X-Barcode-EC', ec)
        .set('X-Barcode-Catatan', String(catatan || '').replace(/[^\x20-\x7e]/g, '-').slice(0, 180))
        .send(buf);
    });
  };

  if (diminta === 'qr') {
    return ukurBarcode('qr', kode, ec, (err, satu) => {
      if (err) return res.status(400).type('text/plain').send('barcode gagal dibuat');
      kirim('qr', Math.max(1, Math.floor(maksQr / satu)), '');
    });
  }

  ukurBarcode('code128', kode, ec, (err, satu) => {
    if (err) return res.status(400).type('text/plain').send('barcode gagal dibuat');
    const skala = Math.floor(lebarTersedia / satu);
    if (skala >= modulMin || diminta === 'code128') {
      const catatan = skala < modulMin ? `Kode terlalu panjang: modul cuma ${skala} dot (ideal ${modulMin}+), QR lebih aman` : '';
      return kirim('code128', Math.max(1, skala), catatan);
    }
    // terlalu rapat untuk dibaca -> otomatis pakai QR (jauh lebih padat & pasti terbaca)
    ukurBarcode('qr', kode, ec, (e2, satub) => {
      if (e2) return res.status(400).type('text/plain').send('barcode gagal dibuat');
      const skalaQr = Math.max(1, Math.floor(maksQr / satub));
      kirim('qr', skalaQr, `Code128 butuh ${satu} modul, kertas hanya ${lebarTersedia} dot (modul ${skala} dot) - otomatis memakai QR Code`);
    });
  });
});

// ---------------------------------------------------------------- printer thermal bluetooth
app.get('/thermal', (req, res) => {
  const v = vThermal.render({ daftar: q.produkAll(''), base: req.BASE, pesan: req.query.pesan });
  res.send(H(req, { judul: 'Cetak ke Printer Thermal', aktif: '/thermal', base: req.BASE, isi: v.isi, scriptExtra: v.script }));
});

// ---------------------------------------------------------------- label cetak
app.get('/label', (req, res) => {
  const cari = String(req.query.q || '').trim();
  let daftar = q.produkAll(cari);
  let dariSesi = null;
  if (req.query.sesi) {
    dariSesi = q.sesiById(Number(req.query.sesi));
    if (dariSesi) {
      const items = q.itemBySesi(dariSesi.id).filter((i) => (i.b + i.t) > 0);
      const map = new Map(daftar.map((p) => [p.id, p]));
      daftar = items.map((i) => map.get(i.produk_id) || { id: i.produk_id, kode: i.kode, nama: i.nama, merek: i.merek, ukuran: '', harga: 0 }).filter(Boolean);
    }
  }
  res.send(H(req, { judul: 'Cetak Barcode / QR', aktif: '/label', base: req.BASE, isi: vLabel.render({ daftar, cari, base: req.BASE, dariSesi, pesan: req.query.pesan }) }));
});

/*
 * Semua halaman/dokumen cetak (`/cetak/*`) selalu dibuat ulang dari data terbaru — jangan pernah
 * disimpan penampil/cache browser. Ini mencegah pengguna melihat dokumen versi lama setelah kode
 * atau datanya diperbarui (pernah terjadi: memo penginputan tampil versi lama).
 */
app.use('/cetak', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.post('/cetak/label', (req, res) => {
  const b = req.body;
  const tipe = ['code128', 'qr', 'keduanya'].includes(b.tipe) ? b.tipe : 'code128';
  const ukuran = ['a4', 'f4', 'thermal'].includes(b.ukuran) ? b.ukuran : 'a4';
  const baris = [];
  for (const [k, v] of Object.entries(b)) {
    const m = /^qty_(\d+)$/.exec(k);
    if (!m) continue;
    const n = parseInt(String(v), 10) || 0;
    if (n > 0) baris.push({ produk: q.produkById(Number(m[1])), qty: n });
  }
  const isi = baris.filter((x) => x.produk);
  if (!isi.length) return balik(req, res, '/label', 'Pilih minimal satu barang dan isi jumlah label');
  res.send(vPrint.label({ isi, tipe, ukuran, tahun: TAHUN_DEFAULT, base: req.BASE }));
});

/**
 * LABEL → PDF (untuk dicetak lewat APLIKASI PIHAK KETIGA).
 *
 * Permintaan user: "Tetap tidak bisa mencetak barcode, bagaimana kalo menjadikannya pdf saja,
 * ada opsi ukuran printer yang akan digunakan, print nya menggunakan aplikasi pihak ketiga".
 *
 * Dipakai dua halaman:
 *  - `/label`  → form yang sama dengan cetak label browser, tombol kedua "Buat PDF".
 *  - `/thermal`→ tombol "Buat PDF" memakai daftar & jumlah yang sedang dipilih (dikirim sebagai
 *                deretan `kode[]`/`nama[]`/`qty[]`).
 *
 * Isi label (barcode/QR) digambar VEKTOR oleh `lib/labelPdf.js`, ukuran halaman PDF tepat sesuai
 * pilihan kertas, dan modulnya diselaraskan ke kelipatan dot printer (`dpi`) supaya tajam.
 */
function kumpulkanBarangPdf(req) {
  const daftar = [];
  const arr = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  // bentuk dari /label: qty_<produkId>
  for (const [k, v] of Object.entries(req.body || {})) {
    const m = /^qty_(\d+)$/.exec(k);
    if (!m) continue;
    const n = parseInt(String(v), 10) || 0;
    if (n <= 0) continue;
    const p = q.produkById(Number(m[1]));
    if (p) daftar.push({ kode: p.kode, nama: p.nama, qty: n });
  }
  // bentuk dari /thermal (dan tautan langsung): deretan kode/nama/qty
  const kode = arr(req.body && req.body.kode);
  const nama = arr(req.body && req.body.nama);
  const qty = arr(req.body && req.body.qty);
  kode.forEach((k, i) => {
    const n = parseInt(String(qty[i] || 1), 10) || 1;
    if (String(k || '').trim()) daftar.push({ kode: String(k).trim(), nama: String(nama[i] || '').trim(), qty: n });
  });
  return daftar;
}

app.all('/cetak/label-pdf', (req, res) => {
  const sumber = Object.assign({}, req.query || {}, req.body || {});
  let daftar = kumpulkanBarangPdf(req);
  /*
   * Bentuk ketiga: tautan langsung `?sesi=<id>` — dipakai ikon cetak di halaman perjalanan supaya
   * "Cetak Barcode Barang" juga langsung menghasilkan PDF. Isinya = semua barang yang bergerak pada
   * perjalanan itu (B+T > 0), satu label per barang; jumlah label bisa diatur lewat `?qty=`.
   */
  const idSesi = parseInt(String(sumber.sesi || ''), 10) || 0;
  if (idSesi) {
    const sesi = q.sesiById(idSesi);
    if (!sesi) return balik(req, res, '/label', 'Perjalanan untuk label barcode tidak ditemukan');
    const n = Math.min(50, Math.max(1, parseInt(String(sumber.qty || '1'), 10) || 1));
    daftar = daftar.concat(
      q
        .itemBySesi(sesi.id)
        .filter((i) => (i.b || 0) + (i.t || 0) > 0)
        .map((i) => ({ kode: i.kode, nama: i.nama, qty: n }))
    );
  }
  if (!daftar.length) return balik(req, res, '/label', 'Pilih minimal satu barang dan isi jumlah label dulu');

  const jenis = ['qr', 'code128', 'keduanya', 'nonaktif'].includes(sumber.tipe || sumber.jenis) ? sumber.tipe || sumber.jenis : 'qr';
  const buf = labelPdf.buatLabelPdf({
    barang: daftar,
    kertas: labelPdf.KERTAS[sumber.kertas] ? sumber.kertas : 'roll58',
    jenis,
    ukuranQr: ['kecil', 'sedang', 'besar'].includes(sumber.ukuranQr) ? sumber.ukuranQr : 'sedang',
    dpi: Number(sumber.dpi) === 300 ? 300 : 203,
    tampilKode: sumber.tampilKode !== '0',
    tampilNama: sumber.tampilNama !== '0',
  });
  const nama = 'label-' + daftar[0].kode.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) + '.pdf';
  res
    .type('application/pdf')
    .set('Content-Disposition', (sumber.unduh === '1' ? 'attachment' : 'inline') + '; filename="' + nama + '"')
    .send(buf);
});

// ---------------------------------------------------------------- setting: logo & layout surat
/*
 * "Di setting ada pilihan edit logo, dan bisa upload logo jpg/png, yang akan di pakai dan ada opsi edit
 *  layout surat" (permintaan user) — halaman ini HANYA untuk administrator.
 *
 * Berkas logo TIDAK disimpan di disk server: dikirim ke penyimpanan media platform dari sisi server,
 * lalu yang disimpan di database hanya URL-nya (lib/setelan.js → `logo_url`).
 */
const MEDIA_UPLOAD = process.env.SC_MEDIA_UPLOAD || 'http://127.0.0.1:4310/api/app-media/upload';

/** Token media milik aplikasi ini (dipasang platform saat publish) — jangan pernah dikirim ke browser. */
function tokenMedia() {
  if (process.env.APP_MEDIA_TOKEN) return String(process.env.APP_MEDIA_TOKEN).trim();
  const jalur = process.env.SC_MEDIA_TOKEN_FILE || path.join(__dirname, '.vibecoder-media-token');
  try {
    return fs.readFileSync(jalur, 'utf8').trim();
  } catch (e) {
    return '';
  }
}

/** Kirim byte gambar ke penyimpanan media platform; kembalikan URL CDN-nya. */
async function unggahKeMedia(buf, namaBerkas) {
  const token = tokenMedia();
  if (!token) throw new Error('penyimpanan media belum siap — coba beberapa saat lagi setelah aplikasi dipublikasikan ulang');
  const r = await fetch(`${MEDIA_UPLOAD}?filename=${encodeURIComponent(namaBerkas)}`, {
    method: 'POST',
    headers: { 'X-App-Media-Token': token, 'Content-Type': 'application/octet-stream' },
    body: buf,
  });
  const teks = await r.text();
  let j = null;
  try {
    j = JSON.parse(teks);
  } catch (e) {
    j = null;
  }
  if (!r.ok || !j || !j.ok || !j.url) {
    // Pesan dari penyimpanan media diteruskan apa adanya supaya pengguna tahu sebabnya — mis. kuota
    // penyimpanan penuh (403) atau berkasnya terlalu besar.
    const sebab = (j && (j.pesan || j.error || j.message)) || (teks && teks.length < 200 ? teks.trim() : '');
    throw new Error(sebab || `berkas ditolak penyimpanan media (${r.status})`);
  }
  return String(j.url);
}

app.get('/setting/logo', (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh membuka pengaturan logo & layout surat')) return;
  res.send(
    H(req, {
      judul: 'Edit Logo & Layout Surat',
      aktif: '/setting/logo',
      base: req.BASE,
      isi: vSetting.render({
        base: req.BASE,
        setelan: setelanSemua(),
        pesan: req.query.pesan,
        galat: req.query.galat,
        bolehUbah: auth.bolehUbah(req),
      }),
      scriptExtra: vSetting.script,
    })
  );
});

app.post('/setting/logo/unggah', upload.single('logo'), async (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh mengubah logo')) return;
  try {
    const f = req.file;
    if (!f || !f.buffer || !f.buffer.length) return balik(req, res, '/setting/logo', 'Pilih berkas logo dulu');
    if (f.size > 5 * 1024 * 1024) return balik(req, res, '/setting/logo', 'Ukuran logo maksimal 5 MB');
    const namaAsli = String(f.originalname || 'logo.png');
    const ext = (namaAsli.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '';
    const extOk = ['jpg', 'jpeg', 'png'].includes(ext.toLowerCase());
    const tipeOk = ['image/jpeg', 'image/png'].includes(String(f.mimetype || '').toLowerCase());
    if (!extOk && !tipeOk) return balik(req, res, '/setting/logo', 'Logo harus berformat JPG atau PNG');
    // Nama berkas unik supaya logo baru tidak menimpa berkas lama di cache/CDN.
    const nama = `logo-${Date.now()}.${(extOk ? ext : 'png').toLowerCase()}`;
    const url = await unggahKeMedia(f.buffer, nama);
    setelanSimpan({ logo_url: url });
    /*
     * IKON APLIKASI (ikon di layar utama HP) dibuat ulang dari logo ini — permintaan user: "samakan
     * ikon aplikasi HP dengan logo yang saya unggah". Salinan gambarnya disimpan di
     * `tools/logo-sumber.png` sebagai bahan baku (byte aslinya sudah ada di penyimpanan media).
     * Kalau pembuatan ikon gagal, logo TETAP tersimpan dan pengguna diberi tahu apa yang harus dilakukan.
     */
    let catatanIkon = ' — ikon aplikasi (layar utama HP) ikut diperbarui';
    try {
      fs.writeFileSync(JALUR_SUMBER_LOGO, f.buffer);
      const hasil = await ikonApp.buatIkon({ sumber: JALUR_SUMBER_LOGO });
      audit(req, 'ikon-aplikasi-diperbarui', 'pengaturan', null, `Ikon aplikasi dibuat ulang dari logo baru (${hasil.berkas.length} ikon)`, [{ nama, kolom: 'ikon', sebelum: '', sesudah: hasil.berkas.join(', ') }]);
    } catch (e) {
      console.error('[galat] ikon dari logo:', e && e.message);
      catatanIkon = ` (logo tersimpan, tetapi ikon aplikasi belum bisa dibuat ulang: ${(e && e.message) || 'kesalahan'} — jalankan "node tools/ikon-dari-logo.js" di folder aplikasi)`;
    }
    audit(req, 'logo-diganti', 'pengaturan', null, 'Logo aplikasi diganti', [{ nama, kolom: 'logo', sebelum: '', sesudah: url }]);
    balik(req, res, '/setting/logo', 'Logo baru tersimpan — otomatis dipakai di dasbor dan kop surat' + catatanIkon);
  } catch (e) {
    console.error('[galat] unggah logo:', e && e.message);
    balik(req, res, '/setting/logo', `Logo gagal diunggah: ${(e && e.message) || 'terjadi kesalahan'}`);
  }
});

app.post('/setting/logo/simpan', (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh mengubah layout surat')) return;
  const b = req.body || {};
  const sebelum = setelanSemua();
  /*
   * Kotak centang mengirim "1" saat dicentang dan TIDAK mengirim apa pun saat dilepas; nilai "0"/"on"
   * tetap diterima supaya pengiriman dari skrip (bukan form) tidak salah dibaca sebagai "dicentang".
   */
  const dariKotak = (v) => (v === '1' || v === 'true' || v === 'on' ? '1' : '0');
  setelanSimpan({
    logo_tampil: dariKotak(b.logo_tampil),
    logo_ukuran: b.logo_ukuran,
    kop_judul: b.kop_judul,
    kop_sub: b.kop_sub,
    kop_garis: dariKotak(b.kop_garis),
    ttd_tampil: dariKotak(b.ttd_tampil),
  });
  const sesudah = setelanSemua();
  const beda = Object.keys(sesudah)
    .filter((k) => sebelum[k] !== sesudah[k])
    .map((k) => ({ nama: k, kolom: k, sebelum: sebelum[k], sesudah: sesudah[k] }));
  if (beda.length) audit(req, 'layout-surat-diubah', 'pengaturan', null, `Layout surat diubah (${beda.map((d) => d.kolom).join(', ')})`, beda);
  balik(req, res, '/setting/logo', 'Pengaturan layout surat tersimpan');
});

app.post('/setting/logo/hapus', (req, res) => {
  if (!hanyaAdmin(req, res, '/', 'Hanya administrator yang boleh mengubah logo')) return;
  setelanSimpan({ logo_url: '' });
  /*
   * Ikon aplikasi ikut dikembalikan ke bawaan (kalau pernah dibuat dari logo unggahan), supaya ikon di
   * layar utama HP tidak "tertinggal" memakai logo lama padahal aplikasinya sudah kembali ke logo bawaan.
   */
  let catatan = '';
  try {
    const hasil = ikonApp.kembalikanIkonBawaan();
    if (hasil.dipulihkan) {
      audit(req, 'ikon-aplikasi-dikembalikan', 'pengaturan', null, 'Ikon aplikasi dikembalikan ke bawaan', [{ nama: 'ikon', kolom: 'ikon', sebelum: 'dari logo unggahan', sesudah: hasil.berkas.join(', ') }]);
      catatan = ' — ikon aplikasi juga kembali ke bawaan';
    }
  } catch (e) {
    console.error('[galat] kembalikan ikon bawaan:', e && e.message);
    catatan = ` (ikon aplikasi belum bisa dikembalikan: ${(e && e.message) || 'kesalahan'})`;
  }
  audit(req, 'logo-dikembalikan', 'pengaturan', null, 'Logo kembali ke bawaan aplikasi');
  balik(req, res, '/setting/logo', 'Logo kembali ke bawaan aplikasi' + catatan);
});

/**
 * CONTOH SURAT JALAN (`/cetak/contoh`) — dokumen contoh dengan data karangan, dipakai halaman Setting
 * sebagai pratinjau: pengguna langsung melihat hasil pengaturan logo/judul/garis/tanda tangan.
 * Tidak menyentuh data perjalanan sama sekali.
 */
app.get('/cetak/contoh', (req, res) => {
  if (!auth.admin(req)) return balik(req, res, '/', 'Hanya administrator yang boleh membuka contoh surat');
  const contoh = {
    id: 0,
    kode_unik: 'CONTOH',
    sales_nama: 'CONTOH SALES',
    tanggal: hariIni(),
    catatan: 'Dokumen contoh — data karangan untuk melihat hasil pengaturan logo & layout surat.',
    status: 'kirim',
  };
  const nama = [
    'Kacamata Hitam Polarized', 'Sunglasses Retro Classic', 'Kacamata Sport Anti UV', 'Sunglasses Kotak Premium',
    'Kacamata Bulat Vintage', 'Sunglasses Cat Eye', 'Kacamata Lipat Travel', 'Sunglasses Clip On',
    'Kacamata Anak Karakter', 'Sunglasses Oversize', 'Kacamata Photocromic', 'Sunglasses Metal Frame',
  ];
  const items = [];
  for (let i = 0; i < 28; i++) {
    items.push({
      id: i + 1,
      kode: `SKU-${String(i + 1).padStart(3, '0')}`,
      nama: `${nama[i % nama.length]} ${String.fromCharCode(65 + (i % 26))}`,
      b: 1 + (i % 5),
      t: i % 4,
      k: 0,
      s: null,
    });
  }
  res.send(
    vPrint.suratJalan({
      sesi: contoh,
      items,
      base: req.BASE,
      judul: 'SURAT JALAN DAN SETORAN',
      namaAdmin: req.petugas ? req.petugas.nama : '',
    })
  );
});

// ---------------------------------------------------------------- cetak dokumen
app.get('/cetak/laporan-sales', (req, res) => {
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dari || '')) ? String(req.query.dari) : '';
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.sampai || '')) ? String(req.query.sampai) : '';
  const rekap = q.laporanSales(dari, sampai);
  /*
   * Tanda tangan admin pada dokumen rekap ini = petugas yang MENGINPUT (yang merekap), bukan yang
   * mencetak (permintaan user). Dokumen ini mencakup banyak perjalanan, jadi namanya ditulis hanya kalau
   * seluruh perjalanan periode itu direkap oleh SATU petugas yang sama; kalau berbeda-beda, garis tanda
   * tangannya dibiarkan kosong untuk diisi tangan.
   */
  const petugasRekap = q.rekapOlehPeriode(dari, sampai);
  res.send(
    vPrint.laporanSales({
      base: req.BASE,
      dari,
      sampai,
      rekap,
      total: q.laporanSalesTotal(rekap),
      hariIni: hariIni(),
      namaAdmin: petugasRekap.length === 1 ? petugasRekap[0] : '',
    })
  );
});

app.get('/cetak/surat-jalan/:id', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status === 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Kunci data barang dibawa dulu sebelum cetak surat jalan');
  res.send(
    vPrint.suratJalan({
      sesi,
      items: q.itemBySesi(sesi.id),
      base: req.BASE,
      judul: 'SURAT JALAN DAN SETORAN',
      // nama admin = petugas yang MENGINPUT perjalanan ini, bukan yang sedang mencetak (permintaan user)
      namaAdmin: namaAdminSesi(sesi),
    })
  );
});

// MEMO PENAMBAHAN BARANG per PENGINPUTAN → berkas PDF (permintaan user: "view memo yang dilihat sudah
// berbentuk pdf"). Ditampilkan inline di penampil PDF browser; ?unduh=1 untuk mengunduh.
app.get('/cetak/memo-tambahan/:id/:batchId', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  const batch = q.tambahanBatchById(req.params.batchId);
  if (!batch || Number(batch.sesi_id) !== Number(sesi.id)) return balik(req, res, `/sesi/${sesi.id}`, 'Memo penginputan tidak ditemukan');
  const daftar = q.tambahanBatchList(sesi.id);
  const nomor = daftar.findIndex((b) => b.id === batch.id) + 1 || 1;
  const nama = `memo-tambahan-${sesi.id}-penginputan-${nomor}.pdf`;

  /*
   * Permintaan user: "tombol kembali di view memo pengambilan tidak ada".
   * Isi memonya tetap PDF (permintaan user sebelumnya), tetapi kalau dibuka lewat `?tampil=1` (tautan
   * View Memo di aplikasi) halaman yang dikirim adalah PEMBUNGKUS HTML berisi bilah tombol
   * Kembali / Cetak / Unduh + PDF-nya di dalam iframe — jadi selalu ada tombol kembali, tanpa
   * mengubah isi PDF-nya sedikit pun. Tanpa `?tampil=1` (mis. dari `?unduh=1`) tetap PDF murni.
   */
  if (req.query.tampil === '1') {
    const v = String(req.query.v || '');
    const src = `${req.BASE}/cetak/memo-tambahan/${sesi.id}/${batch.id}?v=${encodeURIComponent(v)}`;
    const unduh = `${src}&unduh=1`;
    return res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memo Penginputan ${nomor} · ${esc(noSurat(sesi))}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #e9e7f5;
    font-family: 'Liberation Sans', Arial, Helvetica, Roboto, sans-serif; }
  /*
   * Permintaan user: "Tombol x sebagai kembali di atas di hapus, dibuatkan tombol kembali di bawah".
   * Karena itu bilah aksi (Kembali + Unduh) ditaruh di BAWAH halaman — TIDAK ada bilah apa pun di atas,
   * jadi memonya langsung terlihat penuh dan tombol kembalinya jelas di bagian bawah.
   */
  body { display: flex; flex-direction: column; }
  .isi { flex: 1 1 auto; min-height: 0; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
  .kaki { flex: 0 0 auto; padding: 10px 12px 12px; background: #fff; border-top: 1px solid #cfcbe6;
    display: flex; flex-direction: column; gap: 8px; }
  .kaki-aksi { display: flex; gap: 8px; }
  .kaki-aksi a { flex: 1 1 0; text-align: center; font: inherit; font-size: 14px; font-weight: 700;
    padding: 13px 14px; border-radius: 11px; border: 1px solid #cfcbe6; background: #fff; color: #1f1b3a;
    text-decoration: none; }
  .kaki-aksi a.utama { background: linear-gradient(135deg, #4f46e5, #8b5cf6); color: #fff; border-color: transparent; }
  .petunjuk { display: none; font-size: 12.5px; color: #635f82; }
  .petunjuk.tampil { display: block; }
  .gagal { padding: 18px 16px; }
  .gagal { padding: 18px 16px; }
  .gagal a { display: inline-block; margin: 6px 8px 0 0; font-size: 14px; font-weight: 700;
    padding: 12px 18px; border-radius: 11px; text-decoration: none;
    background: linear-gradient(135deg, #4f46e5, #8b5cf6); color: #fff; }
  .gagal a.putih { background: #fff; color: #1f1b3a; border: 1px solid #cfcbe6; }
  .gagal b { display: block; margin-bottom: 4px; }
</style>
</head>
<body>
  <div class="isi">
    <iframe src="${src}" id="memoFrame" title="Memo penginputan ${nomor}"></iframe>
    <div class="gagal" id="memoGagal" hidden>
      <b>Memo tidak bisa ditampilkan di dalam halaman ini.</b>
      Ketuk <b>Buka memo</b> di bagian bawah — halaman ini tetap terbuka, jadi tombol Kembali ada di bawah.
    </div>
  </div>
  <div class="kaki">
    <div class="petunjuk no-print" id="petunjukMemo">Kalau memo tidak muncul, ketuk <b>Buka memo</b> (terbuka
      di tab baru) — tab ini tetap terbuka, tombol Kembali ada di bawah.</div>
    <div class="kaki-aksi">
      <a class="utama" id="btnKembaliMemo" href="${req.BASE}/sesi/${sesi.id}">Kembali</a>
      <a href="${unduh}">Unduh PDF</a>
      <a href="${src}" id="btnBukaMemo" target="_blank" rel="noopener" hidden>Buka memo</a>
    </div>
  </div>
  <script>
  // Tombol Kembali: pakai riwayat hanya kalau ada halaman sebelumnya dari aplikasi, kalau tidak
  // ikuti tautan ke halaman perjalanan (halaman ini sering dibuka di TAB BARU → riwayat kosong).
  document.getElementById('btnKembaliMemo').addEventListener('click', function (ev) {
    var ada = false;
    try { ada = window.history.length > 1 && document.referrer && document.referrer.indexOf(location.origin) === 0; } catch (e) { ada = false; }
    if (!ada) return;
    ev.preventDefault();
    window.history.back();
  });
  /*
   * Ketahanan penampil memo. Permintaan user: "setelah klik buka pdf, tetap tidak ada tombol kembali,
   * tombol kembali ada di awal, tapi tampilan memo tidak ada".
   * 1) "Buka memo" TIDAK lagi membuka TAB BARU — dibuka di tab yang sama supaya tombol Kembali bawaan
   *    browser tetap ada dan kembali ke halaman ini (yang masih punya tombol Kembali).
   * 2) Kalau browser tidak sanggup menampilkan PDF di dalam halaman (umum di HP), area iframe yang
   *    kosong diganti panel berisi tombol besar supaya memonya tetap bisa dibuka.
   */
  var f = document.getElementById('memoFrame');
  var berhasil = false;
  f.addEventListener('load', function () { berhasil = true; });
  setTimeout(function () {
    if (berhasil) return;
    // browser ini tidak bisa menampilkan PDF di dalam halaman → tampilkan panel + tombol "Buka memo"
    // (tab baru) & petunjuk, sementara tombol Kembali tetap ada di bilah bawah.
    document.getElementById('memoGagal').hidden = false;
    document.getElementById('petunjukMemo').classList.add('tampil');
    var b = document.getElementById('btnBukaMemo');
    if (b) b.hidden = false;
  }, 1800);
  </script>
</body>
</html>`);
  }

  const pdf = memoEntri({ sesi, batch, items: q.tambahanItemBatch(batch.id), nomor, akumulasi: q.itemTotals(sesi.id).t });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.unduh === '1' ? 'attachment' : 'inline'}; filename="${nama}"`);
  // anti-cache tegas: penampil PDF di ponsel pernah menyimpan memo versi lama (permintaan user)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(pdf);
});

/*
 * MEMO PENGAMBILAN BARANG -> struk printer thermal (58/80 mm).
 * permintaan user: "Hapus semua opsi print cetak memo kosong" → memo SELALU versi TERISI (mengikuti
 * kolom Tambahan/T) dan `?isi=1` diabaikan. Dulu tanpa `isi=1` halaman ini mencetak memo KOSONG
 * (30 baris untuk ditulis tangan) — mode itu sudah dihapus dari view, menu, dan rute ini.
 */
app.get('/cetak/memo/:id', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  const isi = true;
  const lebar = String(req.query.lebar || '') === '80' ? 80 : 58;
  res.send(
    vMemo.render({
      sesi,
      items: q.itemBySesi(sesi.id),
      base: req.BASE,
      isi,
      lebar,
      // nama admin = petugas yang MENGINPUT perjalanan ini, bukan yang sedang mencetak (permintaan user)
      namaAdmin: namaAdminSesi(sesi),
    })
  );
});

/*
 * ---------- CETAK = PDF (permintaan user terbaru) ----------
 * "Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak PDF saja, 1 ikon" +
 * pilihan user: PDF-nya **terbuka di tab baru** (penampil PDF), dan halaman cetak HTML lama
 * ("beserta panduan kertasnya") tidak lagi dipakai pengguna.
 *
 * Jadi SEMUA dokumen sekarang dibuat server sebagai berkas PDF dari halaman cetak yang SAMA
 * (`/cetak/surat-jalan/:id`, `/cetak/laporan/:id`, `/cetak/laporan-sales`, `/cetak/memo/:id`)
 * memakai Chromium headless dengan ukuran kertas dari `print.css`:
 *   - surat jalan / laporan lengkap / laporan penjualan per sales → F4 215 × 330 mm (1 baris/lembar
 *     sesuai dokumennya), tanpa header/footer dan tanpa menyetel kertas di dialog cetak;
 *   - memo pengambilan → gulungan struk 58 mm (tinggi halaman = tinggi isi struk).
 * Karena itu hasilnya tidak bergantung pada setelan dialog cetak ponsel (di iPhone ukuran kertas tidak
 * bisa dipilih dari halaman web dan bawaannya A4/Letter → dokumen pecah 2 halaman; keluhan user
 * "laporan yang dibuat di iOS bentuknya tidak sesuai"). Rinciannya di `lib/pdfF4.js`.
 *
 * Halaman cetak HTML-nya TETAP ADA karena justru itulah yang dirender jadi PDF — tetapi tidak ada satu
 * pun tautan menu yang menuju ke sana lagi (tautan `<a>`/opsi cetak semuanya ke rute `*-pdf`).
 *
 * `origin` = alamat server aplikasi sendiri; port dibaca dari koneksi yang sedang dipakai
 * (`req.socket.localPort`) sehingga benar juga saat server dijalankan dengan PORT=0 (skrip uji).
 * Cookie pengguna diteruskan karena halaman cetaknya wajib login.
 *
 * JEBAKAN YANG PERNAH TERJADI (jangan diulang): alamat halaman cetaknya **TIDAK boleh memakai
 * `req.BASE`** (subpath publik, mis. `/canvasing`). Server aplikasi ini dilayani platform TANPA subpath
 * (platform memotongnya sebelum permintaan sampai ke Express — terbukti rute `/sesi/:id` bekerja), jadi
 * meminta `http://127.0.0.1:<port>/canvasing/cetak/surat-jalan/1` ke diri sendiri **tidak cocok rute
 * mana pun** → halaman 404 → pemeriksaan dokumen (`.dok`) gagal → rute PDF membalas pengalihan
 * "Gagal membuat PDF — silakan coba lagi" dan **berkas PDF-nya tidak pernah bisa dibuka**. Persis itu
 * keluhan user "Cetak Pdf surat jalan tidak bisa dibuka" (hanya muncul di situs LIVE; di skrip uji
 * `req.BASE` kosong sehingga bug-nya tersembunyi). Dijaga `uji-cetak.js` (butir "PDF tetap terbuka saat
 * aplikasi dilayani di subpath …") yang mengirim header `x-public-base-path: /canvasing`.
 *
 * Catatan pendamping (supaya tidak salah menduga): `req.BASE` diisi `lib/auth.js` dari header
 * `x-public-base-path` — dan permintaan INTERNAL Chromium (yang datang ke 127.0.0.1) tidak membawa
 * header itu, sehingga halaman cetaknya sudah memakai aset tanpa prefix (`/print.css`, `/logo-mark.png`)
 * dan CSS/logo dokumen tetap termuat. Jadi yang wajib dibuang dari alamat ini hanya segmen path
 * halamannya — bukan hanya soal aset.
 */
function originSendiri(req) {
  return `${req.protocol}://127.0.0.1:${req.socket.localPort}`;
}

async function kirimPdfF4(req, res, { alamat, nama, kembali, periksa = '.dok', siapkan = 'pasFontLaporan' }) {
  const salah = pdfF4.alasan();
  if (salah) {
    console.error('[pdf-f4]', salah);
    return balik(req, res, kembali, 'PDF belum bisa dibuat di server ini — silakan hubungi administrator');
  }
  try {
    const buf = await pdfF4.dariHalaman(alamat, { cookie: req.headers.cookie || '', periksa, siapkan });
    res.setHeader('Content-Type', 'application/pdf');
    // bawaannya `inline` (terbuka di penampil PDF tab baru); `?unduh=1` = berkas langsung terunduh
    res.setHeader('Content-Disposition', pdfF4.headerNama(nama, String(req.query.unduh || '') === '1'));
    res.setHeader('Content-Length', buf.length);
    res.send(buf);
  } catch (e) {
    console.error('[pdf-f4] gagal:', (e && e.message) || e);
    return balik(req, res, kembali, 'Gagal membuat PDF — silakan coba lagi');
  }
}

// Unduh PDF F4 — surat jalan & setoran (status kirim / rekap / selesai)
app.get('/cetak/surat-jalan-pdf/:id', async (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status === 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Kunci data barang dibawa dulu sebelum membuat PDF surat jalan');
  await kirimPdfF4(req, res, {
    alamat: `${originSendiri(req)}/cetak/surat-jalan/${sesi.id}`,
    nama: `Surat Jalan ${noSurat(sesi)}.pdf`,
    kembali: `/cetak/surat-jalan/${sesi.id}`,
  });
});

// PDF — laporan lengkap setelah rekap selesai (semua kolom B/T/K/S)
app.get('/cetak/laporan-pdf/:id', async (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status === 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Belum ada data untuk dilaporkan');
  await kirimPdfF4(req, res, {
    alamat: `${originSendiri(req)}/cetak/laporan/${sesi.id}`,
    nama: `Laporan ${noSurat(sesi)}.pdf`,
    kembali: `/cetak/laporan/${sesi.id}`,
  });
});

/*
 * PDF REKAP PENJUALAN PER SALES (F4) — dipakai ikon cetak di halaman Laporan & Laporan per sales.
 * Sumbernya halaman `/cetak/laporan-sales` (satu lembar per sales + lembar REKAP SEMUA SALES);
 * filter tanggal diteruskan apa adanya supaya PDF-nya sama dengan pilihan pengguna.
 */
app.get('/cetak/laporan-sales-pdf', async (req, res) => {
  const dari = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dari || '')) ? String(req.query.dari) : '';
  const sampai = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.sampai || '')) ? String(req.query.sampai) : '';
  const qs = [dari ? `dari=${encodeURIComponent(dari)}` : '', sampai ? `sampai=${encodeURIComponent(sampai)}` : '']
    .filter(Boolean)
    .join('&');
  const periode = `${dari ? tanggalPendek(dari) : 'awal'} - ${sampai ? tanggalPendek(sampai) : tanggalPendek(hariIni())}`;
  await kirimPdfF4(req, res, {
    alamat: `${originSendiri(req)}/cetak/laporan-sales${qs ? `?${qs}` : ''}`,
    nama: `Laporan Penjualan ${periode}.pdf`,
    kembali: `/laporan/sales`,
  });
});

/*
 * PDF MEMO PENGAMBILAN BARANG — struk thermal 58 mm (bisa 80 mm dengan `?lebar=80`).
 * Sumbernya halaman `/cetak/memo/:id`; ukuran kertasnya dihitung di browser (`pasHalamanStruk()`),
 * jadi tinggi halaman PDF = tinggi struk yang sebenarnya (1 struk = 1 halaman).
 */
app.get('/cetak/memo-pdf/:id', async (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  // memo hanya bermakna kalau memang ada barang tambahan (kolom T > 0) — menu pun hanya menawarkannya
  // saat itu; URL langsung tanpa T ditolak supaya tidak ada memo kosong.
  if (!q.itemBySesi(sesi.id).some((i) => (i.t || 0) > 0))
    return balik(req, res, `/sesi/${sesi.id}`, 'Belum ada barang tambahan (kolom T) — memo pengambilan belum ada isinya');
  const lebar = String(req.query.lebar || '') === '80' ? 80 : 58;
  await kirimPdfF4(req, res, {
    alamat: `${originSendiri(req)}/cetak/memo/${sesi.id}?lebar=${lebar}&isi=1`,
    nama: `Memo ${noSurat(sesi)}.pdf`,
    kembali: `/sesi/${sesi.id}`,
    periksa: '.struk',
    siapkan: 'pasHalamanStruk',
  });
});

app.get('/cetak/laporan/:id', (req, res) => {
  const sesi = ambilSesi(req, res);
  if (!sesi) return;
  if (sesi.status === 'draft') return balik(req, res, `/sesi/${sesi.id}`, 'Belum ada data untuk dilaporkan');
  // `namaAdmin` dihitung di dalam vPrint.laporan lewat namaAdminSesi(sesi) — data petugas yang menginput
  res.send(vPrint.laporan({ sesi, items: q.itemBySesi(sesi.id), base: req.BASE }));
});

// ---------------------------------------------------------------- error
app.use((req, res) => {
  res.status(404).send(H(req, { judul: 'Halaman tidak ditemukan', base: req.BASE, isi: `<div class="card"><h1>404</h1><p class="card-hint">Halaman <b>${esc(req.path)}</b> tidak ada.</p><a class="btn btn-primary" href="${req.BASE}/">Kembali ke Dashboard</a></div>` }));
});

/**
 * Penangan GALAT terakhir (4 argumen = error handler Express; harus dipasang paling akhir).
 *
 * Sebelum ini, kesalahan apa pun di dalam route ditampilkan Express sebagai halaman polos
 * "Internal Server Error" berbahasa Inggris — pengguna tidak tahu apa yang salah dan tidak bisa
 * melanjutkan. Sekarang: pesannya dicatat di log server, dan pengguna melihat halaman ringkas
 * berbahasa Indonesia + tombol kembali (API tetap menjawab JSON supaya pemanggil fetch tahu gagalnya).
 */
app.use((err, req, res, next) => {
  const pesan = (err && err.message) || 'kesalahan tidak diketahui';
  console.error('[galat]', req.method, req.originalUrl, '->', pesan);
  if (/^\/api\//.test(req.path)) return res.status(500).json({ ok: false, pesan: 'Terjadi kesalahan di server: ' + pesan });
  res.status(500).send(
    H(req, {
      judul: 'Terjadi kesalahan',
      base: req.BASE,
      isi: `<div class="card"><h1 style="margin:0 0 6px">Terjadi kesalahan</h1>
        <p class="card-hint">Permintaan <b>${esc(req.method)} ${esc(req.originalUrl)}</b> gagal diproses server.</p>
        <div class="alert alert-warn">${esc(pesan)}</div>
        <p class="card-hint">Data yang sudah tersimpan tidak berubah. Silakan ulangi langkah terakhir; kalau tetap gagal, sampaikan pesan di atas ke pengelola aplikasi.</p>
        <a class="btn btn-primary" href="${req.BASE}/">Kembali ke Dashboard</a></div>`,
    })
  );
});

const PORT = Number(process.env.PORT || 3000);
// dicetak port SEBENARNYA (§ `server.address().port`) supaya skrip uji bisa memakai PORT=0 (port acak
// dari sistem) dan membaca nomornya dari baris ini — tidak mungkin bentrok dengan proses lain.
const server = app.listen(PORT, () => console.log('Canvasing SC Sunglasses jalan di port ' + server.address().port));

module.exports = { app, bikinKode };
