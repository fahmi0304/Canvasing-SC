'use strict';
const { esc } = require('../lib/util');
const { KALENDER, SETTING } = require('./ikon');

/** 12 warna tetap untuk grafik (permintaan user: "setidaknya ada 12 warna yang identik"). */
const PALET = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#6366f1', '#f97316', '#0891b2'];

/**
 * KARTU GRAFIK PENJUALAN (permintaan user) — dipakai di DASBOR dan LAPORAN.
 *
 * Permintaan yang berlaku:
 *  - **4 kartu ringkasan di ATAS, dua di antaranya tombol**: "Terjual", "Sales", dan "Hari" bisa diklik
 *    untuk membuka tampilan di bawahnya; **semua tampilan tersembunyi dulu** (permintaan user:
 *    "hidden semua grafik penjualan, saat grafik terjual di klik … saat sales di klik … saat hari di klik").
 *    - **Terjual** → daftar **jenis barang dari yang paling banyak terjual** (No · Nama Barang · Jumlah Terjual).
 *    - **Sales** → grafik batang penjualan per sales.
 *    - **Hari** → grafik batang penjualan per hari.
 *    - "Rata-rata" hanya angka ringkasan (tidak diklik).
 *  - **Semua grafik berbentuk BATANG** — pengaturan bentuk grafik DIHAPUS (permintaan user).
 *  - Ikon **kalender** (filter periode) & **roda gigi** (warna sales) di pojok kanan atas, lurus dengan judul.
 *  - "customize bisa memilih memunculkan grafik atau tidak" → kartu ini punya `data-blok` +
 *    `data-blok-nama`, jadi otomatis muncul di modal Customize Tampilan halaman itu.
 *  - "di bawah grafik penjualan ada tulisan bulan grafik dibuat" → `[data-grafik-kaki]` di dasar kartu.
 *  - keterangan warna per sales (`[data-grafik-legenda]`) sudah DIHAPUS (permintaan user).
 */
exports.kartuGrafik = function ({ id = 'grafikPenjualan', judul = 'Grafik Penjualan', blok = 'grafik', judulBlok = 'Grafik Penjualan' } = {}) {
  const idPanel = id + 'Filter';
  const idSetting = id + 'Setting';
  return `<section class="card kartu-grafik" id="${id}" data-grafik data-blok="${esc(blok)}" data-blok-nama="${esc(judulBlok)}">
  <div class="grafik-head">
    <!-- permintaan user: judul grafik ditulis di dalam kotak (strip gradien), sama seperti judul tabel transaksi -->
    <h2 class="card-title-heading">${esc(judul)}</h2>
    <div class="grafik-ikon">
      <button class="ttk-tombol-mini" type="button" data-grafik-filter aria-expanded="false" aria-controls="${esc(idPanel)}" aria-label="Filter periode grafik" title="Filter periode (hari ini / satu bulan / tahun / custom)">
        ${KALENDER}
      </button>
      <button class="ttk-tombol-mini" type="button" data-grafik-setting aria-expanded="false" aria-controls="${esc(idSetting)}" aria-label="Warna sales" title="Warna sales pada grafik">
        ${SETTING}
      </button>
    </div>
  </div>
  <div class="grafik-panel" id="${esc(idPanel)}" hidden>
    <div class="grafik-filter" role="group" aria-label="Filter periode">
      <button type="button" class="chip" data-periode="hari">Hari ini</button>
      <button type="button" class="chip" data-periode="bulan">Satu bulan</button>
      <button type="button" class="chip" data-periode="tahun">Tahun ini</button>
      <button type="button" class="chip" data-periode="custom">Custom</button>
    </div>
    <form class="periode grafik-custom" data-grafik-custom hidden>
      <div class="field"><label class="f">Dari tanggal</label><input type="date" data-grafik-dari></div>
      <div class="field"><label class="f">Sampai tanggal</label><input type="date" data-grafik-sampai></div>
      <button class="btn btn-primary btn-sm" type="submit">Tampilkan</button>
    </form>
  </div>
  <div class="grafik-panel grafik-setelan" id="${esc(idSetting)}" data-grafik-panel-setelan hidden>
    <div class="setelan-warna">
      <div class="setelan-label">Warna sales <small>(12 warna — pilih per sales)</small></div>
      <div class="warna-daftar" data-grafik-warna></div>
    </div>
  </div>
  <div class="grafik-total" data-grafik-total>Memuat data…</div>
  <div class="grafik-view" id="${esc(id)}-barang" data-grafik-view="barang" hidden>
    <h3 class="grafik-sub">Barang paling banyak terjual</h3>
    <div class="tbl-wrap" data-grafik-barang></div>
  </div>
  <div class="grafik-view" id="${esc(id)}-sales" data-grafik-view="sales" hidden>
    <h3 class="grafik-sub">Penjualan per sales</h3>
    <div class="grafik-list" data-grafik-list></div>
  </div>
  <div class="grafik-view" id="${esc(id)}-hari" data-grafik-view="hari" hidden>
    <h3 class="grafik-sub">Penjualan per hari</h3>
    <div class="grafik-harian" data-grafik-harian></div>
  </div>
  <div class="grafik-kaki" data-grafik-kaki></div>
</section>`;
};

exports.PALET_GRAFIK = PALET;
