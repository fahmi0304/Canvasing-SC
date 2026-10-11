'use strict';
/**
 * PEMBACA GAMBAR untuk penulis PDF (`lib/pdf.js`) — permintaan user: *"letakkan logo pada rekap laporan
 * expedisi barang tepat di atas, rata tengah"*.
 *
 * Penulis PDF aplikasi ini (`lib/pdf.js`) tidak punya penanaman gambar, dan logo-nya bisa berupa
 * **PNG** (bawaan `public/logo-mark.png`, atau logo unggahan administrator) maupun **JPEG**. Modul ini
 * mengubah berkas gambar itu menjadi data yang bisa ditanam PDF:
 *
 *  - **JPEG** → dipakai APA ADANYA dengan filter `/DCTDecode` (PDF mendukung JPEG secara bawaan, jadi
 *    tidak perlu di-dekode ulang — kualitasnya tetap seperti aslinya).
 *  - **PNG** → di-dekode sendiri: `zlib.inflateSync` untuk IDAT, lalu melepas filter baris (None/Sub/Up/
 *    Average/Paeth, spesifikasi PNG), lalu diubah ke **RGB 8-bit** dan dipadatkan lagi dengan
 *    `zlib.deflateSync`. Transparansi **dikomposit ke latar PUTIH** — kalau tidak, sudut transparan logo
 *    (yang RGB-nya 0,0,0) akan tercetak sebagai kotak hitam.
 *
 * Batasan yang disengaja (kalau tidak didukung, pemanggil cukup TIDAK menampilkan logo — laporan tetap
 * dibuat): PNG dengan `bitDepth` bukan 8, PNG ber-interlace (Adam7), dan JPEG CMYK.
 *
 * SUDUT MEMBULAT (`radiusPersen`): logo unggahan biasanya gambar PERSEGI dengan sudut siku, sedangkan di
 * halaman aplikasi sudutnya dibulatkan oleh CSS (`border-radius: 15.6%` — app.css/print.css/ikon HP).
 * PDF tidak mengenal `border-radius`, jadi gambarnya ditempel apa adanya dan **sudutnya tetap siku**
 * (keluhan user: "Logo masih kotak, ubah sudutnya"). Karena itu pembulatannya dikerjakan DI SINI: piksel di
 * luar persegi bersudut bulat dicetak sebagai **latar PUTIH** (warna kertas), sama seperti tampilan di layar.
 * Persentase radius mengikuti CSS: rx = radius% × lebar, ry = radius% × tinggi (sudut elips untuk gambar
 * yang tidak persegi). Tepinya dihaluskan dengan supersampling 2×2 supaya tidak bergerigi.
 */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const MAGIC_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Pembulatan sudut logo dalam PERSEN — HARUS SAMA dengan angka di tempat lain supaya logo di PDF, kop surat,
 * topbar, pratinjau Setting, dan ikon aplikasi HP terlihat satu bentuk:
 *   - `public/app.css`  -> `.logo-img`, `.login-logo img`, `.logo-pratinjau img` (border-radius: 15.6%)
 *   - `public/print.css` -> `.kop-logo` (border-radius: 15.6%)
 *   - `tools/ikon-dari-logo.js` -> IKON.radius = 15.6
 */
const RADIUS_LOGO_PERSEN = 15.6;

/**
 * Rerata tutupan (coverage) persegi bersudut bulat di satu titik, dengan supersampling 2x2 supaya tepinya
 * halus. Mengembalikan 0..1 (0 = di luar, 1 = di dalam).
 */
function tutupBunder(x, y, lebar, tinggi, rx, ry) {
  let dalam = 0;
  for (const dx of [0.25, 0.75]) {
    for (const dy of [0.25, 0.75]) {
      const px = x + dx;
      const py = y + dy;
      let ok;
      if (px >= rx && px <= lebar - rx) ok = py >= 0 && py <= tinggi;                 // pita mendatar
      else if (py >= ry && py <= tinggi - ry) ok = px >= 0 && px <= lebar;           // pita tegak
      else {
        const cx = px < rx ? rx : lebar - rx;                                        // pusat sudut terdekat
        const cy = py < ry ? ry : tinggi - ry;
        const nx = (px - cx) / rx;
        const ny = (py - cy) / ry;
        ok = nx * nx + ny * ny <= 1;
      }
      if (ok) dalam += 1;
    }
  }
  return dalam / 4;
}

/** Lebar bit per piksel dari tipe warna PNG (hanya untuk bitDepth 8). */
function kanalPerTipe(colorType) {
  switch (colorType) {
    case 0: return 1; // grayscale
    case 2: return 3; // RGB
    case 3: return 1; // palet (indeks)
    case 4: return 2; // grayscale + alpha
    case 6: return 4; // RGBA
    default: throw new Error(`tipe warna PNG ${colorType} tidak didukung`);
  }
}

