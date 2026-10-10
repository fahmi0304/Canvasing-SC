'use strict';
const { esc, rp, angka } = require('../lib/util');
const { noSurat } = require('../lib/kode');
const barcode = require('../lib/barcode');
const labelPdf = require('../lib/labelPdf');

exports.render = function ({ daftar, cari, base, dariSesi, pesan }) {
  const defaultQty = cari || dariSesi ? 1 : 0;
  const baris = daftar
    .map(
      (p) => `<tr data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}">
      <td class="kode">${esc(p.kode)}</td>
      <td><b>${esc(p.nama)}</b></td>
      <td class="tengah"><span class="label-item" style="min-width:0;border:none;padding:0">
        <img src="${base}/barcode.svg?kode=${encodeURIComponent(p.kode)}" alt="barcode" style="height:34px;width:auto">
      </span></td>
      <td class="tengah"><span class="qty">
        <button type="button" data-minus data-target="#qty_${p.id}">−</button>
        <input type="number" min="0" name="qty_${p.id}" id="qty_${p.id}" value="${defaultQty}">
        <button type="button" data-plus data-target="#qty_${p.id}">+</button>
      </span></td>
    </tr>`
    )
    .join('');

  return `
<div class="page-head">
  <div>
    <h1>Cetak Barcode / QR Barang</h1>
    <div class="sub">${dariSesi ? `Menampilkan barang yang dibawa pada surat jalan ${esc(noSurat(dariSesi))} (${esc(dariSesi.sales_nama || '')}).` : 'Isi jumlah label tiap barang, lalu klik Cetak PDF — berkas PDF siap dicetak.'}</div>
  </div>
  <div class="aksi">
    <a class="btn btn-ghost" href="${base}/thermal">Cetak ke Printer Thermal (Bluetooth)</a>
    <a class="btn btn-ghost" href="${base}/barang">Inventory</a>
  </div>
</div>
${pesan ? `<div class="alert alert-warn">${esc(pesan)}</div>` : ''}
<div class="alert alert-info">
  <b>Catatan keterbacaan:</b> barcode Code128 untuk kode yang panjang (lebih dari ±13 karakter, mis.
  <span class="kode">LOUIS-VUITTON-CF58370</span>) butuh lebih dari 180 modul. Di kertas label kecil
  (mis. label thermal 50 × 30 mm) modulnya jadi terlalu rapat dan sulit dipindai — pilih <b>QR Code</b>
  untuk kode seperti itu. Pada kertas A4/F4 dengan printer laser/tinta (300–600 dpi) Code128 masih aman.
</div>
<div class="alert alert-info">
  <b>Semua cetak = PDF (permintaan user):</b> tombol di halaman ini menghasilkan <b>berkas PDF label</b>
  dengan ukuran kertas yang sudah pasti — gulungan 25/30/40/58/80 mm, label tetap 50 × 30 / 40 × 30 /
  58 × 40 mm, atau <b>lembar A4/F4</b> berisi grid label 64 × 34 mm. Berkasnya bisa langsung dicetak dari
  penampil PDF / berbagi ke aplikasi merek printer Anda (RawBT, Easy Print, dsb.) tanpa Bluetooth.
</div>
<form method="post" action="${base}/cetak/label-pdf" target="_blank">
<div class="card">
  <div class="grid grid-3" style="align-items:end">
    <div class="field"><label class="f">Jenis kode</label>
      <select name="tipe">
        <option value="code128">Barcode 1D (Code128) — untuk scanner gudang</option>
        <option value="qr">QR Code</option>
        <option value="keduanya">Barcode + QR (satu label)</option>
      </select>
    </div>
    <div class="field"><label class="f">Kertas printer label</label>
      <select name="kertas">
        ${labelPdf
          .daftarKertas()
          .map((k) => `<option value="${k.id}"${k.id === 'roll58' ? ' selected' : ''}>${esc(k.nama)}</option>`)
          .join('')}
      </select>
    </div>
    <div class="field aksi-row">
      <button class="btn btn-ghost btn-sm" type="button" onclick="setSemua(1)">Semua → 1</button>
      <button class="btn btn-ghost btn-sm" type="button" onclick="setSemua(0)">Semua → 0</button>
    </div>
  </div>
  <div class="grid grid-2" style="align-items:end;margin-top:6px">
    <div class="field"><label class="f">Ukuran QR</label>
      <select name="ukuranQr">
        <option value="kecil">Kecil (45% lebar label)</option>
        <option value="sedang" selected>Sedang (65% lebar label) — disarankan</option>
        <option value="besar">Besar (85% lebar label)</option>
      </select>
    </div>
    <div class="field"><label class="f">Resolusi printer</label>
      <select name="dpi">
        <option value="203" selected>203 dpi (8 dot/mm) — paling umum</option>
        <option value="300">300 dpi (11,8 dot/mm)</option>
      </select>
    </div>
  </div>
  <p class="card-hint" style="margin:10px 0 0">Ukuran modul QR &amp; barcode diselaraskan ke
    kelipatan dot sesuai resolusi yang dipilih, supaya hasil cetaknya tajam (tidak kabur).</p>
  <div class="cari-box" style="margin-top:6px">
    <input type="search" data-filter="#tblLabel" placeholder="Filter cepat nama barang…">
  </div>
  <div class="tbl-wrap" style="max-height:60vh;overflow:auto">
    <table class="tbl rapat" id="tblLabel">
      <thead><tr><th>Kode</th><th>Nama Barang</th><th class="tengah">Preview</th><th class="tengah">Jumlah Label</th></tr></thead>
      <tbody>${baris || `<tr><td colspan="4" class="kosong">Tidak ada barang.</td></tr>`}</tbody>
    </table>
  </div>
  <div class="hint" id="pdfInfoLabel" style="margin-top:12px"></div>
  <div id="pdfTautanLabel" hidden style="margin-top:8px"></div>
  <div class="aksi-row" style="margin-top:16px">
    <button class="btn btn-primary btn-lg" type="submit" data-pdf-form>Cetak PDF Label</button>
  </div>
</div>
</form>
<script>
function setSemua(v){ document.querySelectorAll('#tblLabel input[type=number]').forEach(function(i){ i.value = v; }); }

/*
 * Tombol "Cetak PDF Label" (perbaikan revisi ke-81 + permintaan user "semua cetak = PDF"):
 * halaman ini hanya punya SATU tombol cetak dan hasilnya berkas PDF. Form dengan target="_blank"
 * sering TIDAK memunculkan apa pun saat tab baru diblokir (mode aplikasi terpasang/PWA atau browser di
 * dalam aplikasi chat) sehingga terlihat seperti tombol rusak. Karena itu PDF diambil dengan fetch lalu
 * berkasnya DIUNDUH langsung (permintaan user: "cetak pdf usahakan langsung ter download agar bisa di
 * print menggunakan easy print") + tautan "Lihat PDF-nya".
 * Kalau JS dimatikan, tombolnya tetap submit biasa ke /cetak/label-pdf (fallback).
 */
(function(){
  const info = document.getElementById('pdfInfoLabel');
  const kotakTautan = document.getElementById('pdfTautanLabel');
  document.addEventListener('click', async function(ev){
    const b = ev.target.closest('[data-pdf-form]');
    if (!b) return;
    ev.preventDefault();
    const form = b.closest('form');
    const data = new URLSearchParams();
    new FormData(form).forEach(function(v, k){ data.append(k, v); });
    info.textContent = 'Menyiapkan PDF…';
    kotakTautan.hidden = true;
    try {
      const r = await fetch((window.APP_BASE || '') + '/cetak/label-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data,
      });
      if (!r.ok) throw new Error('server menolak (' + r.status + ')');
      const blob = await r.blob();
      if (!blob.size) throw new Error('berkas kosong');
      /*
       * Permintaan user: "cetak pdf usahakan langsung ter download agar bisa di print menggunakan
       * easy print" → berkas SELALU diunduh langsung (tidak dibuka di tab baru). Tautan "buka"
       * tetap disediakan kalau pengguna ingin melihatnya lebih dulu.
       */
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'label-' + new Date().toISOString().slice(0, 10) + '.pdf';
      document.body.appendChild(a); a.click(); a.remove();
      kotakTautan.hidden = false;
      kotakTautan.innerHTML = '<a class="btn btn-ghost btn-sm" href="' + url + '" target="_blank" rel="noopener">Lihat PDF-nya</a>'
        + ' <span class="hint">Berkas PDF ' + (blob.size / 1024).toFixed(0) + ' KB sudah DIUNDUH ke perangkat.'
        + ' Buka dari menu Unduhan / File Manager, lalu cetak lewat Easy Print.</span>';
      info.textContent = 'PDF terunduh (' + (blob.size / 1024).toFixed(0) + ' KB) — buka dari Unduhan, lalu cetak lewat Easy Print.';
    } catch (e){
      info.textContent = 'Gagal membuat PDF: ' + (e.message || 'kesalahan tidak diketahui');
    }
  });
})();
</script>`;
};
