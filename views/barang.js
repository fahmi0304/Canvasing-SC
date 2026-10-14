'use strict';
const { esc, angka } = require('../lib/util');
const { menuBaris } = require('./menu-baris');
const { GARIS, PRINTER } = require('./ikon');

/** Ikon tambah (plus) & edit (pensil) untuk tombol kepala halaman. */
const PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" class="ikon-kepala"><path d="M12 5v14M5 12h14"/></svg>`;
/** Ikon rekap stok (tabel dengan centang) untuk tombol kepala halaman Inventory. */
const IKON_STOK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M9 9v11"/><path d="M12.5 13.4l1.6 1.6 3-3"/></svg>`;

/**
 * Tombol kepala halaman Inventory (permintaan user):
 * Tambah Barang (dua pilihan: impor Excel / satu-satu), Cetak (barcode & printer), Edit barang keseluruhan.
 * Permintaan user (revisi ke-160): aksi **Rekap Stok dipindah KE DALAM ikon garis tiga** (bukan lagi
 * tombol sendiri di baris kepala) — jadi isi menu itu: Rekap Stok · Impor dari Excel · Tambah Barang
 * (satu-satu) · Edit Barang (keseluruhan) · Tampilkan/sembunyikan barang diarsip.
 */
function tombolKepala({ base, tampilArsip = false, jumlahArsip = 0 }) {
  return `<div class="inv-alat">
  <div class="ttk" data-ttk>
    <button class="ttk-tombol" type="button" data-ttk-buka aria-haspopup="true" aria-expanded="false" aria-label="Barang: rekap stok, tambah, edit, &amp; arsip">
      ${GARIS}
    </button>
    <div class="ttk-menu" data-ttk-menu role="menu">
      <div class="ttk-kepala">Barang</div>
      <a role="menuitem" href="${base}/rekap-stok"><span class="ttk-ikon">${IKON_STOK}</span><span>Rekap Stok<small>pilih barang — stok tiap sales, fisik, Kledo, selisih</small></span></a>
      <a role="menuitem" href="${base}/impor"><span class="ttk-ikon">▤</span><span>Impor dari Excel<small>unggah .xlsx/.csv daftar barang</small></span></a>
      <a role="menuitem" href="${base}/barang/baru"><span class="ttk-ikon">＋</span><span>Tambah Barang (satu-satu)<small>isi nama, kode SKU dibuat otomatis</small></span></a>
      <a role="menuitem" href="${base}/barang/edit"><span class="ttk-ikon">✎</span><span>Edit Barang (keseluruhan)<small>ganti nama, susun kode, atau hapus barang</small></span></a>
      ${tombolArsip({ base, tampilArsip, jumlahArsip })}
    </div>
  </div>
  <div class="ttk" data-ttk>
    <button class="ttk-tombol" type="button" data-ttk-buka aria-haspopup="true" aria-expanded="false" aria-label="Cetak barcode &amp; printer">
      ${PRINTER}
    </button>
    <div class="ttk-menu" data-ttk-menu role="menu">
      <div class="ttk-kepala">Cetak Barcode &amp; Printer</div>
      <a role="menuitem" href="${base}/label"><span class="ttk-ikon">▥</span><span>Cetak Barcode / QR (A4 / F4)<small>kertas biasa, hasil vektor tajam</small></span></a>
      <a role="menuitem" href="${base}/thermal"><span class="ttk-ikon">🖨</span><span>Hubungkan Printer Bluetooth<small>printer thermal — cetak label langsung</small></span></a>
    </div>
  </div>
  <a class="btn btn-primary" href="${base}/barang/baru">
    ${PLUS}<span>Tambah Barang</span>
  </a>
</div>`;
}

/**
 * Tombol memunculkan / menyembunyikan barang yang diarsip (permintaan user).
 * Barang ber-arsip = barang yang sudah punya transaksi (tidak boleh dihapus).
 */
function tombolArsip({ base, tampilArsip, jumlahArsip }) {
  // permintaan user: tombol "Barang diarsip" diletakkan di dalam ikon garis tiga
  return tampilArsip
    ? `<a role="menuitem" class="ttk-arsip aktif" href="${base}/barang"><span class="ttk-ikon">🗄</span><span>Sembunyikan barang diarsip<small>kembali ke daftar barang aktif</small></span></a>`
    : `<a role="menuitem" class="ttk-arsip" href="${base}/barang?arsip=1"><span class="ttk-ikon">🗄</span><span>Tampilkan barang diarsip (${angka(jumlahArsip)})<small>barang yang sudah ada transaksi</small></span></a>`;
}

