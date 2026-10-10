'use strict';
const { esc } = require('../lib/util');

/**
 * Grup tombol AKSI berbentuk IKON KOTAK (permintaan user: "input barang tambahan, rekap, dan cetak
 * buat ikon kotak kotak"). Dipakai halaman perjalanan (`views/sesi.js`).
 *
 * Permintaan user terakhir: "posisi, ukuran ikon dan font juga sama, tidak usah ada warna, setiap ikon
 * ada keterangannya di bawah" → SEMUA tombol memakai bentuk yang sama (ikon di atas, keterangan kecil di
 * bawah, ukuran seragam, warna netral tanpa pengelompokan warna).
 *
 * `items`:
 *  - { href, ikon, judul, ket }                    → tautan
 *  - { form, ikon, judul, ket, attr, kelas }       → tombol submit (mis. kunci/rekap/selesai/hapus)
 * `attr` diisi `data-konfirmasi-tema data-judul="…" data-pesan="…" data-ok="…"` supaya memakai popup
 * konfirmasi bertema (handler-nya di `public/app.js`).
 */
exports.grupAksi = function ({ items = [], ekstra = '' }) {
  const isi = items
    .map((it) => {
      const tombol = `class="ttk-tombol berket${it.kelas ? ' ' + it.kelas : ''}" title="${esc(it.judul)}" aria-label="${esc(it.judul)}"`;
      const dalam = `<span class="ikon-aksi-ikon">${it.ikon}</span><span class="ikon-aksi-ket">${esc(it.ket || '')}</span>`;
      if (it.form) {
        return `<form method="post" action="${it.form}">${
          `<button type="submit" ${tombol} ${it.attr || ''}>${dalam}</button>`
        }</form>`;
      }
      return `<a ${tombol} href="${it.href}">${dalam}</a>`;
    })
    .join('');

  return `<div class="ikon-aksi">${isi}${ekstra}</div>`;
};
