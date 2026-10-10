'use strict';
/* Login petugas: pilih nama + PIN angka. Sesi disimpan di tabel petugas_login. */
const crypto = require('crypto');
const { q } = require('./db');

const COOKIE = 'sc_login';
const MASA_BERLAKU_HARI = 30;

/** PIN harus 4-8 angka. */
function pinSah(pin) {
  return /^\d{4,8}$/.test(String(pin || ''));
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), String(salt), 32).toString('hex');
}

function buatPetugas(nama, pin) {
  const bersih = String(nama || '').trim();
  const salt = crypto.randomBytes(12).toString('hex');
  const info = q.petugasTambah(bersih, hashPin(pin, salt), salt);
  return Number(info.lastInsertRowid);
}

function gantiPin(id, pin) {
  const salt = crypto.randomBytes(12).toString('hex');
  q.petugasSetPin(Number(id), hashPin(pin, salt), salt);
}

function pinCocok(petugas, pin) {
  if (!petugas || !petugas.pin_hash || !petugas.salt) return false;
  const a = Buffer.from(String(petugas.pin_hash), 'hex');
  const b = Buffer.from(hashPin(pin, petugas.salt), 'hex');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

function buatLogin(petugasId) {
  const token = crypto.randomBytes(24).toString('hex');
  q.loginBuat(token, Number(petugasId), MASA_BERLAKU_HARI);
  return token;
}

/** Cookie ditaruh di path aplikasi (mis. /canvasing) supaya tetap valid di subpath & custom domain. */
function pathCookie(base) {
  return base && base !== '/' ? base : '/';
}

function kirimCookie(res, req, token) {
  res.append(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=${pathCookie(req.BASE)}; Max-Age=${MASA_BERLAKU_HARI * 86400}; HttpOnly; SameSite=Lax`
  );
}

function hapusCookie(res, req) {
  res.append('Set-Cookie', `${COOKIE}=; Path=${pathCookie(req.BASE)}; Max-Age=0; HttpOnly; SameSite=Lax`);
}

function bacaCookie(req, nama) {
  const raw = String((req.headers && req.headers.cookie) || '');
  for (const bagian of raw.split(';')) {
    const i = bagian.indexOf('=');
    if (i < 0) continue;
    if (bagian.slice(0, i).trim() === nama) return decodeURIComponent(bagian.slice(i + 1).trim());
  }
  return '';
}

/** Halaman yang boleh dibuka tanpa login. */
const BEBAS = ['/login', '/logout'];
// berkas statis (css/js/gambar/manifest) tidak berisi data dan dibutuhkan halaman login/media cetak.
// `webmanifest` wajib ada di sini — kalau tidak, permintaan manifest dialihkan ke /login (302) dan
// browser menganggap aplikasi TIDAK punya manifest → tombol "pasang di layar utama" tidak muncul.
const EKSTENSI_BEBAS = /\.(css|js|mjs|png|svg|jpg|jpeg|gif|ico|webp|webmanifest|json|woff2?)$/i;

function bebas(path) {
  return BEBAS.some((p) => path === p || path.startsWith(p + '/')) || EKSTENSI_BEBAS.test(path);
}

/**
 * Wajib login: setiap halaman/API selain daftar BEBAS akan dialihkan ke /login.
 * req.petugas diisi kalau cookie login masih valid.
 */
function middleware(req, res, next) {
  req.BASE = req.headers['x-public-base-path'] || '';
  req.petugas = null;

  const token = bacaCookie(req, COOKIE);
  if (token) {
    const s = q.loginByToken(token);
    if (s) req.petugas = { id: s.petugas_id, nama: s.nama, peran: s.peran || 'admin_gudang' };
    else hapusCookie(res, req);
  }

  if (req.petugas || bebas(req.path)) return next();

  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    const next_ = req.originalUrl && req.originalUrl !== '/login' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
    return res.redirect(req.BASE + '/login' + next_);
  }
  return res.status(401).json({ ok: false, pesan: 'Belum login' });
}

/** Peran: administrator (semua), admin_gudang (operasional), sales (hanya melihat). */
const PERAN = {
  administrator: { label: 'Administrator', warna: 'ungu', bolehUbah: true, bolehHapus: true },
  admin_gudang: { label: 'Admin Gudang', warna: 'biru', bolehUbah: true, bolehHapus: false },
  sales: { label: 'Sales', warna: 'abu', bolehUbah: false, bolehHapus: false },
};

function peranInfo(peran) {
  return PERAN[peran] || { label: peran || '-', warna: 'abu', bolehUbah: false, bolehHapus: false };
}

/** Boleh mengubah data (input barang, kunci, rekap, master, impor). Sales hanya melihat. */
function bolehUbah(req) {
  return !!(req.petugas && peranInfo(req.petugas.peran).bolehUbah);
}

/** Hanya administrator: hapus perjalanan, kelola petugas & peran. */
function admin(req) {
  return !!(req.petugas && req.petugas.peran === 'administrator');
}

module.exports = {
  COOKIE,
  bebas,
  PERAN,
  peranInfo,
  bolehUbah,
  admin,
  middleware,
  pinSah,
  buatPetugas,
  gantiPin,
  pinCocok,
  buatLogin,
  kirimCookie,
  hapusCookie,
  bacaCookie,
  pathCookie,
};
