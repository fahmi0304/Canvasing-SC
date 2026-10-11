'use strict';
/**
 * MEMO EKSPEDISI BARANG LENGKAP — berkas PDF (permintaan user).
 *
 * Revisi ke-151: seluruh UKURAN HURUF dinaikkan sedikit (±8%) dan tinggi baris tabel ikut disesuaikan supaya
 * tulisannya lebih mudah dibaca; posisi garis dasar tiap baris tetap dihitung lewat helper dasar() (lihat
 * catatan di fungsi itu) supaya tulisan tetap duduk di dalam barisnya.
 *
 * Permintaan user: *"di samping tulisan expedisi barang, ada tombol cetak rekap expedisi barang
 * keseluruhan, formatnya terserah asal mudah dimengerti dan informasinya lengkap"*.
 *
 * Isi dokumen (sengaja dipilih supaya lengkap & mudah dibaca):
 *   1. Kop + judul + keterangan surat jalan (kode, sales, tanggal canvasing, status);
 *   2. **Ringkasan**: jumlah penginputan, total barang (pcs), jumlah jenis barang, penginputan terakhir;
 *   3. **Tabel semua penginputan**: NO | TANGGAL | JAM | DIAMBIL DARI | QTY | DICATAT OLEH + baris TOTAL;
 *   4. **Rincian tiap penginputan**: daftar barang + qty per entri (3 kolom supaya hemat tempat);
 *   5. **Rekap per barang**: setiap barang yang pernah diambil beserta total qty-nya (urut A–Z);
 *   6. Blok tanda tangan (kalau setelan "tanda tangan" hidup).
 *
 * Ukuran kertas mengikuti dokumen lain di aplikasi ini (F4 215 x 330 mm, margin 10 mm) dan penulis PDF-nya
 * memakai `lib/pdf.js` yang sama dengan memo penginputan — tidak ada pustaka baru. Dokumennya otomatis
 * pindah halaman kalau isinya panjang (kop diulang di halaman berikutnya).
 */

const fs = require('fs');
const { Dokumen } = require('./pdf');
const { angka, tanggalPanjang, tanggalPendek, namaAdminSesi, urutNama, hariIni, jamSekarang } = require('./util');

/*
 * VERSI = waktu ubah berkas ini. Dipakai sebagai `?v=` pada tautan tombol cetak (sama seperti VERSI_MEMO
 * pada memo penginputan) supaya **penampil PDF di ponsel tidak memakai berkas LAMA**.
 *
 * Kenapa penting: pernah terjadi pengguna membuka berkas PDF yang sudah tersimpan di penampilnya lalu
 * menyimpulkan "tidak ada yang berubah" padahal kodenya sudah baru. Dengan `?v=`, alamat berkasnya
 * berubah setiap kali laporan ini diperbarui sehingga penampil wajib mengambil yang baru.
 */
const VERSI_EKSPEDISI = (() => {
  try {
    return String(Math.round(fs.statSync(__filename).mtimeMs));
  } catch (e) {
    return '1';
  }
})();
const { noSurat } = require('./kode');
const { semua: setelanSemua } = require('./setelan');

const F4 = { lebarMm: 215, tinggiMm: 330 };
const MARGIN = 10;
const LEBAR_ISI = F4.lebarMm - MARGIN * 2; // 195 mm
const BATAS_BAWAH = F4.tinggiMm - MARGIN - 12; // sisakan ruang untuk kaki halaman

/**
 * y-argumen untuk `Dokumen.teks()` supaya **garis dasar** huruf berada `turun` mm di bawah tepi ATAS
 * baris. `Dokumen.teks()` menambah jarak turun sendiri (bawaan `ukuran * 0.36`), jadi nilai itu
 * dikurangkan di sini.
 *
 * Dipakai supaya semua tulisan **duduk di dalam barisnya**. Sebelumnya posisi baris ditulis
 * `y + 4` SEKALIGUS memakai pemusatan vertikal `tengahBaris`, sehingga teksnya tergelincir ke bawah dan
 * menempel/menyeberangi garis baris (terukur: garis dasar 0,4 mm di bawah garis bawah baris).
 */
const dasar = (turun, ukuran) => turun - ukuran * 0.36;

