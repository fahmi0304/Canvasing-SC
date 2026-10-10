'use strict';
const { esc } = require('../lib/util');
const { GARIS } = require('./ikon');

/**
 * Pemilih cara input (permintaan user):
 *  - Semua layar penginputan (barang dibawa, tambahan, rekap) memakai **satu ikon garis tiga** di pojok
 *    kartu; opsi "scan barcode" / "pilih dari daftar" baru muncul setelah ikon itu diklik
 *    ("ikon opsi scan dan mode daftar … dikumpulkan ke ikon garis tiga, setelah di klik baru muncul mau
 *    pakek scan atau daftar seperti biasa").
 *  - Isi panelnya tetap **2 IKON** seperti semula (daftar = garis daftar, scan = logo QR code) dan yang
 *    menyala = yang sedang dipakai, jadi kelas `.mode-ikon`/`.mode-opsi.aktif` + radio `input:checked`
 *    tetap menjadi sumber kebenaran (`pasangMode()` di `public/app.js`).
 *  - Struktur: `.mode-pilih` → `button.mode-buka[data-mode-buka]` (ikon garis tiga) + `.mode-panel[hidden]`
 *    berisi `.mode-ikon[data-mode-switch]`. Jangan hapus kelas lama itu (dipakai skrip uji & JS).
 */
const IKON_DAFTAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>`;
/** Ikon QR code untuk opsi scan (permintaan user). */
const IKON_SCAN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>
<rect x="14" y="14" width="3.5" height="3.5" rx="1"/><path d="M20.5 14v1.5M20.5 19v1.5M17 20.5h3.5M14 20.5h.5"/></svg>`;

exports.modePilih = function ({ area, fokusDaftar, fokusScan, judulDaftar, ketDaftar, judulScan, ketScan }) {
  const ketD = ketDaftar || 'Input biasa: cari barang dari daftar lalu isi jumlahnya.';
  const ketS = ketScan || 'Scan barcode / QR code pakai scanner USB/Bluetooth atau kamera HP.';
  // id panel dibuat unik per area supaya `aria-controls` tetap benar kalau ada lebih dari satu pemilih
  const idPanel = 'modePanel' + String(area || '').replace(/[^A-Za-z0-9]/g, '');
  return `
<div class="mode-pilih" data-mode-pilih>
  <button type="button" class="mode-buka" data-mode-buka aria-expanded="false" aria-controls="${idPanel}" title="Metode penginputan: scan barcode / pilih dari daftar" aria-label="Metode penginputan: scan barcode / pilih dari daftar">${GARIS}</button>
  <div class="mode-panel" id="${idPanel}" data-mode-panel hidden>
    <div class="mode-kepala">Metode penginputan</div>
    <div class="mode-ikon" data-mode-switch="${esc(area)}" data-fokus-daftar="${esc(fokusDaftar || '')}" data-fokus-scan="${esc(fokusScan || '')}" role="group" aria-label="Cara input">
      <label class="mode-opsi aktif" title="${esc(ketD)}">
        <input type="radio" name="_mode" value="daftar" checked aria-label="${esc(judulDaftar || 'Input biasa')} — ${esc(ketD)}">
        <span class="ikon">${IKON_DAFTAR}</span>
      </label>
      <label class="mode-opsi" title="${esc(ketS)}">
        <input type="radio" name="_mode" value="scan" aria-label="${esc(judulScan || 'Scan barcode / QR code')} — ${esc(ketS)}">
        <span class="ikon">${IKON_SCAN}</span>
      </label>
    </div>
    <div class="mode-kaki">Yang menyala = metode yang dipakai</div>
  </div>
</div>`;
};