/**
 * NAMA BARANG = tombol RINCIAN PEMBAWA (permintaan user terbaru: *"Munculkan rincian yang membawa Saat
 * nama barang di klik saja"*, dengan keputusan pemilik aplikasi: kolom "Dibawa oleh" DIHAPUS dari tabel
 * dan rinciannya cukup muncul sebagai **popup saat nama barang diklik**; jalan ke Rekap Stok tetap lewat
 * **menu aksi baris** — lihat opsi "Rekap Stok" di `opsi` pada `exports.daftar`).
 *
 * Markup-nya tetap `<a href="…/rekap-stok?barang=<id>">` (perilaku LAMA) sebagai **cadangan tanpa
 * JavaScript**, tetapi membawa `data-pembawa` (JSON daftar pembawa) + `data-barang` (nama) yang dipakai
 * handler klien `[data-pembawa]` (`public/app.js`) untuk menampilkan popup dan membatalkan navigasinya.
 */
function tombolNamaBarang(p, base, pembawa) {
  const orang = Array.isArray(pembawa) ? pembawa : [];
  const data = esc(JSON.stringify(orang.map((o) => ({ s: String(o.sales || ''), q: Number(o.qty) || 0 }))));
  return `<a class="barang-pilih" href="${base}/rekap-stok?barang=${Number(p.id)}"
    data-pembawa="${data}" data-barang="${esc(p.nama)}"
    title="Lihat siapa saja yang membawa barang ini"><b>${esc(p.nama)}</b></a>`;
}

