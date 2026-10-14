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
 *      besar"* → seluruh huruf di bawah kop diperbesar; setiap ukuran sudah diperiksa `lebarTeks()`
 *      supaya masih MUAT di kolomnya (lihat komentar `UK_*`);
 *   3. *"teks tinggi nya di tengah tidak mepet garis"* → semua teks dalam baris dipusatkan **vertikal**
 *      lewat opsi `tengahBaris`.
 *
 * **Revisi ke-168** (permintaan user): *"Stok fisik terbagi jadi 2, 1 total stok di sales, otomatis,
 * 2 total stok di gudang manual, tulisan semua barang yang sudah di fix di tombol cetak dan halaman pdf
 * di hapus"*:
 *   1. kolom **STOK FISIK** diganti **DUA** kolom: **TOTAL STOK DI SALES** (otomatis, = kolom
 *      `total_sales` yang dihitung server) dan **TOTAL STOK DI GUDANG** (manual, kolom DB `gudang`);
 *      **STOK KLEDO** tetap;
 *   2. **Selisih = Total Stok di Sales + Total Stok di Gudang - Stok Kledo** (dihitung di server);
 *   3. keterangan di bawah judul **tidak lagi menyebut "Semua barang yang sudah difix"** — cukup
 *      **"Tahun 20xx"** (baris "Barang: …" untuk dokumen satu barang juga tidak dipakai lagi).
 *      Label kepala kolomnya DUA BARIS ("TOTAL STOK / DI SALES") supaya tetap muat di kolomnya.
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
 * UKURAN HURUF & LEBAR KOLOM dokumen (revisi ke-166, ke-168 & ke-169).
 *
 * Semua ukuran DIPERIKSA dengan `lebarTeks()` supaya teksnya benar-benar muat di kolomnya, dan lebar
 * kolom diatur mengikuti labelnya (bukan sebaliknya):
 *   - EMPAT kolom kanan = **19 mm** masing-masing: **SALES** & **GUDANG** (di bawah satu sel kelompok
 *     "TOTAL STOK FISIK" selebar 38 mm — "TOTAL STOK FISIK" pada 8,8pt = 29,4 mm, jadi muat), lalu
 *     **STOK KLEDO** dan **SELISIH** (label dua baris "STOK"/"KLEDO" pada 7,4pt = 7,39 mm, kolom 19 mm);
 *   - kolom sales dibagi sisa: 11 mm/dokumen semua barang (5 sales) dan 9,8 mm/dokumen satu barang —
 *     angka 4 digit pada 9,6pt hanya 7,53 mm, jadi masih lega;
 *   - "NAMA BARANG" 8,8pt = 23,9 mm (kolom 56/62 mm) · "STOK DI SALES" 8,8pt = 24,2 mm (sel kelompok).
 *
 * Semua teks di dalam baris dipusatkan VERTIKAL (`tengahBaris`) supaya tidak mepet garis atas/bawah —
 * perilaku bawaan `Dokumen.teks()` (0,36 x ukuran di bawah titik y) menaruh huruf agak ke ATAS.
 */
const LEBAR_KANAN = 19;        // lebar tiap kolom kanan (SALES · GUDANG · STOK KLEDO · SELISIH)
const UK_NAMA_KEPALA = 8.8;    // sel kepala "NAMA BARANG", "STOK DI SALES" & "TOTAL STOK FISIK"
const UK_NO_KEPALA = 8.6;      // sel kepala "NO"
const UK_KANAN_KEPALA = 7.4;   // sub-kepala "SALES"/"GUDANG"/"KLEDO" & sel "SELISIH"
const UK_NOMOR_SALES = 8.8;    // angka 1..N di baris kedua kepala
const UK_BARIS = 9.6;          // isi tabel (angka & nama barang) — juga kata "Valid" pada selisih 0
const UK_JUMLAH = 9.6;         // baris rekap di bawah tabel (valid · minus · lebih)
const UK_KAKI = 8.6;           // baris "Dicetak: ..."
const UK_TTD = 9.6;            // label tanda tangan

/*
 * PENANDA SELISIH (permintaan user revisi ke-174 → dikoreksi di revisi ke-175 & ke-176):
 *  - **0** → ditulis **"Valid"** saja (ukuran & ketebalan SAMA seperti angka lain) — angka 0 TIDAK
 *    ditulis lagi (revisi ke-176: *"Barang yang valid hanya tertulis Valid, tanpa angka 0"*);
 *  - **minus** → angka `-3` **MERAH & BOLD** (tanpa kata "Minus");
 *  - **lebih** → angka `3` **HIJAU & BOLD** (tanpa kata "Lebih").
 * Karena semua baris kini hanya berisi SATU baris teks, teksnya dipusatkan tegak di barisnya
 * (`tengahBaris: TINGGI_BARIS`) — tidak perlu lagi posisi garis dasar eksplisit, dan kolomnya otomatis
 * lurus untuk semua baris.
 *
 * Kata "Minus"/"Lebih" tetap dipakai pada BARIS REKAP di bawah tabel ("Total barang minus: …"), karena
 * di sana memang label nilai.
 */
