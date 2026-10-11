'use strict';
const { esc, angka } = require('../lib/util');

/** Ikon kaca pembesar (pilih barang). */
const IKON_CARI = `<svg class="ikon-pilih" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/></svg>`;

/**
 * HALAMAN "REKAP STOK" — SATU BARANG YANG DIPILIH + tombol **Fix** (permintaan user).
 *
 * Riwayat permintaan:
 *  - mula-mula: lembar rekap seperti form kertas, SEMUA barang jadi baris;
 *  - revisi ke-160: *"jangan langsung tampilkan semua stok, tapi stok yang dipilih, ada ikon pilih barang"*
 *    → halaman ini hanya menampilkan SATU barang (dipilih lewat panel "Pilih barang");
 *  - revisi ke-161: rumus **Selisih = Stok di Sales + Stok Fisik − Stok Kledo** (Stok di Sales = jumlah
 *    seluruh kolom sales) + kepala tabel diperbaiki agar tidak terpotong/tumpang;
 *  - **revisi ke-162 (berlaku sekarang)** — *"kepala header menggunakan angka 1-5 siapa saja yang 1
 *    terserah, tapi ada keterangan nya di pdf, header masih tumpang tindih, perbaiki, kolom rekap rata
 *    tengah, ada tombol fix, setelah tekan fix, hasil rekap pindah ke bawah, cetak pdf itu data yang
 *    sudah fix"*:
 *    1. kepala kolom sales memakai **ANGKA 1..N** (bukan nama sales) seperti form kertas; siapa orangnya
 *       dijelaskan di **keterangan** (di layar & di PDF);
 *    2. angka di kolom sales **rata tengah**;
 *    3. kolom angka dibuat **sempit** supaya tabelnya muat di layar HP tanpa digeser — inilah yang
 *       menghilangkan "kepala tumpang tindih" (sebelumnya kepala ikut tergeser ke bawah kolom Nama
 *       Barang yang membeku saat tabel digeser mendatar);
 *    4. ada tombol **Fix**: menekannya MENYIMPAN hasil hitungan (angka sales, Stok Fisik, Stok Kledo,
 *       Selisih) ke tabel `stok_fix`, lalu hasilnya **muncul di daftar "Hasil Rekap" DI BAWAH tabel**;
 *    5. **hanya data yang sudah difix** yang dicetak PDF-nya;
 *   - **revisi ke-165 (berlaku sekarang)** — *"Barang yang sudah di fix kan, tetap muncul di halaman
 *     rekap stok meski ganti barang lain untuk di rekap, data rekapan tersimpan terserah di mana"*:
 *     daftar **"Hasil Rekap" menampilkan SEMUA barang yang sudah difix** (datanya tersimpan di tabel
 *     `stok_fix`), jadi berpindah barang untuk direkap **tidak menghilangkan** hasil yang sudah ada.
 *     Kartunya selalu dirender (juga saat belum ada barang yang dipilih), baris milik barang yang sedang
 *     dibuka ditandai (+ nama barangnya bisa diklik untuk kembali ke barang itu), dan tombol PDF utama
 *     mencetak semua hasil fix sementara tombol kedua mencetak hasil fix barang yang sedang dibuka.
 *
 * Nilai Stok Fisik & Stok Kledo tetap **tidak disimpan** sebelum tombol Fix ditekan (sesuai keputusan
 * user sebelumnya) — yang disimpan hanyalah hasil fix itu.
 */