/**
 * Label sumber pengambilan (sama dengan yang dipakai layar & memo).
 * Permintaan user (revisi ke-157): sumber gudang ditulis **"Mengambil di gudang"** (sama dengan kolom
 * Keterangan di kartu Ekspedisi Barang) — "di memo juga" berlaku untuk dokumen ini.
 */
function labelSumber(b) {
  const s = String((b && b.sumber) || '').toLowerCase();
  if (s === 'kembali-gudang') return 'Dikembalikan ke Gudang';
  if (!s || s === 'gudang') return 'Mengambil di gudang';
  return b.kode_sumber ? `${b.kode_sumber} | ${b.sumber}` : `Sales ${b.sumber}`;
}

exports.VERSI_EKSPEDISI = VERSI_EKSPEDISI;
exports.rekapEkspedisi = function ({ sesi, entri = [], setelan, namaAdmin }) {
  const st = setelan || setelanSemua();
  const d = new Dokumen(F4);
  let y = MARGIN;

  /** Tulis ulang kop (dipakai di halaman pertama & setiap halaman lanjutan). */
  function kop(lanjutan) {
    /*
     * PERMINTAAN USER (revisi ke-157): "logo tidak usah di memo" — logo yang dulu digambar di paling atas
     * (rata tengah, revisi ke-147) DIHAPUS dari dokumen ini. Jangan dihidupkan lagi; surat jalan & laporan
     * F4 tetap memakai logo di kopnya.
     */
    d.teks(MARGIN, y, st.kop_sub, { ukuran: 14, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 6.6;
    /*
     * Judul dokumen diselaraskan dengan label tombolnya ("Cetak Memo Pengambilan Lengkap", revisi ke-150) —
     * sebelumnya "REKAP EKSPEDISI BARANG". Isinya tetap seluruh penginputan barang perjalanan ini.
     */
    d.teks(MARGIN, y, 'MEMO EKSPEDISI BARANG LENGKAP', { ukuran: 13, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
    y += 5.4;
    const ket = `Surat Jalan ${noSurat(sesi)} | ${sesi.sales_nama || '-'} | Canvasing ${tanggalPendek(sesi.tanggal)}${lanjutan ? ' | lanjutan' : ''}`;
    d.teks(MARGIN, y, ket, { ukuran: 9.2, rata: 'tengah', lebar: LEBAR_ISI });
    y += 5;
    if (st.kop_garis !== '0') {
      d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.4 });
      y += 4;
    }
  }

  /** Pastikan masih ada ruang; kalau tidak, mulai halaman baru (kop diulang). */
  function ruang(butuh) {
    if (y + butuh > BATAS_BAWAH) {
      d.baru();
      y = MARGIN;
      kop(true);
    }
  }

  /** Judul bagian (dengan garis bawah tipis). */
  function bagian(judul) {
    ruang(12);
    d.teks(MARGIN, y + dasar(1.7, 10.4), judul, { ukuran: 10.4, tebal: true });
    y += 3.2;                                   // garis bawah DI BAWAH tulisan (tidak menyeberangi huruf)
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.25 });
    y += 4.6;
  }

  kop(false);

  /* ---------- TABEL SEMUA PENGINPUTAN ---------- */
  /*
   * Total barang dipakai di baris TOTAL tabel & di bagian rekap per barang. (Empat kotak ringkasan
   * "PENGINPUTAN / TOTAL BARANG / JENIS BARANG / TERAKHIR" sudah DIHAPUS atas permintaan user:
   * "bagian atas empat kotak info pengimputan, total barang dts. tidak usah".)
   */
  const totalQty = entri.reduce((a, b) => a + (b.total || 0), 0);
  bagian('1. SEMUA PENGINPUTAN BARANG');
  const KOL = [
    { judul: 'NO', x: 0, w: 8, rata: 'tengah' },
    { judul: 'TANGGAL', x: 8, w: 22, rata: 'tengah' },
    { judul: 'JAM', x: 30, w: 20, rata: 'tengah' },
    { judul: 'KETERANGAN', x: 50, w: 63, rata: 'left' },
    { judul: 'QTY', x: 113, w: 16, rata: 'tengah' },
    { judul: 'DICATAT OLEH', x: 129, w: 50, rata: 'left' },
  ];
  const TINGGI = 6.9;   // dinaikkan bersama ukuran huruf (revisi ke-151)

  function kepalaTabel() {
    d.kotak(MARGIN, y, LEBAR_ISI, TINGGI, { abu: 0.88 });
    KOL.forEach((k) => d.teks(MARGIN + k.x + 1.5, y + dasar(4.5, 8.2), k.judul, { ukuran: 8.2, tebal: true, rata: k.rata, lebar: k.w - 3 }));
    y += TINGGI;
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.2 });
  }

  kepalaTabel();
  entri.forEach((b, i) => {
    if (y + TINGGI > BATAS_BAWAH) {
      d.baru();
      y = MARGIN;
      kop(true);
      d.teks(MARGIN, y, '1. SEMUA PENGINPUTAN BARANG (lanjutan)', { ukuran: 10.4, tebal: true });
      y += 5.8;
      kepalaTabel();
    }
    const isi = [String(i + 1), tanggalPendek(b.tanggal), b.jam_mulai || '-', d.potong(labelSumber(b), 7.8, KOL[3].w - 3), angka(b.total || 0), d.potong(b.petugas || '-', 7.8, KOL[5].w - 3)];
    KOL.forEach((k, j) => d.teks(MARGIN + k.x + 1.5, y + dasar(4.5, 8.4), isi[j], { ukuran: 8.4, rata: k.rata, lebar: k.w - 3 }));
    y += TINGGI;
    d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.12 });
  });
  // baris total
  d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.4 });
  d.teks(MARGIN + 1.5, y + dasar(4.6, 8.6), 'TOTAL', { ukuran: 8.6, tebal: true, rata: 'kanan', lebar: 111 });
  d.teks(MARGIN + KOL[4].x + 1.5, y + dasar(4.6, 9), angka(totalQty), { ukuran: 9, tebal: true, rata: 'tengah', lebar: KOL[4].w - 3 });
  d.teks(MARGIN + KOL[5].x + 1.5, y + dasar(4.6, 8.2), 'pcs', { ukuran: 8.2, rata: 'left', lebar: KOL[5].w - 3 });
  y += TINGGI + 8;

  /* ---------- 4. RINCIAN TIAP PENGINPUTAN ---------- */
  bagian('2. RINCIAN BARANG PER PENGINPUTAN');
  const KOL_RINCI = 3;
  const JARAK_RINCI = 4;
  const LEBAR_RINCI = (LEBAR_ISI - JARAK_RINCI * (KOL_RINCI - 1)) / KOL_RINCI;
  const TINGGI_RINCI = 5.4;
  const MAKS_BARIS_KOLOM = 24;

  entri.forEach((b, i) => {
    const items = urutNama(b.items || []);
    const barisPerKolom = Math.max(1, Math.min(MAKS_BARIS_KOLOM, Math.ceil(items.length / KOL_RINCI)));
    ruang(9 + barisPerKolom * TINGGI_RINCI);
    // kepala entri
    d.kotak(MARGIN, y, LEBAR_ISI, 6, { abu: 0.93 });
    d.teks(MARGIN + 1.5, y + dasar(4, 8.4), `${i + 1}. ${tanggalPendek(b.tanggal)} | jam ${b.jam_mulai || '-'} | ${labelSumber(b)} | ${angka(b.total || 0)} pcs | dicatat oleh ${b.petugas || '-'}`, {
      ukuran: 8.4,
      tebal: true,
    });
    y += 6 + 2;
    // daftar barang: diisi ke bawah dulu per kolom
    const mulaiY = y;
    let kolom = 0;
    let turun = 0;
    items.forEach((it) => {
      if (turun >= barisPerKolom) {
        kolom += 1;
        turun = 0;
      }
      const x = MARGIN + kolom * (LEBAR_RINCI + JARAK_RINCI);
      const yy = mulaiY + turun * TINGGI_RINCI;
      d.teks(x + 1, yy + dasar(3.55, 8.2), d.potong(`${it.nama} x ${angka(it.qty)}`, 8.2, LEBAR_RINCI - 2), { ukuran: 8.2 });
      turun += 1;
    });
    y = mulaiY + barisPerKolom * TINGGI_RINCI + 4;
  });

  y += 4;

  /* ---------- 5. REKAP PER BARANG ---------- */
  bagian('3. REKAP PER BARANG (seluruh penginputan)');
  const perBarang = new Map();
  entri.forEach((b) => (b.items || []).forEach((it) => {
    const kunci = String(it.nama || '');
    perBarang.set(kunci, (perBarang.get(kunci) || 0) + (Number(it.qty) || 0));
  }));
  const daftarBarang = urutNama([...perBarang.entries()].map(([nama, qty]) => ({ nama, qty })));
  const KOL_B = 3;
  const JARAK_B = 4;
  const LEBAR_B = (LEBAR_ISI - JARAK_B * (KOL_B - 1)) / KOL_B;
  const TINGGI_B = 6;
  const LEBAR_BNO = 8;
  const LEBAR_BQTY = 16;
  const barisB = Math.max(1, Math.min(MAKS_BARIS_KOLOM, Math.ceil(daftarBarang.length / KOL_B)));
  ruang(8 + barisB * TINGGI_B + 8);
  // kepala tiap kolom rekap
  for (let k = 0; k < KOL_B; k++) {
    const x = MARGIN + k * (LEBAR_B + JARAK_B);
    d.kotak(x, y, LEBAR_B, TINGGI_B, { abu: 0.88 });
    d.teks(x + 1, y + dasar(4, 8), 'NO', { ukuran: 8, tebal: true, rata: 'tengah', lebar: LEBAR_BNO });
    d.teks(x + LEBAR_BNO + 1, y + dasar(4, 8), 'NAMA BARANG', { ukuran: 8, tebal: true });
    d.teks(x + LEBAR_B - LEBAR_BQTY, y + dasar(4, 8), 'TOTAL', { ukuran: 8, tebal: true, rata: 'tengah', lebar: LEBAR_BQTY });
  }
  y += TINGGI_B;
  const mulaiB = y;
  daftarBarang.forEach((it, i) => {
    const kolom = Math.floor(i / barisB);
    const turun = i % barisB;
    const x = MARGIN + kolom * (LEBAR_B + JARAK_B);
    const yy = mulaiB + turun * TINGGI_B;
    const lebarNm = LEBAR_B - LEBAR_BNO - LEBAR_BQTY;
    d.teks(x + 1, yy + dasar(3.9, 8.2), String(i + 1), { ukuran: 8.2, rata: 'tengah', lebar: LEBAR_BNO });
    d.teks(x + LEBAR_BNO + 1, yy + dasar(3.9, 8.2), d.potong(it.nama, 8.2, lebarNm - 2), { ukuran: 8.2 });
    d.teks(x + LEBAR_B - LEBAR_BQTY, yy + dasar(3.9, 8.2), angka(it.qty), { ukuran: 8.2, rata: 'tengah', lebar: LEBAR_BQTY });
    d.garis(x, yy + TINGGI_B, x + LEBAR_B, yy + TINGGI_B, { tebal: 0.12 });
  });
  y = mulaiB + barisB * TINGGI_B + 2.4;
  d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.4 });
  d.teks(MARGIN + 1, y + 4.4, `TOTAL SELURUH BARANG: ${angka(totalQty)} pcs dari ${angka(daftarBarang.length)} jenis barang`, { ukuran: 9, tebal: true });
  y += 10;

  /*
   * KAKI DOKUMEN: tanggal & jam cetak. Selain lazim di laporan, ini penanda supaya pengguna bisa
   * memastikan berkas PDF yang dilihatnya memang berkas yang BARU dibuat (bukan berkas lama yang masih
   * tersimpan di penampil PDF ponsel).
   */
  ruang(8);
  d.garis(MARGIN, y, MARGIN + LEBAR_ISI, y, { tebal: 0.2 });
  y += 4;
  d.teks(MARGIN, y, `Dicetak: ${tanggalPendek(hariIni())} ${jamSekarang()}`, { ukuran: 7.8, rata: 'kanan', lebar: LEBAR_ISI });
  y += 6;

  /* ---------- 6. TANDA TANGAN ---------- */
  if (st.ttd_tampil !== '0') {
    ruang(30);
    const admin = namaAdmin || namaAdminSesi(sesi);
    const kolomTtd = (x, jabatan, nama) => {
      d.teks(x, y, jabatan, { ukuran: 9 });
      d.garis(x, y + 16, x + 60, y + 16, { tebal: 0.3 });
      d.teks(x, y + 20, nama || ' ', { ukuran: 9, tebal: true });
    };
    kolomTtd(MARGIN, 'Admin Gudang,', admin);
    kolomTtd(MARGIN + LEBAR_ISI - 60, 'Sales,', sesi.sales_nama || '');
  }

  return d.buffer();
};