/** Lepas filter baris PNG (spesifikasi resmi: 0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). */
function lepasFilter(masuk, lebar, tinggi, bpp) {
  const barisByte = lebar * bpp;
  const keluar = Buffer.alloc(barisByte * tinggi);
  let pos = 0;
  for (let y = 0; y < tinggi; y++) {
    const jenis = masuk[pos++];
    const baris = masuk.subarray(pos, pos + barisByte);
    pos += barisByte;
    const kini = keluar.subarray(y * barisByte, (y + 1) * barisByte);
    const atas = y > 0 ? keluar.subarray((y - 1) * barisByte, y * barisByte) : null;
    for (let i = 0; i < barisByte; i++) {
      const kiri = i >= bpp ? kini[i - bpp] : 0;
      const atasI = atas ? atas[i] : 0;
      const kiriAtas = atas && i >= bpp ? atas[i - bpp] : 0;
      let nilai = baris[i];
      if (jenis === 1) nilai += kiri;
      else if (jenis === 2) nilai += atasI;
      else if (jenis === 3) nilai += Math.floor((kiri + atasI) / 2);
      else if (jenis === 4) {
        const p = kiri + atasI - kiriAtas;
        const pa = Math.abs(p - kiri);
        const pb = Math.abs(p - atasI);
        const pc = Math.abs(p - kiriAtas);
        nilai += pa <= pb && pa <= pc ? kiri : pb <= pc ? atasI : kiriAtas;
      }
      kini[i] = nilai & 0xff;
    }
  }
  return keluar;
}

/**
 * Dekode PNG → { lebar, tinggi, data (RGB 8-bit), filter:'FlateDecode', warna:'DeviceRGB' }.
 * Transparansi dikomposit ke PUTIH (logo bisa berbentuk apa saja dengan sudut transparan).
 */
function bacaPng(buf, radiusPersen = 0) {
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let plte = null;
  let trns = null;
  while (pos + 8 <= buf.length) {
    const panjang = buf.readUInt32BE(pos);
    const jenis = buf.toString('latin1', pos + 4, pos + 8);
    const isi = buf.subarray(pos + 8, pos + 8 + panjang);
    if (jenis === 'IHDR') {
      ihdr = {
        lebar: isi.readUInt32BE(0),
        tinggi: isi.readUInt32BE(4),
        bitDepth: isi[8],
        colorType: isi[9],
        interlace: isi[12],
      };
    } else if (jenis === 'PLTE') plte = Buffer.from(isi);
    else if (jenis === 'tRNS') trns = Buffer.from(isi);
    else if (jenis === 'IDAT') idat.push(Buffer.from(isi));
    else if (jenis === 'IEND') break;
    pos += 12 + panjang;   // panjang + jenis + isi + CRC
  }
  if (!ihdr) throw new Error('PNG tanpa IHDR');
  if (ihdr.bitDepth !== 8) throw new Error(`PNG bitDepth ${ihdr.bitDepth} tidak didukung`);
  if (ihdr.interlace !== 0) throw new Error('PNG ber-interlace tidak didukung');
  const bpp = kanalPerTipe(ihdr.colorType);
  const mentah = lepasFilter(zlib.inflateSync(Buffer.concat(idat)), ihdr.lebar, ihdr.tinggi, bpp);
  const jumlah = ihdr.lebar * ihdr.tinggi;
  const rgb = Buffer.alloc(jumlah * 3);
  // sudut membulat: rx/ry mengikuti CSS (persentase dari lebar/tinggi gambar)
  const rx = radiusPersen > 0 ? (radiusPersen / 100) * ihdr.lebar : 0;
  const ry = radiusPersen > 0 ? (radiusPersen / 100) * ihdr.tinggi : 0;
  for (let i = 0; i < jumlah; i++) {
    let r, g, b, a = 255;
    if (ihdr.colorType === 0) {
      r = g = b = mentah[i];
    } else if (ihdr.colorType === 4) {
      r = g = b = mentah[i * 2];
      a = mentah[i * 2 + 1];
    } else if (ihdr.colorType === 2) {
      r = mentah[i * 3]; g = mentah[i * 3 + 1]; b = mentah[i * 3 + 2];
    } else if (ihdr.colorType === 6) {
      r = mentah[i * 4]; g = mentah[i * 4 + 1]; b = mentah[i * 4 + 2]; a = mentah[i * 4 + 3];
    } else { // palet
      const idx = mentah[i];
      r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    }
    if (rx > 0 || ry > 0) {
      // tutupan sudut membulat dikalikan dengan alpha asli gambar
      const x = i % ihdr.lebar;
      const y = (i - x) / ihdr.lebar;
      a = Math.round(a * tutupBunder(x, y, ihdr.lebar, ihdr.tinggi, rx, ry));
    }
    if (a !== 255) {
      // komposit ke PUTIH supaya bagian transparan tidak jadi hitam di kertas
      r = Math.round((r * a + 255 * (255 - a)) / 255);
      g = Math.round((g * a + 255 * (255 - a)) / 255);
      b = Math.round((b * a + 255 * (255 - a)) / 255);
    }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  /*
   * Data RGB dipadatkan dengan deflate supaya cocok dengan filter yang dideklarasikan ('FlateDecode').
   * Tanpa langkah ini PDF-nya berisi data mentah tapi mengaku ter-deflate → pembaca PDF menolak
   * ("Unknown compression method in flate stream") dan gambarnya tidak muncul sama sekali.
   */
  return { lebar: ihdr.lebar, tinggi: ihdr.tinggi, data: zlib.deflateSync(rgb), filter: 'FlateDecode', warna: 'DeviceRGB' };
}

/** Baca ukuran & jumlah komponen JPEG dari penanda SOF (dipakai untuk menentukan ruang warna). */
function infoJpeg(buf) {
  let pos = 2;
  while (pos + 4 < buf.length) {
    if (buf[pos] !== 0xff) { pos += 1; continue; }
    const penanda = buf[pos + 1];
    if (penanda === 0xd8 || penanda === 0x01 || (penanda >= 0xd0 && penanda <= 0xd7)) { pos += 2; continue; }
    const panjang = buf.readUInt16BE(pos + 2);
    const sof = (penanda >= 0xc0 && penanda <= 0xcf) && penanda !== 0xc4 && penanda !== 0xc8 && penanda !== 0xcc;
    if (sof) {
      const komponen = buf[pos + 9];
      return { tinggi: buf.readUInt16BE(pos + 5), lebar: buf.readUInt16BE(pos + 7), komponen };
    }
    pos += 2 + panjang;
  }
  throw new Error('JPEG tanpa penanda SOF');
}

/** Dekode berkas gambar (PNG/JPEG) → objek siap ditanam oleh `lib/pdf.js`. */
function muatGambar(buf, { radiusPersen = 0 } = {}) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error('berkas gambar kosong');
  if (buf.subarray(0, 8).equals(MAGIC_PNG)) return bacaPng(buf, radiusPersen);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    const info = infoJpeg(buf);
    if (info.komponen === 4) throw new Error('JPEG CMYK tidak didukung');
    return {
      lebar: info.lebar,
      tinggi: info.tinggi,
      data: buf,
      filter: 'DCTDecode',
      warna: info.komponen === 1 ? 'DeviceGray' : 'DeviceRGB',
    };
  }
  throw new Error('format gambar tidak dikenal (hanya PNG/JPEG)');
}