const MERAH = [0.725, 0.110, 0.110];  // #b91c1c (sama dengan warna merah di layar)
const HIJAU = [0.082, 0.502, 0.239];  // #15803d (sama dengan warna hijau di layar)

/**
 * Aturan tampilan sebuah nilai selisih:
 *  0 → `{ tulis: 'Valid', warna: null }`        (kata "Valid", bukan angka 0)
 *  < 0 → `{ tulis: '-N', warna: MERAH }`        (angkanya saja, merah & bold)
 *  > 0 → `{ tulis: 'N', warna: HIJAU }`         (angkanya saja, hijau & bold)
 * Semua ditulis **tebal** (`tebal: true`) — permintaan user: "angkanya bold".
 */
function tampilanSelisih(nilai) {
  const n = Number(nilai) || 0;
  if (n === 0) return { tulis: 'Valid', warna: null };
  return { tulis: angka(n), warna: n < 0 ? MERAH : HIJAU };
}

/** Rekap jumlah baris valid + total minus + total lebih (dipakai baris rekap di bawah tabel). */
function rekapSelisih(hasil) {
  let valid = 0;
  let minus = 0;
  let lebih = 0;
  hasil.forEach((h) => {
    const n = Number(h.selisih) || 0;
    if (n === 0) valid += 1;
    else if (n < 0) minus += Math.abs(n);
    else lebih += n;
  });
  return { valid, minus, lebih };
}

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
 * Bangun berkas PDF hasil rekap stok (hanya baris yang sudah difix).
 * @param {{ hasil: Array, sales: string[], semua?: boolean, setelan?: object, namaCetak?: string }} opsi
 *        `hasil` = baris tabel `stok_fix` (sales_json, total_sales, gudang, kledo, selisih) — dipanggil
 *        pemanggil dengan urutan waktu menaik (paling lama di atas).
 *        `namaCetak` = nama petugas yang MENCETAK (dipakai pada blok tanda tangan "Diperiksa oleh," —
 *        lihat catatan panjang di bagian tanda tangan di bawah).
 */
