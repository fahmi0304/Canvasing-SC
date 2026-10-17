'use strict';
const { esc, angka, tanggalPanjang, tanggalPendek, setoranEfektif, arahBedaSP, catatanSelisihSPRinci, statusInfo, statusSesi, perluDataPenjualan, pisahCatatan, urutNama, kelompokCatatan, tanggalLengkap, selisihJual, selisihBarang } = require('../lib/util');
const { opsiCetak } = require('./cetak');
const { grupAksi } = require('./aksi-ikon');
const { PLUS, PENSIL, JUAL, RETUR, REKAP, SELESAI, KUNCI, AUDIT, HAPUS, PRINTER, VALID: IKON_VALID } = require('./ikon');
const { noSurat } = require('../lib/kode');

/**
 * Status "belum rekap" (surat jalan sudah terbit, hitungan barang kembali belum dibuka):
 * `tunggu_jual` ("Ongoing" — surat jalan terbit, kolom P belum diisi), `kirim` (status LAMA dengan arti yang
 * sama, untuk data/backup lama), dan `jual` (Menunggu Rekap — penjualan sudah diisi).
 */
const BELUM_REKAP = ['tunggu_jual', 'kirim', 'jual'];
/** Kolom P boleh diisi/diperbaiki: selama belum rekap, dan MASIH BOLEH juga saat rekap berjalan. */
const BOLEH_JUAL = ['tunggu_jual', 'kirim', 'jual', 'rekap'];
const { VERSI_EKSPEDISI } = require('../lib/rekapEkspedisi');
const { VERSI_DOKUMEN } = require('../lib/versiDokumen');

const PANEL_SCAN = (opsi) => `
<div class="card scan-card">
  <h2 class="card-title">${esc(opsi.judul)}</h2>
  <p class="card-hint">${opsi.ket}</p>
  <input class="scan-input" data-scan data-sesi="${opsi.sesi}" data-onmatch="${opsi.onmatch}" placeholder="SCAN / KETIK KODE" autocomplete="off" autofocus>
  <div class="scan-info" id="scanInfo">${opsi.ketGagal || 'Arahkan scanner ke barcode barang atau ketik kode lalu Enter.'}</div>
  <div class="scan-net">
    <div>Terisi<b id="netBaris">0</b></div>
    <div>Total Qty<b id="netQty">0</b></div>
    <div>${opsi.labelKedua || 'Baris terpilih'}<b id="netKedua">0</b></div>
  </div>
  <div id="kameraWrap"></div>
  <button class="btn btn-ghost btn-sm" style="margin-top:12px" id="btnKamera" type="button">Scan pakai Kamera HP</button>
  <div class="hint">Scanner USB/Bluetooth: langsung tembak, kode otomatis masuk.</div>
</div>`;

exports.panel = PANEL_SCAN;
exports.kepalaPerjalanan = kepalaPerjalanan;

/** Label sumber pengambilan untuk kartu halaman perjalanan (kode surat jalan sumber kalau ada). */
function labelSumber(t) {
  const sumber = String((t && t.sumber) || '').toLowerCase();
  // Pengembalian barang ke gudang (permintaan user): barangnya keluar dari kolom Dibawa.
  if (sumber === 'kembali-gudang') return 'Dikembalikan ke Gudang';
  /*
   * Permintaan user (revisi ke-152, diperbarui revisi ke-157): kalau diambil dari GUDANG, keterangannya
   * ditulis lengkap — dulu "Diambil dari gudang", sekarang **"Mengambil di gudang"** (permintaan user:
   * "Keterangan di ambil dari gudang, ubah mengambil di gudang").
   */
  if (!sumber || sumber === 'gudang') return 'Mengambil di gudang';
  return t.kode_sumber ? `${t.kode_sumber} · ${t.sumber}` : `Sales ${t.sumber}`;
}

/**
 * KARTU "CATATAN PENGAMBILAN BARANG" (pernah sempat diberi judul "Ekspedisi Barang", dikembalikan ke
 * pengaturan awal atas permintaan user) — permintaan user: catatan pengambilan
 * barang (tgl/pukul · mengambil barang · dari gudang atau sales lain · sebanyak 000 pcs) muncul BESERTA
 * RINCIANNYA di halaman perjalanan DAN Overview, untuk semua status (draft, ongoing, selesai), sebagai
 * daftar TERKUNCI (tidak ada tombol ubah/hapus).
 * Permintaan user (revisi ke-150): "tulisan exspedisi barang kembali ke pengaturan awal" → judulnya dikembalikan
 * ke "Catatan Pengambilan Barang" (sempat diubah menjadi nama lain); tombol cetaknya dipindah ke BAWAH tabel
 * dengan keterangan "Cetak Memo Pengambilan Lengkap".
 * Permintaan user: keterangan di bawah judul
 * (bagian yang menjelaskan bahwa catatannya otomatis & terkunci) DIHAPUS — jangan dihidupkan lagi.
 * `tambahan` = daftar entri (tambahan_batch) milik perjalanan ini; `rincian` = Map(batch_id → barang).
 *
 * **`opts.hapusEntri`** (revisi ke-170, permintaan user "Buat Administrator bisa menghapus barang
 * tambahan"): kalau `{ base, boleh }` diberikan dan `boleh` true (administrator & perjalanan belum
 * selesai), setiap baris penginputan mendapat **tombol hapus** dengan popup konfirmasi bertema. Tombolnya
 * `<button>` di dalam `<form>`, jadi kliknya DIIABAIKAN oleh handler klik-baris (`pasangRinciBaris`).
 */