exports.daftar = function ({ daftar, cari, base, pesan, jumlahSemua, bolehUbah = true, tampilArsip = false, jumlahArsip = 0, dipakai = [], pembawa = new Map() }) {
  const berTransaksi = new Set(dipakai.map(Number));
  /*
   * `pembawa` = Map(produkId → [{ sales, qty }]) dari `q.pemetaanPembawa()` (hanya surat jalan yang BELUM
   * selesai, jumlah B + T). Datanya TIDAK lagi dirender sebagai kolom tabel, melainkan ditempelkan ke
   * nama barang (`data-pembawa`) untuk popup rincian — permintaan user: *"Munculkan rincian yang membawa
   * Saat nama barang di klik saja"*.
   */
  const pembawaBarang = (p) => pembawa.get(Number(p.id)) || [];
  const baris = daftar
    .map(
      (p) => {
        const arsip = Number(p.arsip) === 1;
        const dipakaiTransaksi = berTransaksi.has(Number(p.id));
        /*
         * "Rekap Stok" = jalan menuju lembar Rekap Stok barang ini (permintaan user: setelah klik nama
         * barang memunculkan popup rincian pembawa, jalan ke Rekap Stok pindah ke menu aksi baris ini).
         * Ditaruh paling depan supaya mudah ditemukan.
         */
        const opsi = [
          { href: `${base}/rekap-stok?barang=${Number(p.id)}`, ikon: '▤', label: 'Rekap Stok', ket: 'stok tiap sales & isi hitungan fisik' },
          { href: `${base}/label?q=${encodeURIComponent(p.kode)}`, ikon: '▥', label: 'Cetak label', ket: 'barcode / QR barang ini' },
        ];
        if (bolehUbah) {
          if (arsip) {
            opsi.push({
              form: `${base}/barang/${p.id}/arsip`,
              ikon: '↺',
              label: 'Keluarkan dari arsip',
              ket: 'kembalikan ke daftar barang aktif',
              input: `<input type="hidden" name="arsip" value="0">`,
            });
          } else {
            opsi.push({ href: `${base}/barang/baru?id=${p.id}`, ikon: '✎', label: 'Ubah', ket: 'ganti nama / kode barang' });
            if (dipakaiTransaksi) {
              // sudah ada transaksi → TIDAK dihapus, tapi diarsipkan (permintaan user)
              opsi.push({
                form: `${base}/barang/${p.id}/arsip`,
                kelas: 'ttk-hapus',
                ikon: '🗄',
                label: 'Arsipkan',
                ket: 'sudah ada transaksi — tidak bisa dihapus',
                input: `<input type="hidden" name="arsip" value="1">`,
                attr: `data-konfirmasi-tema data-judul="Arsipkan barang?" data-pesan="Barang ${esc(p.kode)} · ${esc(p.nama)} sudah dipakai di transaksi, jadi tidak bisa dihapus. Barang akan diarsipkan (disembunyikan dari daftar, riwayat transaksi tetap utuh)." data-ok="Ya, arsipkan"`,
              });
            } else {
              opsi.push({
                form: `${base}/barang/${p.id}/hapus`,
                kelas: 'ttk-hapus',
                ikon: '🗑',
                label: 'Hapus',
                ket: 'belum ada transaksi — boleh dihapus',
                attr: `data-konfirmasi-tema data-judul="Hapus barang?" data-pesan="Barang ${esc(p.kode)} · ${esc(p.nama)} belum pernah dipakai di transaksi, jadi boleh dihapus permanen." data-ok="Ya, hapus"`,
              });
            }
          }
        }
        return `<tr data-kode="${esc(p.kode)}" data-nama="${esc(String(p.nama).toLowerCase())}" data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}"${arsip ? ' class="baris-arsip"' : ''}>
        <td class="kode">${esc(p.kode)}</td>
        <td>${tombolNamaBarang(p, base, pembawaBarang(p))}${arsip ? ' <span class="badge b-abu">diarsip</span>' : ''}${p.aktif ? '' : ' <span class="badge b-kuning">tidak ikut canvasing</span>'}</td>
        <td class="aksi-sel">${menuBaris({ judul: esc(p.kode) + ' · ' + esc(p.nama), opsi })}</td>
      </tr>`;
      }
    )
    .join('');

  return `
<div class="page-head">
  <div>
    <h1>Inventory</h1>
    <div class="sub">${angka(daftar.length)} barang${tampilArsip ? ' (termasuk yang diarsip)' : ''} dari ${angka(jumlahSemua)}. Kode memakai format <b>SKU-000</b>.${jumlahArsip && !tampilArsip ? ` Ada <b>${angka(jumlahArsip)}</b> barang diarsip — buka menu garis tiga untuk menampilkannya.` : ''}</div>
  </div>
  <div class="aksi">
    ${bolehUbah ? tombolKepala({ base, tampilArsip, jumlahArsip }) : '<span class="badge b-abu">Peran kamu hanya melihat data</span>'}
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="card">
  <div class="urut-baris">
    <input type="search" data-filter="#tblBarang" placeholder="Filter nama / kode barang…" style="max-width:340px">
    <!--
      Urut A–Z (permintaan user 2026-10-11: "buat filter khusus short a-z di tabel inventory").
      Tombolnya menyusun ulang baris tabel berdasarkan nama (bukan kode) — handler [data-urut-az]
      ada di public/app.js. Atribut aria-pressed menyatakan keadaannya; klik lagi = kembali ke urutan asli.
    -->
    <button class="btn btn-ghost btn-sm urut-az" type="button" data-urut-az data-urut="#tblBarang" aria-pressed="false" title="Urutkan nama barang A–Z">Urut A–Z</button>
    <!-- petunjuk singkat: nama barang bisa diklik untuk melihat berapa yang masih dibawa sales (revisi ke-159) -->
    <span class="hint hint-pilih">Klik <b>nama barang</b> untuk melihat <b>siapa saja yang masih membawa</b> barang itu beserta jumlahnya. Membuka halaman <b>Rekap Stok</b> bisa lewat menu aksi (garis tiga) pada barisnya.</span>
  </div>
  <div class="tbl-wrap" style="max-height:62vh;overflow:auto">
    <table class="tbl tbl-pekat" id="tblBarang">
      <thead><tr><th>Kode Barang (SKU)</th><th>Nama Barang</th><th class="aksi-sel">Aksi</th></tr></thead>
      <tbody>${baris || `<tr><td colspan="3" class="kosong">Belum ada barang. <a href="${base}/impor">Impor dari Excel</a> atau <a href="${base}/barang/baru">tambah satu-satu</a>${jumlahArsip && !tampilArsip ? ` — ada ${angka(jumlahArsip)} barang diarsip (<a href="${base}/barang?arsip=1">tampilkan</a>)` : ''}.</td></tr>`}</tbody>
    </table>
  </div>
</div>`;
};