exports.rekapStokPdf = function ({ hasil = [], sales = [], semua = false, setelan, namaCetak = '' }) {
  const st = setelan || setelanSemua();
  const d = new Dokumen(F4);
  let y = MARGIN;
  const kolomSales = Array.isArray(sales) ? sales : [];

  /*
   * Lebar kolom: NO 8 mm · NAMA BARANG (lebih lebar di dokumen satu barang) · kolom sales dibagi rata
   * dari sisa · empat kolom kanan (TOTAL STOK DI SALES / TOTAL STOK DI GUDANG / STOK KLEDO / SELISIH)
   * masing-masing LEBAR_KANAN (19 mm). Totalnya = LEBAR_ISI (195 mm) supaya tabelnya pas margin ke margin.
   */
  const JUMLAH_SALES = Math.max(1, kolomSales.length);
  const LEBAR_NO = 8;
  const LEBAR_NAMA = semua ? 56 : 62;
  const LEBAR_SALES = Math.max(8, (LEBAR_ISI - LEBAR_NO - LEBAR_NAMA - LEBAR_KANAN * 4) / JUMLAH_SALES);

  const xNo = MARGIN;
  const xNama = xNo + LEBAR_NO;
  const xSales = xNama + LEBAR_NAMA;
  const xTotal = xSales + LEBAR_SALES * JUMLAH_SALES;   // TOTAL STOK DI SALES (otomatis)
  const xGudang = xTotal + LEBAR_KANAN;                 // TOTAL STOK DI GUDANG (manual)
  const xKledo = xGudang + LEBAR_KANAN;
  const xSelisih = xKledo + LEBAR_KANAN;
  const xAkhir = xSelisih + LEBAR_KANAN;
  let tabelAtas = null;   // y mula tabel di halaman ini (garis tegak digambar sekali per halaman)
  let tabelSalesAtas = null; // y batas BAWAH baris kelompok "STOK DI SALES" (garis antar kolom sales mulai dari sini)

  /** Kop dokumen (halaman pertama & setiap halaman lanjutan). Semua teks rata tengah. */
  function kop(lanjutan) {
    d.teks(MARGIN, y, st.kop_sub, { ukuran: 14, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 6.6;
    d.teks(MARGIN, y, 'HASIL REKAP STOK', { ukuran: 13, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 5.2;
    /*
     * Keterangan di bawah judul cukup **"Tahun 20xx"** (permintaan user revisi ke-168: frasa "Semua
     * barang yang sudah difix" DIHAPUS, begitu pula baris "Barang: …" untuk dokumen satu barang).
     * Penanda halaman lanjutan tetap ditulis supaya halaman ke-2 tidak membingungkan.
     */
    const tahun = new Date().getFullYear();
    d.teks(MARGIN, y, `Tahun ${tahun}${lanjutan ? ' | lanjutan' : ''}`, { ukuran: 8.6, rata: 'tengah', lebar: LEBAR_ISI });
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
   * **DUA KELOMPOK DI-MERGE** (permintaan user): (1) *"Pada tulisan stok di sales, kolom di merger"* — sel
   * kelompok **STOK DI SALES**; (2) revisi ke-169 — dua kolom total (Sales & Gudang) berkepala satu
   * kelompok **TOTAL STOK FISIK**. Garis LURUS dari atas tabel hanya digambar di batas kolom besar
   * (NO | NAMA BARANG | kelompok STOK DI SALES | kelompok TOTAL STOK FISIK | STOK KLEDO | SELISIH),
   * sedangkan garis pemisah di DALAM kelompok (antar kolom sales 1..N, dan antara Sales dengan Gudang)
   * baru dimulai di BAWAH baris kelompok (`tabelSalesAtas`). Kalau garisnya ikut naik sampai atas tabel,
   * sel kelompoknya terbelah menjadi beberapa kotak — itulah yang terlihat seperti kepala "kotak-kotak"
   * pada tangkapan layar user.
   */
  function gambarTegak() {
    if (tabelAtas === null || y <= tabelAtas) return;
    [xNo, xNama, xSales, xTotal, xKledo, xSelisih, xAkhir].forEach((x) =>
      d.garis(x, tabelAtas, x, y, { tebal: 0.18 })
    );
    const mulaiSales = tabelSalesAtas === null ? tabelAtas : tabelSalesAtas;
    for (let i = 1; i < JUMLAH_SALES; i++) {
      const x = xSales + i * LEBAR_SALES;
      d.garis(x, mulaiSales, x, y, { tebal: 0.18 });
    }
    // garis antara "SALES" dan "GUDANG" (di dalam kelompok TOTAL STOK FISIK)
    d.garis(xGudang, mulaiSales, xGudang, y, { tebal: 0.18 });
  }

  /**
   * Kepala tabel DUA BARIS: baris pertama = NO · NAMA BARANG · KELOMPOK "STOK DI SALES" · KELOMPOK
   * "TOTAL STOK FISIK" · STOK KLEDO · SELISIH; baris kedua = nomor kolom sales 1..N, lalu **SALES** dan
   * **GUDANG**.
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
    // isian latar (abu) — sel tinggi 2 baris untuk kolom kanan & NO/NAMA, 1 baris untuk kelompok sales
    d.kotak(xNo, atas, LEBAR_NO, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xNama, atas, LEBAR_NAMA, TINGGI_KEPALA * 2, { abu: 0.88 });
    d.kotak(xSales, atas, LEBAR_SALES * JUMLAH_SALES, TINGGI_KEPALA, { abu: 0.88 });
    for (let i = 0; i < JUMLAH_SALES; i++) d.kotak(xSales + i * LEBAR_SALES, tengah, LEBAR_SALES, TINGGI_KEPALA, { abu: 0.95 });
    // kelompok "TOTAL STOK FISIK": satu isian abu selebar DUA kolom (Sales & Gudang)
    d.kotak(xTotal, atas, LEBAR_KANAN * 2, TINGGI_KEPALA, { abu: 0.88 });
    d.kotak(xTotal, tengah, LEBAR_KANAN, TINGGI_KEPALA, { abu: 0.95 });
    d.kotak(xGudang, tengah, LEBAR_KANAN, TINGGI_KEPALA, { abu: 0.95 });
    [xKledo, xSelisih].forEach((x) => d.kotak(x, atas, LEBAR_KANAN, TINGGI_KEPALA * 2, { abu: 0.88 }));
    // garis mendatar: ATAS tabel, garis pemisah di bawah TIAP kelompok, & BAWAH kepala
    d.garis(xSales, tengah, xSales + LEBAR_SALES * JUMLAH_SALES, tengah, { tebal: 0.18 });
    d.garis(xTotal, tengah, xKledo, tengah, { tebal: 0.18 });
    d.garis(MARGIN, atas, MARGIN + LEBAR_ISI, atas, { tebal: 0.25 });
    d.garis(MARGIN, bawah, MARGIN + LEBAR_ISI, bawah, { tebal: 0.3 });
    /*
     * Tulisan kepala — semua rata tengah (mendatar) DAN rata tengah barisnya (tegak, `tengahBaris`)
     * supaya tidak menempel ke garis atas/bawah baris. Empat pembantu:
     *   tDua()   = label SATU baris di sel setinggi dua baris (NO · NAMA BARANG · SELISIH)
     *   tSatu()  = label satu baris di baris PERTAMA (kelompok "STOK DI SALES")
     *   tNomor() = nomor kolom sales (baris KEDUA)
     *   tLabel2()= label DUA BARIS dalam satu sel tinggi-dua-baris (kolom kanan — labelnya panjang,
     *              jadi dipecah supaya tetap muat pada huruf 7,4pt)
     */
    const tDua = (x, lebar, teks, ukuran) =>
      d.teks(x, atas, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA * 2 });
    const tSatu = (x, lebar, teks, ukuran) =>
      d.teks(x, atas, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA });
    const tNomor = (x, lebar, teks, ukuran) =>
      d.teks(x, tengah, teks, { ukuran, tebal: true, rata: 'tengah', lebar, tengahBaris: TINGGI_KEPALA });
    const tLabel2 = (x, lebar, barisAtas, barisBawah, ukuran) => {
      tSatu(x, lebar, barisAtas, ukuran);
      tNomor(x, lebar, barisBawah, ukuran);
    };
    tDua(xNo, LEBAR_NO, 'NO', UK_NO_KEPALA);
    tDua(xNama, LEBAR_NAMA, 'NAMA BARANG', UK_NAMA_KEPALA);
    // sel kelompok "STOK DI SALES" — SATU sel yang di-merge selebar seluruh kolom sales
    tSatu(xSales, LEBAR_SALES * JUMLAH_SALES, 'STOK DI SALES', UK_NAMA_KEPALA);
    for (let i = 0; i < JUMLAH_SALES; i++) tNomor(xSales + i * LEBAR_SALES, LEBAR_SALES, String(i + 1), UK_NOMOR_SALES);
    /*
     * KELOMPOK **TOTAL STOK FISIK** (revisi ke-169) — satu sel kepala selebar DUA kolom (Sales & Gudang),
     * dengan sub-kepala SALES dan GUDANG di baris kedua. Permintaan user: *"total stok di gudang dan total
     * stok di sales kolom atas jadi satu, total stok fisik, di bawahnya sales, gudang, tetap 2 kolom,
     * tapi header nya saja"* — jadi kolomnya tetap dua, hanya kepalanya yang digabung.
     */
    tSatu(xTotal, LEBAR_KANAN * 2, 'TOTAL STOK FISIK', UK_NAMA_KEPALA);
    tNomor(xTotal, LEBAR_KANAN, 'SALES', UK_KANAN_KEPALA);
    tNomor(xGudang, LEBAR_KANAN, 'GUDANG', UK_KANAN_KEPALA);
    tLabel2(xKledo, LEBAR_KANAN, 'STOK', 'KLEDO', UK_KANAN_KEPALA);
    tDua(xSelisih, LEBAR_KANAN, 'SELISIH', UK_KANAN_KEPALA);
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
    /*
     * Nama barang saja — **KODE (SKU) TIDAK DICETAK** (permintaan user revisi ke-169: *"Sku tidak usah di
     * tampilkan"*). Dulu dokumen "semua barang" menambahkan ` (kode)` di belakang nama.
     */
    d.teks(xNama + 1.5, y, d.potong(h.nama, UK_BARIS, LEBAR_NAMA - 3), {
      ukuran: UK_BARIS, tengahBaris: TINGGI_BARIS,
    });
    kolomSales.forEach((nama, j) => {
      const q = Number((rinci[j] || {}).qty || 0);
      if (q) sel(xSales + j * LEBAR_SALES, LEBAR_SALES, angka(q), 'tengah');
    });
    sel(xTotal, LEBAR_KANAN, angka(h.total_sales), 'tengah');
    sel(xGudang, LEBAR_KANAN, angka(h.gudang), 'tengah');
    sel(xKledo, LEBAR_KANAN, angka(h.kledo), 'tengah');
    /*
     * Kolom SELISIH (revisi ke-175/176): 0 → kata **"Valid"**, minus → angka MERAH & BOLD, lebih → angka
     * HIJAU & BOLD. Satu baris teks saja, dipusatkan tegak di barisnya.
     */
    const tap = tampilanSelisih(h.selisih);
    d.teks(xSelisih, y, tap.tulis, {
      ukuran: UK_BARIS, tebal: true, rata: 'tengah', lebar: LEBAR_KANAN,
      tengahBaris: TINGGI_BARIS, warna: tap.warna,
    });
    y += TINGGI_BARIS;
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.18 });
  });
  gambarTegak();

  /*
   * REKAP di bawah tabel (permintaan user revisi ke-174): *"terdapat kolom rekap jumlah barang valid dan
   * total barang minus, total barang lebih"* — SATU baris yang MENGGANTIKAN baris lama
   * ("Jumlah baris hasil rekap: N | Total Selisih: X"). Bagian "minus" ditulis merah dan "lebih" hijau.
   *
   * **Revisi ke-176**: baris rekap ini diberi **ZEBRA** — tiga bagian dengan latar bergantian
   * **putih · abu muda · putih** (keputusan pemilik aplikasi), lengkap dengan garis pemisah tipis supaya
   * batas ketiga bagiannya terlihat. Lebar ketiga bagian dibagi rata dari lebar isi, dan teks tiap bagian
   * dipusatkan di bagiannya masing-masing.
   */
  y += 5;
  const rk = rekapSelisih(hasil);
  const TINGGI_REKAP = 6.4;
  const bagian = [
    { teks: `Jumlah barang valid: ${angka(rk.valid)}`, warna: null, abu: 0 },
    { teks: `Total barang minus: ${angka(rk.minus)}`, warna: MERAH, abu: 0.93 },
    { teks: `Total barang lebih: ${angka(rk.lebih)}`, warna: HIJAU, abu: 0 },
  ];
  const lebarBagian = LEBAR_ISI / bagian.length;
  bagian.forEach((b, i) => {
    const x = MARGIN + i * lebarBagian;
    // latar zebra: bagian ke-2 abu muda, bagian 1 & 3 putih (tidak digambar)
    if (b.abu > 0) d.kotak(x, y, lebarBagian, TINGGI_REKAP, { abu: b.abu });
    // garis pemisah antar bagian + garis atas/bawah baris rekap supaya terbaca sebagai satu baris tabel
    if (i > 0) d.garis(x, y, x, y + TINGGI_REKAP, { tebal: 0.18 });
    d.teks(x, y, b.teks, { ukuran: UK_JUMLAH, rata: 'tengah', lebar: lebarBagian, tengahBaris: TINGGI_REKAP, warna: b.warna });
  });
  d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.18 });
  d.garis(MARGIN, y + TINGGI_REKAP, MARGIN + LEBAR_ISI, y + TINGGI_REKAP, { tebal: 0.18 });
  y += TINGGI_REKAP + 4;

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

  /*
   * TANDA TANGAN (permintaan user revisi ke-176): *"ttd petugas gudang tidak usah, TTD diperiksa itu nama
   * yang mencetak"* → kolom **"Petugas Gudang," DIBUANG**, dan blok **"Diperiksa oleh,"** sekarang
   * mencetak **NAMA PETUGAS YANG MENCETAK** di bawah garisnya (`namaCetak`, dikirim rute PDF).
   *
   * CATATAN PENTING (jangan "diperbaiki" tanpa membaca): ini **kebalikan** dari aturan dokumen surat
   * jalan/memo, yang wajib memakai nama petugas yang **MENGINPUT** (`namaAdminSesi`) dan dilarang memakai
   * nama pencetak (revisi ke-120). Untuk dokumen **Rekap Stok** ini pemilik aplikasi secara eksplisit
   * meminta nama **pencetak**, karena rekap stok memang tidak terikat satu perjalanan/penginput.
   */
  if (st.ttd_tampil !== '0') {
    const xTtd = MARGIN + LEBAR_ISI - 60;
    d.teks(xTtd, y, 'Diperiksa oleh,', { ukuran: UK_TTD, rata: 'tengah', lebar: 60, tengahBaris: 6 });
    d.garis(xTtd, y + 16, xTtd + 60, y + 16, { tebal: 0.3 });
    d.teks(xTtd, y + 17.5, namaCetak || ' ', {
      ukuran: UK_TTD, tebal: true, rata: 'tengah', lebar: 60, tengahBaris: 5,
    });
  }

  return d.buffer();
};

exports.VERSI_STOK = VERSI_STOK;