function kartuPengambilan({ base, sesi, tambahan = [], rincian = new Map(), hapusEntri = null }) {
  const total = tambahan.reduce((a, b) => a + (b.total || 0), 0);
  const bolehHapusEntri = !!(hapusEntri && hapusEntri.boleh);
  /*
   * Permintaan user (revisi ke-137):
   *  - "tanggal hanya cantumkan 1 kali di expedisi, cukup jam saja …, jika tanggal pengambilan berbeda,
   *    maka tanggal cantumkan lagi" → kolom TANGGAL dihapus dari tiap baris entri; tanggalnya ditulis
   *    SEKALI sebagai baris pemisah, dan muncul lagi begitu tanggalnya berganti. Baris entri cukup
   *    menampilkan JAM-nya (`jam_mulai`).
   *  - "status ke-1 ke-2 dst tidak usah" → nomor urut "ke-N" di kolom Status dihapus; badge "Terkunci"
   *    tetap (kolom statusnya tidak dihilangkan).
   *  - "semua kolom di ekspedisi barang rata tengah kolom" → tabel memakai kelas `tbl-tengah`
   *    (baris RINCIAN dikembalikan rata kiri karena isinya daftar barang, bukan angka kolom).
   */
  let tanggalTerakhir = '';
  let noRinci = 0;
  const baris = tambahan
    .map((t) => {
      const barang = rincian.get(t.id) || [];
      noRinci += 1;
      const idRinci = `rinci_${noRinci}`;
      /*
       * Revisi ke-152 (permintaan user): tulisan "Lihat rincian N jenis barang (N pcs)" DIHAPUS —
       * rinciannya cukup muncul saat BARISNYA DIKLIK (pola yang sama dengan baris riwayat di halaman
       * Audit: `data-rinci-baris` + baris rincian `hidden` di bawahnya). Tidak ada tulisan petunjuk
       * "klik baris untuk melihat rincian" di layar.
       */
      const rinci =
        barang.length
          ? `<ul class="rinci-list">${barang.map((b) => `<li><span class="rinci-nama">${esc(b.nama)}</span><b>× ${angka(b.qty)}</b></li>`).join('')}</ul>`
          : '<span class="kode">tidak ada rincian barang</span>';
      // baris pemisah tanggal — hanya dicetak saat tanggalnya BERBEDA dari entri sebelumnya.
      // Format (permintaan user revisi ke-152): HARI, TANGGAL NAMA BULAN TAHUN — mis. "Jumat, 10 Oktober 2026".
      let kepalaTanggal = '';
      if (t.tanggal !== tanggalTerakhir) {
        tanggalTerakhir = t.tanggal;
        kepalaTanggal = `<tr class="baris-tanggal" data-tanggal-pisah="${esc(t.tanggal)}"><td colspan="${bolehHapusEntri ? 4 : 3}">${esc(tanggalLengkap(t.tanggal))}</td></tr>`;
      }
      /*
       * Tombol hapus penginputan (administrator, perjalanan belum selesai) — memakai popup konfirmasi
       * bertema `[data-konfirmasi-tema]` yang sudah ada di `public/app.js`, jadi tidak perlu skrip baru.
       * Ikonnya **ikon sampah** (`HAPUS`, sama dengan tombol hapus lainnya) — permintaan user revisi
       * ke-172: *"Tombol hapus di expedisi barang juga gunakan logo sampah"* (sebelumnya karakter "✕").
       */
      const selHapus = bolehHapusEntri
        ? `<td class="aksi-sel"><form method="post" action="${base}/sesi/${sesi.id}/tambahan/${t.id}/hapus" class="form-hapus-entri">
        <button class="ttk-tombol ttk-hapus" type="submit" data-konfirmasi-tema title="Hapus penginputan ini"
          aria-label="Hapus penginputan ${esc(t.jam_mulai)}"
          data-judul="Hapus penginputan ${esc(t.jam_mulai)}?"
          data-pesan="Penginputan ${esc(tanggalLengkap(t.tanggal))} jam ${esc(t.jam_mulai)} (${angka(t.total)} barang) akan dihapus. Angka stoknya DIPULIHKAN: barang yang tadi diambil dikembalikan ke surat jalan sumbernya, dan barang retur dikembalikan ke kolom Dibawa perjalanan ini."
          data-ok="Ya, hapus">${HAPUS}</button>
      </form></td>`
        : '';
      return `${kepalaTanggal}<tr data-batch="${t.id}" data-tanggal="${esc(t.tanggal)}" data-jam="${esc(t.jam_mulai)}" data-sumber="${esc(t.sumber || 'gudang')}"
          class="baris-rinci-klik" data-rinci-baris="${idRinci}" tabindex="0" role="button" aria-expanded="false" aria-controls="${idRinci}">
        <td class="kode">${esc(t.jam_mulai)}</td>
        <td>${esc(labelSumber(t))}${t.sumber_sesi_id ? ` <small class="kode">(dikurangi ${angka(t.sumber_qty)})</small>` : ''}</td>
        <td class="num">${angka(t.total)}</td>
        ${selHapus}
      </tr>
      <tr class="baris-rinci" id="${idRinci}" data-rinci-detail hidden><td colspan="${bolehHapusEntri ? 4 : 3}">${rinci}</td></tr>`;
    })
    .join('');
  return `
<div class="card pengambilan-card" style="margin-top:22px">
  <!--
    Judul kartu & tombol cetaknya mengikuti permintaan user revisi ke-150 (lihat komentar JS di atas
    fungsi ini). JANGAN menuliskan nama judul LAMA di komentar HTML ini — komentar HTML ikut terkirim ke
    browser dan skrip uji memeriksa HTML mentah (jebakan #30).
  -->
  <h2 class="card-title-heading">Ekspedisi Barang</h2>
  ${
    tambahan.length
      ? `<div class="tbl-wrap" style="max-height:420px;overflow:auto">
    <table class="tbl rapat tbl-pekat tbl-tengah" id="tblPengambilan">
      <thead><tr><th>Jam</th><th>Keterangan</th><th class="num">Qty</th>${bolehHapusEntri ? '<th class="aksi-sel" aria-label="Aksi"></th>' : ''}</tr></thead>
      <tbody>${baris}</tbody>
      <tfoot><tr><td colspan="2"><b>Total barang bergerak</b></td><td class="num"><b>${angka(total)}</b></td>${bolehHapusEntri ? '<td class="aksi-sel"></td>' : ''}</tr></tfoot>
    </table>
  </div>
  <div class="cetak-memo-baris">
    <a class="btn btn-ghost cetak-memo-lengkap" href="${base}/cetak/rekap-ekspedisi-pdf/${sesi.id}?v=${VERSI_EKSPEDISI}"
       target="_blank" rel="noopener" data-pdf-buka
       title="Cetak memo ekspedisi barang lengkap (PDF) — seluruh penginputan barang perjalanan ini"
       aria-label="Cetak memo ekspedisi barang lengkap (PDF)">${PRINTER}<span>Cetak Memo Ekspedisi Barang Lengkap</span></a>
  </div>`
      : `<div class="tbl-wrap"><table class="tbl rapat"><tbody><tr><td class="kosong">Belum ada pengambilan barang di perjalanan ini.</td></tr></tbody></table></div>`
  }
</div>`;
}
exports.kartuPengambilan = kartuPengambilan;

/**
 * KARTU CATATAN dengan dua bagian: (1) catatan MANUAL yang bisa diedit petugas, (2) daftar catatan
 * OTOMATIS yang terkunci (permintaan user: "catatan yang muncul otomatis tidak bisa di edit").
 * Catatan otomatis dibangun sistem dari data pengambilan barang (lihat segarkanCatatan di server.js).
 */
function kartuCatatan({ base, sesi, items = [] }) {
  const { manual, otomatis } = pisahCatatan(sesi.catatan);
  /*
   * Permintaan user (revisi ke-145): catatan otomatis dikelompokkan PER TANGGAL — tanggalnya ditulis
   * **di atas nomor, lurus dengan awal nomor** (format "Kamis, 09 Oktober 2026") dan **nomor mulai dari 1
   * lagi** di tiap tanggal. Aturan itu hanya untuk tanggal yang punya **≥ 2 catatan**; tanggal dengan
   * **1 catatan** memakai **format awal** (tanggal ditulis di barisnya sendiri, `dd/mm/yyyy hh:mm …`).
   * Struktur bloknya dibuat `lib/util.js → kelompokCatatan()` (dipakai juga oleh dokumen F4).
   */
  const blokCatatan = kelompokCatatan(otomatis);
  const terkunci = sesi.status === 'selesai';
  const isiOtomatis = blokCatatan
    .map((b) => {
      const kepala = b.kepala ? `<li class="catatan-tanggal"><span class="rinci-kepala">${esc(b.kepala)}</span></li>` : '';
      const baris = b.baris
        .map((x) => `<li data-otomatis="1"><span class="rinci-no">${x.no}.</span><span class="rinci-nama">${esc(x.teks)}</span></li>`)
        .join('');
      return kepala + baris;
    })
    .join('');
  /*
   * CATATAN OTOMATIS BARANG YANG SELISIH (permintaan user: *"buat catatan otomatis barang yang selisih
   * 'jumlah setoran kurang 00' karena YSL bawa satu tapi tidak dikembalikan"*) — memakai helper yang SAMA
   * dengan dokumen (`views/print.js → catatanSelisihSP()`) supaya layar & kertas berbunyi persis sama.
   * Hanya muncul saat perbandingan Setoran vs Penjualan sudah berarti (status rekap/selesai).
   */
  const adaPenjualan = items.reduce((a, i) => a + (Number(i.p) || 0), 0) > 0;
  const catatanSelisih = catatanSelisihSPRinci(items, (sesi.status === 'rekap' || sesi.status === 'selesai') && adaPenjualan);
  /*
   * Daftar selisih diberi NOMOR sendiri mulai dari 1 (permintaan user: *"jika ada catatan selisih, buat
   * catatan baru, dengan tulisan catatan selisih dan berikan nomor catatan"*) — blok ini juga dipisah
   * dari daftar catatan otomatis biasa (lihat markup di bawah).
   */
  const isiSelisih = catatanSelisih
    .map((x, n) => `<li class="catatan-selisih ${x.arah}" data-selisih-sp="1"><span class="rinci-no">${n + 1}.</span><span class="rinci-nama">${esc(x.teks)}</span></li>`)
    .join('');
  return `
<div class="card" style="margin-top:22px;max-width:680px">
  <h2 class="card-title">Catatan</h2>
  <form method="post" action="${base}/sesi/${sesi.id}/catatan">
    <label class="f">Catatan manual</label>
    <textarea name="catatan" rows="3" placeholder="mis. pesanan yang belum diambil" ${terkunci ? 'disabled' : ''}>${esc(manual)}</textarea>
    ${terkunci ? '' : '<button class="btn btn-primary btn-sm" style="margin-top:10px" type="submit">Simpan Catatan</button>'}
  </form>
  ${
    otomatis.length
      ? `<div class="catatan-otomatis">
    <div class="label-otomatis">Catatan otomatis (dibuat sistem — tidak bisa diedit)</div>
    <ul id="listCatatanOtomatis" class="rinci-list">${isiOtomatis}</ul>
  </div>`
      : ''
  }
  ${
    // Blok BARU "Catatan Selisih" (permintaan user) — terpisah, bernomor mulai dari 1 lagi.
    catatanSelisih.length
      ? `<div class="catatan-otomatis blok-catatan-selisih">
    <div class="label-otomatis">Catatan Selisih</div>
    <ul id="listCatatanSelisih" class="rinci-list">${isiSelisih}</ul>
  </div>`
      : ''
  }
</div>`;
}
exports.kartuCatatan = kartuCatatan;

