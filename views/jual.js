'use strict';
const { esc, angka, selisihJual, selisihBarang } = require('../lib/util');
const { modePilih } = require('./mode');
const { kepalaPerjalanan } = require('./sesi');
const { noSurat } = require('../lib/kode');

/**
 * HALAMAN PENGINPUTAN PENJUALAN (kolom P) — permintaan user:
 *
 *   *"Pada status surat jalan ongoing, sales harus memasukkan dulu jumlah barang yang di jual mereka ke
 *   surat jalan yang ongoing, setelah sales memasukkan barang penjualan mereka surat berubah status
 *   menjadi menunggu rekap, sales dan admin juga bisa memasukkan jumlah penjualan, halaman pengimputan
 *   nya seperti halaman tambahan barang, selisih di hitung dari s dikurangi p"*.
 *
 * Bentuknya meniru layar penginputan yang sudah ada (`views/input.js`): kartu daftar barang dengan kolom
 * jumlah + stepper − / + (klik & tahan), kotak cari, pemilih metode penginputan lewat satu ikon garis
 * tiga (daftar / scan barcode), dan kartu scan. Perbedaannya: yang diisi hanya **satu** kolom (P = jumlah
 * terjual), tidak ada tabel penginputan sebelumnya/memo, dan menyimpannya mengubah status surat jalan
 * menjadi **Menunggu Rekap** (`jual`) — dikerjakan route `POST /sesi/:id/jual`.
 *
 * Baris yang ditampilkan = barang yang IKUT perjalanan ini (B + T > 0) atau yang sudah punya angka
 * terjual (P > 0) — sama seperti layar tambahan yang hanya menampilkan barang yang dibawa, supaya
 * daftarnya pendek dan tidak salah isi.
 */
