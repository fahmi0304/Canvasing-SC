'use strict';
const { esc } = require('../lib/util');

const labelPdf = require('../lib/labelPdf');

exports.render = function ({ daftar, base, pesan }) {
  const baris = daftar
    .map(
      (p) => `<tr data-kode="${esc(p.kode)}" data-nama="${esc(p.nama)}" data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}">
      <td class="kode">${esc(p.kode)}</td>
      <td><b>${esc(p.nama)}</b></td>
      <td class="tengah"><span class="qty">
        <button type="button" data-minus data-target="#tq_${p.id}">−</button>
        <input type="number" min="0" id="tq_${p.id}" value="0">
        <button type="button" data-plus data-target="#tq_${p.id}">+</button>
      </span></td>
    </tr>`
    )
    .join('');

  const script = `
<script src="${base}/bt-printer.js"></script>
<script>
(function(){
  const base = window.APP_BASE || '';
  let koneksi = null;
  const $ = (id) => document.getElementById(id);
  const log = {
    tulis(teks, kelas){
      const d = document.createElement('div');
      if (kelas) d.className = kelas;
      d.textContent = teks;
      $('btLog').appendChild(d);
      $('btLog').scrollTop = $('btLog').scrollHeight;
    },
    info(t){ log.tulis('· ' + t); },
    ok(t){ log.tulis('OK  ' + t, 'ok'); },
    err(t){ log.tulis('GAGAL  ' + t, 'err'); },
  };
  function status(kelas, teks){
    $('btStatus').className = 'bt-status' + (kelas ? ' ' + kelas : '');
    $('btStatusTeks').textContent = teks;
  }
  /*
   * PENTING (perbaikan revisi ke-81) - JANGAN menonaktifkan tombol saat Web Bluetooth tidak ada.
   *
   * Keluhan user "semua tombol tidak berfungsi" terjadi karena SELURUH tombol cetak di-disable di
   * browser yang tidak menyediakan Web Bluetooth (browser di dalam aplikasi chat seperti WhatsApp/
   * Instagram, mode aplikasi terpasang/PWA, atau iOS). Akibatnya tidak ada satu tombol pun yang bisa
   * ditekan dan pengguna tidak tahu sebabnya. Sekarang tombol tetap AKTIF; kalau ditekan, pengguna
   * mendapat penjelasan + arahan memakai PDF (yang tidak membutuhkan Bluetooth sama sekali).
   */
  const adaBluetooth = !!navigator.bluetooth;
  if (!adaBluetooth){
    status('gagal', 'Browser ini tidak menyediakan Bluetooth');
    log.err('Bluetooth tidak tersedia di browser ini. Dua cara tetap bisa: (1) buka aplikasi ini di '
      + 'Chrome Android secara langsung (bukan dari dalam aplikasi chat), atau '
      + '(2) tekan Buat PDF di panel kanan, lalu cetak berkas PDF-nya dari aplikasi pihak ketiga.');
    const panel = $('peringatanBt');
    if (panel) panel.hidden = false;
  }
  // keterangan lingkungan di layar (membantu saat melaporkan masalah)
  const infoLingkungan = $('infoLingkungan');
  if (infoLingkungan){
    const modeAplikasi = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? 'aplikasi terpasang (PWA)' : 'browser biasa';
    infoLingkungan.textContent = 'Bluetooth: ' + (adaBluetooth ? 'tersedia' : 'TIDAK tersedia')
      + ' · Dibuka sebagai: ' + modeAplikasi + ' · PDF bisa dipakai tanpa Bluetooth.';
  }

  function setelan(){
    return {
      lebarDots: Number($('lebarDots').value) || 384,
      kalauPanjang: $('kalauPanjang').value,
      ukuranQr: $('ukuranQr').value,
      ambang: Number($('ambang').value) || 160,
      modul: Math.max(1, Number($('modul').value) || 2),
      tinggiBc: Math.max(24, Number($('tinggiBc').value) || 64),
      tampilKode: $('tampilKode').value === '1',
      tampilNama: $('tampilNama').value === '1',
      lebarMm: Number($('lebarMm').value) || 50,
      tinggiMm: Number($('tinggiMm').value) || 30,
      gapMm: Number($('gapMm').value),
      protokol: $('protokol').value,
      jenis: $('jenis').value,
      ukuranPotong: Number($('potong').value) || 100,
      jedaMs: Number($('jeda').value),
      bandTinggi: Math.max(0, Number($('bandTinggi').value) || 0),
      batasKirim: Math.max(50000, Number($('batasKirim').value) || 60000),
    };
  }

  /**
   * Ambil gambar barcode dari server pada UKURAN DOT yang pasti (tidak di-resample browser),
   * supaya bar-nya tetap tajam saat dicetak. Server juga memberi tahu kalau Code128 terlalu
   * rapat lalu otomatis memakai QR Code.
   */
  /*
   * Lebar QR yang diminta (dot). Permintaan user: QR harus benar-benar terbaca kamera —
   * modul QR 0,25 mm (QR 128 dot) terlalu kecil, jadi ukurannya bisa dipilih:
   * Kecil 45% / Sedang 65% / Besar 85% dari lebar kertas yang tersedia.
   */
  function maksQr(o){
    const porsi = o.ukuranQr === 'kecil' ? 0.45 : o.ukuranQr === 'besar' ? 0.85 : 0.65;
    let batas = Math.round((o.lebarTersedia || 384) * porsi);
    /*
     * Printer LABEL (TSPL) punya tinggi kertas tetap (mis. 50 × 30 mm). QR yang terlalu tinggi
     * akan melampaui label dan terpotong saat dicetak, jadi di mode TSPL ukuran QR dibatasi
     * sisa tinggi label setelah ruang untuk baris kode + nama (± 50 dot).
     */
    if (o.protokol === 'tspl'){
      const tinggiLabel = Math.max(120, (Number(o.tinggiMm) || 30) * 8);
      batas = Math.min(batas, tinggiLabel - 50);
    }
    return Math.max(96, Math.round(batas));
  }

  async function ambilBarcode(kode, o){
    const url = base + '/barcode.png?tipe=' + encodeURIComponent(o.jenis) +
      '&kode=' + encodeURIComponent(kode) +
      '&lebar=' + o.lebarTersedia + '&tinggi=' + o.tinggiBc + '&modul=' + o.modul +
      (o.jenis === 'qr' ? '&maks=' + Math.round(o.maks || maksQr(o)) : '');
    const r = await fetch(url);
    if (!r.ok) return null;
    const info = {
      tipe: r.headers.get('X-Barcode-Tipe') || '',
      skala: Number(r.headers.get('X-Barcode-Skala') || 1),
      lebar: Number(r.headers.get('X-Barcode-Lebar') || 0),
      tinggi: Number(r.headers.get('X-Barcode-Tinggi') || 0),
      catatan: r.headers.get('X-Barcode-Catatan') || '',
    };
    const blob = await r.blob();
    let img = null;
    try { img = await createImageBitmap(blob); } catch (e) { img = await muatBlob(blob); }
    return { img, info };
  }

  function muatBlob(blob){
    return new Promise(function(resolve){
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function(){ resolve(img); };
      img.onerror = function(){ URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function bulat(n){ return Math.max(1, Math.round(n)); }

  /**
   * Gambar satu label ke kanvas: 1 piksel kanvas = 1 dot printer.
   * Tinggi kanvas mengikuti isi (tidak menyisakan kertas kosong).
   */
  async function gambarLabel(kanvas, label, o){
    const W = o.lebarDots;
    const pad = bulat(W * 0.03);
    const tersedia = W - pad * 2;
    const kurang = [];

    // teks: kode & nama (dibungkus, dihitung manual supaya tetap 1 piksel = 1 dot)
    let ukKode = bulat(W * 0.1);
    const ukNama = bulat(W * 0.075);
    const ukurCtx = kanvas.getContext('2d');
    const ukuran = function (teks, font) {
      ukurCtx.font = font;
      return ukurCtx.measureText(String(teks)).width;
    };
    /*
     * Kode panjang (mis. LOUIS-VUITTON-CF58370) dengan font monospace 10% lebar kertas bisa LEBIH
     * LEBAR dari kertas sehingga huruf pertama/terakhir terpotong di tepi (terlihat pada raster uji:
     * baris kode membentang penuh 0..384 dot). Fontnya diperkecil bertahap sampai muat, catatannya
     * dimasukkan ke daftar catatan supaya pengguna tahu kenapa tulisannya kecil.
     */
    let fontKode = 'bold ' + ukKode + 'px monospace';
    if (o.tampilKode && ukuran(label.kode, fontKode) > tersedia){
      const asli = ukKode;
      while (ukKode > 10 && ukuran(label.kode, fontKode) > tersedia){ ukKode -= 1; fontKode = 'bold ' + ukKode + 'px monospace'; }
      kurang.push('Kode panjang: huruf kode diperkecil ' + Math.round((ukKode / asli) * 100) + '% supaya tidak terpotong di tepi kertas');
    }
    const fontNama = ukNama + 'px sans-serif';

    let barisNama = [];
    if (o.tampilNama && label.nama){
      const kata = String(label.nama).split(/\\s+/).filter(Boolean);
      let kini = '';
      kata.forEach(function(k){
        const coba = kini ? kini + ' ' + k : k;
        if (!kini || ukuran(coba, fontNama) <= tersedia) kini = coba;
        else { barisNama.push(kini); kini = k; }
      });
      if (kini) barisNama.push(kini);
      barisNama = barisNama.slice(0, 3);
    }


    /*
     * RUANG UNTUK QR DI PRINTER LABEL (TSPL).
     * Tinggi kertas label tetap (mis. 50 x 30 mm). Kalau QR + teks lebih tinggi dari label,
     * hasil cetak terpotong. Karena itu ruang QR dihitung LEBIH DULU dari sisa tinggi label
     * setelah baris kode + nama, lalu angka itu dipakai sebagai batas ukuran QR.
     */
    const batasTinggiLabel = o.protokol === 'tspl' ? Math.max(120, Math.round((Number(o.tinggiMm) || 30) * 8)) : 0;
    const tinggiTetap = pad + bulat(W * 0.03) +
      (o.tampilKode ? ukKode + bulat(W * 0.02) : 0) +
      barisNama.length * (ukNama + bulat(W * 0.012)) + pad;
    const ruangQr = batasTinggiLabel ? batasTinggiLabel - tinggiTetap : Infinity;
    const maksQrPas = Number.isFinite(ruangQr) ? Math.max(96, Math.round(ruangQr)) : Infinity;
    if (Number.isFinite(ruangQr) && ruangQr < 120){
      kurang.push('Label ' + (o.tinggiMm || 30) + ' mm pendek untuk QR + ' +
        (o.tampilNama && barisNama.length ? 'nama barang' : 'kode') +
        ' - QR diperkecil agar muat (matikan Tulis nama barang supaya QR bisa lebih besar)');
    }

    // barcode / QR pada ukuran dot pasti
    let bc = null;      // barcode batang (code128) — bisa null kalau tidak muat
    let qr = null;      // QR code
    let putar = false;  // barcode diputar 90° (bars searah jalan kertas) untuk kode panjang di kertas sempit
    const panjangMaks = Math.min(560, Math.round(tersedia * 1.45)); // batas panjang label hasil putaran
    if (o.jenis === 'qr'){
      qr = await ambilBarcode(label.kode, { jenis: 'qr', lebarTersedia: tersedia, maks: Math.min(maksQr(o), maksQrPas), tinggiBc: o.tinggiBc, modul: o.modul });
    } else if (o.jenis === 'keduanya'){
      // mode "keduanya": QR lebih kecil (30% lebar) supaya barcode batang tetap muat di sebelahnya
      const qrDulu = await ambilBarcode(label.kode, { jenis: 'qr', lebarTersedia: bulat(tersedia * 0.3), maks: bulat(tersedia * 0.32), tinggiBc: o.tinggiBc, modul: o.modul });
      const sisa = qrDulu && qrDulu.img ? tersedia - qrDulu.info.lebar - bulat(W * 0.03) : tersedia;
      // modul 1 dot supaya barcode tetap bisa mendampingi QR; QR yang menjamin keterbacaan
      bc = await ambilBarcode(label.kode, { jenis: 'code128', lebarTersedia: Math.max(80, sisa), tinggiBc: o.tinggiBc, modul: 1 });
      if (bc && bc.img && bc.info.lebar <= Math.max(80, sisa)) {
        qr = qrDulu;
        if (bc.info.skala < 2) kurang.push('Barcode batang rapat (' + bc.info.skala + ' dot/modul) — pakai QR untuk memindai');
      } else {
        qr = await ambilBarcode(label.kode, { jenis: 'qr', lebarTersedia: tersedia, maks: Math.min(maksQr(o), maksQrPas), tinggiBc: o.tinggiBc, modul: o.modul });
        bc = null;
        kurang.push('Barcode batang tidak muat bersama QR — hanya QR yang dicetak');
      }
    } else if (o.jenis === 'code128'){
      // 1) coba barcode tegak seperti biasa
      bc = await ambilBarcode(label.kode, { jenis: 'code128', lebarTersedia: tersedia, tinggiBc: o.tinggiBc, modul: o.modul });
      const rapat = bc && bc.img && bc.info.skala < o.modul;
      if (rapat && o.kalauPanjang === 'putar'){
        // 2) kode terlalu panjang: putar barcode supaya modul bisa lebih lebar & tetap terbaca
        const putarBc = await ambilBarcode(label.kode, {
          jenis: 'code128',
          lebarTersedia: panjangMaks,
          tinggiBc: Math.max(80, Math.round(tersedia * 0.5)),
          modul: o.modul,
        });
        if (putarBc && putarBc.img && putarBc.info.skala >= o.modul){
          bc = putarBc;
          putar = true;
          kurang.push('Kode panjang: barcode diputar ' + putarBc.info.skala + ' dot/modul supaya bisa dipindai');
        } else {
          kurang.push('Code128 terlalu rapat untuk kertas ini — barcode tetap dicetak tapi sulit dipindai');
        }
      } else if (rapat && o.kalauPanjang === 'qr'){
        qr = await ambilBarcode(label.kode, { jenis: 'qr', lebarTersedia: tersedia, maks: Math.min(maksQr(o), maksQrPas), tinggiBc: o.tinggiBc, modul: o.modul });
        bc = null;
        kurang.push('Kode terlalu panjang untuk barcode batang — otomatis memakai QR Code');
      } else if (rapat){
        kurang.push('Kode terlalu panjang: modul cuma ' + bc.info.skala + ' dot (ideal ' + o.modul + '+) — sulit dipindai');
      }
      if (bc && bc.info.catatan) kurang.push(bc.info.catatan);
    }
    if (bc && bc.info.catatan) kurang.push(bc.info.catatan);
    if (qr && qr.info.catatan) kurang.push(qr.info.catatan);

    const duaGambar = !!(bc && bc.img && qr && qr.img);
    // kalau diputar, sisi panjang barcode (jumlah modul) jadi tegak
    const tinggiBc = Math.max(
      putar && bc && bc.img ? bc.info.lebar : bc && bc.img ? bc.info.tinggi : 0,
      qr && qr.img ? qr.info.tinggi : 0
    );
    const tinggi = pad + tinggiBc + (tinggiBc ? bulat(W * 0.03) : 0) +
      (o.tampilKode ? ukKode + bulat(W * 0.02) : 0) +
      barisNama.length * (ukNama + bulat(W * 0.012)) + pad;

    kanvas.width = W;
    kanvas.height = Math.max(40, tinggi);
    const ctx = kanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, kanvas.width, kanvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';

    let y = pad;
    if (duaGambar){
      // barcode batang di kiri, QR di kanan (dipisah sedikit) lalu di tengah
      const total = bc.info.lebar + bulat(W * 0.03) + qr.info.lebar;
      const mulai = Math.round((W - total) / 2);
      ctx.drawImage(bc.img, mulai, y, bc.info.lebar, bc.info.tinggi); // 1:1, tanpa skala
      ctx.drawImage(qr.img, mulai + bc.info.lebar + bulat(W * 0.03), y, qr.info.lebar, qr.info.tinggi);
      y += tinggiBc + bulat(W * 0.03);
    } else if (bc && bc.img && putar){
      // gambar barcode di kanvas sementara, lalu diputar 90° (1:1, tanpa skala supaya bar tetap tajam)
      const tmp = document.createElement('canvas');
      tmp.width = bc.info.lebar;
      tmp.height = bc.info.tinggi;
      const tc = tmp.getContext('2d');
      tc.imageSmoothingEnabled = false;
      tc.drawImage(bc.img, 0, 0, bc.info.lebar, bc.info.tinggi);
      const x = Math.round((W - bc.info.tinggi) / 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(tmp, 0, -bc.info.tinggi);
      ctx.restore();
      y += bc.info.lebar + bulat(W * 0.03);
    } else if (bc && bc.img){
      const x = Math.round((W - bc.info.lebar) / 2);
      ctx.drawImage(bc.img, x, y, bc.info.lebar, bc.info.tinggi); // 1:1, tanpa skala
      y += bc.info.tinggi + bulat(W * 0.03);
    } else if (qr && qr.img){
      const x = Math.round((W - qr.info.lebar) / 2);
      ctx.drawImage(qr.img, x, y, qr.info.lebar, qr.info.tinggi); // 1:1, tanpa skala
      y += qr.info.tinggi + bulat(W * 0.03);
    }
    if (o.tampilKode && label.kode){
      ctx.font = fontKode;
      ctx.textAlign = 'center';
      ctx.fillText(label.kode, W / 2, y + ukKode);
      y += ukKode + bulat(W * 0.02);
    }
    ctx.font = fontNama;
    ctx.textAlign = 'center';
    barisNama.forEach(function(t){
      ctx.fillText(t, W / 2, y + ukNama);
      y += ukNama + bulat(W * 0.012);
    });

    const tipe = duaGambar ? 'barcode+qr' : bc && bc.img ? (putar ? 'barcode-putar' : bc.info.tipe) : qr && qr.img ? 'qr' : '';
    return { tipe, catatan: kurang.join(' · '), tinggi: kanvas.height };
  }

  async function pratinjau(){
    const ke = (window.PRATINJAU_KE || 0) + 1;
    const o = setelan();
    const tr = document.querySelector('#tblTermal tbody tr');
    const barisKosong = document.querySelectorAll('#tblTermal tbody tr').length === 0;
    const kode = barisKosong ? 'CONTOH-001' : ($('pvKode').dataset.kode || (tr ? tr.dataset.kode : 'CONTOH-001'));
    const nama = barisKosong ? 'Contoh Barang' : (tr ? tr.dataset.nama : 'Contoh Barang');
    $('pvKode').textContent = kode;
    $('pvNama').textContent = nama;
    $('pvKode').dataset.kode = kode;
    const k = $('pvKanvas');
    const hasil = await gambarLabel(k, { kode, nama }, o);
    $('pvUkuran').textContent = k.width + ' x ' + k.height + ' dot · ' +
      Math.round(k.width / 8) + ' mm × ' + Math.round(k.height / 8) + ' mm' +
      (hasil.tipe ? ' · ' + hasil.tipe.toUpperCase() : '');
    const pesan = $('pvPesan');
    pesan.textContent = hasil.catatan || '';
    pesan.style.display = hasil.catatan ? 'block' : 'none';
    $('pvCatatan').hidden = !hasil.catatan;
    window.PRATINJAU_KE = ke;   // penanda selesai untuk skrip uji
  }

  function daftarTerpilih(){
    const hasil = [];
    document.querySelectorAll('#tblTermal tbody tr').forEach(function(tr){
      const n = parseInt(tr.querySelector('input[type=number]').value, 10) || 0;
      if (n > 0) hasil.push({ kode: tr.dataset.kode, nama: tr.dataset.nama, qty: n });
    });
    return hasil;
  }

  async function kirim(daftar, judul){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    const o = setelan();
    log.info('Mulai ' + judul + ' — ' + daftar.length + ' macam label · kertas ' + o.lebarDots + ' dot');
    let terkirim = 0;
    const kanvas = $('pvKanvas');
    for (const item of daftar){
      if (o.protokol === 'tspl'){
        const perintah = SCBT.tsplLabel({ kode: item.kode, nama: item.nama, qty: item.qty, jenis: o.jenis }, o);
        await koneksi.tulis(SCBT.teksKeByte(perintah), function(i, n){ $('btProgress').textContent = item.kode + ' — paket ' + i + '/' + n; });
        terkirim += item.qty;
        log.tulis('  ' + item.kode + ' x' + item.qty + ' (TSPL)', 'ok');
      } else {
        for (let c = 1; c <= item.qty; c++){
          const hasil = await gambarLabel(kanvas, item, o);
          if (hasil.catatan) log.err(item.kode + ': ' + hasil.catatan);
          const data = kanvas.getContext('2d').getImageData(0, 0, kanvas.width, kanvas.height);
          const bytes = SCBT.escposRaster(data, { ambang: o.ambang, lebarDots: kanvas.width, bandTinggi: o.bandTinggi });
          log.tulis('  raster ' + kanvas.width + 'x' + kanvas.height + ' dot · ' + Math.ceil(bytes.length / 1024) + ' KB · blok ' + o.bandTinggi + ' baris', '');
          if (bytes.length > o.batasKirim) log.err('Data melebihi batas ' + Math.round(o.batasKirim / 1024) + ' KB — kiriman dipotong otomatis supaya buffer printer tidak meluap.');
          await koneksi.tulis(bytes, function(i, n){ $('btProgress').textContent = item.kode + ' (' + c + '/' + item.qty + ') — paket ' + i + '/' + n; });
          terkirim++;
        }
        log.tulis('  ' + item.kode + ' x' + item.qty + ' (ESC/POS raster ' + kanvas.width + 'x' + kanvas.height + ' dot)', 'ok');
      }
    }
    $('btProgress').textContent = '';
    log.ok('Selesai: ' + terkirim + ' label terkirim ke printer.');
    SC.toast('Selesai: ' + terkirim + ' label terkirim', 'ok');
  }

  /** Pola uji: memastikan dot printer sejajar & protokol raster benar (gambar dari bt-printer.js). */
  function polaUji(){
    const k = document.createElement('canvas');
    const o = setelan();
    // tinggi pola: ikuti tinggi label di mode TSPL supaya tidak membuang kertas label
    const tinggi = o.protokol === 'tspl' ? Math.max(120, Math.round((o.tinggiMm || 30) * 8)) : 320;
    return SCBT.gambarPolaUji(k, o.lebarDots, tinggi);
  }

  async function kirimPolaUji(){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    const o = setelan();
    const k = polaUji();
    const data = k.getContext('2d').getImageData(0, 0, k.width, k.height);
    const bytes = SCBT.escposRaster(data, { ambang: o.ambang, lebarDots: k.width, bandTinggi: o.bandTinggi });
    log.info('Mengirim pola uji ' + k.width + 'x' + k.height + ' dot (' + Math.ceil(bytes.length / 1024) + ' KB, blok ' + o.bandTinggi + ' baris)…');
    await koneksi.tulis(bytes, function(i, n){ $('btProgress').textContent = 'pola uji — paket ' + i + '/' + n; });
    $('btProgress').textContent = '';
    log.ok('Pola uji terkirim. Periksa: 4 balok hitam penuh, garis 1/2/3 dot harus jelas terpisah.');
  }

  /* ---- DIAGNOSA PRINTER (revisi ke-79) ----
   * Tiga alat bantu supaya pengguna bisa MENEMUKAN sendiri penyebab hasil cetak berantakan:
   *  - uji teks ESC/POS: hanya teks (tanpa raster) -> kalau terbaca, printer paham ESC/POS.
   *  - uji teks TSPL: perintah teks TSPL -> kalau ini yang terbaca, ganti "Jenis printer" ke TSPL.
   *  - penggaris lebar: raster berisi tanda tiap 50 dot + angkanya -> angka terakhir yang terlihat
   *    = lebar kertas sebenarnya dalam dot (kertas lebih sempit dari setelan = hasil cetak acak).
   */
  function teksEscpos(baris){
    const teks = '\\x1b\\x40' + baris.join('\\n') + '\\n'.repeat(3);
    const keluar = new Uint8Array(teks.length);
    for (let i = 0; i < teks.length; i++) keluar[i] = teks.charCodeAt(i) & 0xff;
    return keluar;
  }

  async function kirimUjiTeks(mode){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    const o = setelan();
    let bytes;
    if (mode === 'tspl'){
      const perintah = [
        'SIZE ' + (o.lebarMm || 50) + ' mm,' + (o.tinggiMm || 30) + ' mm',
        'GAP ' + (o.gapMm === undefined ? 2 : o.gapMm) + ' mm,0 mm',
        'DIRECTION 1',
        'REFERENCE 0,0',
        'CLS',
        'TEXT 20,20,"2",0,1,1,"TSPL TEKS UJI"',
        'TEXT 20,60,"1",0,1,1,"LEBAR ' + o.lebarDots + ' DOT"',
        'TEXT 20,90,"1",0,1,1,"1234567890 ABCDEFGH"',
        'PRINT 1,1',
        '',
      ].join('\\r\\n');
      bytes = SCBT.teksKeByte(perintah);
      log.info('Uji teks TSPL (' + bytes.length + ' byte)…');
    } else {
      bytes = teksEscpos([
        'UJI TEKS ESC/POS',
        'LEBAR SETELAN: ' + o.lebarDots + ' DOT',
        'ANGKA: 1234567890',
        'HURUF: ABCDEFGHIJ',
        '--------------------------------',
        'Kalau baris ini TERBACA, printer',
        'memakai ESC/POS. Masalahnya di',
        'ukuran gambar, bukan protokol.',
      ]);
      log.info('Uji teks ESC/POS (' + bytes.length + ' byte, tanpa gambar)…');
    }
    try {
      await koneksi.tulis(bytes, function(i, n){ $('btProgress').textContent = 'uji teks — paket ' + i + '/' + n; });
      $('btProgress').textContent = '';
      log.ok(mode === 'tspl'
        ? 'Uji teks TSPL terkirim. Kalau terbaca rapi → pilih "Jenis printer: TSPL".'
        : 'Uji teks ESC/POS terkirim. Kalau terbaca rapi → printer memakai ESC/POS (masalahnya di ukuran gambar).');
    } catch (e){
      log.err('Gagal mengirim: ' + e.message);
    }
  }

  function rasterPenggaris(kanvas){
    const W = setelan().lebarDots;
    const H = 120;
    kanvas.width = W; kanvas.height = H;
    const ctx = kanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('PENGGARIS LEBAR KERTAS (dot)', 6, 24);
    // garis dasar + tanda tiap 50 dot, tiap 100 dot diberi angka & lebih tinggi
    ctx.fillRect(0, 70, W, 2);
    for (let x = 0; x <= W - 4; x += 50){
      const tinggi = (x % 100 === 0) ? 26 : 14;
      ctx.fillRect(x, 70 - tinggi, 2, tinggi + 2);
      if (x % 100 === 0) ctx.fillText(String(x), x + 3, 68);
    }
    ctx.font = '14px monospace';
    ctx.fillText('angka terakhir yang terlihat = lebar kertas sebenarnya', 6, 104);
    return kanvas;
  }

  async function kirimPenggaris(){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    const o = setelan();
    const k = rasterPenggaris(document.createElement('canvas'));
    const data = k.getContext('2d').getImageData(0, 0, k.width, k.height);
    const bytes = SCBT.escposRaster(data, { ambang: o.ambang, lebarDots: k.width, bandTinggi: o.bandTinggi });
    log.info('Mengirim penggaris lebar ' + k.width + ' dot (' + Math.ceil(bytes.length / 1024) + ' KB)…');
    try {
      await koneksi.tulis(bytes, function(i, n){ $('btProgress').textContent = 'penggaris — paket ' + i + '/' + n; });
      $('btProgress').textContent = '';
      log.ok('Penggaris terkirim. Baca angka terakhir yang masih terlihat, lalu samakan "Lebar kertas (dot)" dengan angka itu.');
    } catch (e){
      log.err('Gagal mengirim: ' + e.message);
    }
  }

  $('btnUjiTeks').addEventListener('click', function(){ kirimUjiTeks('escpos'); });
  $('btnUjiTeksTspl').addEventListener('click', function(){ kirimUjiTeks('tspl'); });
  $('btnPenggaris').addEventListener('click', kirimPenggaris);

  /* ---- BUAT PDF LABEL (untuk dicetak aplikasi pihak ketiga) ----
   * Memakai daftar & jumlah yang sedang dipilih di tabel, dikirim sebagai form POST ke
   * /cetak/label-pdf. Berkasnya dibuka di tab baru (penampil PDF) supaya bisa dibagikan/
   * dicetak lewat aplikasi lain.
   */
  /*
   * Buat PDF lewat fetch + blob, BUKAN dengan form target="_blank".
   *
   * Alasan (perbaikan revisi ke-81): di mode aplikasi terpasang (PWA) & browser di dalam aplikasi chat,
   * tab baru sering diblokir sehingga menekan tombol PDF TIDAK memunculkan apa pun dan terlihat seperti
   * "tombol tidak berfungsi". Alur sekarang:
   *   1. ambil PDF dengan fetch (tanpa tab baru),
   *   2. coba buka di tab baru,
   *   3. kalau tab diblokir → berkasnya DIUNDUH dan sebuah tautan ditampilkan untuk diketuk,
   *   4. status ditulis di layar (bukan hanya toast).
   */
  async function buatPdf(kodeSaja){
    const o = setelan();
    const barisPertama = document.querySelector('#tblTermal tbody tr');
    const daftar = kodeSaja
      ? [{ kode: barisPertama ? barisPertama.dataset.kode : 'CONTOH-001',
           nama: barisPertama ? barisPertama.dataset.nama : 'Contoh Barang', qty: 1 }]
      : daftarTerpilih();
    const info = $('pdfInfo');
    const kotakTautan = $('pdfTautan');
    if (!daftar.length){
      SC.toast('Isi jumlah label dulu', 'err');
      info.textContent = 'Isi jumlah label pada tabel (kolom paling kiri), lalu tekan tombol PDF lagi.';
      return;
    }

    const params = new URLSearchParams();
    daftar.forEach(function (x){ params.append('kode', x.kode); params.append('nama', x.nama); params.append('qty', x.qty); });
    params.set('kertas', $('pdfKertas').value);
    params.set('ukuranQr', $('pdfUkuranQr').value);
    params.set('tipe', o.jenis === 'nonaktif' ? 'code128' : o.jenis);
    params.set('dpi', '203');

    info.textContent = 'Menyiapkan PDF (akan langsung terunduh)…';
    if (kotakTautan) kotakTautan.hidden = true;
    try {
      const r = await fetch((window.APP_BASE || '') + '/cetak/label-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (!r.ok) throw new Error('server menolak (' + r.status + ')');
      const blob = await r.blob();
      if (!blob.size) throw new Error('berkas kosong');
      const url = window.URL.createObjectURL(blob);
      const jumlah = daftar.reduce(function(a, x){ return a + x.qty; }, 0);
      const namaKertas = $('pdfKertas').options[$('pdfKertas').selectedIndex].textContent;
      /*
       * Permintaan user: "cetak pdf usahakan langsung ter download agar bisa di print menggunakan
       * easy print" → berkas SELALU diunduh langsung (tidak dicoba dibuka di tab baru lebih dulu).
       * Tautan "Lihat PDF" tetap disediakan kalau pengguna ingin memeriksanya dulu.
       */
      const a = document.createElement('a');
      a.href = url;
      a.download = 'label-' + String(daftar[0].kode || 'barang').replace(/[^A-Za-z0-9._-]/g, '_') + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      if (kotakTautan){
        kotakTautan.hidden = false;
        kotakTautan.innerHTML = '<a class="btn btn-ghost btn-sm" href="' + url + '" target="_blank" rel="noopener">Lihat PDF-nya</a>'
          + ' <span class="hint">Berkas PDF ' + (blob.size / 1024).toFixed(0) + ' KB sudah DIUNDUH ke perangkat.'
          + ' Buka dari menu Unduhan / File Manager, lalu cetak lewat Easy Print.</span>';
      }
      info.textContent = 'PDF terunduh: ' + jumlah + ' label · kertas ' + namaKertas
        + ' (' + (blob.size / 1024).toFixed(0) + ' KB). Buka dari menu Unduhan, lalu cetak lewat Easy Print.';
      SC.toast('PDF terunduh (' + jumlah + ' label)', 'ok');
    } catch (e){
      info.textContent = 'Gagal membuat PDF: ' + (e.message || 'kesalahan tidak diketahui') + ' — coba lagi.';
      SC.toast('Gagal membuat PDF', 'err');
    }
  }
  $('btnPdf').addEventListener('click', function(){ buatPdf(false); });
  $('btnPdfContoh').addEventListener('click', function(){ buatPdf(true); });

  // tombol "Salin tautan aplikasi" pada panel peringatan tanpa Bluetooth
  const btnSalin = document.querySelector('[data-salin-halaman]');
  if (btnSalin){
    btnSalin.addEventListener('click', async function(){
      const url = location.href;
      try {
        await navigator.clipboard.writeText(url);
        SC.toast('Tautan disalin — tempel di Chrome Android', 'ok');
      } catch (e){
        // clipboard diblokir (mode PWA/WebView): tampilkan tautannya supaya bisa disalin manual
        const info = $('infoLingkungan');
        if (info) info.textContent = 'Tautan aplikasi: ' + url + ' — buka di Chrome Android untuk printer Bluetooth.';
        SC.toast('Tautan ditampilkan di layar (salin manual)', 'info');
      }
    });
  }

  $('btnPratinjau').addEventListener('click', pratinjau);
  ['lebarDots','jenis','protokol','modul','tinggiBc','tampilKode','tampilNama','kalauPanjang'].forEach(function(id){ $(id).addEventListener('change', pratinjau); });

  $('btnSambung').addEventListener('click', async function(){
    $('btnSambung').disabled = true;
    try {
      koneksi = await SCBT.sambung({ log: log, ukuranPotong: Number($('potong').value) || 100, jedaMs: Number($('jeda').value) });
      status('siap', 'Tersambung: ' + koneksi.nama + (koneksi.mode === 'cepat' ? ' (mode cepat, paket 20 byte)' : ' (mode konfirmasi)'));
      SC.toast('Printer tersambung', 'ok');
    } catch (e){
      status('gagal', e.message);
      log.err(e.message);
      koneksi = null;
    }
    $('btnSambung').disabled = false;
  });

  $('btnPutus').addEventListener('click', function(){
    if (koneksi && koneksi.device && koneksi.device.gatt.connected) koneksi.device.gatt.disconnect();
    koneksi = null;
    status('', 'Belum tersambung');
    log.info('Printer diputus.');
  });

  /*
   * BUG yang diperbaiki (revisi ke-79): tombol ini dulu memanggil "polaUji" - fungsi yang hanya
   * MENGGAMBAR kanvas pola uji tanpa mengirim apa pun ke printer, sehingga tombol "Cetak Uji Pola"
   * tidak pernah mengeluarkan kertas (keluhan user: "cetak uji pola tidak berfungsi").
   * Yang benar adalah "kirimPolaUji" (menyusun raster lalu mengirim lewat koneksi).
   * polaUji tetap dipakai oleh kirimPolaUji dan pratinjau. JANGAN dikembalikan ke polaUji.
   */
  $('btnUji').addEventListener('click', kirimPolaUji);

  $('btnCetak').addEventListener('click', function(){
    const daftar = daftarTerpilih();
    if (!daftar.length){ SC.toast('Isi jumlah label dulu', 'err'); return; }
    kirim(daftar, 'cetak label terpilih');
  });

  document.querySelectorAll('[data-semua]').forEach(function(b){
    b.addEventListener('click', function(){
      const v = Number(b.dataset.semua);
      document.querySelectorAll('#tblTermal tbody tr').forEach(function(tr){
        if (tr.style.display !== 'none') tr.querySelector('input[type=number]').value = v;
      });
    });
  });

  const barisAda = document.querySelectorAll('#tblTermal tbody tr').length > 0;
  pratinjau().then(function(){
    if (!barisAda) log.info('Inventory masih kosong — impor Excel dulu lewat Inventory.');
  });
})();
</script>`;

  return {
    isi: `
<div class="page-head">
  <div>
    <h1>Cetak Barcode ke Printer Thermal (Bluetooth)</h1>
    <div class="sub">Sambungkan printer thermal Bluetooth, lalu cetak label barcode barang langsung dari HP / komputer.</div>
  </div>
  <div class="aksi">
    <a class="btn btn-ghost" href="${base}/label">Cetak A4 / F4</a>
    <a class="btn btn-ghost" href="${base}/barang">Inventory</a>
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="alert alert-warn">
  <b>Kalau barcode tidak terbaca / hasilnya titik-titik:</b> kode barang yang panjang (mis. LOUIS-VUITTON-CF58370)
  butuh lebih dari 250 modul, sedangkan kertas 58 mm hanya 384 dot — artinya modulnya &lt; 2 dot dan mustahil
  dipindai. Aplikasi sekarang menanganinya sendiri: <b>barcode diputar 90°</b> supaya modulnya cukup lebar
  (masih Code128, tetap bisa dipindai), atau pilih di setelan kalau mau dialihkan ke <b>QR Code</b>.
  Kertas <b>80 mm (576 dot)</b> juga sudah cukup untuk barcode tegak biasa.
</div>

<div class="dua-kolom">
  <div class="card">
    <h2 class="card-title">1. Sambungkan printer</h2>
    <div class="bt-status" id="btStatus"><span class="titik"></span><span id="btStatusTeks">Belum tersambung</span></div>
    <div class="alert alert-warn" id="peringatanBt" hidden>
      <b>Bluetooth tidak tersedia di browser ini.</b> Biasanya karena aplikasi dibuka dari dalam
      aplikasi lain (WhatsApp/Instagram) atau dari ikon aplikasi terpasang. Dua cara tetap bisa:
      <b>(1)</b> buka alamat aplikasi ini di Chrome Android secara langsung, atau
      <b>(2)</b> tekan <b>Buat PDF</b> di panel kanan lalu cetak PDF-nya dari aplikasi pihak ketiga.
      <div class="hint" id="infoLingkungan" style="margin-top:8px"></div>
      <div class="aksi-row" style="margin-top:10px">
        <button class="btn btn-ghost btn-sm" type="button" data-salin-halaman>Salin tautan aplikasi</button>
        <span class="hint">lalu tempel di <b>Chrome Android</b> untuk memakai printer Bluetooth</span>
      </div>
    </div>
    <div class="aksi-row" style="margin-top:14px">
      <button class="btn btn-primary" type="button" id="btnSambung">Sambungkan Printer Bluetooth</button>
      <button class="btn btn-ghost" type="button" id="btnPutus">Putuskan</button>
      <button class="btn btn-ghost" type="button" id="btnUji">Cetak Uji Pola</button>
      <button class="btn btn-ghost" type="button" id="btnUjiTeks">Uji Teks (ESC/POS)</button>
      <button class="btn btn-ghost" type="button" id="btnUjiTeksTspl">Uji Teks (TSPL)</button>
      <button class="btn btn-ghost" type="button" id="btnPenggaris">Cetak Penggaris Lebar</button>
    </div>
    <div class="hint" id="hintDiagnosa">
      <b>Urutan diagnosa kalau hasil cetak berantakan:</b>
      1) <b>Uji Teks (ESC/POS)</b> — kalau tulisannya terbaca, printer paham ESC/POS dan masalahnya di
      ukuran/gambar; kalau tetap berantakan, coba <b>Uji Teks (TSPL)</b> lalu ganti "Jenis printer" ke TSPL.
      2) <b>Cetak Penggaris Lebar</b> — baca angka terakhir yang masih terlihat di kertas, lalu samakan
      "Lebar kertas (dot)" dengan angka itu (kertas yang lebih sempit dari setelan membuat hasil tercetak
      acak/terpotong). 3) Baru <b>Cetak Uji Pola</b> untuk memastikan gambar & titik printer rapi.
    </div>
    <div class="hint">Nyalakan printer → aktifkan Bluetooth di HP → klik Sambungkan → pilih nama printer. Pakai Chrome/Edge di Android atau komputer (iOS/Safari belum mendukung).</div>
    <div class="hint"><b>Cetak Uji Pola</b> mengirim balok hitam + garis 1/2/3 dot. Kalau hasilnya pecah/ bergeser, protokol raster printer berbeda — coba ganti ukuran paket/jeda di bawah, atau pakai protokol TSPL bila printer label.</div>
    <div id="btLog" style="margin-top:16px"></div>
    <div class="hint" id="btProgress"></div>
  </div>

  <div class="card">
    <h2 class="card-title">2. Setelan printer</h2>
    <div class="field-row">
      <div class="field"><label class="f">Jenis printer</label>
        <select id="protokol">
          <option value="escpos">ESC/POS — printer struk 58/80 mm (paling umum)</option>
          <option value="tspl">TSPL — printer label TSC/Zebra</option>
        </select>
      </div>
      <div class="field"><label class="f">Isi label</label>
        <select id="jenis">
          <option value="code128">Barcode Code128 (otomatis QR kalau terlalu rapat)</option>
          <option value="qr">QR Code saja</option>
          <option value="keduanya">Barcode + QR</option>
          <option value="nonaktif">Tanpa barcode (kode + nama saja)</option>
        </select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label class="f">Lebar kertas (dot)</label>
        <select id="lebarDots">
          <option value="384">384 dot (58 mm) — default</option>
          <option value="576">576 dot (80 mm) — barcode lebih lega</option>
          <option value="416">416 dot (48 mm)</option>
          <option value="320">320 dot (40 mm)</option>
          <option value="240">240 dot (30 mm) — label kecil</option>
          <option value="200">200 dot (25 mm) — label paling kecil</option>
        </select>
      </div>
      <div class="field"><label class="f">Lebar modul barcode (dot)</label>
        <input type="number" id="modul" value="2" min="1" max="6">
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label class="f">Tinggi barcode (dot)</label><input type="number" id="tinggiBc" value="64" min="24" max="160"></div>
      <div class="field"><label class="f">Tulis kode di bawah barcode?</label>
        <select id="tampilKode"><option value="1">Ya</option><option value="0">Tidak</option></select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label class="f">Tulis nama barang?</label>
        <select id="tampilNama"><option value="1">Ya</option><option value="0">Tidak</option></select>
      </div>
      <div class="field"><label class="f">Kepekatan (ambang hitam)</label><input type="number" id="ambang" value="160" min="40" max="240"></div>
    </div>
    <div class="field">
      <label class="f">Kalau kode terlalu panjang untuk kertas ini</label>
      <select id="kalauPanjang">
        <option value="putar">Putar barcode 90° — tetap Code128 &amp; bisa dipindai (disarankan)</option>
        <option value="qr">Ganti ke QR Code</option>
        <option value="rapat">Tetap Code128 rapat (tidak disarankan)</option>
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label class="f">Ukuran QR Code</label>
        <select id="ukuranQr">
          <option value="kecil">Kecil (45% lebar kertas)</option>
          <option value="sedang" selected>Sedang (65% lebar kertas) — disarankan</option>
          <option value="besar">Besar (85% lebar kertas)</option>
        </select>
      </div>
      <div class="field"><label class="f">Ukuran paket kirim (byte)</label><input type="number" id="potong" value="100"></div>
      <div class="field"><label class="f">Jeda antar paket (ms)</label><input type="number" id="jeda" value="8"></div>
    </div>
    <div class="field-row">
      <div class="field"><label class="f">Tinggi blok raster (baris)</label><input type="number" id="bandTinggi" value="100" min="0" max="2000"></div>
      <div class="field"><label class="f">Batas data sekali kirim (byte)</label><input type="number" id="batasKirim" value="60000" min="50000"></div>
    </div>
    <div class="hint"><b>Tinggi blok raster</b> memecah gambar jadi beberapa blok kecil saat dikirim — penting untuk printer
      murah yang buffer-nya kecil (gejala salah: hasil cetak tergeser / terputus di tengah). Isi 0 hanya kalau printemya kuat.</div>
    <div class="field-row">
      <div class="field"><label class="f">Ukuran label TSPL — lebar (mm)</label><input type="number" id="lebarMm" value="50"></div>
      <div class="field"><label class="f">Tinggi / gap label TSPL (mm)</label>
        <div style="display:flex;gap:8px">
          <input type="number" id="tinggiMm" value="30" style="text-align:center">
          <input type="number" id="gapMm" value="2" style="text-align:center">
        </div>
      </div>
    </div>
    <div class="hint">Kalau hasil cetak terlalu pudar, kecilkan angka kepekatan (mis. 190). Kalau terlalu tebal/hitam, besarkan (mis. 130).
      Hasil cetak <b>tergeser/terputus</b>? Sambung ulang printer (aplikasi memakai mode konfirmasi bila printer mendukung),
      lalu kecilkan <b>tinggi blok raster</b> (mis. 60) dan naikkan <b>jeda antar paket</b> (mis. 25 ms).</div>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <details class="card" style="padding:12px 14px" id="panduanPdf">
      <summary style="cursor:pointer;font-weight:700">Cara mencetak kalau Bluetooth tidak bisa dipakai
        (klik untuk membuka panduan)</summary>
      <div class="stack" style="margin-top:10px;gap:10px">
        <div class="alert alert-warn" style="margin:0">
          <b>Kenapa Bluetooth sering tidak bisa?</b> Peramban web (Chrome) hanya bisa memakai
          <b>Bluetooth LE (BLE)</b>. Printer thermal yang lebih lama memakai <b>Bluetooth Classic (SPP)</b> —
          printer seperti itu <b>tidak akan muncul</b> di daftar perangkat saat menekan “Sambungkan Printer
          Bluetooth”, dan itu bukan kerusakan aplikasi. Solusinya: <b>cetak lewat berkas PDF</b> memakai
          aplikasi pihak ketiga yang bisa Bluetooth Classic.
        </div>
        <div>
          <div class="judul-kecil">Langkah mencetak PDF (disarankan)</div>
          <ol class="pasang-langkah">
            <li>Pilih <b>Kertas printer untuk PDF</b> di bawah sesuai label Anda (contoh: <b>Label 50×30 mm</b>
              atau <b>Gulungan 58 mm</b>).</li>
            <li>Isi jumlah label, lalu tekan <b>Buat PDF label terpilih</b> (atau <b>PDF 1 label contoh</b> untuk
              mencoba). Berkasnya <b>langsung terunduh</b> — tidak perlu tab baru.</li>
            <li>Buka aplikasi cetak di HP (mis. <b>Easy Print</b>, RawBT, NokoPrint, atau aplikasi merek printer
              Anda), lalu buka berkas PDF dari folder <b>Unduhan</b> (menu Unduhan / File Manager).</li>
            <li>Di aplikasi itu pilih printer Bluetooth Anda — printernya sudah dipasangkan lebih dulu di
              <b>Setelan → Bluetooth</b> HP.</li>
            <li>Ukuran kertas di aplikasi = sama dengan langkah 1, dan skala <b>100% / “Asli”</b>
              (jangan “Fit to page”, QR-nya bisa mengecil lalu sulit dipindai).</li>
          </ol>
        </div>
        <div class="hint">
          Kalau printer Anda <b>BLE</b> (bukan Bluetooth Classic), tombol <b>Sambungkan Printer Bluetooth</b>
          di atas tetap bisa dipakai langsung — coba dulu; kalau printernya tidak muncul di daftar, berarti
          printernya Bluetooth Classic dan pakai jalur PDF di atas.
        </div>
      </div>
    </details>
    <div class="judul-kecil">Kalau Bluetooth tidak bisa mencetak → Buat PDF</div>
    <p class="card-hint" style="margin-top:6px">
      Buat berkas <b>PDF label</b> dengan ukuran kertas yang pasti, lalu cetak dari
      <b>aplikasi pihak ketiga</b> (aplikasi merek printer, RawBT, atau layanan cetak bawaan HP).
      Cara ini tidak memakai Bluetooth &amp; tidak bergantung pada protokol printer.
    </p>
    <div class="field-row">
      <div class="field"><label class="f">Kertas printer untuk PDF</label>
        <select id="pdfKertas">
          ${labelPdf
            .daftarKertas()
            .map((k) => `<option value="${k.id}"${k.id === 'roll58' ? ' selected' : ''}>${esc(k.nama)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="field"><label class="f">Ukuran QR</label>
        <select id="pdfUkuranQr">
          <option value="kecil">Kecil (45%)</option>
          <option value="sedang" selected>Sedang (65%) — disarankan</option>
          <option value="besar">Besar (85%)</option>
        </select>
      </div>
    </div>
    <div class="aksi-row" style="margin-top:12px">
      <button class="btn btn-primary" type="button" id="btnPdf">Buat PDF label terpilih</button>
      <button class="btn btn-ghost" type="button" id="btnPdfContoh">PDF 1 label contoh (kode + QR)</button>
    </div>
    <div class="hint" id="pdfInfo"></div>
    <div id="pdfTautan" hidden style="margin-top:8px"></div>
    <hr style="border:none;border-top:1px solid var(--line);margin:18px 0">
    <div class="judul-kecil">Pratinjau label (1 piksel = 1 dot printer)</div>
    <div class="label-canvas-wrap">
      <canvas id="pvKanvas" width="384" height="120"></canvas>
      <div>
        <div class="hint">Contoh isi label:</div>
        <div class="kode" id="pvKode" data-kode="CONTOH-001">CONTOH-001</div>
        <div id="pvNama" style="font-weight:700">Contoh Barang</div>
        <div class="hint" id="pvUkuran" style="margin-top:6px"></div>
        <button class="btn btn-ghost btn-sm" type="button" id="btnPratinjau" style="margin-top:10px">Perbarui Pratinjau</button>
      </div>
    </div>
    <div class="alert alert-warn" id="pvCatatan" hidden style="margin-top:14px"><b id="pvPesan"></b></div>
  </div>
</div>

<div class="card" style="margin-top:22px">
  <h2 class="card-title">3. Pilih barang &amp; cetak</h2>
  <p class="card-hint">Isi jumlah label tiap barang, lalu klik <b>Cetak ke Printer</b>. Sebaiknya klik <b>Cetak Uji Pola</b> dulu untuk memastikan printer &amp; ukurannya pas.</p>
  <div class="cari-box">
    <input type="search" data-filter="#tblTermal" placeholder="Cari nama / kode barang…">
    <button class="btn btn-ghost btn-sm" type="button" data-semua="1">Semua → 1</button>
    <button class="btn btn-ghost btn-sm" type="button" data-semua="0">Semua → 0</button>
  </div>
  <div class="tbl-wrap daftar-termal">
    <table class="tbl rapat" id="tblTermal">
      <thead><tr><th>Kode</th><th>Nama Barang</th><th class="tengah">Jumlah Label</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="3" class="kosong">Belum ada barang. <a href="' + base + '/impor">Impor Excel</a> dulu.</td></tr>'}</tbody>
    </table>
  </div>
  <div class="aksi-row" style="margin-top:18px">
    <button class="btn btn-primary btn-lg" type="button" id="btnCetak">Cetak ke Printer</button>
  </div>
</div>`,
    script,
  };
};