exports.baru = function ({ base, daftarSales, hariIni, pesan, bolehKelolaSales = false }) {
  const adaDaftar = daftarSales.length > 0;
  /*
   * Tautan "Kelola daftar sales" hanya untuk yang BERHAK mengelola (administrator) — sejak revisi
   * ke-139 mengelola nama sales = hak administrator, jadi untuk peran lain tautan itu hanya menuntun ke
   * halaman yang tidak bisa mereka ubah. Keterangannya tetap tampil, tautannya saja yang dilepas.
   */
  const tautanSales = bolehKelolaSales ? ' <a href="' + base + '/sales">Kelola daftar sales</a>' : '';
  const opsi = daftarSales.map((s) => `<option value="${esc(s.nama)}">${esc(s.nama)}</option>`).join('');
  /*
   * Geser ke kanan = PINDAH HALAMAN dengan konfirmasi (permintaan user) — mekanismenya di
   * public/app.js (SC.geserHalaman), sama seperti layar penginputan/tambahan/retur/rekap.
   * "Pindah & simpan" di sini = mengirim formulir (membuat transaksinya, sesuai keputusan user:
   * "sama seperti halaman lain (popup muncul, simpan = membuat transaksinya)"), sedangkan "Pindah
   * tanpa menyimpan" kembali ke dasbor seperti tombol Batal.
   */
  const script = `<script>
// dipasang setelah DOMContentLoaded supaya app.js (yang dimuat di akhir <body>) sudah siap —
// skrip di dalam isi halaman berjalan LEBIH DULU daripada <script src="app.js"> di layout
document.addEventListener('DOMContentLoaded', function(){
  if (!window.SC || typeof window.SC.geserHalaman !== 'function') return;
  window.SC.geserHalaman({
    tujuan: ${JSON.stringify(base + '/')},
    simpan: function(){
      var f = document.querySelector('.card form[action$="/sesi"]');
      if (!f) return;
      // requestSubmit() menjalankan validasi browser dulu (nama sales wajib) — kalau belum lengkap,
      // popup validasi muncul dan pengguna tetap di halaman ini
      if (typeof f.requestSubmit === 'function') f.requestSubmit();
      else f.submit();
    },
  });
});
</script>`;
  return `
<div class="page-head">
  <div><h1>Tambah Transaksi</h1>
  <div class="sub">Setelah jumlah barang dibawa diinput, data akan dikunci dan tidak bisa diubah lagi.</div></div>
  <div class="aksi"><a class="btn btn-ghost" href="${base}/">Batal</a></div>
</div>
${pesan ? `<div class="alert alert-warn">${esc(pesan)}</div>` : ''}
<div class="card" style="max-width:640px">
  <form method="post" action="${base}/sesi">
    <div class="field">
      <label class="f">Tanggal</label>
      <input type="date" name="tanggal" value="${esc(hariIni)}" required>
    </div>
    <div class="field">
      <label class="f">Nama sales</label>
      ${adaDaftar ? `<select name="sales_nama" id="pilihSales" data-pilih-sales="#boxSalesBaru" required>
        <option value="">— pilih nama sales —</option>
        ${opsi}
        <option value="__baru__">＋ Nama sales baru…</option>
      </select>` : ''}
      <div id="boxSalesBaru" ${adaDaftar ? 'hidden' : ''}>
        <label class="f" style="margin-top:10px">Nama sales baru</label>
        <input type="text" name="sales_baru" id="salesBaru" placeholder="mis. ZAIN" autocomplete="off" ${adaDaftar ? '' : 'required'}>
        <div class="hint">Nama baru otomatis disimpan ke daftar sales.</div>
      </div>
      ${adaDaftar ? `<div class="hint">Belum ada namanya di daftar? Pilih <b>＋ Nama sales baru…</b> lalu ketik namanya.${tautanSales}</div>` : `<div class="hint">Daftar sales masih kosong — nama yang kamu isi akan disimpan ke daftar.${tautanSales}</div>`}
    </div>
    <div class="field">
      <label class="f">Catatan (opsional)</label>
      <input type="text" name="catatan" placeholder="mis. area Pasar Baru">
    </div>
    <button class="btn btn-primary btn-lg" type="submit">Buat &amp; Input Barang Dibawa</button>
  </form>
</div>
${script}`;
};

/**
 * Kepala keterangan perjalanan (permintaan user: "nama sales di overview ada di atas beserta
 * tanggal canvasingnya"). Dipakai di halaman perjalanan, overview, rekap, dan audit — menggantikan
 * `.page-head` yang judulnya sudah pindah ke topbar.
 */
function kepalaPerjalanan(sesi, tambahan = '', alat = '', opsi = {}) {
  // statusSesi() membedakan "Ongoing" (baru dikunci) dengan "Menunggu Data Penjualan"
  // (rekap sudah dikunci tetapi kolom P masih kosong) — lihat lib/util.js.
  const info = statusSesi(sesi);
  // opsi.geserKembali: geser ke kanan = kembali (permintaan user, pengganti tombol "Kembali")
  const kembali = opsi.geserKembali || '';
  /*
   * opsi.ikonAtas = ikon yang ditaruh di POJOK KANAN ATAS dan LURUS DENGAN NAMA SALES (permintaan user:
   * "ikon audit pindah ke atas pojok kanan, lurus dengan nama"). Ikonya menjadi anak ketiga .pjl-utama
   * dan kepala-nya dapat kelas .pjl-ada-ikon-atas; CSS-nya membuat .pjl-utama menjadi grid 3 kolom
   * (nama | keterangan | ikon) sehingga ikonnya SELALU sebaris dengan nama — termasuk di layar HP,
   * yang sebelumnya ikon ini ikut wadah .pjl-alat dan turun ke baris sendiri (terukur 65–94 px
   * di bawah nama pada 700/390 px).
   */
  const ikonAtas = opsi.ikonAtas || '';
  return `<div class="pjl-kepala${ikonAtas ? ' pjl-ada-ikon-atas' : ''}"${kembali ? ` data-geser-kembali="${esc(kembali)}"` : ''}>
  <div class="pjl-utama">
    <div class="pjl-sales">${esc(sesi.sales_nama || '(sales belum diisi)')}</div>
    <div class="pjl-meta">
      <span class="pjl-jadwal">Canvasing ${esc(tanggalPanjang(sesi.tanggal))}</span>
      <span class="pjl-kode">${esc(noSurat(sesi))}</span>
      <span class="badge b-${info.warna}">${esc(info.label)}</span>
      ${tambahan}
    </div>
    ${ikonAtas ? `<div class="pjl-ikon-atas">${ikonAtas}</div>` : ''}
  </div>
  ${alat ? `<div class="pjl-alat">${alat}</div>` : ''}
</div>`;
}

/**
 * Kotak "REKAP" di halaman perjalanan (permintaan user): gabungan kolom K & S, sekaligus tombol untuk
 * memulai / melanjutkan rekap karena ikon Rekap di deretan aksi sudah diganti ikon Retur.
 *  - status `rekap` → tautan ke halaman rekap (lanjut hitung barang kembali);
 *  - status `kirim`/`jual` & barang dibawa > 0 → tombol POST `/sesi/:id/rekap/mulai` (popup konfirmasi
 *    bertema lewat `data-konfirmasi-tema` yang sudah ditangani public/app.js) — status `jual`
 *    (**Menunggu Rekap**) memang tahap yang menunggu rekap dimulai;
 *  - selain itu → kotak biasa (tidak bisa diklik) dengan keterangan alasannya.
 *
 * SEJAK revisi ini keterangannya memuat DUA selisih (permintaan user: "selisih di hitung dari s dikurangi
 * p", dengan jawaban pilihan **selisih lama B+T−K−S tetap ada sebagai keterangan tambahan**):
 *  - `selisih jual`  = S − P  (dihitung hanya kalau sales sudah mengisi P; kalau belum, selisih ini
 *    tidak ditampilkan supaya surat jalan lama tidak berekor merah tanpa alasan);
 *  - `selisih barang` = B + T − K − S (keterangan tambahan, sekaligus penanda kotak merah seperti dulu).
 */
