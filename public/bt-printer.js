/**
 * Cetak label ke printer thermal Bluetooth dari browser.
 *
 * Dua protokol didukung:
 *  - "escpos" : printer struk 58/80 mm (ESC/POS). Label dikirim sebagai gambar raster 1-bit
 *               (perintah GS v 0) sehingga hasilnya sama seperti preview di layar.
 *  - "tspl"   : printer label TSC/Zebra (TSPL/TSPL2). Dikirim sebagai perintah teks
 *               (SIZE/GAP/CLS/BARCODE/QRCODE/TEXT/PRINT) — lebih tajam & cepat, tapi ukuran
 *               label harus disetel sesuai kertas label yang dipakai.
 *
 * Bagian pembentuk perintah (escposRaster, tsplLabel, potong) murni fungsi JS — bisa diuji di Node.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SCBT = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // UUID service yang umum dipakai printer thermal BLE
  const SERVICE_UUIDS = [
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '0000ff10-0000-1000-8000-00805f9b34fb',
    '0000ff20-0000-1000-8000-00805f9b34fb',
    '0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ae30-0000-1000-8000-00805f9b34fb',
  ];

  /* ------------------------------------------------------------------ ESC/POS */

  /**
   * Ubah data piksel (RGBA, seperti ImageData) jadi perintah ESC/POS raster.
   * @param {{width:number,height:number,data:Uint8ClampedArray|Uint8Array}} img
   * @param {{ambang?:number, lebarDots?:number, feed?:number}} opsi
   * @returns {Uint8Array}
   */
  function escposRaster(img, opsi) {
    opsi = opsi || {};
    const ambang = opsi.ambang === undefined ? 160 : opsi.ambang;
    const lebar = opsi.lebarDots || img.width;
    const tinggi = img.height;
    const bytePerBaris = Math.ceil(lebar / 8);
    // Printer murah punya buffer kecil: raster panjang dipecah jadi beberapa blok GS v 0
    // supaya tidak meluap (gejala: hasil cetak tergeser/terputus di tengah).
    const bandTinggi = opsi.bandTinggi === undefined ? 0 : Math.max(0, Math.floor(opsi.bandTinggi));
    const pakaiBand = bandTinggi > 0 && tinggi > bandTinggi;

    const bitmap = new Uint8Array(bytePerBaris * tinggi);
    for (let y = 0; y < tinggi; y++) {
      for (let x = 0; x < lebar; x++) {
        const i = (y * img.width + x) * 4;
        const a = img.data[i + 3];
        const kilau = a < 128 ? 255 : (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114);
        if (kilau < ambang) {
          bitmap[y * bytePerBaris + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }

    const feed = opsi.feed === undefined ? 3 : opsi.feed;
    const awal = [0x1b, 0x40]; // ESC @ reset
    const kepala = (baris) => [0x1d, 0x76, 0x30, 0x00, lebar & 0xff, (lebar >> 8) & 0xff, baris & 0xff, (baris >> 8) & 0xff];
    const akhir = new Array(feed).fill(0x0a);

    const blokMulai = [];
    const blokData = [];
    if (pakaiBand) {
      for (let y = 0; y < tinggi; y += bandTinggi) {
        const h = Math.min(bandTinggi, tinggi - y);
        blokMulai.push(kepala(h));
        blokData.push(bitmap.subarray(y * bytePerBaris, (y + h) * bytePerBaris));
      }
    } else {
      blokMulai.push(kepala(tinggi));
      blokData.push(bitmap);
    }

    let panjang = awal.length + akhir.length;
    blokMulai.forEach((m, i) => { panjang += m.length + blokData[i].length; });
    const keluar = new Uint8Array(panjang);
    let p = 0;
    keluar.set(awal, p); p += awal.length;
    blokMulai.forEach((m, i) => {
      keluar.set(m, p); p += m.length;
      keluar.set(blokData[i], p); p += blokData[i].length;
    });
    keluar.set(akhir, p);
    return keluar;
  }

  /* ------------------------------------------------------------------ TSPL */

  /**
   * Susun perintah TSPL untuk satu label.
   * @param {{kode:string, nama:string, qty?:number, jenis?:'code128'|'qr'|'keduanya'}} label
   * @param {{lebarMm?:number, tinggiMm?:number, gapMm?:number, lebarDots?:number, padat?:boolean}} opsi
   * @returns {string}
   */
  function tsplLabel(label, opsi) {
    opsi = opsi || {};
    const lebarMm = opsi.lebarMm || 50;
    const tinggiMm = opsi.tinggiMm || 30;
    const gapMm = opsi.gapMm === undefined ? 2 : opsi.gapMm;
    const jenis = label.jenis || 'code128';
    const nama = String(label.nama || '').replace(/"/g, "'");
    const kode = String(label.kode || '').replace(/"/g, "'");
    const padat = !!opsi.padat;

    const baris = [
      `SIZE ${lebarMm} mm,${tinggiMm} mm`,
      `GAP ${gapMm} mm,0 mm`,
      'DIRECTION 1',
      'REFERENCE 0,0',
      'CLS',
    ];

    if (jenis === 'qr') {
      baris.push('QRCODE 24,16,L,5,A,0,M2,S7,"' + kode + '"');
      baris.push(`TEXT 96,30,"${padat ? 1 : 2}",0,1,1,"${kode}"`);
      baris.push(`TEXT 24,110,"1",0,1,1,"${nama.slice(0, 34)}"`);
    } else if (jenis === 'keduanya') {
      baris.push(`BARCODE 20,10,"128",54,1,0,2,2,"${kode}"`);
      baris.push('QRCODE 300,6,L,4,A,0,M2,S7,"' + kode + '"');
      baris.push(`TEXT 20,74,"1",0,1,1,"${kode}"`);
      baris.push(`TEXT 20,98,"1",0,1,1,"${nama.slice(0, 34)}"`);
    } else {
      baris.push(`BARCODE 20,14,"128",70,1,0,2,2,"${kode}"`);
      baris.push(`TEXT 20,88,"1",0,1,1,"${kode}"`);
      baris.push(`TEXT 20,110,"1",0,1,1,"${nama.slice(0, 34)}"`);
    }
    baris.push(`PRINT 1,${label.qty || 1}`);
    return baris.join('\r\n') + '\r\n';
  }

  function teksKeByte(teks) {
    // semua karakter yang dipakai perintah TSPL ASCII; karakter lain diganti
    const bersih = String(teks).replace(/[^\x0a\x0d\x20-\x7e]/g, '?');
    const keluar = new Uint8Array(bersih.length);
    for (let i = 0; i < bersih.length; i++) keluar[i] = bersih.charCodeAt(i) & 0xff;
    return keluar;
  }

  /* ------------------------------------------------------------------ pola uji */

  /**
   * Gambar pola uji ke kanvas: balok penuh, garis 1/2/3 dot, kotak-kotak, dan teks.
   * Dipakai untuk memastikan protokol raster & keselarasan dot printer sebelum mencetak dokumen asli.
   * Digambar 1 piksel = 1 dot.
   */
  function gambarPolaUji(kanvas, lebarDots, tinggiDots) {
    const W = lebarDots || 384;
    // tinggi bisa diatur supaya pola uji tidak melebihi kertas label (mis. label 50 x 30 mm)
    const H = Math.max(120, tinggiDots || 320);
    kanvas.width = W;
    kanvas.height = H;
    const ctx = kanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    const tepi = Math.max(8, Math.round(W * 0.03));
    // 1. balok hitam penuh
    for (let i = 0; i < 4; i++) ctx.fillRect(tepi + i * Math.round(W * 0.1), 10, Math.round(W * 0.06), Math.round(W * 0.06));
    // 2. garis vertikal 1 / 2 / 3 dot
    const dasar = [56, 96, 136];
    for (let i = 0; i < 40 && tepi + i * 8 < W - tepi; i++) ctx.fillRect(tepi + i * 8, dasar[0], 1, 28);
    for (let i = 0; i < 30 && tepi + i * 11 < W - tepi; i++) ctx.fillRect(tepi + i * 11, dasar[1], 2, 28);
    for (let i = 0; i < 22 && tepi + i * 15 < W - tepi; i++) ctx.fillRect(tepi + i * 15, dasar[2], 3, 28);
    // 3. kotak-kotak (uji ketajaman)
    const blok = Math.max(2, Math.round(W * 0.005) + 1);
    for (let y = 0; y < 22; y++) for (let x = 0; x < 60 && tepi + x * blok * 2 < W - tepi; x++) if ((x + y) % 2 === 0) ctx.fillRect(tepi + x * blok * 2, 180 + y * blok * 2, blok, blok);
    // 4. teks
    ctx.textAlign = 'left';
    ctx.font = 'bold ' + Math.max(18, Math.round(W * 0.075)) + 'px monospace';
    ctx.fillText('UJI CETAK ' + W + 'x' + H + ' DOT', tepi, H - 40);
    ctx.font = Math.max(12, Math.round(W * 0.055)) + 'px monospace';
    ctx.fillText('garis 1 / 2 / 3 dot di atas', tepi, H - 14);
    return kanvas;
  }

  /* ------------------------------------------------------------------ umpan ke printer */

  function potong(bytes, ukuran) {
    const n = ukuran || 100;
    const bagian = [];
    for (let i = 0; i < bytes.length; i += n) {
      bagian.push(bytes.subarray(i, Math.min(i + n, bytes.length)));
    }
    return bagian;
  }

  const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Bikin koneksi ke printer Bluetooth. Mengembalikan objek { device, karakter, nama, tulis(bytes, log) }. */
  async function sambung(opsi) {
    opsi = opsi || {};
    const log = opsi.log || function () {};
    if (!navigator.bluetooth) {
      throw new Error('Browser ini tidak mendukung Bluetooth. Pakai Chrome/Edge di Android atau komputer.');
    }
    log.info('Memilih printer…');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICE_UUIDS,
    });
    log.info('Menghubungkan ke ' + (device.name || '(tanpa nama)') + '…');
    device.addEventListener('gattserverdisconnected', () => log.err('Printer terputus.'));
    const server = await device.gatt.connect();

    // Pilih characteristic: utamakan yang mendukung WRITE DENGAN KONFIRMASI, karena
    // tanpa konfirmasi data raster bisa hilang di tengah -> hasil cetak tergeser/terputus.
    let karakter = null;
    let mode = '';
    const services = await server.getPrimaryServices();
    for (const svc of services) {
      let chars = [];
      try {
        chars = await svc.getCharacteristics();
      } catch (e) {
        continue;
      }
      for (const c of chars) {
        const p = c.properties || {};
        if (p.write && c.writeValue) {
          karakter = c;
          mode = 'konfirmasi';
          break;
        }
        if (!karakter && p.writeWithoutResponse && c.writeValueWithoutResponse) {
          karakter = c;
          mode = 'cepat';
        }
      }
      if (mode === 'konfirmasi') break;
    }
    if (!karakter) {
      throw new Error('Printer tidak punya jalur tulis data (bukan printer?) — coba nyalakan ulang printer lalu sambung lagi.');
    }
    log.ok('Tersambung ke ' + (device.name || 'printer') + ' (mode ' + mode + ').');
    if (mode === 'cepat') {
      log.info('Printer hanya menyediakan jalur tanpa konfirmasi — paket dibuat kecil (20 byte) supaya data tidak hilang.');
    }

    async function tulis(bytes, onProgress) {
      // mode tanpa konfirmasi tidak boleh kirim paket besar (data bisa hilang)
      const maks = mode === 'konfirmasi' ? (opsi.ukuranPotong || 100) : Math.min(opsi.ukuranPotong || 20, 20);
      const potongan = potong(bytes, Math.max(20, maks));
      const jeda = opsi.jedaMs === undefined ? (mode === 'konfirmasi' ? 8 : 20) : opsi.jedaMs;
      for (let i = 0; i < potongan.length; i++) {
        const bagian = potongan[i];
        if (mode === 'konfirmasi') {
          await karakter.writeValue(bagian);
        } else {
          await karakter.writeValueWithoutResponse(bagian);
        }
        if (onProgress) onProgress(i + 1, potongan.length);
        await tunggu(jeda);
      }
    }

    return { device, karakter, nama: device.name || 'printer', mode, tulis, server };
  }

  return { SERVICE_UUIDS, escposRaster, tsplLabel, teksKeByte, potong, sambung, tunggu, gambarPolaUji };
});
