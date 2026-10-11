'use strict';
/**
 * HASIL REKAP STOK — berkas PDF (permintaan user).
 *
 * Riwayat singkat: lembar "form kertas" (revisi 159) → satu barang dipilih (160) → rumus Selisih
 * (161) → angka 1..N + tombol Fix + hanya data yang difix yang dicetak (162) → **revisi ke-164**:
 *   - **kepala tabel diperbaiki**: sel kelompok "STOK DI SALES" dulu digambar di BARIS KEPALA YANG SALAH
 *     sehingga baris pertama kepala bolong/putih (terlihat seperti PDF rusak) — sekarang digambar di
 *     barisnya sendiri; ditambah **garis atas tabel** yang sebelumnya belum pernah digambar;
 *   - **kolom "WAKTU FIX" DIHAPUS** dan **nama yang memfix tidak dicantumkan**;
 *   - **keterangan "Selisih = Stok di Sales + Stok Fisik - Stok Kledo" DIHAPUS**;
 *   - **semua teks RATA TENGAH** kecuali nama barang (tetap rata kiri);
 *   - baris dicetak **urut waktu (paling lama di atas)** sehingga fix berikutnya menyusul di bawah.
 *
 * **Revisi ke-166** (permintaan user, dari tangkapan layar PDF-nya):
 *   1. *"Pada tulisan stok di sales, kolom di merger"* → sel kelompok **"STOK DI SALES" di-merge**: garis
 *      pemisah antar kolom sales baru dimulai di BAWAH baris kelompok (sebelumnya garisnya naik sampai
 *      atas tabel sehingga sel kelompok terbelah jadi beberapa kotak);
 *   2. *"perbesar seluruh ukuran teks di bawah kop agar terlihat fit dengan kolom namun tidak terlalu
 *      besar"* → seluruh huruf di bawah kop diperbesar (isi tabel 8,2 → **9,2pt**, kepala 8/6,6 →
 *      **8,8 / 7,4pt**, baris jumlah & kaki juga); setiap ukuran sudah diperiksa `lebarTeks()` supaya
 *      masih MUAT di kolomnya (lihat komentar `UK_*`);
 *   3. *"teks tinggi nya di tengah tidak mepet garis"* → semua teks dalam baris dipusatkan **vertikal**
 *      lewat opsi `tengahBaris` (perilaku bawaan `teks()` menaruh huruf agak ke atas sehingga mendekati
 *      garis atas baris).
 *
 * Isi dokumen: kop (tulisan toko + judul + keterangan), baris **Keterangan nomor kolom** (mis.
 * "1 = Ahmad Zaki | 2 = Haris | ..."), tabel (NO · NAMA BARANG · STOK DI SALES 1..N · STOK FISIK ·
 * STOK KLEDO · SELISIH), baris jumlah, kaki "Dicetak:" + blok tanda tangan (bila setelan tanda tangan
 * hidup). Ukuran kertas mengikuti dokumen lain (F4 215 x 330 mm, margin 10 mm), penulisnya `lib/pdf.js`.
 *
 * CATATAN: `lib/pdf.js → aman()` mengganti semua karakter non-ASCII dengan `?`, jadi jangan memakai
 * karakter seperti "·" atau "×" di dalam dokumen ini — pakai "|" dan huruf "x".
 */

const fs = require('fs');
const { Dokumen, lebarTeks } = require('./pdf');
const { angka, tanggalPendek, hariIni, jamSekarang } = require('./util');
const { semua: setelanSemua } = require('./setelan');

/*
 * VERSI = waktu ubah berkas ini; dipakai sebagai `?v=` pada tautan tombol cetak supaya penampil PDF di
 * ponsel tidak menyajikan berkas LAMA (pola yang sama dengan VERSI_MEMO & VERSI_EKSPEDISI).
 */
const VERSI_STOK = (() => {
  try {
    return String(Math.round(fs.statSync(__filename).mtimeMs));
  } catch (e) {
    return '1';
  }
})();