function kotakRekap(tot, { base, sesi, bolehUbah }) {
  const sj = (Number(tot.p) || 0) > 0 ? selisihJual(tot) : 0;
  const sb = selisihBarang(tot);
  const waspada = sj === 0 && sb === 0 ? '' : ' kotak-waspada';
  /*
   * Catatan: isi kotak dibangun dengan fungsi kecil (bukan penggantian teks/regex). Percobaan pertama
   * memakai `.replace(/<div class="note">[^<]*</, …)` untuk mengganti keterangannya — potongan itu ikut
   * menghapus karakter `<` dari `</div>` sehingga tag penutupnya rusak; browser lalu "menelan" sisa
   * halaman ke dalam grid 3 kolom ini (gejala nyata di HP: tiga kartu Rincian/Ekspedisi/Catatan jadi
   * berdampingan sempit DAN muncul teks bocor "menunggu/div>"). Jangan kembali ke cara itu.
   */
  const isi = (ket) =>
    `<div class="label">Rekap</div><div class="value">${angka(tot.s)}</div>` +
    `<div class="note">${ket}</div>`;
  /*
   * Permintaan user (revisi ke-144): "teks k di bawah angka rekap ubah ke pcs" → keterangan kotak Rekap
   * yang dulu `K 5` sekarang menuliskan **jumlah barang kembali + satuan pcs** (`5 pcs`).
   *
   * Sejak selisih penjualan (S − P) diperkenalkan, keterangan kotak ini cukup memuat **selisih barang**
   * (B+T−K−S) — pemeriksaan selisih terhadap laporan sales ada di kotak **P** di sebelahnya
   * supaya setiap kotak menjelaskan kolomnya sendiri.
   */
  const ketRekap = `${angka(tot.k)} pcs` + (sb === 0 ? '' : ` · selisih barang ${angka(sb)}`);
  const isiDefault = isi(ketRekap);
  if (!bolehUbah) return `<div class="kotak-info${waspada}">${isiDefault}</div>`;
  if (sesi.status === 'rekap') {
    return `<a class="kotak-info kotak-rekap${waspada}" href="${base}/sesi/${sesi.id}/rekap"
      title="Lanjut hitung barang kembali (isi kolom Rekap)">${isiDefault}</a>`;
  }
  if (BELUM_REKAP.includes(sesi.status)) {
    /*
     * REKAP BOLEH DIMULAI walau penjualan (P) belum diisi — permintaan user: *"Buat surat jalan tetap bisa
     * di rekap meski penjualan bisa di imput …"*, dengan pilihan pemilik aplikasi: tombolnya **muncul
     * dengan peringatan tambahan** kalau penjualan belum diisi. Peringatan itu ditulis di `data-pesan`
     * popup konfirmasi, dan keterangan kotaknya ikut menandai bahwa statusnya masih Ongoing.
     */
    const adaPenjualan = (Number(tot.p) || 0) > 0;
    if ((Number(tot.b) || 0) > 0) {
      const pesanPopup = adaPenjualan
        ? 'Penjualan (P) yang dilaporkan sales sudah tersimpan. Barang tambahan dikunci dan penghitungan barang kembali dibuka.'
        : 'Peringatan: penjualan (kolom P) BELUM diisi, jadi angka penjualan masih 0 dan selisihnya akan terlihat di laporan. Rekap tetap bisa dijalankan — penjualan masih boleh diisi selama rekap berjalan. Barang tambahan dikunci dan penghitungan barang kembali dibuka.';
      return `<form method="post" action="${base}/sesi/${sesi.id}/rekap/mulai" class="kotak-rekap-form">
      <button type="submit" class="kotak-info kotak-rekap${waspada}" title="Mulai rekap — hitung barang kembali"
        data-konfirmasi-tema data-judul="${adaPenjualan ? 'Mulai rekap?' : 'Mulai rekap — penjualan belum diisi?'}"
        data-pesan="${pesanPopup}" data-ok="Ya, mulai rekap">${isiDefault}</button>
    </form>`;
    }
  }
  // Status selesai tidak "menunggu" apa pun lagi → tampilkan keterangan K & selisih seperti biasa.
  if (sesi.status === 'selesai') return `<div class="kotak-info${waspada}">${isiDefault}</div>`;
  const ket = Number(tot.b) || 0 ? 'menunggu' : 'isi barang dibawa dulu';
  return `<div class="kotak-info${waspada}">${isi(ket)}</div>`;
}

