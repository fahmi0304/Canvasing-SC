'use strict';
const { esc, angka, tanggalPendek, tanggalPanjang } = require('../lib/util');
const { badge } = require('./layout');
const { ikonPdf } = require('./cetak');
const { menuBaris, attrBarisKlik, opsiUndo } = require('./menu-baris');
const { FILTER, KALENDER, ORANG, LAPORAN } = require('./ikon');
const { noSurat } = require('../lib/kode');
const { kartuGrafik } = require('./grafik');
/*
 * `?v=` pada tautan PDF F4 = waktu ubah templat dokumen (lib/versiDokumen.js) supaya penampil PDF di
 * ponsel tidak menyajikan berkas LAMA untuk alamat yang sama.
 */
const { VERSI_DOKUMEN } = require('../lib/versiDokumen');

/**
 * Tombol FILTER TANGGAL (ikon kalender). Dipakai di halaman laporan per sales
 * (permintaan user: "pilihan tanggal diubah ke tombol kalender yang setelah diklik
 * baru memunculkan pilihan tanggal"). Handler `[data-kalender-buka]` ada di `public/app.js`.
 */
function tombolKalender({ base, action, dari = '', sampai = '', tombolKanan = '', ringkas = false, sales = '', daftarSales = [] }) {
  const opsiSales = `<select name="sales" aria-label="Filter sales">
      <option value="">— semua sales —</option>
      ${daftarSales.map((x) => `<option value="${esc(x.nama)}"${sales.toLowerCase() === String(x.nama).toLowerCase() ? ' selected' : ''}>${esc(x.nama)}</option>`).join('')}
    </select>`;
  return `<div class="kalender${ringkas ? ' ringkas' : ''}" data-kalender>
  <button class="${ringkas ? 'ttk-tombol' : 'btn btn-ghost'}" type="button" data-kalender-buka aria-expanded="false" aria-controls="panelKalender" title="Filter tanggal" aria-label="Filter tanggal">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="ikon-kalender">
      <rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>
    </svg>
    ${ringkas ? '' : '<span>Filter Tanggal</span>'}
  </button>
  <form class="kalender-panel" id="panelKalender" method="get" action="${base}${esc(action)}" data-kalender-panel hidden>
    <div class="field"><label class="f">Dari tanggal</label><input type="date" name="dari" value="${esc(dari || '')}"></div>
    <div class="field"><label class="f">Sampai tanggal</label><input type="date" name="sampai" value="${esc(sampai || '')}"></div>
    ${daftarSales.length || sales ? `<div class="field field-lebar"><label class="f">Sales</label>${opsiSales}</div>` : ''}
    <div class="kalender-aksi">
      <button class="btn btn-primary btn-sm" type="submit">Tampilkan</button>
      <a class="btn btn-ghost btn-sm" href="${base}${esc(action)}">Reset</a>
      ${tombolKanan}
    </div>
  </form>
</div>`;
}

/**
 * TOMBOL nama sales di tabel Laporan (permintaan user 2026-10-11): "buat filter khusus nama sales di
 * tabel pada halaman laporan yang ketika di klik menampilkan laporan sales itu saja di tabel".
 *
 * Nama sales di sel `td-sales` jadi tombol; handler `[data-sales-pilih]` ada di `public/app.js`
 * (`pasangSaringSales`) dan menyaring baris `#tblLaporan` lewat atribut `data-sales` pada tiap `<tr>`
 * (dibandingkan tanpa membedakan huruf besar/kecil). Menekan nama yang SAMA lagi = melepas saringannya.
 *
 * Sengaja memakai `<button>` (bukan `<b>`): elemen tombol masuk daftar ABAIKAN di `pasangKlikBaris()`,
 * jadi mengklik nama sales TIDAK ikut membuka laporan perjalanan (perilaku klik baris tetap utuh).
 */
function tombolSaringSales(nama) {
  const teks = String(nama || '').trim() || '-';
  return `<button class="sales-pilih" type="button" data-sales-pilih="${esc(teks)}" title="Tampilkan hanya laporan ${esc(teks)}" aria-label="Tampilkan hanya laporan ${esc(teks)}">${esc(teks)}</button>`;
}

