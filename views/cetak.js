'use strict';
const { esc } = require('../lib/util');

/** Logo printer (SVG) — dipakai tombol opsi cetak. */
const IKON_PRINTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M7 9V4h10v5"/><path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-4A2.5 2.5 0 0 1 5.5 9h13A2.5 2.5 0 0 1 21 11.5v4A2.5 2.5 0 0 1 18.5 18H17"/>
<rect x="7" y="14" width="10" height="7" rx="1.5"/><path d="M17.5 12h.01"/></svg>`;

/**
 * Opsi cetak berupa tombol berlogo printer (permintaan user) — opsinya baru muncul setelah diklik.
 *
 * Sejak permintaan user terbaru ("Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak
 * PDF saja, 1 ikon") SEMUA isinya adalah berkas PDF dan **tidak ada lagi halaman cetak HTML**:
 * - setiap tautan memakai `target="_blank"` (pilihan user: "PDF-nya terbuka di tab baru untuk
 *   dilihat/dicetak dari penampil PDF") + `data-pdf-buka` sebagai penanda;
 * - `data-pdf-buka` ditangani `public/app.js`: kalau tab baru DIBLOKIR (mode aplikasi terpasang/PWA,
 *   WebView di dalam aplikasi chat) PDF-nya dibuka di tab ini supaya ikonnya tidak terlihat mati
 *   (jebakan lama revisi ke-81/ke-82).
 *
 * opsi: [{ label, ket, href, utama }] — `ket` opsional, `utama` = disorot.
 * `bawah`: keterangan kecil DI BAWAH ikon (dipakai di halaman perjalanan supaya semua ikon aksi sama bentuk).
 */
exports.opsiCetak = function ({ base = '', opsi = [], judul = 'Cetak PDF', label = 'Cetak PDF', kecil = false, bawah = '', nonaktif = '' }) {
  if (!opsi.length && !nonaktif) return '';
  const isi = opsi
    .map(
      (o) => `<a role="menuitem"${o.utama ? ' class="utama"' : ''} target="_blank" rel="noopener" data-pdf-buka href="${base}${esc(o.href)}">
        <span class="cetak-ikon">⬇</span><span>${esc(o.label)}${o.ket ? `<small>${esc(o.ket)}</small>` : ''}</span>
      </a>`
    )
    .join('');

  const dalam = bawah
    ? `<span class="ikon-aksi-ikon">${IKON_PRINTER}</span><span class="ikon-aksi-ket">${esc(bawah)}</span>`
    : `${IKON_PRINTER}${kecil ? '' : `<span>${esc(label)}</span>`}`;

  return `<div class="cetak" data-cetak>
    <button class="cetak-tombol${kecil ? ' kecil' : ''}${bawah ? ' berket' : ''}" type="button" data-cetak-buka aria-haspopup="true" aria-expanded="false" aria-label="${esc(judul)}" title="${esc(judul)}">
      ${dalam}
    </button>
    <div class="cetak-menu" data-cetak-menu role="menu">
      <div class="cetak-kepala">${esc(judul)}</div>
      ${isi}
      ${nonaktif ? `<div class="cetak-kosong">${esc(nonaktif)}</div>` : ''}
    </div>
  </div>`;
};

/**
 * Ikon cetak yang LANGSUNG membuka berkas PDF — dipakai tempat yang hanya punya SATU dokumen
 * (kepala halaman Laporan & Laporan per sales), supaya pengguna tidak perlu membuka menu dulu
 * ("langsung cetak PDF saja, 1 ikon"). Bentuknya sama dengan tombol ikon lain (`.ttk-tombol`).
 */
exports.ikonPdf = function ({ base = '', href, judul = 'Cetak PDF', label = '' }) {
  return `<a class="ttk-tombol" href="${base}${esc(href)}" target="_blank" rel="noopener" data-pdf-buka aria-label="${esc(judul)}" title="${esc(judul)}"${label ? ` data-label="${esc(label)}"` : ''}>${IKON_PRINTER}</a>`;
};

exports.IKON_PRINTER = IKON_PRINTER;