/**
 * Ambil gambar dari alamat yang dipakai aplikasi (`/logo-mark.png`, `/canvasing/logo-mark.png`,
 * atau URL penyimpanan media untuk logo unggahan) lalu dekode.
 *
 * @param {string} sumber alamat gambar (`setelan.logo_url` atau bawaan `base + '/logo-mark.png'`)
 * @param {string} base   awalan subpath aplikasi (dipakai untuk membuang prefix saat membaca berkas lokal)
 * @param {object} opsi   - `publicDir` (folder berkas statis, bawaan `public/` di root aplikasi)
 *                        - `ambil` (fungsi fetch, bisa diganti untuk pengujian)
 */
async function ambilGambar(sumber, base = '', { publicDir, ambil, radiusPersen = 0 } = {}) {
  const alamat = String(sumber || '').trim();
  if (!alamat) throw new Error('alamat gambar kosong');
  if (/^https?:/i.test(alamat)) {
    const f = ambil || globalThis.fetch;
    if (!f) throw new Error('fetch tidak tersedia');
    const r = await f(alamat);
    if (!r.ok) throw new Error(`gagal mengunduh gambar (${r.status})`);
    return muatGambar(Buffer.from(await r.arrayBuffer()), { radiusPersen });
  }
  const dir = publicDir || path.join(__dirname, '..', 'public');
  // buang awalan subpath (`/canvasing/logo-mark.png` → `logo-mark.png`) & cegah keluar dari folder
  let relatif = alamat.replace(/^\/+/, '');
  const baseBersih = String(base || '').replace(/^\/+|\/+$/g, '');
  if (baseBersih && relatif.startsWith(baseBersih + '/')) relatif = relatif.slice(baseBersih.length + 1);
  const berkas = path.join(dir, relatif);
  if (!berkas.startsWith(dir)) throw new Error('alamat gambar di luar folder aplikasi');
  return muatGambar(fs.readFileSync(berkas), { radiusPersen });
}

module.exports = { muatGambar, ambilGambar, RADIUS_LOGO_PERSEN };