/**
 * Halaman EDIT BARANG KESELURUHAN (permintaan user: "tombol edit untuk merubah barang keseluruhan").
 * Semua barang bisa diubah sekaligus (kode SKU, nama, aktif) + tombol menyusun ulang kode jadi SKU-001….
 */
exports.editSemua = function ({ daftar, base, pesan, bolehUbah = true, dipakai = [] }) {
  const berTransaksi = new Set(dipakai.map(Number));
  const baris = daftar
    .map(
      (p) => {
        const dipakaiTransaksi = berTransaksi.has(Number(p.id));
        return `<tr data-id="${p.id}" data-nama="${esc(p.nama)}"${dipakaiTransaksi ? ' data-arsipkan="1"' : ''}>
        <td class="td-kode"><input type="text" name="kode_${p.id}" value="${esc(p.kode)}" aria-label="Kode ${esc(p.nama)}"></td>
        <td><input type="text" name="nama_${p.id}" value="${esc(p.nama)}" aria-label="Nama barang"></td>
        <td class="aksi-sel">
          <input type="checkbox" name="${dipakaiTransaksi ? 'arsip' : 'hapus'}_${p.id}" value="1" data-hapus-baris hidden>
          <button class="btn-hapus-kecil" type="button" data-tandai-hapus="${p.id}"
            title="${dipakaiTransaksi ? 'Arsipkan (sudah ada transaksi)' : 'Hapus barang ini'}">${dipakaiTransaksi ? '🗄' : '&times;'}</button>
        </td>
      </tr>`;
      }
    )
    .join('');

  const script = `
<script>
document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-tandai-hapus]');
  if (!b) return;
  var tr = b.closest('tr');
  var sudah = tr.classList.toggle('baris-dihapus');
  var input = tr.querySelector('input[data-hapus-baris]');
  if (input) input.checked = sudah;
  b.setAttribute('title', sudah ? 'Batalkan hapus' : 'Hapus barang ini');
  b.textContent = sudah ? '↺' : '×';
  var info = document.getElementById('infoHapus');
  var semua = Array.from(document.querySelectorAll('tr.baris-dihapus'));
  var jmlHapus = semua.filter(function (tr) { return !tr.hasAttribute('data-arsipkan'); }).length;
  var jmlArsip = semua.length - jmlHapus;
  info.hidden = semua.length === 0;
  var bagian = [];
  if (jmlHapus) bagian.push('<b>' + jmlHapus + '</b> barang akan dihapus');
  if (jmlArsip) bagian.push('<b>' + jmlArsip + '</b> barang akan diarsipkan (sudah ada transaksi)');
  info.innerHTML = bagian.join(' · ') + '. Klik <b>Simpan</b> untuk melanjutkan.';
});
</script>`;

  return `
<div class="page-head">
  <div>
    <h1>Edit Barang Keseluruhan</h1>
    <div class="sub">Ganti nama barang, susun ulang kodenya (<b>SKU-000</b>), atau buang barang — semua bisa sekaligus. Barang yang <b>sudah ada transaksi diarsipkan</b>, yang belum ada transaksi dihapus.</div>
  </div>
  <div class="aksi"><a class="btn btn-ghost" href="${base}/barang">Kembali ke Inventory</a></div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<form method="post" action="${base}/barang/edit" id="formEditBarang">
<div class="card">
  <div class="aksi-row" style="margin-bottom:14px">
    <input type="search" data-filter="#tblEdit" placeholder="Filter nama / kode…" style="max-width:320px">
    <button class="btn btn-ghost btn-sm" type="submit" name="_aksi" value="sku"
      data-konfirmasi-tema data-judul="Susun ulang kode jadi SKU-001…?"
      data-pesan="Semua kode barang akan diganti berurutan menjadi SKU-001, SKU-002, dan seterusnya mengikuti urutan daftar. Label barcode yang lama perlu dicetak ulang." data-ok="Ya, susun ulang">
      Susun ulang kode → SKU-001…
    </button>
  </div>
  <div class="tbl-wrap" style="max-height:60vh;overflow:auto">
    <table class="tbl tbl-pekat" id="tblEdit">
      <thead><tr><th class="td-kode">Kode (SKU)</th><th>Nama Barang</th><th class="aksi-sel">Hapus / Arsip</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="3" class="kosong">Belum ada barang.</td></tr>'}</tbody>
    </table>
  </div>
  <div class="alert alert-warn" id="infoHapus" hidden style="margin-top:14px"></div>
  <div class="aksi-row" style="margin-top:16px">
    <button class="btn btn-primary btn-lg" type="submit" name="_aksi" value="simpan">Simpan Semua Perubahan</button>
    <a class="btn btn-ghost btn-lg" href="${base}/barang">Batal</a>
  </div>
</div>
</form>
${script}`;
};