const F4 = { lebarMm: 215, tinggiMm: 330 };
const MARGIN = 10;
const LEBAR_ISI = F4.lebarMm - MARGIN * 2;      // 195 mm
const BATAS_BAWAH = F4.tinggiMm - MARGIN - 12;  // sisakan ruang untuk kaki halaman
const TINGGI_KEPALA = 6.6;                      // tinggi tiap baris kepala tabel
const TINGGI_BARIS = 6.2;

/*
 * UKURAN HURUF dokumen (revisi ke-166 — permintaan user: *"perbesar seluruh ukuran teks di bawah kop
 * agar terlihat fit dengan kolom namun tidak terlalu besar"*).
 *
 * Semua nilai DIPERIKSA dengan `lebarTeks()` supaya teksnya benar-benar muat di kolomnya. Karena itu
 * lebar kolom ikut dilonggarkan sedikit: kolom sales hanya memuat angka (paling banyak 3 digit = 5,7 mm
 * pada 9,6pt) sedangkan kolom isian memuat label panjang — jadi ruangnya digeser dari kolom sales ke
 * kolom isian (LEBAR_ISIAN 17 → 22 mm, kolom sales menyusut mengikuti sisa). Tanpa itu label
 * "STOK KLEDO" **melebihi kolomnya** (17,35 mm pada 7,4pt > 17 mm).
 *
 * Hasil pemeriksaan: "STOK KLEDO" 8,2pt = 19,22 mm (kolom 22 mm) · "STOK FISIK" 8,2pt = 16,55 mm ·
 * "NAMA BARANG" 8,8pt = 23,9 mm (kolom 56/62 mm) · "STOK DI SALES" 8,8pt = 24,2 mm (selompok 65 mm) ·
 * angka 3 digit 9,6pt = 5,65 mm (kolom sales ≥ 11,8 mm).
 *
 * Semua teks di dalam baris dipusatkan VERTIKAL (`tengahBaris`) supaya tidak mepet garis atas/bawah —
 * perilaku bawaan `Dokumen.teks()` (0,36 x ukuran di bawah titik y) menaruh huruf agak ke ATAS.
 */
const UK_NAMA_KEPALA = 8.8;    // sel kepala "NAMA BARANG" & "STOK DI SALES"
const UK_NO_KEPALA = 8.6;      // sel kepala "NO"
const UK_ISIAN_KEPALA = 8.2;   // sel kepala "STOK FISIK" / "STOK KLEDO" / "SELISIH"
const UK_NOMOR_SALES = 8.8;    // angka 1..N di baris kedua kepala
const UK_BARIS = 9.6;          // isi tabel (angka & nama barang)
const UK_JUMLAH = 9.6;         // baris "Jumlah baris hasil rekap ..."
const UK_KAKI = 8.6;           // baris "Dicetak: ..."
const UK_TTD = 9.6;            // label tanda tangan

/** Pecah teks menjadi beberapa baris yang muat `lebar` mm (untuk keterangan nomor kolom). */
function bungkus(kata, ukuran, lebar) {
  const baris = [];
  let kini = '';
  (Array.isArray(kata) ? kata : String(kata).split(' ')).forEach((w) => {
    const coba = kini ? `${kini} ${w}` : w;
    if (kini && lebarTeks(coba, ukuran) > lebar) {
      baris.push(kini);
      kini = w;
    } else {
      kini = coba;
    }
  });
  if (kini) baris.push(kini);
  return baris;
}

/**
 * Bangun berkas PDF hasil rekap stok (hanya data yang sudah difix).
 * @param {{ hasil: Array, sales: string[], semua?: boolean, setelan?: object }} opsi
 *        `hasil` = baris tabel `stok_fix` (sales_json, fisik, kledo, selisih) — dipanggil pemanggil
 *        dengan urutan waktu menaik (paling lama di atas).
 */
