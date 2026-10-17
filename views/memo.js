'use strict';
/**
 * MEMO PENGAMBILAN BARANG — struk printer thermal (58 mm / 80 mm).
 *
 * Halaman ini menggantikan memo kertas F4 ÷ 2: isinya ditata seperti struk (monospace, satu kolom),
 * bisa langsung dicetak ke printer thermal Bluetooth (ESC/POS raster) atau lewat dialog cetak browser.
 */
const { esc, angka, tanggalPendek, urutNama } = require('../lib/util');
const { noSurat } = require('../lib/kode');
const { semua: setelanSemua } = require('../lib/setelan');

const LEBAR = {
  58: { mm: 58, dots: 384 },
  80: { mm: 80, dots: 576 },
};

exports.LEBAR = LEBAR;

/*
 * Susun daftar baris memo = HANYA barang tambahan (kolom T) yang benar-benar ada.
 * permintaan user: "Hapus semua opsi print cetak memo kosong" → mode memo kosong (30 baris bergaris
 * titik untuk ditulis tangan) DIHAPUS dari view, menu, dan rute (`/cetak/memo/:id` selalu terisi).
 * Jangan dihidupkan lagi tanpa permintaan user.
 */
function susunBaris({ items }) {
  let n = 0;
  // barang di struk disusun A-Z (permintaan user: "cukup urutkan nama A-Z saat mencetak saja")
  return urutNama(items)
    .filter((i) => i.t > 0)
    .map((i) => {
      n += 1;
      return { no: n, nama: i.nama, kode: i.kode, qty: angka(i.t) };
    });
}