exports.form = function ({ edit, base, kodeBerikut = '', bolehUbah = true }) {
  const p = edit || { kode: '', nama: '', aktif: 1 };
  return `
<div class="page-head">
  <div><h1>${edit ? 'Ubah Barang' : 'Tambah Barang'}</h1>
  <div class="sub">Isi nama barangnya saja — kode SKU dibuat otomatis (format <b>SKU-000</b>), boleh diganti manual.</div></div>
  <div class="aksi"><a class="btn btn-ghost" href="${base}/barang">Kembali ke Inventory</a></div>
</div>
<div class="card" style="max-width:620px">
  <form method="post" action="${base}/barang/simpan">
    ${edit ? `<input type="hidden" name="id" value="${edit.id}">` : ''}
    <div class="field">
      <label class="f">Nama barang *</label>
      <input type="text" name="nama" value="${esc(p.nama)}" required placeholder="mis. Prada H503 Symbol">
    </div>
    <div class="field">
      <label class="f">Kode SKU</label>
      <input type="text" name="kode" value="${esc(p.kode || kodeBerikut)}" placeholder="${esc(kodeBerikut || 'SKU-001')}">
      <div class="hint">Dikosongkan? Otomatis dipakai ${esc(kodeBerikut || 'SKU-001')} (format SKU + 3 digit).</div>
    </div>
    <div class="field">
      <label class="f">Masuk daftar canvasing?</label>
      <select name="aktif">
        <option value="1" ${p.aktif ? 'selected' : ''}>Ya (ikut daftar canvasing)</option>
        <option value="0" ${p.aktif ? '' : 'selected'}>Tidak</option>
      </select>
    </div>
    <div class="aksi-row">
      <button class="btn btn-primary btn-lg" type="submit">Simpan</button>
      <a class="btn btn-ghost btn-lg" href="${base}/barang">Batal</a>
    </div>
  </form>
</div>`;
};

