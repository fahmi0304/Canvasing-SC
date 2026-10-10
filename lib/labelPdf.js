'use strict';
/*
 * LABEL BARCODE / QR → PDF (untuk dicetak lewat APLIKASI PIHAK KETIGA).
 *
 * Latar (permintaan user): "Tetap tidak bisa mencetak barcode, bagaimana kalo menjadikannya pdf saja,
 * ada opsi ukuran printer yang akan digunakan, print nya menggunakan aplikasi pihak ketiga".
 *
 * Kenapa PDF: aplikasi pengguna (RawBT, aplikasi merek printer, atau layanan cetak bawaan Android)
 * bisa mencetak berkas PDF dengan ukuran halaman yang SUDAH PASTI — tidak bergantung pada protokol
 * Bluetooth yang kita tebak (raster ESC/POS / TSPL) dan tidak lewat Web Bluetooth sama sekali.
 *
 * Isi label digambar VEKTOR (kotak hitam untuk modul QR & bar Code128), bukan gambar raster:
 *  - ukuran halaman PDF ditentukan tepat (mis. gulungan 58 mm),
 *  - modul QR selalu persegi & digambar dari data bwip-js (bukan hasil tangkapan layar),
 *  - hasil cetak tetap tajam di resolusi printer mana pun.
 *
 * Sumber geometri: `bwipjs.render()` (API gambar bwip-js) yang kita "rekam" sendiri — lihat `rekam()`.
 * Satuannya: 2 satuan bwip = 1 modul; `line(...)` = satu bar batang (x = titik TENGAH bar).
 */

const bwipjs = require('bwip-js');
const { Dokumen, lebarTeks } = require('./pdf');

/**
 * Pilihan kertas. `tinggi: null` = gulungan (tinggi halaman mengikuti isi label).
 * `margin` = batas tidak tercetak (printer thermal umumnya 1–3 mm).
 */
const KERTAS = {
  roll58: { lebar: 58, tinggi: null, margin: 2, nama: 'Gulungan 58 mm (paling umum)' },
  roll80: { lebar: 80, tinggi: null, margin: 2, nama: 'Gulungan 80 mm' },
  roll40: { lebar: 40, tinggi: null, margin: 1.5, nama: 'Gulungan 40 mm' },
  roll30: { lebar: 30, tinggi: null, margin: 1.5, nama: 'Gulungan 30 mm (label kecil)' },
  roll25: { lebar: 25, tinggi: null, margin: 1, nama: 'Gulungan 25 mm (paling kecil)' },
  label50x30: { lebar: 50, tinggi: 30, margin: 1.5, nama: 'Label 50 × 30 mm' },
  label40x30: { lebar: 40, tinggi: 30, margin: 1.5, nama: 'Label 40 × 30 mm' },
  label58x40: { lebar: 58, tinggi: 40, margin: 2, nama: 'Label 58 × 40 mm' },
  /*
   * Lembar A4/F4 (permintaan user: "semua cetak dokumen laporan digabung ke cetak PDF") — dulu label
   * pada kertas A4/F4 hanya bisa dicetak lewat dialog cetak browser (`/cetak/label`, kini tidak dipakai
   * lagi di UI). Sekarang PDF-nya bisa juga: label ditata BERGRID di lembar, sebanyak yang muat
   * (64 × 34 mm di A4, 64 × 35 mm di F4) — sama seperti lembar label stiker yang dicetak printer laser.
   */
  a4: { lebar: 210, tinggi: 297, margin: 8, grid: { lebar: 64, tinggi: 34, jarak: 2 }, nama: 'Kertas A4 — lembar label 64 × 34 mm' },
  f4: { lebar: 215, tinggi: 330, margin: 8, grid: { lebar: 64, tinggi: 35, jarak: 2 }, nama: 'Kertas F4 — lembar label 64 × 35 mm' },
};

/** Nama kertas untuk pilihan di halaman (id dipakai di URL). */
function daftarKertas() {
  return Object.entries(KERTAS).map(([id, k]) => ({ id, nama: k.nama, lebar: k.lebar, tinggi: k.tinggi }));
}

/**
 * Ambil GEOMETRI barcode/QR dari `bwipjs.raw()` — data modul mentah dari BWIPP, bukan hasil
 * menebak dari API gambar.
 *
 * Alasan (penting): percobaan pertama memakai `bwipjs.render()` lalu menafsirkan polygon/line-nya
 * sendiri dan hasilnya QR yang TIDAK bisa dipindai (bwip-js mengisi path dengan aturan even-odd,
 * jadi setiap kotak tidak boleh digambar terpisah). `raw()` memberi data yang tidak ambigu:
 *   - QR    : `pixs` = bitmap datar (1 = modul hitam, 0 = putih), `pixx` × `pixy` = jumlah modul.
 *   - 1D    : `sbs` = lebar run BERGANTAI (bar, spasi, bar, …) dalam satuan MODUL.
 *
 * Hasilnya dipakai langsung untuk menggambar KOTAK di PDF (tiap run hitam = satu kotak), jadi
 * modulnya tajam tanpa perlu trik even-odd.
 */
