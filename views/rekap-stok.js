'use strict';
const { esc, angka } = require('../lib/util');
/*
 * Ikon tombol hapus. Permintaan user revisi ke-171: *"Tombol hapus rekap menggunakan ikon sampah"* —
 * tombol hapus hasil rekap memakai **ikon sampah** aplikasi (`views/ikon.js → HAPUS`), bukan lagi
 * karakter "✕". Ikonnya SVG, jadi tampil sama di semua perangkat (tidak bergantung font emoji).
 */
const { HAPUS } = require('./ikon');

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
 *   - **revisi ke-165** — *"Barang yang sudah di fix kan, tetap muncul di halaman rekap stok meski ganti
 *     barang lain untuk di rekap, data rekapan tersimpan terserah di mana"*: daftar **"Hasil Rekap"
 *     menampilkan SEMUA hasil rekap** (datanya tersimpan di tabel `stok_fix`), jadi berpindah barang
 *     untuk direkap **tidak menghilangkan** hasil yang sudah ada. Kartunya selalu dirender (juga saat
 *     belum ada barang yang dipilih) dan baris milik barang yang sedang dibuka ditandai.
 *   - **revisi ke-167** — cetak PDF-nya **SATU tombol** untuk semua hasil rekap; opsi "Cetak PDF barang
 *     ini" dihapus dari kartu.
 *   - **revisi ke-168 (BERLAKU SEKARANG)** — *"Stok fisik terbagi jadi 2, 1 total stok di sales,
 *     otomatis, 2 total stok di gudang manual, tulisan semua barang yang sudah di fix di tombol cetak dan
 *     halaman pdf di hapus"*:
 *     1. kolom **Stok Fisik** diganti **DUA** kolom: **Total Stok di Sales** (OTOMATIS = jumlah seluruh
 *        kolom sales 1..N, ditampilkan sebagai kolom sendiri) + **Total Stok di Gudang** (diisi manual);
 *        kolom **Stok Kledo** tetap seperti semula;
 *     2. **Selisih = Total Stok di Sales + Total Stok di Gudang - Stok Kledo** (di layar & di server);
 *     3. frasa **"semua barang yang sudah difix" DIHAPUS** dari tombol cetak (sekarang
 *        **"Cetak PDF Rekap Stok"**), dari judul kartu ("Hasil Rekap"), dari baris keterangan kartu
 *        (sisanya hanya "Keterangan nomor kolom: …"), dan dari dokumen PDF (keterangan di bawah judul
 *        cukup **"Tahun 20xx"**).
 *
 * Nilai Total Stok di Gudang & Stok Kledo tetap **tidak disimpan** sebelum tombol Fix ditekan (sesuai
 * keputusan user sebelumnya) — yang disimpan hanyalah hasil fix itu (kolom DB-nya bernama `gudang`).
 */