exports.render = function ({ daftar, barang, sales, matriks, hasil = [], hasilBarang = [], base, pesan, versi = '', bolehUbah = true }) {
  const kolomSales = Array.isArray(sales) ? sales : [];
  const kunci = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const terpilih = barang || null;
  const hasilTerpilih = Array.isArray(hasilBarang) ? hasilBarang : [];
  const adaHasil = hasil.length > 0;
  /** Keterangan nomor: "1 = Ahmad Zaki · 2 = Haris · …" (dipakai di layar & PDF). */
  const keteranganNomor = kolomSales.length
    ? kolomSales.map((n, i) => `<b>${i + 1}</b> = ${esc(n)}`).join(' &nbsp;·&nbsp; ')
    : '<b>—</b> belum ada data sales';

  const itemPilih = daftar
    .map(
      (p) => `<a class="pilih-item${terpilih && Number(terpilih.id) === Number(p.id) ? ' aktif' : ''}" data-pilih-item
        href="${base}/rekap-stok?barang=${Number(p.id)}" data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}">
        <span class="nm">${esc(p.nama)}</span><span class="kd">${esc(p.kode)}</span></a>`
    )
    .join('');

  /* ---------- tabel input (satu barang) ---------- */
  const baris = terpilih
    ? (() => {
        const nilai = matriks[terpilih.id] || {};
        let totalSales = 0;
        const selSales = kolomSales
          .map((nama) => {
            const q = Number(nilai[kunci(nama)] || 0);
            totalSales += q;
            return `<td class="num tengah">${q ? angka(q) : ''}</td>`;
          })
          .join('');
        return `<tr data-id="${terpilih.id}" data-nama="${esc(String(terpilih.nama).toLowerCase())}" data-total-sales="${totalSales}" class="baris-sorot">
        <td class="beku"><span class="nm">${esc(terpilih.nama)}</span><span class="kd">${esc(terpilih.kode)}</span></td>
        ${selSales}
        <td class="kolom-isi"><input type="number" min="0" inputmode="numeric" name="fisik" data-fisik value="" aria-label="Stok fisik ${esc(terpilih.nama)}"></td>
        <td class="kolom-isi"><input type="number" min="0" inputmode="numeric" name="kledo" data-kledo value="" aria-label="Stok kledo ${esc(terpilih.nama)}"></td>
        <td class="kolom-selisih" data-selisih>—</td>
      </tr>`;
      })()
    : '';

  const tabel = terpilih
    ? `<form method="post" action="${base}/rekap-stok/fix" id="formFix" class="form-fix">
    <input type="hidden" name="produk_id" value="${Number(terpilih.id)}">
    <div class="tbl-wrap">
      <table class="tbl tbl-pekat kolom-beku" id="tblStok">
        <thead>
          <tr>
            <th rowspan="2" class="beku">Nama Barang</th>
            <th colspan="${kolomSales.length || 1}" class="tengah kelompok">Stok di Sales</th>
            <th rowspan="2" class="tengah kolom-isian">Stok Fisik</th>
            <th rowspan="2" class="tengah kolom-isian">Stok Kledo</th>
            <th rowspan="2" class="tengah kolom-isian">Selisih</th>
          </tr>
          <tr>${(kolomSales.length ? kolomSales : ['—']).map((n, i) => `<th class="tengah nama-sales" title="${esc(n)}">${i + 1}</th>`).join('')}</tr>
        </thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
    <div class="aksi-row aksi-dua aksi-satu fix-baris">
      <button class="btn btn-primary btn-lg" type="submit" id="btnFix" data-konfirmasi-tema
        data-judul="Fix hasil rekap ini?"
        data-pesan="Hasil hitungan barang ini (angka stok tiap sales, Stok Fisik, Stok Kledo, dan Selisih) akan disimpan sebagai hasil rekap yang sudah difix, lalu muncul di daftar bawah. Hanya data yang sudah difix yang ikut tercetak di PDF."
        data-ok="Ya, fix">Fix</button>
    </div>
  </form>`
    : '<p class="card-hint">Belum ada barang yang dipilih. Buka <b>ikon “Pilih barang”</b> di atas untuk memilih barangnya — atau klik nama barang di halaman Inventory.</p>';

  /* ---------- daftar hasil Fix (di bawah tabel) ---------- */
  const barisHasil = hasil
    .map((h, i) => {
      let rinci = [];
      try { rinci = JSON.parse(h.sales_json || '[]') || []; } catch (e) { rinci = []; }
      const sel = kolomSales
        .map((nama, j) => {
          const barisRinci = rinci[j] || {};
          const q = Number(barisRinci.qty || 0);
          return `<td class="num tengah" title="${esc(nama)}">${q ? angka(q) : ''}</td>`;
        })
        .join('');
      /*
       * Kolom "Waktu fix" & nama petugas yang memfix sudah DIHAPUS (permintaan user: "tidak usah waktu
       * fix … yang memfix kan tidak usah dicantumkan") — barisnya cukup berisi datanya saja, dan
       * tiap Fix baru MENYUSUL di baris paling bawah (urutan dari server: lama → baru).
       *
       * Baris milik barang yang SEDANG DIBUKA ditandai `.baris-terpilih` dan nama barangnya bisa diklik
       * untuk kembali ke barang itu (memudahkan lompat-lompat saat merekap banyak barang).
       */
      const sedangDibuka = terpilih && Number(h.produk_id) === Number(terpilih.id);
      return `<tr data-fix="${h.id}"${sedangDibuka ? ' class="baris-terpilih"' : ''}>
        <td class="num-no tengah">${i + 1}</td>
        <td class="beku"><a class="barang-pilih" href="${base}/rekap-stok?barang=${Number(h.produk_id)}"
          title="Buka rekap stok barang ini"><span class="nm">${esc(h.nama)}</span><span class="kd">${esc(h.kode)}</span></a></td>
        ${sel}
        <td class="num tengah">${angka(h.fisik)}</td>
        <td class="num tengah">${angka(h.kledo)}</td>
        <td class="num tengah ${Number(h.selisih) !== 0 ? 'ada-selisih' : ''}">${angka(h.selisih)}</td>
        ${
          bolehUbah
            ? `<td class="aksi-sel"><form method="post" action="${base}/rekap-stok/fix/hapus" class="form-hapus-fix">
          <input type="hidden" name="id" value="${h.id}">
          <input type="hidden" name="produk_id" value="${h.produk_id}">
          <button class="ttk-tombol ttk-hapus" type="submit" data-konfirmasi-tema
            data-judul="Hapus hasil rekap ini?"
            data-pesan="Baris hasil rekap yang sudah difix ini akan dihapus dan tidak ikut tercetak di PDF."
            data-ok="Ya, hapus" title="Hapus hasil rekap">✕</button>
        </form></td>`
            : '<td class="aksi-sel"></td>'
        }
      </tr>`;
    })
    .join('');

  /*
   * KARTU "Hasil Rekap" — SELALU dirender dan isinya **SEMUA barang yang sudah difix** (permintaan user
   * terbaru: *"Barang yang sudah di fix kan, tetap muncul di halaman rekap stok meski ganti barang lain
   * untuk di rekap"*). Sebelumnya kartu ini hanya tampil untuk barang yang sedang dibuka dan hanya
   * memuat baris barang itu, sehingga hasil fix barang sebelumnya "hilang" dari layar begitu barangnya
   * diganti untuk direkap. Datanya sendiri selalu tersimpan di tabel `stok_fix` (server), jadi
   * berpindah barang tidak menghapus apa pun.
   */
  const tombolPdf = adaHasil
    ? `<a class="btn btn-primary" href="${base}/cetak/rekap-stok-pdf?semua=1${versi ? '&v=' + esc(versi) : ''}" target="_blank" rel="noopener" data-pdf-buka>Cetak PDF (semua)</a>${
        terpilih && hasilTerpilih.length
          ? `<a class="btn btn-ghost" href="${base}/cetak/rekap-stok-pdf?barang=${Number(terpilih.id)}${versi ? '&v=' + esc(versi) : ''}" target="_blank" rel="noopener" data-pdf-buka>Cetak PDF barang ini</a>`
          : ''
      }`
    : '';

  const kartuHasil = `<div class="card kartu-hasil" id="kartuHasil">
    <div class="kepala-hasil">
      <h2 class="card-title-heading">Hasil Rekap (sudah difix)</h2>
      ${tombolPdf ? `<div class="hasil-aksi">${tombolPdf}</div>` : ''}
    </div>
    ${
      adaHasil
        ? `<p class="card-hint">Semua barang yang sudah difix tetap tampil di daftar ini, termasuk saat barangnya diganti untuk direkap. Baris yang ditandai warna = barang yang sedang dibuka (namanya bisa diklik untuk pindah ke barang itu). Keterangan nomor kolom: ${keteranganNomor}</p>
    <div class="tbl-wrap">
      <table class="tbl rapat kolom-beku" id="tblHasilStok">
        <thead>
          <tr>
            <th rowspan="2" class="num-no tengah">NO</th>
            <th rowspan="2" class="beku">Nama Barang</th>
            <th colspan="${kolomSales.length || 1}" class="tengah kelompok">Stok di Sales</th>
            <th rowspan="2" class="tengah kolom-isian">Stok Fisik</th>
            <th rowspan="2" class="tengah kolom-isian">Stok Kledo</th>
            <th rowspan="2" class="tengah kolom-isian">Selisih</th>
            <th rowspan="2" class="aksi-sel"></th>
          </tr>
          <tr>${(kolomSales.length ? kolomSales : ['—']).map((n, i) => `<th class="tengah nama-sales" title="${esc(n)}">${i + 1}</th>`).join('')}</tr>
        </thead>
        <tbody>${barisHasil}</tbody>
      </table>
    </div>`
        : '<p class="card-hint">Belum ada hasil rekap yang difix. Pilih barang, isi <b>Stok Fisik</b> &amp; <b>Stok Kledo</b> di tabel atas, lalu tekan tombol <b>Fix</b> — hasilnya muncul di sini dan tetap tersimpan walau barangnya diganti.</p>'
    }
  </div>`;

  return `
<div class="halaman-rekap-stok">
<div class="page-head">
  <div>
    <h1>Rekap Stok</h1>
    <div class="sub">Stok satu barang yang masih dibawa tiap sales (kolom B + T dari surat jalan yang belum selesai), plus kolom hitung fisik.</div>
  </div>
  <div class="aksi">
    <a class="btn btn-ghost" href="${base}/barang">Kembali ke Inventory</a>
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="card">
  <div class="urut-baris">
    <details class="pilih-barang" id="pilihBarang" data-pilih-barang>
      <summary class="btn btn-ghost btn-sm" title="Pilih barang" aria-label="Pilih barang">${IKON_CARI}<span>Pilih barang</span></summary>
      <div class="pilih-panel" data-pilih-panel>
        <div class="pilih-kepala">Pilih barang
          <button class="pilih-tutup" type="button" data-pilih-tutup aria-label="Tutup">&times;</button>
        </div>
        <input type="search" id="cariPilihBarang" data-pilih-cari placeholder="Cari nama / kode barang…" autocomplete="off">
        <div class="pilih-daftar" data-pilih-daftar>${itemPilih || '<div class="pilih-kosong">Belum ada barang di master.</div>'}</div>
        <div class="pilih-kaki" id="infoPilihBarang">${angka(daftar.length)} barang</div>
      </div>
    </details>
    <span class="terpilih">${terpilih ? `Barang: <b>${esc(terpilih.nama)}</b> <span class="kd">${esc(terpilih.kode)}</span>` : 'Barang: <b>belum dipilih</b>'}</span>
  </div>
  ${tabel}
  ${
    terpilih
      ? `<span class="hint hint-pilih">Kolom <b>Stok Fisik</b> &amp; <b>Stok Kledo</b> diisi di sini, lalu tekan <b>Fix</b> untuk menyimpannya sebagai hasil rekap — hasilnya masuk daftar <b>Hasil Rekap</b> di bawah (tetap tampil walau pindah ke barang lain) dan <b>hanya data yang sudah difix</b> yang ikut tercetak PDF.</span>
  <p class="card-hint keterangan-nomor">Keterangan nomor kolom: ${keteranganNomor}</p>`
      : ''
  }
</div>
${kartuHasil}
</div>`;
};