function rekam(kode, tipe, { ec = 'M' } = {}) {
  try {
    if (tipe === 'qr') {
      const r = bwipjs.raw('qrcode', String(kode), { eclevel: ec })[0];
      if (!r || !r.pixs) return null;
      return { tipe: 'qr', modul: r.pixx, baris: r.pixy, bitmap: r.pixs };
    }
    const r = bwipjs.raw('code128', String(kode), {})[0];
    if (!r || !r.sbs) return null;
    const bar = [];
    let x = 0;
    r.sbs.forEach((lebar, i) => {
      if (i % 2 === 0) bar.push({ x, w: lebar });   // indeks genap = batang hitam
      x += lebar;
    });
    return { tipe: 'code128', totalModul: x, bar };
  } catch (e) {
    return null;
  }
}

/** Zona sunyi QR (modul) di setiap sisi — standar ISO/IEC 18004. */
const QR_SUNYI = 4;

/** Jumlah modul QR termasuk zona sunyi (untuk menghitung besar modul). */
function modulQrTotal(r) {
  return r.modul + QR_SUNYI * 2;
}

/**
 * Tulis QR ke halaman PDF: tiap baris modul hitam yang berdampingan digabung jadi satu kotak,
 * dan ukuran modul dibulatkan ke KELIPATAN DOT printer supaya kotaknya tajam (bukan pecahan dot).
 * @returns {{sisiMm:number, modulDot:number}}
 */
function gambarQr(d, r, xMm, yMm, sisiMaksMm, dotsPerMm) {
  const total = modulQrTotal(r);
  const modulDot = Math.max(2, Math.floor((sisiMaksMm * dotsPerMm) / total));
  const modulMm = modulDot / dotsPerMm;
  const sisiMm = modulMm * total;
  const x0 = xMm + QR_SUNYI * modulMm;
  const y0 = yMm + QR_SUNYI * modulMm;
  for (let baris = 0; baris < r.baris; baris++) {
    let kolom = 0;
    while (kolom < r.modul) {
      if (r.bitmap[baris * r.modul + kolom] !== 1) { kolom++; continue; }
      let panjang = 1;
      while (kolom + panjang < r.modul && r.bitmap[baris * r.modul + kolom + panjang] === 1) panjang++;
      d.kotak(x0 + kolom * modulMm, y0 + baris * modulMm, panjang * modulMm, modulMm, { abu: 0 });
      kolom += panjang;
    }
  }
  return { sisiMm, modulDot };
}

/**
 * Tulis barcode batang (Code128) ke halaman PDF. Lebar satu modul dibulatkan ke kelipatan dot.
 * `rataKiri` = gambar dari tepi kiri kotak (dipakai mode "keduanya" supaya QR selalu bisa
 * diletakkan TEPAT di sebelah kanan batang — kalau batangnya di tengah, posisi QR menebak dan
 * keduanya saling menimpa; bug nyata yang tertangkap saat menguji label lembar A4: QR-nya menimpa
 * batang sehingga hanya sebagian label terbaca decoder).
 * @returns {{lebarMm:number, modulDot:number, x:number}}
 */
function gambarBatang(d, r, xMm, yMm, lebarMaksMm, tinggiMm, dotsPerMm, rataKiri = false) {
  const modulDot = Math.max(1, Math.floor((lebarMaksMm * dotsPerMm) / r.totalModul));
  const modulMm = modulDot / dotsPerMm;
  const lebarMm = modulMm * r.totalModul;
  const x0 = xMm + (rataKiri ? 0 : Math.max(0, (lebarMaksMm - lebarMm) / 2));
  r.bar.forEach((b) => {
    d.kotak(x0 + b.x * modulMm, yMm, b.w * modulMm, tinggiMm, { abu: 0 });
  });
  return { lebarMm, modulDot, x: x0 };
}

/** Bungkus teks jadi beberapa baris yang muat `lebarMm` (maks `maksBaris`). */
function bungkus(teks, ukuran, lebarMm, maksBaris) {
  const kata = String(teks || '').split(/\s+/).filter(Boolean);
  const baris = [];
  let kini = '';
  kata.forEach((k) => {
    const coba = kini ? kini + ' ' + k : k;
    if (!kini || lebarTeks(coba, ukuran) <= lebarMm) kini = coba;
    else { baris.push(kini); kini = k; }
  });
  if (kini) baris.push(kini);
  return baris.slice(0, maksBaris);
}