/** Bilah keterangan saringan sales + tombol pelepasnya (tersembunyi selama belum ada saringan). */
function bilahSaringSales() {
  return `<div class="saring-sales" data-saring-sales data-saring-target="#tblLaporan" hidden>
  <span>Saring nama sales: <b data-saring-nama></b> <span class="saring-jumlah" data-saring-jumlah></span></span>
  <button class="btn btn-ghost btn-sm" type="button" data-saring-batal>Semua sales</button>
</div>`;
}

/**
 * Menu tiga garis di samping judul "Laporan Penjualan" (permintaan user):
 * berisi Filter Tanggal · Filter Sales · Cetak.
 */
function menuTigaBaris({ base, daftarSales = [], dari = '', sampai = '', sales = '' }) {
  const opsiSales = [
    `<option value="">— semua sales —</option>`,
    ...daftarSales.map((s) => `<option value="${esc(s.nama)}"${sales.toLowerCase() === String(s.nama).toLowerCase() ? ' selected' : ''}>${esc(s.nama)}</option>`),
  ].join('');

  return `<div class="lapor-menu" data-lapor>
  <button class="ttk-tombol" type="button" data-lapor-buka aria-haspopup="true" aria-expanded="false" aria-controls="laporPanel" aria-label="Filter tanggal &amp; sales" title="Filter tanggal &amp; sales">
    ${FILTER}
  </button>
  <div class="lapor-panel" id="laporPanel" data-lapor-panel role="menu" hidden>
    <form class="lapor-blok" method="get" action="${base}/laporan/sales">
      <div class="lapor-judul"><span class="lapor-ikon-judul">${KALENDER}</span>Filter Tanggal</div>
      <div class="lapor-baris">
        <label class="f">Dari<input type="date" name="dari" value="${esc(dari || '')}"></label>
        <label class="f">Sampai<input type="date" name="sampai" value="${esc(sampai || '')}"></label>
      </div>
      <input type="hidden" name="sales" value="${esc(sales || '')}">
      <button class="btn btn-primary btn-sm" type="submit">Tampilkan periode</button>
    </form>
    <form class="lapor-blok" method="get" action="${base}/laporan/sales">
      <div class="lapor-judul"><span class="lapor-ikon-judul">${ORANG}</span>Filter Sales</div>
      <select name="sales">${opsiSales}</select>
      <input type="hidden" name="dari" value="${esc(dari || '')}">
      <input type="hidden" name="sampai" value="${esc(sampai || '')}">
      <button class="btn btn-primary btn-sm" type="submit">Tampilkan sales</button>
    </form>
  </div>
</div>`;
}