exports.detail = function ({ sesi, items, base, pesan, scan, bolehUbah = true, bolehHapus = true, tambahan = [], rincian = new Map(), ambilan = [], bolehHapusEntri = false, bolehJual = false }) {
  const tot = { b: 0, t: 0, k: 0, s: 0, p: 0 };
  items.forEach((i) => {
    tot.b += i.b; tot.t += i.t; tot.k += i.k; tot.s += setoranEfektif(i); tot.p += Number(i.p) || 0;
  });
  // selisih LAMA (keterangan tambahan sejak selisih penjualan S−P diperkenalkan) — lihat kotakRekap()
  const selisih = selisihBarang(tot);
  const ada = items.filter((i) => i.b + i.t + i.k > 0);

  /*
   * Permintaan user (revisi ke-144) — halaman lanjutan surat jalan terbit:
   *  - "kolom k ... tidak usah" → kolom **K DIHAPUS** dari tabel rincian (kolom K baru berisi setelah
   *    rekap; info barang kembali tetap ada di kotak **Rekap** di atas tabel);
   *  - "kolom s ganti total, b,t, total, rata tengah" → kolom **S diganti label Total** dan kolom
   *    B · T · Total **rata tengah** (kelas `num tengah`, sama seperti halaman Overview).
   *
   * Permintaan user sebelumnya yang TETAP berlaku: rincian tanpa kolom NO & Kode, tanpa keterangan di atas
   * tabel, dan **kolom Total selalu ditulis angkanya** (0 saat semua bawaan kembali) — barang yang
   * setorannya 0 ditulis "0", bukan sel kosong (keluhan "setelah rekap kolom S yang kosong kolomnya jadi
   * full hitam"). Kolom B & T tetap dikosongkan saat 0 (sama seperti kertas).
   *
   * Permintaan user TERBARU: *"di halaman sebelum rekap berikan kolom p"* → kolom **P** ditambahkan
   * tepat di samping kolom **Total** (Total = Setoran/`setoranEfektif`), jadi urutannya
   * **Nama Barang · B · T · P · Total**. Kolom P hanya ditampilkan setelah surat jalan terbit
   * (status `kirim` ke atas); saat masih `draft` belum ada penjualan sama sekali sehingga kolomnya
   * dibiarkan tidak ada.
   */
  const tampilP = sesi.status !== 'draft';
  /*
   * Penanda warna S & P (merah = setoran kurang, hijau = setoran lebih) menyala begitu sales melaporkan
   * penjualannya (total P > 0) — TERMASUK saat surat jalan masih Ongoing/Menunggu Rekap, karena pada
   * tahap itulah sales mengisi P dan user mengharapkan selisihnya langsung terlihat di semua tempat
   * (permintaan user: "Jika s tidak sama dengan p maka kolomnya merah" + "semua tempat"). Surat jalan
   * lama (P = 0 semua) tetap bersih tanpa tanda. Sama dengan `views/print.js → bolehBandingP()`.
   */
  const bandingP = sesi.status !== 'draft' && (Number(tot.p) || 0) > 0;
  const baris = ada
    .map((i) => {
      const s = setoranEfektif(i);
      const p = Number(i.p) || 0;
      /*
       * Sel P & Total (=S) diberi warna menurut ARAH selisihnya: **kurang** (setoran lebih sedikit dari
       * penjualan) = MERAH, **lebih** (setoran lebih banyak dari penjualan) = HIJAU — permintaan user:
       * *"Jika barang setoran lebih, maka tulisan nya Hijau"*.
       */
      const arah = bandingP ? arahBedaSP(i, s) : '';
      /*
       * NILAI 0 DIKOSONGKAN (permintaan user: *"kolom yang nilainya 0 biarkan kosong"*) untuk SEMUA kolom
       * angka di tabel — B · T · P(Jual) · Total. Ini menggantikan aturan lama "kolom S selalu ditulis
       * angkanya (0 saat balance)" yang berlaku di layar; kotak ringkasan DI ATAS tabel tetap menulis 0.
       */
      return `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num tengah">${Number(i.b) || ''}</td>
        <td class="num tengah">${Number(i.t) || ''}</td>
        ${tampilP ? `<td class="num tengah${arah ? ' beda-sp ' + arah : ''}">${p === 0 ? '' : angka(p)}</td>` : ''}
        <td class="num tengah${arah ? ' beda-sp ' + arah : ''}">${s === 0 ? '' : angka(s)}</td>
      </tr>`;
    })
    .join('');

  // Semua aksi halaman ini = IKON KOTAK (permintaan user), termasuk cetak (ikon printer + dropdown).
  const aksiIkon = [];
  /*
   * Opsi cetak dikumpulkan lalu ditampilkan lewat tombol berlogo printer.
   * permintaan user terbaru: "Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak PDF
   * saja, 1 ikon" → SEMUA isinya berkas PDF (tidak ada lagi halaman cetak HTML / dialog setel kertas).
   */
  const cetakOpsi = [];
  const cetak = (url, label, ket) => cetakOpsi.push({ href: url, label, ket });
  const konfirmasi = (judul, pesan, ok) =>
    `data-konfirmasi-tema data-judul="${esc(judul)}" data-pesan="${esc(pesan)}" data-ok="${esc(ok || 'Ya, lanjutkan')}"`;

  if (sesi.status === 'draft') {
    if (bolehUbah) {
      // Permintaan user: "ikon tambah ubah ke Edit" — di surat jalan yang BELUM dikunci, ikon ini
      // membuka layar ubah barang dibawa (bukan menambah transaksi baru), jadi namanya "Edit".
      aksiIkon.push({ href: `${base}/sesi/${sesi.id}/ambil`, ikon: PENSIL, judul: 'Edit barang yang dibawa (B)', ket: 'Edit' });
      aksiIkon.push({
        form: `${base}/sesi/${sesi.id}/kunci`,
        ikon: KUNCI,
        judul: 'Kunci & Terbitkan Surat Jalan',
        ket: 'Kunci',
        attr: konfirmasi('Kunci data barang dibawa?', 'Setelah dikunci, jumlah barang yang dibawa tidak dapat diubah lagi dan surat jalan siap dicetak.', 'Ya, kunci'),
      });
    }
    if (bolehHapus) {
      aksiIkon.push({
        form: `${base}/sesi/${sesi.id}/hapus`,
        ikon: HAPUS,
        kelas: 'ttk-hapus',
        judul: 'Hapus perjalanan ini',
        ket: 'Hapus',
        attr: konfirmasi(`Hapus surat jalan ${noSurat(sesi)}?`, 'Surat jalan ini beserta seluruh inputannya akan dihapus. Tindakan ini tidak bisa dibatalkan.', 'Ya, hapus'),
      });
    }
  }
  if (BELUM_REKAP.includes(sesi.status) || sesi.status === 'rekap') {
    /*
     * Ikon PENJUALAN (kolom P) — permintaan user: *"Pada status surat jalan ongoing, sales harus
     * memasukkan dulu jumlah barang yang di jual mereka … sales dan admin juga bisa memasukkan jumlah
     * penjualan"*. Ikonnya paling depan karena itu langkah pertama yang diminta dari sales; yang boleh
     * membukanya = `bolehJual` (administrator/admin gudang untuk semua surat jalan, atau sales yang
     * namanya sama dengan nama sales surat jalan ini).
     * Kolom P masih boleh diisi/diperbaiki SELAMA rekap berjalan, jadi ikonnya ikut tampil di status itu.
     */
    if (bolehJual) aksiIkon.push({ href: `${base}/sesi/${sesi.id}/jual`, ikon: JUAL, judul: 'Input jumlah barang terjual (P)', ket: 'Penjualan' });
  }
  /*
   * JEBAKAN yang pernah terjadi (keluhan user: "ikon tambah dan retur ganda"): Tambahan & Retur dulu
   * ditambahkan di DUA blok — yang di atas (karena kondisinya ikut memuat status `rekap`) DAN blok
   * khusus `rekap` di bawah — sehingga halaman surat jalan berstatus "Sedang Rekap" menampilkan ikon
   * "Tambahan" & "Retur" masing-masing DUA KALI. Sekarang keduanya ditambahkan SEKALI SAJA:
   * tahap BELUM REKAP di sini, tahap rekap di blok di bawah.
   */
  if (BELUM_REKAP.includes(sesi.status) && bolehUbah) {
    aksiIkon.push({ href: `${base}/sesi/${sesi.id}/tambahan`, ikon: PLUS, judul: 'Input Tambahan Barang (T)', ket: 'Tambahan' });
    // Permintaan user: ikon Retur di samping Tambahan MENGGANTIKAN ikon Rekap; mulai rekap lewat
    // kotak "Rekap" di baris kotak B/T/Rekap (lihat kotakRekap()).
    aksiIkon.push({ href: `${base}/sesi/${sesi.id}/retur`, ikon: RETUR, judul: 'Retur / kembalikan barang ke gudang', ket: 'Retur' });
  }
  if (sesi.status === 'rekap' && bolehUbah) {
    // Lanjut hitung rekap TIDAK lagi berupa ikon (permintaan user: ikon Rekap diganti Retur) —
    // melanjutkan rekap dari kotak "Rekap" di baris kotak B/T/Rekap.
    aksiIkon.push({ href: `${base}/sesi/${sesi.id}/tambahan`, ikon: PLUS, judul: 'Input Tambahan (T)', ket: 'Tambahan' });
    aksiIkon.push({ href: `${base}/sesi/${sesi.id}/retur`, ikon: RETUR, judul: 'Retur / kembalikan barang ke gudang', ket: 'Retur' });
    aksiIkon.push({
      form: `${base}/sesi/${sesi.id}/selesai`,
      ikon: SELESAI,
      judul: 'Selesaikan Rekap & Kunci',
      ket: 'Selesai',
      /*
       * Peringatannya menyesuaikan: kalau penjualan (P) masih kosong, rekap memang tetap boleh dikunci
       * tetapi statusnya TIDAK menjadi "Selesai" melainkan kembali "Ongoing" (menunggu data penjualan)
       * dan transaksinya tetap tampil di dasbor — jangan biarkan pengguna mengira laporannya sudah final.
       */
      attr: tot.p > 0
        ? konfirmasi('Selesaikan rekap & kunci semua data?', 'Angka tidak dapat diubah lagi setelah ini dan laporan lengkap F4 siap dicetak.', 'Ya, selesaikan')
        : konfirmasi('Selesaikan rekap TANPA penjualan (P)?', 'Penjualan (P) masih kosong, jadi status surat jalan ini TIDAK menjadi "Selesai" melainkan kembali "Ongoing" (menunggu data penjualan) dan tetap tampil di dasbor. Angka rekap (B/T/K/S) tersimpan — setelah penjualan diisi, jalankan rekap lagi lalu kunci untuk menyelesaikannya.', 'Ya, kunci rekap'),
    });
  }
  /*
   * Semua opsi cetak sekarang = berkas PDF yang dibuat server (permintaan user: "Semua cetak dokumen
   * laporan digabung ke cetak PDF, langsung cetak PDF saja, 1 ikon"):
   *  - surat jalan & laporan lengkap → PDF F4 (1 halaman, tanpa header/footer);
   *  - barcode barang → PDF label (kertas gulungan 58 mm, QR).
   * Permintaan user terbaru: "cetak memo di logo print tidak usah" → opsi **PDF Memo Pengambilan
   * DIHAPUS dari menu logo printer** di halaman ini (dan halaman rekap). Memonya tetap bisa dilihat
   * per penginputan lewat kolom **Memo** di kartu "Catatan Pengambilan Barang" serta dari menu baris
   * halaman Laporan — jadi tidak ada fungsi yang hilang. Jangan dihidupkan lagi di menu cetak.
   */
  /*
   * OPSI CETAK DI HALAMAN SURAT JALAN HANYA UNTUK STATUS **SELESAI** — permintaan user: *"hapus opsi cetak
   * di halaman surat jalan terbit, ongoing dan draft"*, dengan jawaban pilihan pemilik aplikasi: draft ·
   * Surat Jalan Terbit · Menunggu Rekap · Sedang Rekap **tanpa** opsi cetak, hanya **Selesai** yang punya.
   *
   * Fungsi cetak tidak hilang: semua dokumen tetap bisa dicetak dari menu baris **Dasbor** & **Laporan**
   * (`surat-jalan-pdf` / `laporan-pdf` / `memo-pdf`), halaman **rekap**, dan **Inventory** (barcode).
   */
  if (sesi.status === 'selesai') {
    cetak(`/cetak/laporan-pdf/${sesi.id}?v=${VERSI_DOKUMEN}`, 'PDF Laporan Lengkap (F4)', 'terbuka di penampil PDF · semua kolom B/T/K/S');
    cetak(`/cetak/surat-jalan-pdf/${sesi.id}?v=${VERSI_DOKUMEN}`, 'PDF Surat Jalan & Setoran (F4)', 'terbuka di penampil PDF · kertas F4');
    cetak(`/cetak/label-pdf?sesi=${sesi.id}`, 'PDF Barcode Barang', 'terbuka di penampil PDF · label QR gulungan 58 mm');
  }

  // Audit: ikon sejajar dengan ikon aksi lainnya (permintaan user)
  aksiIkon.push({ href: `${base}/sesi/${sesi.id}/audit`, ikon: AUDIT, judul: 'Audit perubahan perjalanan', ket: 'Audit' });

  const grupIkonAksi = grupAksi({
    items: aksiIkon,
    // Permintaan user: setiap ikon punya keterangan kecil di bawahnya — termasuk ikon cetak.
    // Hanya status SELESAI yang punya opsi cetak di halaman ini (lihat `cetakOpsi` di atas).
    ekstra: sesi.status !== 'selesai' ? '' : opsiCetak({
      base,
      opsi: cetakOpsi,
      judul: 'Cetak PDF',
      bawah: 'Cetak PDF',
      nonaktif: cetakOpsi.length ? '' : 'Belum ada dokumen PDF yang bisa dicetak.',
    }),
  });

  // Catatan: kartu "Riwayat Scan Terakhir" DIHAPUS (permintaan user) — riwayat scan tetap tercatat di
  // halaman Audit (`/sesi/:id/audit`). Jangan dihidupkan lagi.
  //
  // Catatan pengambilan barang (permintaan user): daftar TERKUNCI per penginputan (tanggal · jam ·
  // diambil dari gudang/sales lain · jumlah) beserta rincian barangnya + View Memo PDF. Tampil di
  // halaman perjalanan & Overview untuk semua status — lihat kartuPengambilan().
  const kartuAmbil = kartuPengambilan({ base, sesi, tambahan, rincian, hapusEntri: { boleh: bolehHapusEntri } });

  /*
   * Keterangan kotak "P" di halaman perjalanan (permintaan user: kolom P = jumlah barang yang
   * DIJUAL menurut sales, diisi lewat halaman penjualan `/sesi/:id/jual`).
   *  - "belum diisi"   = surat jalan belum lewat tahap penjualan (masih `kirim`, atau sudah `jual` tetapi
   *    sales belum mengisi satu pun angka);
   *  - "dilaporkan sales" = sudah ada angka P;
   *  - "tidak dilaporkan" = sudah masuk rekap/selesai tanpa angka penjualan dari sales.
   */
  const ketJual =
    (Number(tot.p) || 0) > 0
      ? `dilaporkan sales${selisihJual(tot) === 0 ? '' : ` · selisih ${angka(selisihJual(tot))}`}`
      : BOLEH_JUAL.includes(sesi.status)
        ? 'belum diisi'
        : 'tidak dilaporkan';

  // Tulisan "barang dibawa sudah dikunci" ditaruh di PALING BAWAH halaman (permintaan user)
  const pesanKunci =
    sesi.status === 'selesai'
      ? `<div class="alert alert-ok" style="margin-top:22px">Rekap selesai &amp; dikunci (${esc(sesi.selesai_at || '')}). Semua data hanya bisa dibaca.</div>`
      : sesi.status === 'draft'
        ? ''
        : `<div class="alert alert-warn" style="margin-top:22px">Jumlah barang yang dibawa sudah <b>dikunci</b> (${esc(sesi.dikunci_at || '')}) dan tidak dapat diubah.</div>`;

  return `
${kepalaPerjalanan(sesi, `<span class="pjl-extra">${esc(noSurat(sesi))}</span>`, grupIkonAksi)}
${pesan ? `<div class="alert ${sesi.status === 'draft' ? 'alert-info' : 'alert-ok'}">${esc(pesan)}</div>` : ''}

${bolehUbah ? '' : '<div class="alert alert-info">Peran kamu hanya melihat data — aksi pengubahan tidak tersedia.</div>'}

<!--
  Jumlah = satu baris berisi 3 kotak (B · T · REKAP) saat masih DRAFT, dan 4 kotak (B · T · JUAL (P) ·
  REKAP) setelah surat jalan terbit.
  Permintaan user: "kolom k dan s diganti ke rekap, 2 kolom dijadikan 1" + "rekap dihapus, mulai rekap
  dari kolom/kotak Rekap yang baru" + "pada kolom rekap gunakan warna kontras tapi senada".
  Jadi kotak K dan S digabung menjadi satu kotak **Rekap** yang:
   - menampilkan angka Setoran (S) sebagai angka utama dengan keterangan K dan kedua selisihnya,
   - menjadi SATU-SATUNYA jalan untuk mulai rekap (status kirim/jual → tombol POST rekap/mulai dengan
     popup konfirmasi bertema) atau melanjutkan hitung (status rekap → tautan ke halaman rekap),
   - berwarna kontras tapi senada: memakai gradien aksen (indigo→violet sesuai tema pengguna).
  Kotak **P** (permintaan user: "sales harus memasukkan dulu jumlah barang yang di jual … selisih di
  hitung dari s dikurangi p") muncul setelah surat jalan terbit dan hilang lagi saat masih draft
  (di draft belum ada penjualan sama sekali).
-->
<div class="info-kotak${sesi.status === 'draft' ? ' tiga' : ''}" style="margin-top:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  ${
    sesi.status === 'draft'
      ? ''
      // labelnya cukup "P" (permintaan user: *"semua keterangan jual (p) ubah ke p saja"*)
      : `<div class="kotak-info"><div class="label">P</div><div class="value">${angka(tot.p)}</div><div class="note">${ketJual}</div></div>`
  }
  ${kotakRekap(tot, { base, sesi, bolehUbah })}
</div>

<!-- Kepala tabel pekat / tidak transparan (permintaan user). Judul di atas kolom DIHAPUS atas permintaan
     user ("hapus tulisan di atas kolom pada halaman surat jalan") — catatan ini sengaja TIDAK menulis
     nama judulnya, karena komentar HTML ikut terkirim ke browser dan skrip uji memeriksa HTML mentah
     (jebakan #30). Jangan hidupkan lagi judulnya. -->
<div class="card" style="margin-top:22px">
  <div class="tbl-wrap" style="max-height:520px;overflow:auto">
    <table class="tbl rapat tbl-pekat">
      <thead><tr><th>Nama Barang</th><th class="num tengah">B</th><th class="num tengah">T</th>${
        // kepala kolom penjualan cukup "P" (permintaan user: "semua keterangan jual (p) ubah ke p saja")
        tampilP ? '<th class="num tengah">P</th>' : ''
      }<th class="num tengah">Total</th></tr></thead>
      <tbody>${baris || `<tr><td colspan="${tampilP ? 5 : 4}" class="kosong">Belum ada jumlah yang diinput.</td></tr>`}</tbody>
    </table>
  </div>
</div>
${kartuAmbil}
${kartuCatatan({ base, sesi, items })}
${pesanKunci}`;
};

