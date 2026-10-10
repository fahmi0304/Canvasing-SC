'use strict';
const { esc } = require('../lib/util');
const { GARIS } = require('./ikon');

/**
 * Menu per baris: satu tombol GARIS TIGA di kolom Aksi yang menampung SEMUA opsi
 * (permintaan user: "opsinya juga dikumpulkan semua ke garis tiga").
 *
 * `opsi` item:
 *  - { href, label, ket, ikon, target, kelas, attr }  → tautan (`attr` dipakai untuk `data-pdf-buka`)
 *  - { form: action, input, label, ket, ikon, attr }  → tombol submit (mis. Hapus)
 *  - { label, ket, ikon, attr }                       → tombol biasa (JS)
 * Untuk hapus dipakai `attr: 'data-konfirmasi-tema data-judul="…" data-pesan="…"'` supaya
 * konfirmasinya memakai popup bertema (bukan confirm() bawaan browser) — lihat `public/app.js`.
 *
 * Menu selalu tampil UTUH: saat dibuka, `pasangTitikTiga()` memindahkannya ke <body> dan
 * memposisikannya `fixed` (lihat `public/app.css` → `.ttk-menu.melayang`) supaya tidak
 * terpotong oleh `.tbl-wrap { overflow: auto }`.
 */
exports.menuBaris = function ({ judul = 'Menu', opsi = [] }) {
  /*
   * Tidak ada opsi → TIDAK ada tombol menu sama sekali. Dipakai sejak revisi ke-138: menu baris DASBOR
   * bisa benar-benar kosong (mis. baris draft untuk peran yang tidak boleh menghapus — opsi "Buka" sudah
   * dihapus karena barisnya sendiri bisa diklik), dan tombol garis tiga tanpa isi hanya membingungkan.
   */
  if (!opsi.length) return '';
  const isi = opsi
    .map((o) => {
      const ikon = `<span class="ttk-ikon">${o.ikon || '•'}</span>`;
      const teks = `<span>${esc(o.label)}${o.ket ? `<small>${esc(o.ket)}</small>` : ''}</span>`;
      /*
       * `target: true` (dipakai semua opsi cetak) DITERJEMAHKAN ke `_blank`. Sebelumnya nilai boolean itu
       * ditulis apa adanya menjadi `target="true"`, dan browser memperlakukannya sebagai **nama jendela
       * "true"** — bukan tab baru seperti yang dimaksud: setelah tab cetak pertama terbuka, semua tombol
       * cetak lain (termasuk dari baris surat jalan yang berbeda) menimpa tab yang sama.
       */
      const target = o.target === true ? '_blank' : String(o.target || '');
      if (o.form) {
        return `<form method="post" action="${o.form}">
        ${o.input || ''}
        <button type="submit"${o.kelas ? ` class="${o.kelas}"` : ''} ${o.attr || ''}>${ikon}${teks}</button>
      </form>`;
      }
      if (o.attr && !o.href) return `<button type="button" ${o.attr}>${ikon}${teks}</button>`;
      // `attr` juga berlaku untuk TAUTAN (dipakai `data-pdf-buka` pada opsi cetak PDF).
      return `<a role="menuitem" href="${o.href}"${target ? ` target="${esc(target)}" rel="noopener"` : ''}${o.attr ? ` ${o.attr}` : ''}${o.kelas ? ` class="${o.kelas}"` : ''}>${ikon}${teks}</a>`;
    })
    .join('');

  return `<div class="ttk" data-ttk>
  <button class="ttk-tombol" type="button" data-ttk-buka aria-haspopup="true" aria-expanded="false" aria-label="${esc(judul)}">
    ${GARIS}
  </button>
  <div class="ttk-menu" data-ttk-menu role="menu">
    <div class="ttk-kepala">${esc(judul)}</div>
    ${isi}
  </div>
</div>`;
};

/*
 * ---------- BARIS YANG BISA DIKLIK (permintaan user) ----------
 * "Tombol overview di dasbor dan laporan hapus, fungsinya pindah ke klik baris laporannya".
 * Jadi opsi "Overview" DIHAPUS dari kedua menu baris (dasbor & laporan) dan fungsinya dipindah ke
 * **klik pada barisnya sendiri** — inilah alamat yang dituju.
 *
 * Surat jalan yang masih DRAFT belum punya laporan, jadi barisnya membuka HALAMAN PERJALANANNYA
 * (`/sesi/:id`) — sama dengan tujuan opsi "Buka". Perilaku "draft tidak punya Overview" itu permintaan
 * user sebelumnya, jangan diubah.
 *
 * PENTING: alamatnya WAJIB memakai awalan `base` (header `X-Public-Base-Path`, mis. `/canvasing` saat
 * aplikasi ada di subpath). Tanpa itu pengalihannya menuju akar domain (`https://…/sesi/37/overview`)
 * dan berakhir **404 "Halaman tidak dapat ditemukan"** — itu keluhan user pada revisi 128. Karena itu
 * `base` diteruskan dari view pemanggil; jangan memanggil `attrBarisKlik()` tanpa `base`.
 */
exports.alamatBaris = function (s, base = '') {
  return `${base}${s.status === 'draft' ? `/sesi/${s.id}` : `/sesi/${s.id}/overview`}`;
};

/** Atribut untuk `<tr>` supaya SELURUH baris bisa diklik. Handlernya `pasangKlikBaris()` di public/app.js. */
exports.attrBarisKlik = function (s, base = '') {
  return ` class="baris-klik" data-baris-open="${esc(exports.alamatBaris(s, base))}" tabindex="0" role="link"`;
};