/** Halaman hub Laporan */
exports.hub = function ({ base, pesan, daftar, jumlahBarang, jumlahSales, daftarSales = [], bolehUbah = true, bolehHapus = false }) {
  const baris = daftar
    .map((s) => {
      /*
       * permintaan user: "Pada halaman laporan, tombol aksi di laporan selesai hanya menampilkan
       * overview, cetak surat jalan lengkap, dan hapus, hanya administrator yang bisa menghapus".
       * Jadi laporan yang SUDAH SELESAI punya menu PALING RINGKAS: Overview · Cetak Surat Jalan
       * Lengkap (F4) · Hapus. Dua opsi cetak lain (surat jalan & setoran yang kolom K/S-nya masih
       * kosong, serta memo pengambilan) sengaja TIDAK ditawarkan untuk baris selesai karena
       * dokumen lengkapnya sudah memuat semuanya — jangan dihidupkan lagi tanpa permintaan user.
       * Pengaturan "Hapus" tetap `bolehHapus` = administrator saja (lihat server.js).
       */
      const selesai = s.status === 'selesai';
      const opsiBaris = [
        /*
         * permintaan user: "Tombol overview di dasbor dan laporan hapus, fungsinya pindah ke klik baris
         * laporannya" → opsi "Overview" DIHAPUS (laporan perjalanan dibuka dengan mengklik barisnya:
         * `attrBarisKlik()` di menu-baris.js + `pasangKlikBaris()` di public/app.js).
         *
         * Opsi "Buka" tetap ada HANYA untuk baris draft: baris draft tidak punya laporan dan tidak punya
         * opsi cetak, jadi tanpa ini menu baris draft bisa KOSONG (peran yang tidak boleh menghapus tidak
         * punya opsi apa pun) sehingga tombol garis tiganya tidak berguna — dulu keputusan user.
         */
        ...(s.status === 'draft'
          ? [{ href: `${base}/sesi/${s.id}`, ikon: '▸', label: 'Buka', ket: 'Lanjutkan alur perjalanan' }]
          : []),
        /*
         * Permintaan user terbaru: "Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak
         * PDF saja, 1 ikon" → tiap baris hanya punya SATU opsi cetak berupa berkas PDF (dibuka di
         * penampil PDF tab baru lewat `data-pdf-buka`): laporan lengkap untuk baris selesai, surat jalan
         * & setoran untuk baris kirim/rekap. Dua opsi cetak lain (K/S masih kosong + memo) tetap tidak
         * ditawarkan untuk baris selesai karena dokumen lengkapnya sudah memuat semuanya.
         */
        ...(s.status === 'draft'
          ? []
          : [
              {
                href: `${base}${selesai ? `/cetak/laporan-pdf/${s.id}` : `/cetak/surat-jalan-pdf/${s.id}`}?v=${VERSI_DOKUMEN}`,
                target: true,
                attr: 'data-pdf-buka',
                ikon: '🖨',
                label: selesai ? 'PDF Laporan Lengkap (F4)' : 'PDF Surat Jalan & Setoran (F4)',
                ket: 'terbuka di penampil PDF · 1 halaman F4',
              },
            ]),
        /*
         * permintaan user: "Hapus semua opsi print cetak memo kosong" → memo hanya kalau ada barang
         * tambahan (T > 0) dan SELALU versi terisi; sekarang berkas PDF-nya (`/cetak/memo-pdf/…`).
         */
        ...(s.status === 'draft' || selesai || !(Number(s.tot_t) > 0)
          ? []
          : [{ href: `${base}/cetak/memo-pdf/${s.id}`, target: true, attr: 'data-pdf-buka', ikon: '🖨', label: 'PDF Memo Pengambilan', ket: 'terbuka di penampil PDF · struk thermal 58 mm' }]),
      ];
      /*
       * UNDO untuk administrator (permintaan user: "Administrator bisa meng undo surat jalan") — satu
       * langkah: Selesai → Sedang Rekap, Sedang Rekap → Ongoing, Ongoing → Draft. Ditempatkan SEBELUM
       * "Hapus laporan" supaya opsi yang tidak merusak data muncul lebih dulu.
       */
      if (bolehHapus) {
        const undo = opsiUndo(s, base, '/laporan');
        if (undo) opsiBaris.push(undo);
        opsiBaris.push({
          form: `${base}/sesi/${s.id}/hapus`,
          kelas: 'ttk-hapus',
          ikon: '🗑',
          label: 'Hapus laporan',
          ket: 'Hapus perjalanan ini beserta inputannya',
          input: `<input type="hidden" name="balik" value="/laporan">`,
          attr: `data-konfirmasi-tema data-judul="Hapus laporan perjalanan?" data-pesan="Surat jalan ${esc(noSurat(s))} (${esc(s.sales_nama || '-')}, ${esc(tanggalPendek(s.tanggal))}) beserta seluruh inputannya akan dihapus. Tindakan ini tidak bisa dibatalkan." data-ok="Ya, hapus"`,
        });
      }
      return `<tr data-status="${esc(s.status)}" data-sales="${esc(String(s.sales_nama || '-'))}"${attrBarisKlik(s, base)}>
        <td class="td-tanggal"><div class="tgl">${esc(tanggalPendek(s.tanggal))}</div></td>
        <td class="td-sales">${tombolSaringSales(s.sales_nama)}<span class="status-isi">${badge(s)}</span></td>
        <td class="aksi-sel">${menuBaris({ judul: `${noSurat(s)} · ${s.sales_nama || '-'}`, opsi: opsiBaris })}</td>
      </tr>`;
    })
    .join('');

  return `
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="blok-halaman" data-blok-halaman="laporan">
<div class="stack blok-wadah" data-blok-wadah>
  <!-- permintaan user: TIDAK ada kotak besar di atas daftar laporan; ikon (filter · laporan lengkap · cetak)
       diletakkan seperti di halaman Inventory (baris kepala berisi grup ikon, tanpa kartu pembungkus).
       Tetap di dalam wadah blok supaya masih bisa disembunyikan/diatur dari Customize Tampilan. -->
  <div class="page-head" data-blok="penjualan" data-blok-nama="Laporan Penjualan">
    <div class="aksi">
      <div class="lapor-ikon">
        ${menuTigaBaris({ base, daftarSales })}
        <a class="ttk-tombol" href="${base}/laporan/sales" title="Buka laporan penjualan lengkap" aria-label="Buka laporan penjualan lengkap">
          ${LAPORAN}
        </a>
        ${ikonPdf({ base, href: '/cetak/laporan-sales-pdf', judul: 'Cetak PDF Laporan Penjualan (F4)' })}
      </div>
    </div>
  </div>

  ${kartuGrafik({ id: 'grafikLaporan', judul: 'Grafik Penjualan', blok: 'grafik', judulBlok: 'Grafik Penjualan' })}

  <div class="card" data-blok="cetak" data-blok-nama="Daftar Perjalanan">
    ${bilahSaringSales()}
    <div class="tbl-wrap" style="max-height:62vh;overflow:auto">
      <table class="tbl tbl-pekat" id="tblLaporan">
        <thead><tr>
          <th>Tanggal</th><th>Nama Sales</th><th class="aksi-sel">Aksi</th>
        </tr></thead>
        <tbody>${baris || '<tr><td colspan="3" class="kosong">Belum ada perjalanan.</td></tr>'}</tbody>
      </table>
    </div>
  </div>
</div>
</div>
<script>
(function(){
  var box = document.querySelector('[data-lapor]');
  if (!box) return;
  var tombol = box.querySelector('[data-lapor-buka]');
  var panel = box.querySelector('[data-lapor-panel]');
  function setel(buka){
    panel.hidden = !buka;
    if (!buka) (window.SC && SC.sembunyikanPanel ? SC.sembunyikanPanel(panel) : bersihkanPanel());
    tombol.setAttribute('aria-expanded', buka ? 'true' : 'false');
    tombol.classList.toggle('aktif', buka);
    var kartu = box.closest('.card');
    if (kartu) kartu.classList.toggle('kartu-atas', buka);
    if (buka && window.SC && SC.letakkanPanel) SC.letakkanPanel(panel, tombol);
  }
  function bersihkanPanel(){
    panel.style.position = '';
    panel.style.left = '';
    panel.style.top = '';
    panel.style.width = '';
    panel.style.maxHeight = '';
  }
  tombol.addEventListener('click', function(ev){ ev.stopPropagation(); setel(panel.hidden); });
  document.addEventListener('click', function(ev){
    if (panel.hidden) return;
    if (ev.target.closest('[data-lapor]') || ev.target.closest('[data-lapor-panel]')) return;
    setel(false);
  });
  document.addEventListener('keydown', function(ev){
    if ((ev.key === 'Escape' || ev.keyCode === 27) && !panel.hidden) setel(false);
  });
  panel.addEventListener('submit', function(){ setel(false); });
  // klik link cetak -> tutup panel
  panel.addEventListener('click', function(ev){ if (ev.target.closest('a')) setel(false); });
})();

</script>`;
};

