'use strict';
const fs = require('fs');
const path = require('path');
const { esc } = require('../lib/util');
const { TEMA_SCRIPT, PWA_HEAD } = require('./layout');

/*
 * Logo halaman login DITANAM langsung ke halaman (bukan `<img src="logo.svg">`).
 * Alasannya: tulisan "SYAIF COLLECTION" di dalam SVG memakai font nama usaha (`--font-brand`,
 * Montserrat ExtraBold) — kalau SVG-nya dipanggil sebagai gambar, browser TIDAK memuat font dari
 * halaman sehingga tulisannya kembali ke font bawaan. Dengan ditanam, tulisan memakai font yang sama
 * seperti di topbar (permintaan user: "nama usaha lebih tegas"). Dibaca sekali saat modul dimuat.
 */
const LOGO_SVG = fs
  .readFileSync(path.join(__dirname, '..', 'public', 'logo.svg'), 'utf8')
  .replace(/\swidth="\d+"\sheight="\d+"/, '')
  .replace('<svg ', '<svg class="logo-lockup" focusable="false" ');

/** Halaman login. Kalau belum ada petugas sama sekali, tampilkan form buat petugas pertama. */
exports.render = function ({ base, pesan, daftar = [], next = '', setelan = null }) {
  const pertama = daftar.length === 0;
  /*
   * Kalau pengguna sudah mengunggah logo sendiri (Setting → Edit Logo), halaman login ikut memakainya.
   * Kalau belum, logo bawaan ditanam INLINE sebagai SVG supaya tulisan "SYAIF COLLECTION" di dalamnya
   * memakai font nama usaha (lihat catatan LOGO_SVG di atas).
   */
  const logo = setelan && setelan.logo_url ? `<img class="login-logo-img" src="${esc(setelan.logo_url)}" alt="Logo toko">` : LOGO_SVG;

  const isiForm = pertama
    ? `
  <form method="post" action="${base}/login/petugas-pertama" class="stack" style="gap:14px">
    <div class="alert alert-info">Belum ada petugas. Buat petugas pertama (nama + PIN angka) — sesudah ini semua halaman harus login.</div>
    <div>
      <label class="f">Nama petugas</label>
      <input type="text" id="namaPetugas" name="nama" placeholder="mis. ADMIN GUDANG" required autocomplete="off">
    </div>
    <div>
      <label class="f">PIN (angka, 4–8 digit)</label>
      <input type="password" id="pinPetugas" name="pin" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" placeholder="mis. 1234" required autocomplete="new-password">
    </div>
    <div>
      <label class="f">Ulangi PIN</label>
      <input type="password" name="pin2" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="new-password">
    </div>
    <button class="btn btn-primary btn-lg" type="submit">Buat Petugas &amp; Masuk</button>
  </form>`
    : `
  <form method="post" action="${base}/login" class="stack" style="gap:14px">
    <input type="hidden" name="next" value="${esc(next)}">
    <div>
      <label class="f">Nama petugas</label>
      <select name="petugas_id" id="petugasId" required>
        <option value="">— pilih nama petugas —</option>
        ${daftar.map((p) => `<option value="${p.id}">${esc(p.nama)}</option>`).join('')}
      </select>
    </div>
    <div>
      <label class="f">PIN (angka)</label>
      <input type="password" id="pinPetugas" name="pin" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" placeholder="••••" required autocomplete="current-password">
    </div>
    <button class="btn btn-primary btn-lg" type="submit">Masuk</button>
  </form>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Masuk · Canvasing SC Sunglasses</title>
${TEMA_SCRIPT}
${PWA_HEAD(base)}
<link rel="stylesheet" href="${base}/app.css">
</head>
<body>
<main class="container">
  <div class="login-wrap">
    <div class="login-logo">
      ${logo}
    </div>
    <div class="card">
      <h1 style="margin:0 0 6px;font-size:22px">${pertama ? 'Buat Petugas Pertama' : 'Masuk'}</h1>
      <p class="card-hint">${pertama ? 'Nama petugas dipakai sebagai nama admin pada tanda tangan dokumen rekap.' : 'Pilih nama petugas, lalu masukkan PIN angka.'}</p>
      ${pesan ? `<div class="alert alert-warn">${esc(pesan)}</div>` : ''}
      ${isiForm}
    </div>
    <div class="hint" style="text-align:center;margin-top:14px">Nama petugas otomatis tercetak sebagai <b>Admin Gudang</b> pada tanda tangan laporan rekap.</div>
  </div>
</main>
</body>
</html>`;
};
