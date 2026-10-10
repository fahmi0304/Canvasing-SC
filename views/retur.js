'use strict';
const { esc, angka } = require('../lib/util');
const { modePilih } = require('./mode');
const { noSurat } = require('../lib/kode');

/**
 * HALAMAN KHUSUS RETUR / PENGEMBALIAN BARANG (permintaan user):
 *   "tambah ikon khusus retur atau pengembalian dengan tulisan retur di ikon beserta simbolnya, ketika di
 *    klik, langsung menuju halaman khusus mengimput barang yang akan di retur … hanya barang yang sedang
 *    dibawa (kolom B) yang bisa diretur, dengan kolom B berkurang"
 *
 * Isinya sengaja dipisah dari layar tambahan supaya jelas: yang dapat diretur HANYA barang yang masih
 * dibawa (kolom B > 0) pada perjalanan ini. Menyimpan akan membuat satu ENTRI terkunci
 * (`tambahan_batch.sumber = 'kembali-gudang'`), mengurangi kolom B, menambah catatan otomatis
 * "… mengembalikan barang ke gudang sebanyak N pcs (dicatat oleh NAMA)", dan memonya bisa dilihat
 * (judul memonya "MEMO PENGEMBALIAN BARANG").
 */
exports.render = function ({ sesi, items, base, pesan }) {
  const totalB = items.reduce((a, i) => a + (i.b || 0), 0);

  const baris = items
    .map(
      (i) => `<tr class="barang" id="row_${i.id}" data-id="${i.id}" data-b="${i.b}" data-cari="${esc(
        (i.kode + ' ' + i.nama).toLowerCase()
      )}">
        <td class="beku"><span class="nm">${esc(i.nama)}</span></td>
        <td class="num dibawa" data-b="${i.b}">${angka(i.b)}</td>
        <td class="tengah">
          <span class="qty">
            <button type="button" data-minus data-target="#in_${i.id}">−</button>
            <input type="number" min="0" max="${i.b}" step="1" name="r_${i.id}" id="in_${i.id}" value="0"
              data-qty data-maks="${i.b}">
            <button type="button" data-plus data-target="#in_${i.id}">+</button>
          </span>
        </td>
      </tr>`
    )
    .join('');

  const isi = `
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<form method="post" action="${base}/sesi/${sesi.id}/retur" id="formRetur" class="mepet">
<div class="mode-area mode-daftar" id="areaRetur">
  <div class="card">
    <!--
      Permintaan user: judul "Barang yang akan diretur" DIHAPUS, dan ringkasannya dibuat 3 KOLOM
      (Jenis · Total retur · Dibawa) yang lebarnya sama; ikon cara penginputan duduk di kolom ke-4
      pada baris yang sama, jadi ada 4 kolom sejajar dengan tinggi seragam.
    -->
    <div class="input-kepala retur-kepala">
      <div class="info-kotak tiga">
        <div class="kotak-info"><div class="label">Jenis</div><div class="value" id="netBaris">0</div></div>
        <div class="kotak-info"><div class="label">Total retur</div><div class="value" id="netQty">0</div></div>
        <div class="kotak-info"><div class="label">Dibawa</div><div class="value">${angka(totalB)}</div></div>
      </div>
      <div class="input-alat">
        ${modePilih({ area: '#areaRetur', fokusDaftar: '#cariRetur', fokusScan: '#scanRetur' })}
      </div>
    </div>

    <!-- Peringatan menetap: muncul selama ada jumlah yang dibatasi (tidak hanya toast sekilas). -->
    <div class="peringatan-retur" id="peringatanRetur" hidden></div>

    <div class="cari-box">
      <input type="search" id="cariRetur" placeholder="Cari nama / kode barang… (F2)">
    </div>

    <div class="tbl-wrap">
      <table class="tbl rapat tbl-pekat kolom-beku" id="tblRetur">
        <thead>
          <tr><th class="beku">Nama Barang</th><th class="num kolom-b">B</th><th class="tengah">Jumlah Retur</th></tr>
        </thead>
        <tbody id="bodyRetur">${
          baris ||
          `<tr><td colspan="3" class="kosong">Tidak ada barang yang sedang dibawa di perjalanan ini.</td></tr>`
        }</tbody>
      </table>
    </div>

    <div class="aksi-row aksi-dua" style="margin-top:12px">
      <button class="btn btn-primary btn-lg" type="submit" id="btnSimpanRetur" name="_aksi" value="simpan">Simpan Retur &amp; Kunci</button>
      <button class="btn btn-ghost btn-lg" type="submit" name="_aksi" value="tetap">Simpan &amp; Tetap di Sini</button>
    </div>
  </div>

  <div class="card scan-card panel-scan">
    <h2 class="card-title">Scan Barcode</h2>
    <input class="scan-input" id="scanRetur" data-scan data-sesi="${sesi.id}" data-onmatch="onScanRetur"
      placeholder="SCAN / KETIK KODE" autocomplete="off">
    <div class="scan-info" id="scanInfo">Scan barang yang akan diretur — jumlahnya langsung bertambah.</div>
    <div class="scan-net">
      <div>Jenis<b id="netBarisScan">0</b></div>
      <div>Total retur<b id="netQtyScan">0</b></div>
    </div>
    <div id="kameraWrap"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px" id="btnKamera" type="button">Scan pakai Kamera HP</button>
  </div>
</div>
</form>`;

  const script = `
<script>
(function(){
  const body = document.getElementById('bodyRetur');
  const elCari = document.getElementById('cariRetur');
  const form = document.getElementById('formRetur');
  if (!body) return;

  function nilai(inp){ return parseInt(inp && inp.value, 10) || 0; }
  function barisSemua(){ return Array.from(body.querySelectorAll('tr.barang')); }
  /** Jumlah retur tidak boleh melebihi barang yang sedang dibawa (kolom B). */
  /**
   * Jumlah retur TIDAK boleh melebihi barang yang dibawa (kolom B).
   * Permintaan user: "pop up tidak muncul saat barang yang diretur lebih, namun angka tetap tidak boleh
   * bertambah hingga lebih dari barang b" → angkanya dibatasi (klamp) DAN diberi pemberitahuan yang
   * mudah terlihat: toast + baris peringatan menetap (#peringatanRetur) yang berisi nama barangnya,
   * jadi tidak hanya pesan sekilas yang mudah terlewat.
   */
  let pesanTerakhir = '';
  /** @returns {boolean} true kalau nilainya TADI melebihi batas lalu dipotong (jadi ada pelanggaran). */
  function batasi(inp){
    const maks = parseInt(inp.dataset.maks, 10) || 0;
    let v = nilai(inp);
    if (v < 0) v = 0;
    let dipotong = false;
    if (v > maks){
      v = maks;
      dipotong = true;
      const nama = (function(){ const tr = inp.closest('tr'); const nm = tr && tr.querySelector('.nm'); return nm ? nm.textContent.trim() : 'Barang'; })();
      const pesan = nama + ': jumlah retur dibatasi ' + maks + ' (sesuai barang yang dibawa)';
      // Permintaan user: "pop up di halaman retur masih muncul" → TIDAK memakai toast lagi; cukup baris
      // peringatan menetap di atas daftar (#peringatanRetur) yang ikut hilang saat angkanya diturunkan.
      pesanTerakhir = pesan;
      tampilPeringatan(pesan);
    }
    if (String(inp.value) !== String(v)) inp.value = String(v);
    return dipotong;
  }
  /** Baris peringatan menetap di atas daftar (disembunyikan lagi kalau tidak ada yang dibatasi). */
  function tampilPeringatan(teks){
    const p = document.getElementById('peringatanRetur');
    if (!p) return;
    if (teks){ p.textContent = teks; p.hidden = false; }
    else { p.textContent = ''; p.hidden = true; pesanTerakhir = ''; }
  }
  function segarkan(){
    let barisIsi = 0, qty = 0;
    barisSemua().forEach(function(tr){
      const v = nilai(tr.querySelector('[data-qty]'));
      if (v > 0){ barisIsi++; qty += v; }
    });
    const a = document.getElementById('netBaris'), b = document.getElementById('netQty');
    if (a) a.textContent = barisIsi;
    if (b) b.textContent = qty;
    const c = document.getElementById('netBarisScan'), d = document.getElementById('netQtyScan');
    if (c) c.textContent = barisIsi;
    if (d) d.textContent = qty;
  }
  function saring(){
    const kata = (elCari && elCari.value || '').trim().toLowerCase();
    barisSemua().forEach(function(tr){
      tr.hidden = !!kata && (tr.dataset.cari || '').indexOf(kata) === -1;
    });
  }
  if (elCari){
    elCari.addEventListener('input', saring);
    // Enter di kotak cari tidak mengirim form (scanner yang salah fokus tidak menyimpan)
    elCari.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') ev.preventDefault(); });
  }
  body.addEventListener('input', function(ev){
    const inp = ev.target.closest('[data-qty]');
    if (!inp) return;
    // memunculkan peringatan HANYA kalau nilainya tadi melebihi batas; angka yang sah (termasuk yang
    // tepat sama dengan B) langsung membersihkan peringatannya
    if (!batasi(inp)) tampilPeringatan('');
    segarkan();
  });
  body.addEventListener('click', function(ev){
    const b = ev.target.closest('[data-plus],[data-minus]');
    if (!b) return;
    const inp = document.querySelector(b.dataset.target);
    if (inp) setTimeout(function(){
      if (!batasi(inp)) tampilPeringatan('');
      segarkan();
    }, 0);
  });
  form.addEventListener('submit', function(ev){
    const total = barisSemua().reduce(function(a, tr){ return a + nilai(tr.querySelector('[data-qty]')); }, 0);
    if (total <= 0){
      ev.preventDefault();
      SC.toast('Belum ada jumlah barang yang akan diretur', 'err');
    }
  });

  /*
   * ---------- geser ke KANAN = PINDAH HALAMAN dengan konfirmasi ----------
   * permintaan user: "Saat berada pada halaman pengimputan, tambahan barang, retur, rekap, buat perjalanan
   * baru, ketika menggeser tidak langsung pindah halaman, namun muncul pop up yang menanyakan, tetap di
   * halaman, pindah ke halaman lain dan simpan hasil imput" — mekanismenya di public/app.js
   * (SC.geserHalaman). Di sini: tujuan halaman perjalanan, "simpan" = kirim form retur (kolom yang masih
   * kosong akan ditolak popup validasi server seperti tombol Simpan biasa).
   */
  if (window.SC && typeof window.SC.geserHalaman === 'function') {
    window.SC.geserHalaman({
      // tujuan diselesaikan SERVER saat render (skrip klien tidak punya variabel base/sesi)
      tujuan: '${base}/sesi/${sesi.id}',
      simpan: function(){
        const f = document.getElementById('formRetur');
        if (!f) return;
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = '_aksi';
        inp.value = 'simpan';
        f.appendChild(inp);
        if (typeof f.requestSubmit === 'function') f.requestSubmit();
        else f.submit();
      },
    });
  }

  /** Scan barcode: hanya barang yang SEDANG DIBawa yang bisa diretur. */
  window.onScanRetur = function(d){
    const tr = document.getElementById('row_' + d.id);
    const inp = document.getElementById('in_' + d.id);
    if (!d.adaDiSesi || !tr || !inp){
      SC.toast('Barang ini tidak ada di perjalanan ini', 'err');
      document.getElementById('scanInfo').innerHTML =
        '<b>' + (d.item ? d.item.nama : 'Barang') + '</b> — tidak ada di perjalanan ini';
      return;
    }
    if (tr.classList.contains('terkunci')){
      SC.toast('Baris ini TERKUNCI — ketuk nama barangnya 3× untuk membuka', 'info');
      document.getElementById('scanInfo').innerHTML =
        '<b>' + d.item.nama + '</b> — baris ini TERKUNCI, ketuk nama barangnya 3× untuk membuka';
      return;
    }
    const maks = parseInt(inp.dataset.maks, 10) || 0;
    if (maks <= 0){
      SC.toast('Barang ini tidak sedang dibawa (B = 0) — tidak bisa diretur', 'err');
      document.getElementById('scanInfo').innerHTML =
        '<b>' + d.item.nama + '</b> · ' + d.item.kode + ' — tidak sedang dibawa, tidak bisa diretur';
      return;
    }
    inp.value = Math.min(maks, nilai(inp) + 1);
    SC.flash(tr, true);
    document.getElementById('scanInfo').innerHTML =
      '<b>' + d.item.nama + '</b> · ' + d.item.kode + ' — retur: ' + inp.value + ' dari ' + maks + ' dibawa';
    segarkan();
  };

  const bk = document.getElementById('btnKamera');
  if (bk) bk.addEventListener('click', function(){
    SC.scanKamera(function(kode){
      const inp = document.querySelector('[data-scan]');
      inp.value = kode;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, 'btnKamera');
  });

  segarkan();
  saring();
})();
</script>`;

  return { isi, script, judul: `Retur Barang · ${noSurat(sesi)}` };
};