exports.impor = function ({ base, pesan }) {
  const script = `
<script>
(function(){
  const base = window.APP_BASE || '';
  let data = null;
  const $ = (id) => document.getElementById(id);
  const GUESS = { kode: ['kode','sku','code','artikel','kd'], nama: ['nama','produk','barang','item','description'] };
  function isiPilihan(){
    ['kode','nama'].forEach(function(k){
      const sel = $('map_'+k);
      sel.innerHTML = '<option value="">— tidak ada —</option>' + data.headers.map(function(h,i){
        return '<option value="'+i+'">'+ (h || ('Kolom '+(i+1))) +'</option>';
      }).join('');
      let pilih = -1;
      data.headers.forEach(function(h,i){
        const t = String(h||'').toLowerCase();
        if (pilih === -1 && GUESS[k].some(function(g){ return t.includes(g); })) pilih = i;
      });
      if (pilih >= 0) sel.value = String(pilih);
    });
  }
  function preview(){
    $('prevHead').innerHTML = '<tr><th>Kode Barang</th><th>Nama Barang</th></tr>';
    $('prevBody').innerHTML = data.rows.slice(0, 8).map(function(r){
      return '<tr>' + ['kode','nama'].map(function(k){
        const i = $('map_'+k).value;
        return '<td>' + (i === '' ? '' : (r[Number(i)]||'')) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('prevWrap').style.display = '';
    $('infoJumlah').textContent = data.total + ' baris data terbaca (menampilkan ' + Math.min(8, data.rows.length) + ' baris pertama)';
  }
  $('berkas').addEventListener('change', async function(){
    const f = this.files[0];
    if (!f) return;
    $('status').textContent = 'Membaca ' + f.name + '…';
    const fd = new FormData();
    fd.append('berkas', f);
    try {
      const r = await fetch(base + '/api/impor/parse', { method:'POST', body: fd });
      const d = await r.json();
      if (!d.ok) { SC.toast(d.pesan, 'err'); $('status').textContent = ''; return; }
      data = d;
      $('status').textContent = 'Sheet dibaca: ' + d.sheet;
      isiPilihan(); preview();
      $('panel').style.display = '';
    } catch(e) { SC.toast('Gagal membaca berkas', 'err'); $('status').textContent = ''; }
  });
  ['kode','nama'].forEach(function(k){
    document.addEventListener('change', function(ev){ if (ev.target && ev.target.id === 'map_'+k) preview(); });
  });
  $('btnImpor').addEventListener('click', async function(){
    if (!data) return;
    if ($('map_nama').value === '') { SC.toast('Kolom Nama Barang wajib dipetakan', 'err'); return; }
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === 'ganti' && !(await SC.konfirmasi({ judul:'Ganti semua data barang?', pesan:'Semua barang lama akan dihapus dan diganti isi berkas ini.', ok:'Ya, ganti' }))) return;
    const mapping = {};
    ['kode','nama'].forEach(function(k){ mapping[k] = $('map_'+k).value; });
    $('btnImpor').disabled = true;
    $('btnImpor').textContent = 'Mengimpor…';
    try {
      const r = await fetch(base + '/api/impor/commit', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ rows: data.rows, mapping: mapping, mode: mode })
      });
      const d = await r.json();
      SC.toast(d.pesan, d.ok ? 'ok' : 'err');
      if (d.ok) setTimeout(function(){ location.href = base + '/barang'; }, 1200);
    } catch(e) { SC.toast('Gagal impor', 'err'); }
    $('btnImpor').disabled = false;
    $('btnImpor').textContent = 'Impor Sekarang';
  });
})();
</script>`;

  return {
    isi: `
<div class="page-head">
  <div><h1>Impor Data Barang dari Excel</h1>
  <div class="sub">Berkas .xlsx / .xls / .csv — baris pertama jadi judul kolom. Kolom <b>NAMA PRODUK</b> wajib; kolom kode opsional (kalau kosong dibuat otomatis <b>SKU-000</b>).</div></div>
  <div class="aksi"><a class="btn btn-ghost" href="${base}/barang">Kembali ke Inventory</a></div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
<div class="card">
  <h2 class="card-title-heading">1. Pilih berkas</h2>
  <p class="card-hint">Belum punya filenya? Unduh template di bawah, isi, lalu unggah kembali.</p>
  <div class="aksi-row" style="margin-bottom:14px">
    <a class="btn btn-ghost btn-sm" href="${base}/impor/template.xlsx">Unduh template Excel (.xlsx)</a>
    <a class="btn btn-ghost btn-sm" href="${base}/impor/template.csv">Unduh template CSV</a>
  </div>
  <input type="file" id="berkas" accept=".xlsx,.xls,.csv">
  <div class="hint" id="status"></div>
</div>

<div class="card" id="panel" style="display:none">
  <h2 class="card-title-heading">2. Petakan kolom</h2>
  <p class="card-hint" id="infoJumlah"></p>
  <div class="grid grid-2">
    <div class="field"><label class="f">Nama Barang *</label><select id="map_nama"></select></div>
    <div class="field"><label class="f">Kode Barang</label><select id="map_kode"></select></div>
  </div>
  <div class="field">
    <label class="f">Cara impor</label>
    <label style="display:block;font-weight:500;margin-bottom:6px"><input type="radio" name="mode" value="upsert" checked> Tambah barang baru &amp; perbarui yang namanya sama (aman)</label>
    <label style="display:block;font-weight:500"><input type="radio" name="mode" value="ganti"> Ganti semua data barang dengan isi berkas ini</label>
  </div>
  <div class="tbl-wrap" id="prevWrap" style="margin-bottom:16px">
    <table class="tbl tbl-pekat"><thead id="prevHead"></thead><tbody id="prevBody"></tbody></table>
  </div>
  <button class="btn btn-primary btn-lg" id="btnImpor" type="button">Impor Sekarang</button>
</div>`,
    script,
  };
};
