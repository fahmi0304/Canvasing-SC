'use strict';
const bwipjs = require('bwip-js');

/**
 * Zona sunyi QR = 4 modul (standar ISO/IEC 18004). Di bwip-js, `paddingwidth` dihitung dalam
 * SATUAN PIKSEL SKALA-1 dan lebar satu modul QR = 2 px skala-1, jadi 4 modul butuh padding = 8.
 * Sebelumnya nilai ini 1 (= ½ modul) sehingga hasil cetak nyaris tidak punya batas putih —
 * kamera sering gagal mengunci QR yang zona sunyinya kurang dari 4 modul.
 */
const QR_PAD = 8;
/** Tingkat koreksi galat QR. 'M' (±15% data rusak masih terbaca) aman untuk kertas thermal
 *  yang titiknya bisa melebar/kotor; 'L' terlalu rapuh, 'H' membuat QR jauh lebih besar. */
const QR_EC = 'M';

/** SVG barcode/QR, ukuran mengikuti style CSS (viewBox sudah proporsional). */
function svg(kode, tipe = 'code128', opts = {}) {
  const teks = String(kode || '').trim();
  if (!teks) return '';
  try {
    if (tipe === 'qr') {
      const skala = opts.scale || 3;
      const svgQr = bwipjs.toSVG({
        bcid: 'qrcode',
        text: teks,
        scale: skala,
        paddingwidth: QR_PAD,
        paddingheight: QR_PAD,
        eclevel: opts.eclevel || QR_EC,
      });
      /*
       * Sisipkan jumlah modul sebagai atribut `data-modul` (= lebar viewBox dibagi 2×skala).
       * Gunanya: ukuran modul NYATA di kertas bisa dihitung & diperiksa langsung dari HTML
       * (lebar QR di kertas ÷ jumlah modul) tanpa menebak, dan `uji-qr.js` memverifikasinya.
       * Total modul sudah TERMASUK zona sunyi 4 modul di setiap sisi.
       */
      const vb = /viewBox="0 0 (\d+)/.exec(svgQr);
      const modul = vb ? Math.round(Number(vb[1]) / (2 * skala)) : 0;
      return svgQr.replace('<svg ', `<svg data-modul="${modul}" data-zona="${QR_PAD / 2}" `);
    }
    return bwipjs.toSVG({
      bcid: 'code128',
      text: teks,
      scale: 2,
      height: opts.height || 11,
      includetext: false,
      paddingwidth: 0,
      paddingheight: 0,
    });
  } catch (err) {
    return '';
  }
}

/** PNG (dipakai halaman cetak thermal Bluetooth — canvas butuh gambar raster). */
function png(opsi, cb) {
  bwipjs.toBuffer(opsi, cb);
}

module.exports = { svg, png, QR_PAD, QR_EC };