exports.render = function ({ sesi, items, base, pesan, petugas = '' }) {
  const relevan = items.filter((i) => (Number(i.b) || 0) + (Number(i.t) || 0) > 0 || (Number(i.p) || 0) > 0);
  const tot = { b: 0, t: 0, k: 0, p: 0, s: 0 };
  items.forEach((i) => {
    tot.b += Number(i.b) || 0;
    tot.t += Number(i.t) || 0;
    tot.k += Number(i.k) || 0;
    tot.p += Number(i.p) || 0;
  });
  tot.s = tot.b + tot.t - tot.k;

  // pertama = surat jalan belum pernah punya laporan penjualan (tunggu_jual / status lama `kirim`)
  const pertama = sesi.status === 'tunggu_jual' || sesi.status === 'kirim';
  const labelSimpan = pertama ? 'Simpan & Menunggu Rekap' : 'Simpan Perubahan Penjualan';

  const baris = relevan
    .map(
      (i) => `<tr class="barang" id="row_${i.id}" data-id="${i.id}" data-kode="${esc(i.kode)}" data-p="${
        Number(i.p) || 0
      }" data-cari="${esc((i.kode + ' ' + i.nama).toLowerCase())}">
        <td class="beku"><span class="nm">${esc(i.nama)}</span></td>
        <td class="num tengah">${angka(i.b)}</td>
        <td class="num tengah">${angka(i.t)}</td>
        <td class="tengah">
          <span class="qty">
            <button type="button" data-minus data-target="#in_${i.id}">−</button>
            <input type="number" min="0" name="p_${i.id}" id="in_${i.id}" value="${Number(i.p) || 0}" data-qty>
            <button type="button" data-plus data-target="#in_${i.id}">+</button>
          </span>
        </td>
      </tr>`
    )
    .join('');

  const script = `
<script>
(function(){
  const base = window.APP_BASE || '';
  const sesiId = ${sesi.id};
  const body = document.getElementById('bodyJual');

  function nilai(inp){ const n = parseInt(inp.value, 10); return isNaN(n) || n < 0 ? 0 : n; }

  function segarkan(){
    let terisi = 0, qty = 0;
    body.querySelectorAll('tr[data-id]').forEach(function(tr){
      const inp = tr.querySelector('[data-qty]');
      const n = nilai(inp);
      tr.dataset.p = String(n);
      if (n > 0) terisi++;
      qty += n;
    });
    const elBaris = document.getElementById('netBaris');
    const elQty = document.getElementById('netQty');
    if (elBaris) elBaris.textContent = terisi + ' / ' + body.querySelectorAll('tr[data-id]').length;
    if (elQty) elQty.textContent = qty;
    const elBarisScan = document.getElementById('netBarisScan');
    const elQtyScan = document.getElementById('netQtyScan');
    if (elBarisScan) elBarisScan.textContent = terisi;
    if (elQtyScan) elQtyScan.textContent = qty;
    const tFoot = document.getElementById('tJual');
    if (tFoot) tFoot.textContent = qty;
  }

  document.addEventListener('input', function(ev){
    if (ev.target.dataset && ev.target.dataset.qty !== undefined) segarkan();
  });

  /* ---------- scan barcode: setiap tembakan = +1 jumlah terjual barang itu ---------- */
  window.onScanJual = function(d){
    if (!d.adaDiSesi || !document.getElementById('row_' + d.id)){
      SC.toast('Barang ini tidak ada di perjalanan ini — hanya barang yang dibawa yang bisa dijual', 'err');
      return;
    }
    const tr = document.getElementById('row_' + d.id);
    const inp = document.getElementById('in_' + d.id);
    /*
     * Baris yang DIKUNCI (ketuk nama barang 3×) tidak diubah oleh scan — sama seperti layar penginputan
     * lain (barang dibawa & rekap). Tanpa ini, scan tetap menambah angka pada baris yang sedang
     * dikunci sehingga penguncian baris tidak ada gunanya saat memakai scanner.
     */
    if (tr.classList.contains('terkunci')){
      const nm = tr.querySelector('.nm');
      const nama = nm ? nm.textContent.trim() : 'Baris ini';
      SC.toast(nama + ' TERKUNCI — ketuk nama barangnya 3× untuk membuka', 'info');
      document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> — baris ini TERKUNCI, ketuk nama barangnya 3× untuk membuka';
      return;
    }
    inp.value = nilai(inp) + 1;
    SC.flash(tr, true);
    document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> · ' + d.item.kode + ' — terjual: ' + inp.value;
    segarkan();
  };

  /* ---------- geser ke KANAN = popup pindah halaman (menyimpan dulu kalau diminta) ---------- */
  if (window.SC && typeof window.SC.geserHalaman === 'function') {
    window.SC.geserHalaman({
      tujuan: base + '/sesi/${sesi.id}',
      simpan: function(){
        const form = document.getElementById('formJual');
        if (!form) return;
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      },
    });
  }

  const bk = document.getElementById('btnKamera');
  if (bk) bk.addEventListener('click', function(){
    SC.scanKamera(function(kode){
      const inp = document.querySelector('[data-scan]');
      inp.value = kode;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, 'btnKamera');
  });

  segarkan();
})();
</script>`;

  const isi = `
${kepalaPerjalanan(sesi, `<span class="pjl-extra">Penjualan</span>`)}
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<form method="post" action="${base}/sesi/${sesi.id}/jual" id="formJual">
<div class="mode-area mode-daftar" id="areaJual">
  <div class="card">
    <div class="input-kepala">
      <h2 class="input-judul">Barang terjual</h2>
      <div class="input-baris-alat">
        <div class="input-net">
          <div>Baris terisi<b id="netBaris">0</b></div>
          <div>Total qty<b id="netQty">0</b></div>
        </div>
        <div class="input-alat">
          ${modePilih({ area: '#areaJual', fokusDaftar: '#cariDaftar', fokusScan: '#scanInput' })}
        </div>
      </div>
    </div>

    <div class="cari-box">
      <input type="search" id="cariDaftar" data-filter="#tblJual" placeholder="Cari nama / kode barang… (F2)">
    </div>

    <div class="tbl-wrap" style="max-height:62vh;overflow:auto">
      <table class="tbl rapat tbl-pekat kolom-beku" id="tblJual">
        <thead>
          <tr><th class="beku">Nama Barang</th><th class="num tengah">B</th><th class="num tengah">T</th><th class="tengah">P</th></tr>
        </thead>
        <tbody id="bodyJual">${baris || '<tr><td colspan="4" class="kosong">Belum ada barang yang dibawa di perjalanan ini.</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td class="beku">TOTAL</td>
            <td class="num tengah">${angka(tot.b)}</td>
            <td class="num tengah">${angka(tot.t)}</td>
            <td class="tengah" id="tJual">${angka(tot.p)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="aksi-row aksi-dua aksi-satu" style="margin-top:18px">
      <button class="btn btn-primary btn-lg" type="submit" id="btnSimpanJual">${esc(labelSimpan)}</button>
    </div>
  </div>

  <div class="card scan-card panel-scan">
    <h2 class="card-title">Scan Barcode</h2>
    <input class="scan-input" id="scanInput" data-scan data-sesi="${sesi.id}" data-onmatch="onScanJual" placeholder="SCAN / KETIK KODE" autocomplete="off">
    <div class="scan-info" id="scanInfo">Scan barang yang terjual — jumlahnya langsung bertambah.</div>
    <div class="scan-net">
      <div>Baris terisi<b id="netBarisScan">0</b></div>
      <div>Total qty<b id="netQtyScan">0</b></div>
      <div>Hasil scan<b id="netKedua">0</b></div>
    </div>
    <div id="kameraWrap"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px" id="btnKamera" type="button">Scan pakai Kamera HP</button>
  </div>
</div>
</form>

<!-- Kartu keterangan penginputan (pola yang sama dengan layar tambahan): di BAWAH form, dilipat dulu. -->
<details class="card entri-kepala mepet" id="kepalaEntri">
  <summary class="entri-sum">
    <span class="entri-sum-judul">Penginputan penjualan</span>
    <span class="entri-sum-meta">${esc(noSurat(sesi))} · ${esc(sesi.sales_nama || '-')}</span>
    <span class="entri-sum-toggle">Detail</span>
  </summary>
  <div class="entri-isi">
    <div class="entri-info">
      <div><span class="label">Diisi oleh</span><b>${esc(petugas || '-')}</b></div>
      <div><span class="label">Selisih penjualan (S − P)</span><b>${angka(selisihJual(tot))}</b></div>
      <div><span class="label">Selisih barang (B + T − K − S)</span><b>${angka(selisihBarang(tot))}</b></div>
    </div>
  </div>
</details>`;

  return { isi, script };
};