exports.rekapStokPdf = function ({ hasil = [], sales = [], semua = false, setelan }) {
  const st = setelan || setelanSemua();
  const d = new Dokumen(F4);
  let y = MARGIN;
  const kolomSales = Array.isArray(sales) ? sales : [];

  /*
   * Lebar kolom: NO 8 mm · NAMA BARANG (lebih lebar di dokumen satu barang) · tiap kolom sales dibagi
   * rata dari sisa · tiga kolom isian (STOK FISIK / STOK KLEDO / SELISIH) 22 mm.
   * Totalnya = LEBAR_ISI (195 mm) supaya tabelnya pas dari margin ke margin.
   * LEBAR_ISIAN 22 mm dipilih supaya label kepala "STOK KLEDO" (19,2 mm pada 8,2pt) muat dengan sisa
   * ±1,4 mm di kiri-kanan — lihat catatan UK_* di atas.
   */
  const JUMLAH_SALES = Math.max(1, kolomSales.length);
  const LEBAR_NO = 8;
  const LEBAR_NAMA = semua ? 56 : 62;
  const LEBAR_ISIAN = 22;
  const LEBAR_SALES = Math.max(8, (LEBAR_ISI - LEBAR_NO - LEBAR_NAMA - LEBAR_ISIAN * 3) / JUMLAH_SALES);

  const xNo = MARGIN;
  const xNama = xNo + LEBAR_NO;
  const xSales = xNama + LEBAR_NAMA;
  const xFisik = xSales + LEBAR_SALES * JUMLAH_SALES;
  const xKledo = xFisik + LEBAR_ISIAN;
  const xSelisih = xKledo + LEBAR_ISIAN;
  const xAkhir = xSelisih + LEBAR_ISIAN;
  let tabelAtas = null;   // y mula tabel di halaman ini (garis tegak digambar sekali per halaman)
  let tabelSalesAtas = null; // y batas BAWAH baris kelompok "STOK DI SALES" (garis antar kolom sales mulai dari sini)

  /** Kop dokumen (halaman pertama & setiap halaman lanjutan). Semua teks rata tengah. */
  function kop(lanjutan) {
    d.teks(MARGIN, y, st.kop_sub, { ukuran: 14, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 6.6;
    d.teks(MARGIN, y, 'HASIL REKAP STOK', { ukuran: 13, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 5.2;
    const tahun = new Date().getFullYear();
    const judul = semua
      ? `Tahun ${tahun} | Semua barang yang sudah difix${lanjutan ? ' | lanjutan' : ''}`
      : `Tahun ${tahun} | Barang: ${(hasil[0] && hasil[0].nama) || '-'}${lanjutan ? ' | lanjutan' : ''}`;
    d.teks(MARGIN, y, judul, { ukuran: 8.6, rata: 'tengah', lebar: LEBAR_ISI });
    y += 4.6;
    /*
     * KETERANGAN NOMOR (permintaan user: "kepala header menggunakan angka 1-5 … tapi ada keterangan nya
     * di pdf") — dibungkus per baris supaya tidak melewati lebar halaman, ditulis rata tengah.
     */
    const bagian = kolomSales.map((n, i) => `${i + 1} = ${n}`);
    const baris = bungkus(`Keterangan nomor kolom: ${bagian.join('  |  ')}`, 8, LEBAR_ISI);
    baris.forEach((b) => {
      d.teks(MARGIN, y, b, { ukuran: 8, rata: 'tengah', lebar: LEBAR_ISI });
      y += 4;
    });
    y += 0.6;
    if (st.kop_garis !== '0') {
      d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.4 });
      y += 4;
    }
  }

  /**
   * Garis tegak seluruh tabel halaman ini (digambar sekali saat halaman itu selesai).
   *
   * **KOLOM KELOMPOK "STOK DI SALES" DI-MERGE** (permintaan user: *"Pada tulisan stok di sales, kolom di
   * merger"*): garis LURUS dari atas tabel hanya digambar di batas kolom besar
   * (NO | NAMA BARANG | kelompok STOK DI SALES | STOK FISIK | STOK KLEDO | SELISIH), sedangkan garis
   * pemisah antar kolom sales baru dimulai di BAWAH baris kelompok (`tabelSalesAtas`). Sebelumnya semua
   * garis sales ikut naik sampai atas tabel sehingga sel kelompok itu terbelah menjadi beberapa kotak —
   * itulah yang terlihat seperti kepala tabel "kotak-kotak" di tangkapan layar user.
   */
  function gambarTegak() {
    if (tabelAtas === null || y <= tabelAtas) return;
    [xNo, xNama, xSales, xFisik, xKledo, xSelisih, xAkhir].forEach((x) =>
      d.garis(x, tabelAtas, x, y, { tebal: 0.18 })
    );
    const mulaiSales = tabelSalesAtas === null ? tabelAtas : tabelSalesAtas;
    for (let i = 1; i < JUMLAH_SALES; i++) {
      const x = xSales + i * LEBAR_SALES;
      d.garis(x, mulaiSales, x, y, { tebal: 0.18 });
    }
  }

  /**
   * Kepala tabel DUA BARIS: baris pertama = NO · NAMA BARANG · KELOMPOK "STOK DI SALES" · STOK FISIK ·
   * STOK KLEDO · SELISIH; baris kedua = nomor kolom sales 1..N.
   *
   * JANGAN menggambar sel kelompok di baris kedua (itu bug revisi ke-162: baris pertama kepala jadi
   * bolong/putih sehingga PDF terlihat rusak), dan JANGAN lupa garis ATAS tabel.
   */
  function kepalaTabel() {
    const atas = y;
    const tengah = atas + TINGGI_KEPALA;         // batas dua baris kepala
    const bawah = atas + TINGGI_KEPALA * 2;
    tabelAtas = atas;
    tabelSalesAtas = tengah;
    // isian latar (abu) — sel tinggi 2 baris untuk NO/NAMA/FISIK/KLEDO/SELISIH, 1 baris untuk kelompok
    d.kotak(xNo, atas, LEBAR_NO, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xNama, atas, LEBAR_NAMA, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xSales, atas, LEBAR_SALES * JUMLAH_SALES, TINGGI_KEPALA, { abu: 0.88 });
    for (let i = 0; i < JUMLAH_SALES; i++) d.kotak(xSales + i * LEBAR_SALES, tengah, LEBAR_SALES, TINGGI_KEPALA, { abu: 0.95 });
    d.kotak(xFisik, atas, LEBAR_ISIAN, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xKledo, atas, LEBAR_ISIAN, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xSelisih, atas, LEBAR_ISIAN, TINGGI_KEPALA * 2, { abu: 0.88 });
    // garis mendatar: ATAS tabel, garis pemisah di bawah kelompok (hanya selebar kolom sales), & BAWAH kepala
    d.garis(xSales, tengah, xSales + LEBAR_SALES * JUMLAH_SALES, tengah, { tebal: 0.18 });
    d.garis(MARGIN, atas, MARGIN + LEBAR_ISI, atas, { tebal: 0.25 });
    d.garis(MARGIN, bawah, MARGIN + LEBAR_ISI, bawah, { tebal: 0.3 });
    /*
     * Tulisan kepala — semua rata tengah (mendatar) DAN rata tengah barisnya (tegak, `tengahBaris`)
     * supaya tidak menempel ke garis atas/bawah baris. Tiga pembantu:
     *   tDua()  = sel kepala yang tingginya DUA baris (NO · NAMA BARANG · STOK FISIK · STOK KLEDO · SELISIH)
     *   tSatu() = sel kepala satu baris di baris PERTAMA (kelompok "STOK DI SALES")
     *   tNomor()= sel nomor kolom sales di baris KEDUA
     */
    const tDua = (x, lebar, teks, ukuran) =>
      d.teks(x, atas, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA * 2 });
    const tSatu = (x, lebar, teks, ukuran) =>
      d.teks(x, atas, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA });
    const tNomor = (x, lebar, teks, ukuran) =>
      d.teks(x, tengah, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA });
    tDua(xNo, LEBAR_NO, 'NO', UK_NO_KEPALA);
    tDua(xNama, LEBAR_NAMA, 'NAMA BARANG', UK_NAMA_KEPALA);
    // sel kelompok "STOK DI SALES" — SATU sel yang di-merge selebar seluruh kolom sales
    tSatu(xSales, LEBAR_SALES * JUMLAH_SALES, 'STOK DI SALES', UK_NAMA_KEPALA);
    for (let i = 0; i < JUMLAH_SALES; i++) tNomor(xSales + i * LEBAR_SALES, LEBAR_SALES, String(i + 1), UK_NOMOR_SALES);
    tDua(xFisik, LEBAR_ISIAN, 'STOK FISIK', UK_ISIAN_KEPALA);
    tDua(xKledo, LEBAR_ISIAN, 'STOK KLEDO', UK_ISIAN_KEPALA);
    tDua(xSelisih, LEBAR_ISIAN, 'SELISIH', UK_ISIAN_KEPALA);
    y = bawah;
  }

  kop(false);
  kepalaTabel();

  if (!hasil.length) {
    d.teks(xNama + 1.5, y, 'Belum ada data yang difix.', {
      ukuran: UK_BARIS, rata: 'tengah', lebar: LEBAR_NAMA, tengahBaris: TINGGI_BARIS,
    });
    y += TINGGI_BARIS;
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.18 });
  }

  hasil.forEach((h, i) => {
    if (y + TINGGI_BARIS > BATAS_BAWAH) {
      gambarTegak();
      d.baru();
      y = MARGIN;
      kop(true);
      kepalaTabel();
    }
    let rinci = [];
    try { rinci = JSON.parse(h.sales_json || '[]') || []; } catch (e) { rinci = []; }
    /*
     * NO & angka rata tengah, HANYA nama barang yang rata kiri (permintaan user). Semua teks dipusatkan
     * VERTIKAL di barisnya (`tengahBaris`) supaya tidak menempel garis (revisi ke-166).
     */
    const sel = (x, lebar, teks, rata) =>
      d.teks(x, y, teks, { ukuran: UK_BARIS, rata, lebar, tengahBaris: TINGGI_BARIS });
    sel(xNo, LEBAR_NO, String(i + 1), 'tengah');
    d.teks(xNama + 1.5, y, d.potong(`${h.nama}${semua && h.kode ? ' (' + h.kode + ')' : ''}`, UK_BARIS, LEBAR_NAMA - 3), {
      ukuran: UK_BARIS, tengahBaris: TINGGI_BARIS,
    });
    kolomSales.forEach((nama, j) => {
      const q = Number((rinci[j] || {}).qty || 0);
      if (q) sel(xSales + j * LEBAR_SALES, LEBAR_SALES, angka(q), 'tengah');
    });
    sel(xFisik, LEBAR_ISIAN, angka(h.fisik), 'tengah');
    sel(xKledo, LEBAR_ISIAN, angka(h.kledo), 'tengah');
    sel(xSelisih, LEBAR_ISIAN, angka(h.selisih), 'tengah');
    y += TINGGI_BARIS;
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.18 });
  });
  gambarTegak();

  y += 5;
  const totalSelisih = hasil.reduce((a, h) => a + (Number(h.selisih) || 0), 0);
  d.teks(MARGIN, y, `Jumlah baris hasil rekap: ${angka(hasil.length)} | Total Selisih: ${angka(totalSelisih)}`, {
    ukuran: UK_JUMLAH,
    rata: 'tengah',
    lebar: LEBAR_ISI,
    tengahBaris: 5,   // dipusatkan di ruang 5 mm antara tabel & garis kaki
  });
  y += 7;

  /* ---------- KAKI: waktu cetak (penanda berkas baru) + tanda tangan ---------- */
  const butuh = st.ttd_tampil === '0' ? 12 : 36;
  if (y + butuh > BATAS_BAWAH) {
    d.baru();
    y = MARGIN;
    kop(true);
  }
  d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.2 });
  y += 4;
  d.teks(MARGIN, y, `Dicetak: ${tanggalPendek(hariIni())} ${jamSekarang()}`, {
    ukuran: UK_KAKI, rata: 'tengah', lebar: LEBAR_ISI, tengahBaris: 4,
  });
  y += 8;

  if (st.ttd_tampil !== '0') {
    const kolomTtd = (x, jabatan) => {
      d.teks(x, y, jabatan, { ukuran: UK_TTD, rata: 'tengah', lebar: 60, tengahBaris: 6 });
      d.garis(x, y + 16, x + 60, y + 16, { tebal: 0.3 });
    };
    kolomTtd(MARGIN, 'Petugas Gudang,');
    kolomTtd(MARGIN + LEBAR_ISI - 60, 'Diperiksa oleh,');
  }

  return d.buffer();
};

exports.VERSI_STOK = VERSI_STOK;
