'use strict';

/**
 * KODE UNIK SURAT JALAN (permintaan user).
 *
 * "setiap buat surat jalan, sales mengeluarkan kode unik sendiri bukan hanya #7 … terus mengikuti jumlah
 *  keluarnya" dan "Kode unik jika Zainal Ardi itu ZA, jika Ahmad Zaki itu AZ, jika Umam Jack itu UJ,
 *  setiap kode yang bisa merepresentasikan nama sales".
 *
 * Aturan:
 *  - nama lebih dari satu kata → inisial tiap kata  (Zainal Ardi → ZA, Ahmad Zaki → AZ)
 *  - nama satu kata           → 3 huruf pertama      (Zainuri → ZAI, Cici → CIC)
 *  - **kode khusus per sales** (lihat `KODE_KHUSUS`) menang di atas aturan umum
 *  - lalu 3 digit nomor urut PER SALES sesuai urutan keluarnya surat jalan (ZA001, ZA002, …)
 *  - kalau inisial dua sales berbeda sama (mis. "Ahmad Zaki" & "Andi Zulkifli" sama-sama AZ), yang
 *    belakangan mendapat huruf tambahan dari namanya supaya tidak pernah bentrok (AZK… → AZK001).
 */

/** Bersihkan nama menjadi huruf/angka saja, huruf besar. */
function bersih(nama) {
  return String(nama || '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * KODE KHUSUS per sales (permintaan user: "Kode Haris menjadi HRS, kode Umam Jack menjadi UMJ").
 * Kunci = nama sales huruf kecil dengan spasi dinormalkan. Aturan umum di bawah TIDAK diubah karena
 * dipakai sales lain — kalau user meminta singkatan lain lagi, cukup tambahkan pasangannya di sini
 * (dan kode surat jalan lama untuk sales itu ikut ditulis ulang oleh migrasi di `lib/db.js`).
 */
const KODE_KHUSUS = {
  haris: 'HRS',
  'umam jack': 'UMJ',
  zainuri: 'ZNR',
};

/** Kode khusus satu sales ('' kalau tidak ada). */
function kodeKhusus(nama) {
  const k = String(nama || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return KODE_KHUSUS[k] || '';
}

/** Inisial dasar nama sales: Zainal Ardi → ZA, Zainuri → ZAI, Haris → HRS (khusus), nama kosong → X. */
function inisial(nama) {
  const khusus = kodeKhusus(nama);
  if (khusus) return khusus;
  const kata = bersih(nama);
  if (!kata.length) return 'X';
  if (kata.length === 1) return (kata[0].slice(0, 3) || 'X').toUpperCase();
  return (kata.map((k) => k[0]).join('') || 'X').toUpperCase();
}

/** Huruf-huruf nama berurutan (dipakai untuk memperpanjang inisial yang bentrok). */
function hurufNama(nama) {
  return bersih(nama)
    .join('')
    .toUpperCase();
}

/**
 * Daftar kode yang sudah terpakai → Map(prefix → nama sales pemiliknya).
 * Digit di belakang kode dibuang supaya bisa dipakai memeriksa bentrok inisial antar sales.
 */
function petaPrefix(kodeAda = [], sesiAda = []) {
  const peta = new Map();
  const pemilik = new Map();
  (sesiAda || []).forEach((s) => {
    if (s && s.kode_unik) pemilik.set(String(s.kode_unik).toUpperCase(), String(s.sales_nama || '').toLowerCase());
  });
  kodeAda.forEach((k) => {
    const kode = String(k || '').toUpperCase();
    const prefix = kode.replace(/\d+$/, '');
    if (!prefix) return;
    if (!peta.has(prefix)) peta.set(prefix, pemilik.get(kode) || null);
  });
  return peta;
}

/**
 * Prefix unik untuk satu sales: kalau inisialnya sudah dipakai sales LAIN, tambah huruf dari namanya.
 * `petaPrefix` = hasil `petaPrefix(kodeAda, sesiAda)`.
 */
function prefixSales(nama, peta = new Map()) {
  const sendiri = String(nama || '').trim().toLowerCase();
  const huruf = hurufNama(nama);
  let d = inisial(nama);
  let i = bersih(nama).length > 1 ? bersih(nama).map((k) => k[0]).join('').length : 3;
  while (peta.has(d) && peta.get(d) !== sendiri && i < huruf.length) {
    d += huruf[i];
    i += 1;
  }
  let n = 2;
  const dasar = d;
  while (peta.has(d) && peta.get(d) !== sendiri) {
    d = dasar + n; // nama yang hurufnya sama persis → tambah angka
    n += 1;
  }
  return d;
}

/**
 * Kode surat jalan berikutnya untuk satu sales, mengikuti jumlah yang sudah keluar.
 * `sesiAda` = semua baris sesi (dipakai mencari nomor terakhir sales ini & bentrok inisial).
 */
function kodeBaru(nama, sesiAda = []) {
  const kodeAda = sesiAda.map((s) => s && s.kode_unik).filter(Boolean);
  const prefix = prefixSales(nama, petaPrefix(kodeAda, sesiAda));
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
  let maks = 0;
  kodeAda.forEach((k) => {
    const m = re.exec(String(k).toUpperCase());
    if (m) maks = Math.max(maks, Number(m[1]));
  });
  return prefix + String(maks + 1).padStart(3, '0');
}

/** Nomor surat jalan yang ditampilkan: kode unik kalau ada, kalau tidak jatuh ke #id. */
function noSurat(sesi) {
  const kode = sesi && sesi.kode_unik ? String(sesi.kode_unik).trim() : '';
  return kode || (sesi && sesi.id ? `#${sesi.id}` : '-');
}

module.exports = { inisial, prefixSales, petaPrefix, kodeBaru, noSurat, kodeKhusus, KODE_KHUSUS };