/** OVERVIEW — tampilan laporan perjalanan (hanya baca) + opsi cetak. */
exports.overview = function ({ sesi, items, base, pesan, tambahan = [], rincian = new Map(), ambilan = [], bolehHapusEntri = false, bolehJual = false }) {
  /*
   * Permintaan user (revisi ke-136) — Overview laporan:
   *  - "juga otomatis urut barang a-z"  → daftar disusun A–Z (urutNama, sama seperti dokumen cetak);
   *  - "tidak usah tampilkan kolom k" & "ikon k di atas hapus"  → kolom K & kotak K DIHAPUS karena
   *    kolom K baru berisi setelah rekap;
   *  - "s ubah ke total" & "ikon s di atas ubah ke total"  → kolom/kotak S diganti label **Total**
   *    (nilainya tetap setoran efektif = B + T − K, jadi sebelum rekap Total = seluruh barang dibawa,
   *    sesudah rekap = barang yang benar-benar terjual);
   *  - "daftar barang bergerak ubah ke daftar barang dibawa" → judul kartunya diganti.
   */
  const ada = urutNama(items.filter((i) => (i.b || 0) + (i.t || 0) + (i.k || 0) > 0));
  const tot = { b: 0, t: 0, k: 0, s: 0, p: 0 };
  ada.forEach((i) => {
    tot.b += i.b; tot.t += i.t; tot.k += i.k; tot.s += setoranEfektif(i); tot.p += Number(i.p) || 0;
  });
  // selisih LAMA (B+T−K−S) — tetap ditampilkan di kotak Total/S sebagai keterangan tambahan
  const selisih = selisihBarang(tot);
  /*
   * Kotak & keterangan **P** (permintaan user: "sales harus memasukkan dulu jumlah barang yang di
   * jual mereka … selisih di hitung dari s dikurangi p"): nilai P + selisih penjualan S−P. Sama dengan
   * halaman perjalanan supaya keduanya terbaca sama.
   */
  const adaP = (Number(tot.p) || 0) > 0;
  const sj = adaP ? selisihJual(tot) : 0;
  const ketJual = adaP
    ? `dilaporkan sales${sj === 0 ? '' : ` · selisih ${angka(sj)}`}`
    : BOLEH_JUAL.includes(sesi.status)
      ? 'belum diisi'
      : 'tidak dilaporkan';
  /*
   * Permintaan user terbaru: *"Pada overview laporan selesai, tampilkan b,t,k,s nya"* — jadi **khusus
   * status `selesai`** kotak ringkasan & kolom tabelnya memakai **B · T · K · S** (K & S baru terisi
   * setelah rekap selesai). Status lain (draft/kirim/rekap) TETAP seperti revisi ke-136: kotak
   * **B · T · Total** dan tabel **Nama Barang · B · T · Total**, karena K masih 0 sebelum direkap —
   * jangan ubah bagian itu tanpa permintaan baru.
   */
  const selesai = sesi.status === 'selesai';
  /*
   * Permintaan user: *"Jika rekap sudah di kunci namun data penjualan kosong maka statusnya bukan lagi
   * ongoing, tapi menunggu data penjualan, tampilan overview nya b,t,k,s,p namun p nya kosong"*.
   *
   * Keadaan itu = rekap SUDAH dikunci tetapi penjualan (P) belum pernah diisi (`perluDataPenjualan`, cap
   * `rekap_at` terisi). Bentuk Overview-nya disamakan dengan laporan yang sudah selesai —
   * **B · T · K · S · P** dengan kolom P dibiarkan KOSONG (angka 0 tidak ditulis) — karena angka rekap
   * (K & S) memang sudah ada, hanya penjualannya yang masih menunggu.
   */
  const menungguPenjualan = perluDataPenjualan(sesi);
  const rekapSudah = selesai || menungguPenjualan;   // bentuk tabel/kotak 5 kolom: B · T · K · S · P
  /*
   * Permintaan user TERBARU (sama dengan halaman perjalanan): *"di halaman sebelum rekap berikan kolom p"*
   * → kolom **P** ditambahkan tepat di samping kolom Total/S. Saat status masih `draft` kolomnya
   * tidak ditampilkan (belum ada penjualan sama sekali).
   * Penanda MERAH pada sel P & S (S tidak sama dengan P) hanya saat perbandingannya berarti
   * (`bandingP` = sales sudah mengisi P, bukan draft) — lihat catatan di views/print.js → bolehBandingP().
   */
  const tampilP = sesi.status !== 'draft';
  /*
   * TAHAP "BELUM REKAP" (`kirim`/`jual`) — permintaan user: *"Pada overview menunggu rekap semua kolom
   * jual (p) ganti p saja, nilai total itu b+t-p dan keterangan ikon total di atas adalah barang yang
   * harus dikembalikan, ikon p di atas tidak harus berwarna karena memang sesuai dengan laporan sales,
   * kolom total di bawah itu b+t-p"*.
   *
   * Di tahap ini kolom **P** = laporan penjualan sales APA ADANYA (tanpa warna — memang sesuai laporan),
   * dan kolom **Total** = **B + T − P** = *sisa barang* (barang yang dibawa/ditambah
   * tetapi tidak dilaporkan terjual). Karena Total bukan Setoran (S) lagi, perbandingan S vs P (penanda
   * merah/hijau `beda-sp`) TIDAK dipakai di sini — penandanya tetap ada di halaman perjalanan, dokumen
   * F4, dan Overview saat sudah `rekap`/`selesai`.
   */
  const belumRekap = BELUM_REKAP.includes(sesi.status) && !menungguPenjualan;
  const totKembali = (Number(tot.b) || 0) + (Number(tot.t) || 0) - (Number(tot.p) || 0);
  /*
   * Penanda warna S & P (merah = setoran kurang, hijau = setoran lebih) hanya saat perbandingannya
   * berarti: perjalanan sudah `rekap`/`selesai` DAN sales sudah melaporkan penjualan (P > 0).
   */
  const bandingP = (sesi.status === 'rekap' || sesi.status === 'selesai') && (Number(tot.p) || 0) > 0;

  /*
   * Kolom NO/Kode tetap TIDAK ditampilkan. Untuk status selesai: B & T dikosongkan bila 0 (persis kertas),
   * sedangkan K & S selalu ditulis angkanya — sama seperti dokumen F4.
   */
  const baris = ada
    .map((i) => {
      const s = setoranEfektif(i);
      // arah selisih S vs P menentukan warna sel: kurang = MERAH, lebih = HIJAU (permintaan user)
      const arah = bandingP ? arahBedaSP(i, s) : '';
      // di tahap belum rekap: kolom P apa adanya ("terjual"), kolom Total = B + T − P ("sisa barang")
      if (belumRekap) {
        // nilai 0 dikosongkan di SEMUA kolom angka (permintaan user); kolom P tanpa warna
        const kembali = (Number(i.b) || 0) + (Number(i.t) || 0) - (Number(i.p) || 0);
        const pi = Number(i.p) || 0;
        return `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num tengah">${Number(i.b) || ''}</td>
        <td class="num tengah">${Number(i.t) || ''}</td>
        ${tampilP ? `<td class="num tengah">${pi === 0 ? '' : angka(pi)}</td>` : ''}
        <td class="num tengah">${kembali === 0 ? '' : angka(kembali)}</td>
      </tr>`;
      }
      const p = Number(i.p) || 0;
      /*
       * IKON VALID (permintaan user: tulisan "Valid" diganti ikon dan dipindah **dari kolom S ke kolom P**,
       * gambar kiriman user = centang putih di bulatan hijau) — berlaku di Overview & dokumen PDF:
       * kalau laporan penjualan sales (P) SAMA dengan setoran hasil rekap (S), **kolom P** menampilkan
       * ikonnya sedangkan **kolom S/Total tetap menampilkan angka** setorannya.
       */
      /*
       * Permintaan user TERBARU: ikon VALID hanya untuk baris yang penjualannya BENAR-BENAR ada
       * (P > 0). Kalau P = 0 — apa pun setorannya, biasanya juga 0 — selnya dibiarkan KOSONG dan
       * TIDAK dicentang. Sebelum ini laporan seperti ZA008 (hampir seluruh barisnya P = 0 & S = 0)
       * jadi penuh ikon centang padahal tidak ada penjualan yang dilaporkan sama sekali.
       */
      const valid = bandingP && p > 0 && p === s;
      return rekapSudah
        ? `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num tengah">${Number(i.b) || ''}</td>
        <td class="num tengah">${Number(i.t) || ''}</td>
        <td class="num tengah">${Number(i.k) || ''}</td>
        <td class="num tengah${arah && !valid ? ' beda-sp ' + arah : ''}">${s === 0 ? '' : angka(s)}</td>
        <td class="num tengah${valid ? ' valid-ikon' : arah ? ' beda-sp ' + arah : ''}">${valid ? IKON_VALID : p === 0 ? '' : angka(p)}</td>
      </tr>`
        : `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num tengah">${Number(i.b) || ''}</td>
        <td class="num tengah">${Number(i.t) || ''}</td>
        ${tampilP ? `<td class="num tengah${valid ? ' valid-ikon' : arah ? ' beda-sp ' + arah : ''}">${valid ? IKON_VALID : p === 0 ? '' : angka(p)}</td>` : ''}
        <td class="num tengah${arah && !valid ? ' beda-sp ' + arah : ''}">${s === 0 ? '' : angka(s)}</td>
      </tr>`;
    })
    .join('');

  /*
   * Ikon Audit = pojok kanan atas, LURUS dengan nama sales (permintaan user). Ditaruh lewat
   * `opsi.ikonAtas` — bukan lagi `.pjl-alat`, karena wadah itu di HP melebar penuh sehingga ikonnya
   * turun ke baris sendiri (terukur 65–94 px di bawah nama).
   */
  const ikonAudit = `
    <a class="ttk-tombol pjl-ikon" href="${base}/sesi/${sesi.id}/audit"
       title="Audit perubahan perjalanan" aria-label="Audit perubahan perjalanan">${AUDIT}</a>`;
  /*
   * Ikon PENJUALAN di pojok kanan atas (sebelah ikon Audit) — permintaan user: *"sales dan admin juga bisa
   * memasukkan jumlah penjualan"*. Ditampilkan selama kolom P masih boleh diisi (status `kirim`/`jual`)
   * dan hanya untuk yang berhak (`bolehJual`: administrator/admin gudang untuk semua surat jalan, sales
   * hanya untuk surat jalan miliknya). Alasannya: baris Dasbor/Laporan membuka **Overview**, jadi tanpa
   * ikon di sini sales tidak punya jalan masuk ke halaman penjualan.
   */
  const ikonJual =
    bolehJual && BOLEH_JUAL.includes(sesi.status)
      ? `<a class="ttk-tombol pjl-ikon" href="${base}/sesi/${sesi.id}/jual"
           title="Input jumlah barang terjual (P)" aria-label="Input jumlah barang terjual">${JUAL}</a>`
      : '';

  return `
${kepalaPerjalanan(sesi, `<span class="pjl-extra">Overview laporan</span>`, '', { geserKembali: base + '/', ikonAtas: ikonJual + ikonAudit })}
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

${
  rekapSudah
    ? `<div class="info-kotak lima" style="margin-bottom:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  <div class="kotak-info"><div class="label">K</div><div class="value">${angka(tot.k)}</div><div class="note">kembali</div></div>
  <div class="kotak-info${selisih === 0 ? '' : ' kotak-waspada'}"><div class="label">S</div><div class="value">${angka(tot.s)}</div><div class="note">${selisih === 0 ? 'jumlah barang' : `jumlah barang · selisih ${angka(selisih)}`}</div></div>
  <div class="kotak-info${sj === 0 ? '' : ' kotak-waspada'}"><div class="label">P</div><div class="value">${angka(tot.p)}</div><div class="note">${ketJual}</div></div>
</div>`
    : belumRekap
      ? `<div class="info-kotak" style="margin-bottom:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  <!--
    Kolom P: laporan penjualan sales APA ADANYA — sengaja TANPA warna (permintaan user).
    Keterangannya **"terjual"** (permintaan user: *"keterangan p di kotak atas itu terjual"*) — dulu
    "sesuai laporan sales"; jangan kembali ke kalimat panjang itu.
  -->
  <div class="kotak-info"><div class="label">P</div><div class="value">${angka(tot.p)}</div><div class="note">terjual</div></div>
  <!--
    Kolom Total di tahap ini = B + T − P dan keterangannya **"sisa barang"**
    (permintaan user: *"keterangan total itu sisa barang"*) — menggantikan "barang yang harus dikembalikan".
  -->
  <div class="kotak-info${totKembali < 0 ? ' kotak-waspada' : ''}"><div class="label">Total</div><div class="value">${angka(totKembali)}</div><div class="note">sisa barang</div></div>
</div>`
      : `<div class="info-kotak${sesi.status === 'draft' ? ' tiga' : ''}" style="margin-bottom:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  ${
    sesi.status === 'draft'
      ? ''
      : `<div class="kotak-info${sj === 0 ? '' : ' kotak-waspada'}"><div class="label">P</div><div class="value">${angka(tot.p)}</div><div class="note">${ketJual}</div></div>`
  }
  <div class="kotak-info${selisih === 0 ? '' : ' kotak-waspada'}"><div class="label">Total</div><div class="value">${angka(tot.s)}</div><div class="note">${selisih === 0 ? 'jumlah barang' : `jumlah barang · selisih ${angka(selisih)}`}</div></div>