exports.render = function ({ daftar, barang, sales, matriks, hasil = [], base, pesan, versi = '', bolehUbah = true }) {
  const kolomSales = Array.isArray(sales) ? sales : [];
  const kunci = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const terpilih = barang || null;
  const adaHasil = hasil.length > 0;

  /*
   * PENANDA SELISIH (permintaan user revisi ke-174 → dikoreksi revisi ke-175 & ke-176):
   *  - **0** → ditulis **"Valid"** saja (ukuran & ketebalan SAMA seperti angka lain) — angka 0 TIDAK
   *    ditulis lagi (revisi ke-176: *"Barang yang valid hanya tertulis Valid, tanpa angka 0"*);
   *  - **minus** → angka (`-3`) **MERAH & BOLD** (tanpa kata "Minus");
   *  - **lebih** → angka (`3`) **HIJAU & BOLD** (tanpa kata "Lebih").
   * Aturan & warnanya SENGAJA sama dengan dokumen PDF (`lib/rekapStok.js`) — kalau salah satu diubah,
   * ubah yang lain juga. Di layar warnanya lewat kelas CSS `.ket-minus` / `.ket-lebih` (`app.css`).
   */
  const tampilanSelisih = (nilai) => {
    const n = Number(nilai) || 0;
    if (n === 0) return { tulis: 'Valid', kelas: 'ket-valid' };
    return { tulis: angka(n), kelas: n < 0 ? 'ket-minus' : 'ket-lebih' };
  };
  /** Rekap di bawah tabel: jumlah baris valid + total minus + total lebih (sama dengan PDF). */
  const rekapSelisih = (daftarHasil) => {
    let valid = 0; let minus = 0; let lebih = 0;
    daftarHasil.forEach((h) => {
      const n = Number(h.selisih) || 0;
      if (n === 0) valid += 1;
      else if (n < 0) minus += Math.abs(n);
      else lebih += n;
    });
    return { valid, minus, lebih };
  };
  /** Keterangan nomor: "1 = Ahmad Zaki · 2 = Haris · …" (dipakai di layar & PDF). */
  const keteranganNomor = kolomSales.length
    ? kolomSales.map((n, i) => `<b>${i + 1}</b> = ${esc(n)}`).join(' &nbsp;·&nbsp; ')
    : '<b>—</b> belum ada data sales';

  /*
   * KEPALA TABEL (revisi ke-169) — dua kolom "Total Stok di Sales" & "Total Stok di Gudang" tetap DUA
   * kolom seperti sebelumnya, tetapi **kepalanya digabung satu** menjadi kelompok **"Total Stok Fisik"**
   * dengan sub-kepala **Sales** & **Gudang** di baris kedua (permintaan user: *"total stok di gudang dan
   * total stok di sales kolom atas jadi satu, total stok fisik, di bawahnya sales, gudang, tetap 2 kolom,
   * tapi header nya saja"*).
   *
   * SKU (kode barang) TIDAK ditampilkan lagi di halaman ini (permintaan user: *"Sku tidak usah di
   * tampilkan"*) — nama barang saja. Pencarian tetap bisa memakai kode karena `data-cari` masih memuat
   * kode + nama.
   */
  const kepalaKelompok = (jumlahSales, denganNo) => `
          <tr>
            ${denganNo ? '<th rowspan="2" class="num-no tengah">NO</th>' : ''}
            <th rowspan="2" class="beku">Nama Barang</th>
            <th colspan="${jumlahSales}" class="tengah kelompok">Stok di Sales</th>
            <th colspan="2" class="tengah kelompok kelompok-fisik">Total Stok Fisik</th>
            <th rowspan="2" class="tengah kolom-isian">Stok<br>Kledo</th>
            <th rowspan="2" class="tengah kolom-isian">Selisih</th>
            ${denganNo ? '<th rowspan="2" class="aksi-sel"></th>' : ''}
          </tr>
          <tr>${kolomSales.map((n, i) => `<th class="tengah nama-sales" title="${esc(n)}">${i + 1}</th>`).join('')}<th class="tengah nama-total">Sales</th><th class="tengah nama-total">Gudang</th></tr>`;

  const itemPilih = daftar
    .map(
      (p) => `<a class="pilih-item${terpilih && Number(terpilih.id) === Number(p.id) ? ' aktif' : ''}" data-pilih-item
        href="${base}/rekap-stok?barang=${Number(p.id)}" data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}">
        <span class="nm">${esc(p.nama)}</span></a>`
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
        <td class="beku"><span class="nm">${esc(terpilih.nama)}</span></td>
        ${selSales}
        <td class="num tengah kolom-total" data-total-terlihat>${angka(totalSales)}</td>
        <td class="kolom-isi"><input type="number" min="0" inputmode="numeric" name="gudang" data-gudang value="" aria-label="Total stok di gudang ${esc(terpilih.nama)}"></td>
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
        <thead>${kepalaKelompok(kolomSales.length || 1, false)}</thead>
        <tbody>${baris}</tbody>
      </table>
    </div>
    <div class="aksi-row aksi-dua aksi-satu fix-baris">
      <button class="btn btn-primary btn-lg" type="submit" id="btnFix" data-konfirmasi-tema
        data-judul="Fix hasil rekap ini?"
        data-pesan="Hasil hitungan barang ini (Total Stok Fisik: Sales & Gudang, Stok Kledo, dan Selisih) akan disimpan sebagai hasil rekap, lalu muncul di daftar bawah. Hanya hasil rekap itulah yang ikut tercetak di PDF."
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
      /*
       * KETERANGAN SELISIH di dalam kolom SELISIH, **di bawah angkanya** (permintaan user revisi ke-174):
       * 0 → "Valid" (netral), minus → "Minus" (merah), lebih → "Lebih" (hijau). Warnanya SAMA dengan
       * dokumen PDF-nya. Angka & keterangannya ditaruh di dalam `<span>` terpisah supaya skrip uji (dan
       * pembaca layar) bisa membedakan keduanya — jangan digabung jadi satu teks.
       */
      const nilaiSelisih = Number(h.selisih) || 0;
      const tapSelisih = tampilanSelisih(nilaiSelisih);
      return `<tr data-fix="${h.id}"${sedangDibuka ? ' class="baris-terpilih"' : ''}>
        <td class="num-no tengah">${i + 1}</td>
        <td class="beku"><a class="barang-pilih" href="${base}/rekap-stok?barang=${Number(h.produk_id)}"
          title="Buka rekap stok barang ini"><span class="nm">${esc(h.nama)}</span></a></td>
        ${sel}
        <td class="num tengah kolom-total">${angka(h.total_sales)}</td>
        <td class="num tengah">${angka(h.gudang)}</td>
        <td class="num tengah">${angka(h.kledo)}</td>
        <td class="num tengah kolom-selisih-hasil ${tapSelisih.kelas}">
          <span class="selisih-angka">${tapSelisih.tulis}</span>
        </td>
        ${
          bolehUbah
            ? `<td class="aksi-sel"><form method="post" action="${base}/rekap-stok/fix/hapus" class="form-hapus-fix">
          <input type="hidden" name="id" value="${h.id}">
          <input type="hidden" name="produk_id" value="${h.produk_id}">
          <button class="ttk-tombol ttk-hapus" type="submit" data-konfirmasi-tema
            data-judul="Hapus hasil rekap ini?"
            data-pesan="Baris hasil rekap yang sudah difix ini akan dihapus dan tidak ikut tercetak di PDF."
            data-ok="Ya, hapus" title="Hapus hasil rekap" aria-label="Hapus hasil rekap">${HAPUS}</button>
        </form></td>`
            : '<td class="aksi-sel"></td>'
        }
      </tr>`;
    })
    .join('');

  /*
   * KARTU "Hasil Rekap" — SELALU dirender dan isinya **SEMUA hasil rekap** (permintaan user:
   * *"Barang yang sudah di fix kan, tetap muncul di halaman rekap stok meski ganti barang lain untuk di
   * rekap"*). Sebelumnya kartu ini hanya tampil untuk barang yang sedang dibuka dan hanya memuat baris
   * barang itu, sehingga hasil fix barang sebelumnya "hilang" dari layar begitu barangnya diganti untuk
   * direkap. Datanya selalu tersimpan di tabel `stok_fix` (server), jadi berpindah barang tidak
   * menghapus apa pun.
   *
   * CETAK PDF-nya SATU saja (permintaan user: *"Opsi cetak pdf itu untuk semua barang yang sudah fix,
   * hapus cetak pdf barang ini"*) dan **labelnya "Cetak PDF Rekap Stok"** (permintaan user revisi
   * ke-168: frasa "semua barang yang sudah difix" DIHAPUS, begitu juga di dokumen PDF). Tombol
   * "Cetak PDF barang ini" (`?barang=<id>`) sudah DIHAPUS — jangan dihidupkan lagi. Rute
   * `/cetak/rekap-stok-pdf?barang=<id>` tetap ada di server (dipakai skrip uji & tidak merugikan),
   * tetapi TIDAK ada lagi tautan ke sana dari halaman mana pun.
   *
   * HAPUS (revisi ke-173, permintaan user: *"beri tombol hapus semua hasil rekap, dan tambah pada setiap
   * baris hasil rekap ada tombol hapus hasil rekap, untuk mengahapus satu per satu, admin dan
   * adminisrator bisa menghapus"*) — keputusan pemilik aplikasi:
   *  - **dua tombol besar**: **"Hapus semua (semua barang)"** + **"Hapus hasil barang ini"** (yang kedua
   *    hanya muncul kalau barang yang sedang dibuka punya hasil rekap), keduanya lewat **popup konfirmasi
   *    bertema yang menyebut jumlah barisnya**;
   *  - tombol **per baris** (ikon sampah di ujung kanan) tetap ada untuk menghapus satu per satu;
   *  - yang boleh menghapus = **administrator & admin gudang** (`bolehUbah`, sama dengan tombol per baris
   *    yang sudah ada) — peran sales ditahan middleware peran di server.
   */
  const tombolPdf = adaHasil
    ? `<a class="btn btn-primary" href="${base}/cetak/rekap-stok-pdf?semua=1${versi ? '&v=' + esc(versi) : ''}"
        target="_blank" rel="noopener" data-pdf-buka title="Cetak PDF Rekap Stok">Cetak PDF Rekap Stok</a>`
    : '';

  const jumlahHasilBarang = barang ? hasil.filter((h) => Number(h.produk_id) === Number(barang.id)).length : 0;
  const rkp = rekapSelisih(hasil);   // rekap valid/minus/lebih untuk baris di bawah tabel
  const tombolHapus = !adaHasil || !bolehUbah
    ? ''
    : `<button class="btn btn-danger" type="submit" form="formHapusSemua" id="btnHapusSemua" data-konfirmasi-tema
        data-judul="Hapus SEMUA hasil rekap?"
        data-pesan="SELURUH ${angka(hasil.length)} baris hasil rekap (semua barang) akan dihapus dan tidak ikut tercetak di PDF. Data yang dihapus tidak bisa dikembalikan."
        data-ok="Ya, hapus semua" title="Hapus semua baris hasil rekap">Hapus semua (${angka(hasil.length)})</button>${
        jumlahHasilBarang
          ? `<button class="btn btn-danger" type="submit" form="formHapusBarang" id="btnHapusBarang" data-konfirmasi-tema
        data-judul="Hapus hasil rekap ${esc(barang.nama)}?"
        data-pesan="${angka(jumlahHasilBarang)} baris hasil rekap barang ${esc(barang.nama)} akan dihapus dan tidak ikut tercetak di PDF. Data yang dihapus tidak bisa dikembalikan."
        data-ok="Ya, hapus" title="Hapus hasil rekap barang yang sedang dibuka">Hapus hasil barang ini (${angka(jumlahHasilBarang)})</button>`
          : ''
      }`;

  /*
   * CATATAN PENTING soal form hapus di kepala kartu: form-nya DITARUH DI LUAR tabel dan tombolnya memakai
   * atribut `form="…"` supaya bisa diklik dari kepala kartu. Handler konfirmasi bertema
   * (`[data-konfirmasi-tema]` di `public/app.js`) sudah membaca `form` tombolnya, jadi popupnya tetap
   * jalan. Penjelasan ini SENGAJA ditulis sebagai komentar JS (bukan komentar HTML) karena komentar HTML
   * ikut terkirim ke browser dan dibaca skrip uji (jebakan #30).
   */
  const kartuHasil = `<div class="card kartu-hasil" id="kartuHasil">
    <div class="kepala-hasil">
      <h2 class="card-title-heading">Hasil Rekap</h2>
      ${tombolPdf || tombolHapus ? `<div class="hasil-aksi">${tombolPdf}${tombolHapus}</div>` : ''}
    </div>
    ${
      adaHasil
        ? `${
            bolehUbah
              ? `<form method="post" action="${base}/rekap-stok/fix/hapus-semua" id="formHapusSemua" class="form-hapus-massal"></form>${
                  terpilih
                    ? `<form method="post" action="${base}/rekap-stok/fix/hapus-barang" id="formHapusBarang" class="form-hapus-massal">
          <input type="hidden" name="produk_id" value="${Number(terpilih.id)}">
        </form>`
                    : ''
                }`
              : ''
          }
    <p class="card-hint keterangan-nomor">Keterangan nomor kolom: ${keteranganNomor}</p>
    <div class="tbl-wrap">
      <table class="tbl rapat kolom-beku" id="tblHasilStok">
        <thead>${kepalaKelompok(kolomSales.length || 1, true)}</thead>
        <tbody>${barisHasil}</tbody>
      </table>
    </div>
    <div class="rekap-selisih" data-rekap-selisih>
      <span class="rekap-bagian" data-rekap-bagian="1">Jumlah barang valid: <b data-rekap="valid">${angka(rkp.valid)}</b></span>
      <span class="rekap-bagian ket-minus" data-rekap-bagian="2">Total barang minus: <b data-rekap="minus">${angka(rkp.minus)}</b></span>
      <span class="rekap-bagian ket-lebih" data-rekap-bagian="3">Total barang lebih: <b data-rekap="lebih">${angka(rkp.lebih)}</b></span>
    </div>`
        : '<p class="card-hint">Belum ada hasil rekap. Pilih barang, isi <b>Total Stok di Gudang</b> &amp; <b>Stok Kledo</b> di tabel atas, lalu tekan tombol <b>Fix</b> — hasilnya muncul di sini dan tetap tersimpan walau barangnya diganti.</p>'
    }
  </div>`;

  return `
<div class="halaman-rekap-stok">
<div class="page-head">
  <div>
    <h1>Rekap Stok</h1>
    <div class="sub">Stok satu barang yang masih dibawa tiap sales (kolom B + T dari surat jalan yang belum selesai) plus kolom hitung: Total Stok di Sales (otomatis), Total Stok di Gudang &amp; Stok Kledo (diisi manual), dan Selisih.</div>
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
    <span class="terpilih">${terpilih ? `Barang: <b>${esc(terpilih.nama)}</b>` : 'Barang: <b>belum dipilih</b>'}</span>
  </div>
  ${tabel}
  ${
    terpilih
      ? `<span class="hint hint-pilih">Kolom <b>Total Stok di Gudang</b> &amp; <b>Stok Kledo</b> diisi di sini (kolom <b>Total Stok di Sales</b> terisi otomatis), lalu tekan <b>Fix</b> untuk menyimpannya sebagai hasil rekap — hasilnya masuk daftar <b>Hasil Rekap</b> di bawah dan tetap tampil walau pindah ke barang lain.</span>
  <p class="card-hint keterangan-nomor">Keterangan nomor kolom: ${keteranganNomor}</p>`
      : ''
  }
</div>
${kartuHasil}
</div>`;
};