/**
 * Susun PDF label.
 *
 * @param {object} o
 * @param {Array<{kode:string,nama:string,qty:number}>} o.barang
 * @param {string} o.kertas  id dari KERTAS
 * @param {'qr'|'code128'|'keduanya'|'nonaktif'} o.jenis
 * @param {boolean} o.tampilKode
 * @param {boolean} o.tampilNama
 * @param {'kecil'|'sedang'|'besar'} o.ukuranQr
 * @param {number} [o.dpi=203]  resolusi printer (dipakai untuk menyelaraskan modul ke kelipatan dot)
 * @returns {Buffer} berkas PDF
 */
function buatLabelPdf(o) {
  const kertas = KERTAS[o.kertas] || KERTAS.roll58;
  const margin = kertas.margin;
  const grid = kertas.grid || null;          // lembar A4/F4: label ditata bergrid
  // lebar & tinggi satu SEL label (kertas gulungan = 1 label per halaman)
  const selLebar = grid ? grid.lebar : kertas.lebar - margin * 2;
  const selTinggi = grid ? grid.tinggi : null;
  const lebarIsi = selLebar;
  const porsiQr = o.ukuranQr === 'kecil' ? 0.45 : o.ukuranQr === 'besar' ? 0.85 : 0.65;
  const jenis = ['qr', 'code128', 'keduanya', 'nonaktif'].includes(o.jenis) ? o.jenis : 'qr';
  // resolusi printer: 203 dpi (8 dot/mm, paling umum untuk printer thermal) atau 300 dpi
  const dpi = Number(o.dpi) === 300 ? 300 : 203;
  const dotsPerMm = dpi / 25.4;
  const tampilKode = o.tampilKode !== false;
  const tampilNama = o.tampilNama !== false;

  /*
   * Ukuran huruf mengikuti lebar label (label kecil = huruf kecil), satuannya POIN PDF langsung.
   * CATATAN: versi pertama salah — angkanya ditulis dalam mm lalu dikonversi lagi dengan poin(),
   * sehingga hurufnya ~2,8x terlalu besar dan baris teks melimpah keluar kertas (tertangkap uji raster).
   */
  const ukKode = Math.max(5.5, Math.min(11, selLebar * 0.19));
  const ukNama = Math.max(5, Math.min(10, selLebar * 0.16));

  // ukuran label gulungan dihitung dulu supaya halaman tidak menyisakan kertas kosong
  const label = o.barang.length ? o.barang : [{ kode: '', nama: '', qty: 0 }];

  /** Tinggi isi satu label (mm) — dipakai untuk kertas gulungan. */
  function tinggiIsi(b) {
    let t = margin;
    const adaKode = jenis !== 'nonaktif';
    const batasTinggi = selTinggi ? selTinggi - margin * 2 - 14 : 40;
    if (jenis === 'qr') {
      t += Math.min(lebarIsi * porsiQr, batasTinggi);
    } else if (jenis === 'keduanya') {
      t += Math.min(lebarIsi * 0.55, 12);
    } else if (jenis === 'code128') {
      t += 11;
    }
    if (tampilKode && b.kode) t += ukKode * 0.42 + 1.6;
    if (tampilNama && b.nama) t += bungkus(b.nama, ukNama, lebarIsi, 3).length * ukNama * 0.42 + 0.8;
    return t + margin + (adaKode ? 1.5 : 0);
  }

  // kertas gulungan: tinggi halaman mengikuti isi label pertama
  const tinggiHalaman = kertas.tinggi || Math.max(18, Math.round(tinggiIsi(label[0]) * 2) / 2);
  /*
   * `new Dokumen()` sudah membuat halaman pertama DAN `d.isi` menunjuk ke halaman itu.
   * JANGAN membuang halaman pertama (dulu `d.halaman.pop()`): setelah dibuang, hasil gambar
   * masuk ke array yang sudah tidak terdaftar sehingga PDF-nya kosong (478 bita) — kesalahan yang
   * tertangkap saat menguji berkas hasilnya. Jadi: halaman pertama dipakai, sisanya `d.baru()`.
   */
  const d = new Dokumen({ lebarMm: kertas.lebar, tinggiMm: tinggiHalaman });

  /*
   * Susunan halaman:
   *  - kertas gulungan / label tetap → SATU label per halaman;
   *  - lembar A4/F4 → label ditata bergrid (kolom × baris) di tiap halaman.
   */
  let kolom = 1;
  let baris = 1;
  if (grid) {
    kolom = Math.max(1, Math.floor((kertas.lebar - margin * 2 + grid.jarak) / (grid.lebar + grid.jarak)));
    baris = Math.max(1, Math.floor((kertas.tinggi - margin * 2 + grid.jarak) / (grid.tinggi + grid.jarak)));
  }
  const perHalaman = kolom * baris;

  let halamanPertama = true;
  let diHalaman = 0;
  label.forEach((b) => {
    const qty = Math.max(1, Number(b.qty) || 1);
    for (let i = 0; i < qty; i++) {
      if (!halamanPertama && diHalaman >= perHalaman) {
        d.baru();
        diHalaman = 0;
      }
      halamanPertama = false;
      const kx = grid ? margin + (diHalaman % kolom) * (grid.lebar + grid.jarak) : margin;
      const ky = grid ? margin + Math.floor(diHalaman / kolom) * (grid.tinggi + grid.jarak) : margin;
      gambarSatu(d, b, kx, ky);
      diHalaman += 1;
    }
  });

  function gambarSatu(d, b, kx, ky) {
    let y = ky;
    const tengah = (w) => kx + (lebarIsi - w) / 2;

    if (jenis === 'qr') {
      const sisiIsi = lebarIsi * porsiQr;
      const tinggiMaks = selTinggi ? selTinggi - margin * 2 - teksTinggi(b) - 1.5 : 40;
      const sisi = Math.min(sisiIsi, tinggiMaks);
      const r = rekam(b.kode, 'qr');
      if (r) {
        // QR WAJIB persegi; modulnya dibulatkan ke kelipatan dot printer (lihat gambarQr)
        const sisiNyata = ((modulQrTotal(r) * Math.max(2, Math.floor((sisi * dotsPerMm) / modulQrTotal(r)))) / dotsPerMm);
        const hasil = gambarQr(d, r, tengah(sisiNyata), y, sisi, dotsPerMm);
        y += hasil.sisiMm + 1.2;
      } else {
        d.teks(kx, y + 3, 'kode kosong', { ukuran: ukNama });
        y += 5;
      }
    } else if (jenis === 'code128') {
      const r = rekam(b.kode, 'code128');
      if (r) {
        const tinggiBar = Math.min(11, selTinggi ? selTinggi - margin * 2 - teksTinggi(b) - 1.5 : 11);
        gambarBatang(d, r, kx, y, lebarIsi, tinggiBar, dotsPerMm);
        y += tinggiBar + 1.2;
      }
    } else if (jenis === 'keduanya') {
      // barcode batang di kiri, QR di kanan (QR yang menjamin keterbacaan kode panjang)
      const r = rekam(b.kode, 'code128');
      const q = rekam(b.kode, 'qr');
      if (r && q) {
        const sisiQrMaks = Math.min(lebarIsi * 0.38, 12);
        const totalQr = modulQrTotal(q);
        const modulQrDot = Math.max(2, Math.floor((sisiQrMaks * dotsPerMm) / totalQr));
        const sisiQr = (totalQr * modulQrDot) / dotsPerMm;
        const lebarBcMaks = Math.max(10, lebarIsi - sisiQr - 2);
        // batang dirata-kirikan supaya QR-nya PASTI duduk di sebelah kanannya tanpa tumpang tindih
        const bc = gambarBatang(d, r, kx, y, lebarBcMaks, Math.min(11, sisiQr), dotsPerMm, true);
        gambarQr(d, q, bc.x + bc.lebarMm + 2, y, sisiQrMaks, dotsPerMm);
        y += Math.max(Math.min(11, sisiQr), sisiQr) + 1.2;
      }
    }

    if (tampilKode && b.kode) {
      const t = b.kode;
      let uk = ukKode;
      // kode panjang: kecilkan huruf sampai muat lebar kertas; kalau masih lebar, pecah 2 baris
      while (uk > ukKode * 0.6 && lebarTeks(t, uk, true) > lebarIsi) uk -= 0.3;
      const barisKode = lebarTeks(t, uk, true) > lebarIsi ? bungkus(t, uk, lebarIsi, 2) : [t];
      barisKode.forEach((baris) => {
        d.teks(kx, y, baris, { ukuran: uk, tebal: true, rata: 'tengah', lebar: lebarIsi });
        y += uk * 0.42 + 0.4;
      });
      y += 0.8;
    }
    if (tampilNama && b.nama) {
      bungkus(b.nama, ukNama, lebarIsi, 3).forEach((baris) => {
        d.teks(kx, y, baris, { ukuran: ukNama, rata: 'tengah', lebar: lebarIsi });
        y += ukNama * 0.42;
      });
    }
  }

  function teksTinggi(b) {
    let t = 0;
    if (tampilKode && b.kode) t += ukKode * 0.42 + 1.6;
    if (tampilNama && b.nama) t += bungkus(b.nama, ukNama, lebarIsi, 3).length * ukNama * 0.42 + 0.8;
    return t;
  }

  return d.buffer();
}

module.exports = { buatLabelPdf, daftarKertas, KERTAS, rekam };