</div>`
}

<div class="card" style="margin-bottom:22px">
  <h2 class="card-title-heading">Daftar Barang Dibawa</h2>
  <div class="tbl-wrap" style="max-height:520px;overflow:auto">
    <table class="tbl rapat tbl-pekat">
      <thead><tr><th>Nama Barang</th><th class="num tengah">B</th><th class="num tengah">T</th>${
        rekapSudah
          ? '<th class="num tengah">K</th><th class="num tengah">S</th><th class="num tengah">P</th>'
          : // kepala kolom penjualan cukup "P" di SEMUA tahap (permintaan user)
            `${tampilP ? '<th class="num tengah">P</th>' : ''}<th class="num tengah">Total</th>`
      }</tr></thead>
      <tbody>${baris || `<tr><td colspan="${rekapSudah ? 6 : tampilP ? 5 : 4}" class="kosong">Belum ada barang yang dibawa di perjalanan ini.</td></tr>`}</tbody>
    </table>
  </div>
</div>
${kartuPengambilan({ base, sesi, tambahan, rincian, hapusEntri: { boleh: bolehHapusEntri } })}
${kartuCatatan({ base, sesi, items })}`;
};

/** AUDIT — daftar perubahan apa saja di perjalanan ini (siapa, kapan, sebelum → sesudah). */
exports.audit = function ({ sesi, catatan, base, pesan }) {
  const daftar = catatan || [];

  const ubah = (d) => {
    let detail = [];
    try { detail = JSON.parse(d.detail || '[]'); } catch (e) { detail = []; }
    if (!detail.length) return '';
    return `<ul class="audit-detail">${detail
      .map((x) => {
        if (x.sebelum === undefined) return `<li><b>${esc(x.kolom || '')}</b> → <span class="audit-baru">${esc(x.sesudah)}</span></li>`;
        return `<li><b>${esc(x.kolom || '')}</b>: <span class="audit-lama">${esc(x.sebelum)}</span> → <span class="audit-baru">${esc(x.sesudah)}</span></li>`;
      })
      .join('')}</ul>`;
  };

  const baris = daftar
    .map((d, n) => {
      // Permintaan user: kolom riwayat cukup Waktu · Petugas · Aksi; rinciannya muncul di baris
      // terpisah di bawahnya saat barisnya diklik (klik lagi = disembunyikan lagi). Tidak ada tulisan
      // "klik untuk lihat" — penanda buka/tutup cukup tanda panah kecil di kolom Aksi (CSS).
      const id = 'audit_' + n;
      const rinci = `${d.ringkas ? `<div class="audit-ringkas">${esc(d.ringkas)}</div>` : ''}${ubah(d)}`;
      return `<tr class="audit-baris" data-audit-baris="${id}" tabindex="0" role="button" aria-expanded="false" aria-controls="${id}">
        <td class="kode">${esc(d.waktu)}</td>
        <td><b>${esc(d.petugas_nama || '-')}</b><div class="kode">${esc((d.peran || '').replace('_', ' '))}</div></td>
        <td class="audit-aksi"><span class="badge b-biru">${esc(d.aksi)}</span></td>
      </tr>
      <tr class="audit-rinci" id="${id}" data-audit-rinci hidden><td colspan="3">${rinci || '<span class="kode">tidak ada rincian perubahan</span>'}</td></tr>`;
    })
    .join('');

  return `
<div class="page-head">
  <div>
    <h1>Audit Surat Jalan ${esc(noSurat(sesi))}</h1>
    <div class="sub">${esc(sesi.sales_nama || '-')} · ${esc(tanggalPanjang(sesi.tanggal))} · ${daftar.length} catatan perubahan</div>
  </div>
  <div class="aksi">
    <a class="btn btn-ghost" href="${base}/sesi/${sesi.id}/overview">Overview</a>
    <a class="btn btn-ghost" href="${base}/">Kembali ke Dasbor</a>
  </div>
</div>
${kepalaPerjalanan(sesi, `<span class="pjl-extra">${daftar.length} catatan perubahan</span>`)}
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
<div class="card">
  <div class="tbl-wrap">
    <table class="tbl">
      <thead><tr><th>Waktu</th><th>Petugas</th><th>Aksi</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="3" class="kosong">Belum ada perubahan yang tercatat untuk perjalanan ini.</td></tr>'}</tbody>
    </table>
  </div>
</div>`;
};