exports.render = function ({ sesi, items, base, lebar = 58, namaAdmin, setelan }) {
  // Setelan "Edit Logo & Layout Surat" → nama toko pada kop (lib/setelan.js). Blok tanda tangan sudah dihapus.
  const st = setelan || setelanSemua();
  const ukuran = LEBAR[String(lebar) === '80' ? 80 : 58];
  const baris = susunBaris({ items });
  const total = items.reduce((a, i) => a + (i.t || 0), 0);
  const sales = String(sesi.sales_nama || '').trim();

  // tinggi awal (perkiraan) — dirapikan lagi di browser dari tinggi struk yang sebenarnya
  const tinggiMm = Math.max(60, Math.ceil(38 + Math.max(baris.length, 1) * 4.4 + 34));

  const barisHtml = baris
    .map(
      (b) => `<tr>
        <td class="no">${b.no}</td>
        <td class="nm">${esc(b.nama || '')}</td>
        <td class="q">${esc(b.qty || '')}</td>
      </tr>`
    )
    .join('');

  const isi = `
<div class="struk${ukuran.mm === 80 ? ' lebar80' : ''}">
  <div class="pusat toko">${esc(st.kop_sub)}</div>
  <div class="pusat">${esc(String(sesi.tanggal || '').slice(0, 4))}</div>
  <div class="pisah"></div>
  <div class="pusat judul">MEMO PENGAMBILAN BARANG</div>
  <div class="meta">
    <div><b>No.</b><span>${esc(noSurat(sesi))}</span></div>
    <div><b>Tanggal</b><span>${esc(tanggalPendek(sesi.tanggal))}</span></div>
    <div><b>Sales</b><span>${esc(sales || '-')}</span></div>
  </div>
  <div class="pisah"></div>
  <table>
    <thead><tr><th class="no">No</th><th class="nm">Nama Barang</th><th class="q">Jml</th></tr></thead>
    <tbody>${barisHtml}</tbody>
  </table>
  <div class="pisah"></div>
  <div class="total"><span>Total Barang</span><span>${angka(total)}</span></div>
  <div class="pisah"></div>
  <div class="pusat">Barang diambil sesuai daftar di atas</div>
</div>`;

  const dataJson = JSON.stringify({
    toko: st.kop_sub,
    // tanda tangan DIHAPUS dari semua dokumen (permintaan user) — kanvas tidak menggambarnya lagi
    ttd: false,
    tahun: String(sesi.tanggal || '').slice(0, 4),
    judul: 'MEMO PENGAMBILAN BARANG',
    id: sesi.id,
    tanggal: tanggalPendek(sesi.tanggal),
    sales: sales || '-',
    namaAdmin: namaAdmin || '',
    total: angka(total),
    totalAngka: total,
    terisi: true,
    baris,
  });

  const urlUbah = (lebarBaru) => `${base}/cetak/memo/${sesi.id}?lebar=${lebarBaru}`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memo Pengambilan ${esc(noSurat(sesi))} · Struk ${ukuran.mm} mm</title>
<link rel="stylesheet" href="${base}/print.css">
<style id="gayaHalaman">@page{size:${ukuran.mm}mm ${tinggiMm}mm;margin:0}</style>
</head>
<body class="struk-lembar">
<div class="bar-cetak no-print">
  <button class="utama" type="button" id="btnCetakMemo">Cetak / Simpan PDF</button>
  <a href="${base}/sesi/${sesi.id}" id="btnKembaliMemo" rel="prev">Kembali</a>
</div>

<div class="container no-print" style="max-width:720px;padding-top:16px">
  <div class="card" style="padding:18px 20px">
    <h2 class="card-title">Cetak Memo Pengambilan Barang — Struk Thermal</h2>
    <p class="card-hint">Isi memo mengikuti kolom <b>Tambahan (T)</b> perjalanan ini.
      Lebar kertas struk bisa diganti 58 mm atau 80 mm.</p>
    <div class="struk-baris" style="margin-bottom:14px">
      <label class="f" style="margin:0">Lebar kertas</label>
      <select id="lebarStruk" data-url58="${esc(urlUbah(58))}" data-url80="${esc(urlUbah(80))}">
        <option value="58"${ukuran.mm === 58 ? ' selected' : ''}>58 mm (struk kecil)</option>
        <option value="80"${ukuran.mm === 80 ? ' selected' : ''}>80 mm (struk lebar)</option>
      </select>
      <button class="btn btn-ghost" type="button" id="btnUbahLebar">Terapkan Lebar</button>
    </div>
    <div class="struk-status" id="btStatus"><span class="titik"></span><span id="btStatusTeks">Belum tersambung ke printer</span></div>
    <div class="aksi-row" style="margin-top:12px">
      <button class="btn btn-primary" type="button" id="btnSambung">Sambungkan Printer Bluetooth</button>
      <button class="btn btn-sukses" type="button" id="btnKirim" disabled>Kirim Struk ke Printer</button>
      <button class="btn btn-ghost" type="button" id="btnPolaUji" disabled>Cetak Uji Pola</button>
      <button class="btn btn-ghost" type="button" id="btnPratinjau">Perbarui Pratinjau</button>
    </div>
    <div id="strukLog" style="margin-top:12px">Belum ada aktivitas printer.</div>
    <div class="hint" style="margin-top:10px">Web Bluetooth hanya jalan di Chrome/Edge (Android/desktop), belum di iOS/Safari.
      Kalau printer tidak terdeteksi, pastikan printernya Bluetooth LE (bukan Bluetooth klasik/SPP).</div>
    <div class="hint" style="margin-top:8px"><b>Kalau memakai dialog cetak browser:</b> ubah <b>Paper size</b> ke
      <b>${ukuran.mm} mm (roll / struk)</b> dan margin <b>None</b>, lalu matikan <b>Headers and footers</b> —
      kalau dibiarkan A4, struk akan tercetak di tengah kertas lebar.</div>
  </div>
  <div class="aksi-row" style="margin:16px 0 4px">
    <a class="btn btn-ghost" href="${base}/sesi/${sesi.id}">Kembali ke Perjalanan</a>
    <a class="btn btn-ghost" href="${base}/thermal">Halaman Printer Thermal</a>
  </div>
  <div class="hint" style="margin-bottom:6px">Pratinjau yang dikirim ke printer (${ukuran.dots} dot):</div>
  <div style="background:#fff;border:1px solid rgba(99,95,130,.2);border-radius:12px;padding:10px;overflow:auto">
    <canvas id="pvStruk"></canvas>
  </div>
</div>

${isi}

<script>window.APP_BASE = ${JSON.stringify(base)}; window.MEMO_DATA = ${dataJson};
// Kertas struk = roll: tinggi halaman disamakan dengan tinggi isi supaya 1 struk = 1 halaman.
window.LEBAR_MM = ${ukuran.mm};
window.pasHalamanStruk = function () {
  var s = document.querySelector('.struk');
  var gaya = document.getElementById('gayaHalaman');
  if (!s || !gaya) return 60;
  var px = 96 / 25.4;
  var mm = Math.max(40, Math.ceil(s.getBoundingClientRect().height / px) + 1);
  gaya.textContent = '@page{size:' + window.LEBAR_MM + 'mm ' + mm + 'mm;margin:0}';
  return mm;
};
</script>
<script src="${base}/app.js"></script>
<script src="${base}/bt-printer.js"></script>
<script src="${base}/memo-struk.js"></script>
<script>
(function(){
  var data = window.MEMO_DATA;
  var ukuran = { 58: 384, 80: 576 };
  var dots = ${ukuran.dots};
  var koneksi = null;
  var $ = function(id){ return document.getElementById(id); };

  function log(teks, kelas){
    var d = document.createElement('div');
    if (kelas) d.className = kelas;
    d.textContent = teks;
    $('strukLog').appendChild(d);
    $('strukLog').scrollTop = $('strukLog').scrollHeight;
  }
  function status(kelas, teks){
    $('btStatus').className = 'struk-status' + (kelas ? ' ' + kelas : '');
    $('btStatusTeks').textContent = teks;
  }

  /*
   * (perbaikan revisi ke-81) Tombol TIDAK dinonaktifkan lagi saat Web Bluetooth tidak ada — dulu
   * pengguna melihat tombol mati tanpa bisa menekan apa pun ("tombol tidak berfungsi"). Sekarang
   * tombol tetap aktif; menekannya memunculkan penjelasan, dan struk tetap bisa dicetak lewat PDF.
   */
  if (!navigator.bluetooth){
    status('gagal', 'Browser ini tidak menyediakan Bluetooth');
    log('Bluetooth tidak tersedia di browser ini. Struk tetap bisa dicetak lewat tombol "Cetak / Simpan PDF" '
      + '(atau buka aplikasi ini di Chrome Android secara langsung).', 'err');
  }

  function gambar(){
    return SCStruk.gambar($('pvStruk'), data, { lebarDots: dots });
  }
  function pasHalaman(){
    var mm = window.pasHalamanStruk();
    return mm;
  }
  window.addEventListener('beforeprint', pasHalaman);

  /* Tombol Cetak & Kembali di halaman memo — sama seperti halaman cetak lain (permintaan user:
     "Tombol kembali di halaman cetak tidak berfungsi"): tombol Kembali memakai URL sungguhan, dan
     riwayat browser hanya dipakai kalau halaman ini memang punya riwayat dari aplikasi. */
  $('btnCetakMemo').addEventListener('click', function () {
    try { window.focus(); window.print(); }
    catch (e) { alert('Pencetakan diblokir browser ini — silakan tekan Ctrl+P / Cmd+P.'); }
  });
  $('btnKembaliMemo').addEventListener('click', function (ev) {
    var adaRiwayat = false;
    try { adaRiwayat = window.history.length > 1 && document.referrer && document.referrer.indexOf(location.origin) === 0; } catch (e) { adaRiwayat = false; }
    if (!adaRiwayat) return;      // ikuti href (halaman perjalanan)
    ev.preventDefault();
    window.history.back();
  });

  $('btnPratinjau').addEventListener('click', function(){
    var k = gambar();
    log('Pratinjau diperbarui: ' + k.width + ' x ' + k.height + ' dot · tinggi kertas ' + pasHalaman() + ' mm.');
  });

  $('btnUbahLebar').addEventListener('click', function(){
    var v = $('lebarStruk').value;
    location.href = $('lebarStruk').dataset['url' + v];
  });

  $('btnSambung').addEventListener('click', async function(){
    $('btnSambung').disabled = true;
    try {
      koneksi = await SCBT.sambung({ log: { info: function(t){ log('· ' + t); }, ok: function(t){ log('OK  ' + t, 'ok'); }, err: function(t){ log('GAGAL  ' + t, 'err'); } } });
      status('siap', 'Tersambung: ' + koneksi.nama + (koneksi.mode === 'cepat' ? ' (mode cepat, paket 20 byte)' : ' (mode konfirmasi)'));
      $('btnKirim').disabled = false;
      $('btnPolaUji').disabled = false;
      SC.toast('Printer tersambung', 'ok');
    } catch (e){
      status('gagal', e.message);
      log('GAGAL  ' + e.message, 'err');
      koneksi = null;
      $('btnKirim').disabled = true;
    }
    $('btnSambung').disabled = false;
  });

  // Pola uji: memastikan printer menerima raster dengan benar sebelum mencetak struk asli
  $('btnPolaUji').addEventListener('click', async function(){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    $('btnPolaUji').disabled = true;
    try {
      var k = SCBT.gambarPolaUji(document.createElement('canvas'), dots);
      var bytes = SCBT.escposRaster(k.getContext('2d').getImageData(0, 0, k.width, k.height), { lebarDots: k.width, bandTinggi: 100 });
      log('Mengirim pola uji ' + k.width + 'x' + k.height + ' dot (' + Math.ceil(bytes.length / 1024) + ' KB)…');
      await koneksi.tulis(bytes, function(i, n){ log('  paket ' + i + '/' + n); });
      log('OK  Pola uji terkirim. Periksa: 4 balok hitam penuh, garis 1/2/3 dot terpisah rapi.', 'ok');
    } catch (e){
      log('GAGAL  ' + e.message, 'err');
    }
    $('btnPolaUji').disabled = false;
  });

  $('btnKirim').addEventListener('click', async function(){
    if (!koneksi){ SC.toast('Sambungkan printer dulu', 'err'); return; }
    $('btnKirim').disabled = true;
    try {
      var kanvas = gambar();
      var ctx = kanvas.getContext('2d');
      // blok 100 baris: printer struk murah buffer-nya kecil, data panjang sekaligus bikin hasil tergeser
      var bytes = SCBT.escposRaster(ctx.getImageData(0, 0, kanvas.width, kanvas.height), { lebarDots: kanvas.width, feed: 4, bandTinggi: 100 });
      log('Mengirim struk ' + kanvas.width + 'x' + kanvas.height + ' dot (' + Math.ceil(bytes.length / 1024) + ' KB, blok 100 baris)…');
      await koneksi.tulis(bytes, function(i, n){ log('  paket ' + i + '/' + n); });
      log('OK  Struk memo terkirim ke ' + koneksi.nama + '.', 'ok');
      SC.toast('Struk terkirim ke printer', 'ok');
    } catch (e){
      log('GAGAL  ' + e.message, 'err');
      SC.toast('Gagal mengirim struk', 'err');
    }
    $('btnKirim').disabled = false;
  });

  gambar();
  pasHalaman();
})();
</script>
</body>
</html>`;
};