/** Laporan Penjualan (per sales, dengan filter tanggal & sales) */
exports.sales = function ({ base, pesan, dari, sampai, sales = '', daftarSales = [], rekap, total }) {
  const blok = rekap
    .map(
      (s) => `
      <tr class="baris-sales" data-cari="${esc(s.sales.toLowerCase())}">
        <td>${esc(s.sales || '(tanpa nama)')}</td>
        <td class="num">${angka(s.perjalanan)}</td>
        <td class="num">${angka(s.b)}</td>
        <td class="num">${angka(s.t)}</td>
        <td class="num">${angka(s.k)}</td>
        <td class="num">${angka(s.s)}</td>
        <td class="num">${s.selisih === 0 ? '&mdash;' : `<span class="badge b-merah">${angka(s.selisih)}</span>`}</td>
        <td class="num"><button class="btn btn-ghost btn-sm" type="button" data-buka="${esc(s.sales)}">Rincian</button></td>
      </tr>
      ${s.detail
        .map(
          (d) => `<tr class="baris-detail" data-untuk="${esc(s.sales)}" style="display:none">
            <td class="kode">${esc(noSurat({ kode_unik: d.kode_unik, id: d.sesi_id }))}</td>
            <td>${esc(tanggalPendek(d.tanggal_rekap || d.tanggal))}<span class="kode">rekap</span></td>
            <td colspan="2">${esc(d.nama)} <span class="kode">${esc(d.kode)}</span></td>
            <td class="num">${angka(d.qty)}</td>
            <td colspan="3"></td>
          </tr>`
        )
        .join('')}
    `
    )
    .join('');

  const script = `
<script>
document.addEventListener('click', function(ev){
  const b = ev.target.closest('[data-buka]');
  if (!b) return;
  const nama = b.dataset.buka;
  const baris = Array.from(document.querySelectorAll('[data-untuk]')).filter(function(tr){ return tr.dataset.untuk === nama; });
  const tampil = baris.length && baris[0].style.display === 'none';
  baris.forEach(function(tr){ tr.style.display = tampil ? '' : 'none'; });
  b.textContent = tampil ? 'Tutup' : 'Rincian';
});
</script>`;

  const q = (dari || sampai || sales)
    ? `?${[
        dari ? `dari=${encodeURIComponent(dari)}` : '',
        sampai ? `sampai=${encodeURIComponent(sampai)}` : '',
        sales ? `sales=${encodeURIComponent(sales)}` : '',
      ]
        .filter(Boolean)
        .join('&')}`
    : '';

  return {
    isi: `
<div class="info-kotak" style="margin-bottom:18px">
  <div class="kotak-info"><div class="label">S</div><div class="value">${angka(total.s)}</div><div class="note">terjual</div></div>
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(total.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(total.t)}</div><div class="note">tambahan</div></div>
  <div class="kotak-info${total.selisih === 0 ? '' : ' kotak-waspada'}"><div class="label">K</div><div class="value">${angka(total.k)}</div><div class="note">${total.selisih === 0 ? 'kembali' : `selisih ${angka(total.selisih)}`}</div></div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="card">
  <div class="lapor-kepala">
    <h2 class="card-title-heading">Rekap per Sales</h2>
    <div class="lapor-alat">
      <div class="lapor-ikon">
        ${tombolKalender({ base, action: '/laporan/sales', dari, sampai, ringkas: true, sales, daftarSales })}
        ${ikonPdf({ base, href: `/cetak/laporan-sales-pdf${q}`, judul: 'Cetak PDF Laporan Penjualan (F4)' })}
      </div>
    </div>
  </div>
  <div class="hint" style="margin:0 0 12px">Periode laporan mengikuti <b>tanggal rekap</b> (tanggal saat perjalanan direkap), bukan tanggal canvasing.</div>
  <input type="search" data-filter="#tblSales" placeholder="Cari nama sales…" style="max-width:340px;margin:0 0 14px">
  <div class="tbl-wrap" style="max-height:62vh;overflow:auto">
    <table class="tbl tbl-pekat" id="tblSales">
      <thead><tr><th>Sales</th><th class="num">Perjalanan</th><th class="num">B</th><th class="num">T</th><th class="num">K</th><th class="num">Terjual (S)</th><th class="num">Selisih</th><th class="num">Aksi</th></tr></thead>
      <tbody>${blok || '<tr><td colspan="8" class="kosong">Belum ada data penjualan pada filter ini.</td></tr>'}</tbody>
      ${rekap.length ? `<tfoot><tr style="background:var(--tbl-head-bg);font-weight:800">
        <td>TOTAL</td><td class="num">${angka(total.perjalanan)}</td><td class="num">${angka(total.b)}</td><td class="num">${angka(total.t)}</td>
        <td class="num">${angka(total.k)}</td><td class="num">${angka(total.s)}</td>
        <td class="num">${total.selisih === 0 ? '&mdash;' : angka(total.selisih)}</td><td></td>
      </tr></tfoot>` : ''}
    </table>
  </div>
</div>`,
    script,
  };
};

exports.tombolKalender = tombolKalender;
exports.menuTigaBaris = menuTigaBaris;
