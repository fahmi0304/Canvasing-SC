'use strict';
const { esc, angka, tanggalPanjang, tanggalPendek, setoranEfektif, statusInfo, pisahCatatan, urutNama } = require('../lib/util');
const { opsiCetak } = require('./cetak');
const { grupAksi } = require('./aksi-ikon');
const { PLUS, PENSIL, RETUR, REKAP, SELESAI, KUNCI, AUDIT, HAPUS } = require('./ikon');
const { noSurat } = require('../lib/kode');
const { VERSI_MEMO } = require('../lib/memoEntri');

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
  if (!sumber || sumber === 'gudang') return 'Gudang';
  return t.kode_sumber ? `${t.kode_sumber} · ${t.sumber}` : `Sales ${t.sumber}`;
}

/**
 * KARTU "EXPEDISI BARANG" (dulu "Catatan Pengambilan Barang") — permintaan user: catatan pengambilan
 * barang (tgl/pukul · mengambil barang · dari gudang atau sales lain · sebanyak 000 pcs) muncul BESERTA
 * RINCIANNYA di halaman perjalanan DAN Overview, untuk semua status (draft, ongoing, selesai), sebagai
 * daftar TERKUNCI (tidak ada tombol ubah/hapus).
 * Permintaan user terbaru: judulnya diubah menjadi "Ekspedisi Barang" dan keterangan di bawah judul
 * (bagian yang menjelaskan bahwa catatannya otomatis & terkunci) DIHAPUS — jangan dihidupkan lagi.
 * `tambahan` = daftar entri (tambahan_batch) milik perjalanan ini; `rincian` = Map(batch_id → barang).
 */
function kartuPengambilan({ base, sesi, tambahan = [], rincian = new Map() }) {
  const total = tambahan.reduce((a, b) => a + (b.total || 0), 0);
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
  const baris = tambahan
    .map((t) => {
      const barang = rincian.get(t.id) || [];
      const rinci =
        barang.length
          ? `<details class="rinci"><summary>Lihat rincian ${barang.length} jenis barang (${angka(t.total)} pcs)</summary>
              <ul class="rinci-list">${barang.map((b) => `<li><span class="rinci-nama">${esc(b.nama)}</span><b>× ${angka(b.qty)}</b></li>`).join('')}</ul>
            </details>`
          : '<span class="kode">tidak ada rincian barang</span>';
      // baris pemisah tanggal — hanya dicetak saat tanggalnya BERBEDA dari entri sebelumnya
      let kepalaTanggal = '';
      if (t.tanggal !== tanggalTerakhir) {
        tanggalTerakhir = t.tanggal;
        kepalaTanggal = `<tr class="baris-tanggal" data-tanggal-pisah="${esc(t.tanggal)}"><td colspan="5">${esc(tanggalPendek(t.tanggal))}</td></tr>`;
      }
      return `${kepalaTanggal}<tr data-batch="${t.id}" data-tanggal="${esc(t.tanggal)}" data-jam="${esc(t.jam_mulai)}" data-sumber="${esc(t.sumber || 'gudang')}">
        <td class="kode">${esc(t.jam_mulai)} WITA</td>
        <td>${esc(labelSumber(t))}${t.sumber_sesi_id ? ` <small class="kode">(dikurangi ${angka(t.sumber_qty)})</small>` : ''}</td>
        <td class="num">${angka(t.total)}</td>
        <td><span class="badge b-abu">Terkunci</span></td>
        <td class="tengah"><a class="btn btn-ghost btn-sm" data-view-memo="${t.id}" target="_blank" rel="noopener" href="${base}/cetak/memo-tambahan/${sesi.id}/${t.id}?tampil=1&v=${VERSI_MEMO}">📄 View Memo</a></td>
      </tr>
      <tr class="baris-rinci"><td colspan="5">${rinci}</td></tr>`;
    })
    .join('');
  return `
<div class="card pengambilan-card" style="margin-top:22px">
  <h2 class="card-title-heading">Ekspedisi Barang</h2>
  ${
    tambahan.length
      ? `<div class="tbl-wrap" style="max-height:420px;overflow:auto">
    <table class="tbl rapat tbl-pekat tbl-tengah" id="tblPengambilan">
      <thead><tr><th>Jam</th><th>Diambil dari</th><th class="num">Jumlah (pcs)</th><th>Status</th><th class="tengah">View Memo</th></tr></thead>
      <tbody>${baris}</tbody>
      <tfoot><tr><td colspan="2"><b>Total pengambilan</b></td><td class="num"><b>${angka(total)}</b></td><td colspan="2"></td></tr></tfoot>
    </table>
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
function kartuCatatan({ base, sesi }) {
  const { manual, otomatis } = pisahCatatan(sesi.catatan);
  const terkunci = sesi.status === 'selesai';
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
    <ul id="listCatatanOtomatis" class="rinci-list">${otomatis.map((b, i) => `<li data-otomatis="1"><span class="rinci-no">${i + 1}.</span><span class="rinci-nama">${esc(b)}</span></li>`).join('')}</ul>
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
  const info = statusInfo(sesi.status);
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
 *  - status `kirim` & barang dibawa > 0 → tombol POST `/sesi/:id/rekap/mulai` (popup konfirmasi bertema
 *    lewat `data-konfirmasi-tema` yang sudah ditangani public/app.js);
 *  - selain itu → kotak biasa (tidak bisa diklik) dengan keterangan alasannya.
 */
function kotakRekap(tot, selisih, { base, sesi, bolehUbah }) {
  const waspada = selisih === 0 ? '' : ' kotak-waspada';
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
  const isiDefault = isi(`K ${angka(tot.k)}${selisih === 0 ? '' : ` · selisih ${angka(selisih)}`}`);
  if (!bolehUbah) return `<div class="kotak-info${waspada}">${isiDefault}</div>`;
  if (sesi.status === 'rekap') {
    return `<a class="kotak-info kotak-rekap${waspada}" href="${base}/sesi/${sesi.id}/rekap"
      title="Lanjut hitung barang kembali (isi kolom Rekap)">${isiDefault}</a>`;
  }
  if (sesi.status === 'kirim' && (Number(tot.b) || 0) > 0) {
    return `<form method="post" action="${base}/sesi/${sesi.id}/rekap/mulai" class="kotak-rekap-form">
      <button type="submit" class="kotak-info kotak-rekap${waspada}" title="Mulai rekap — hitung barang kembali"
        data-konfirmasi-tema data-judul="Mulai rekap?"
        data-pesan="Barang tambahan dikunci dan penghitungan barang kembali dibuka." data-ok="Ya, mulai rekap">${isiDefault}</button>
    </form>`;
  }
  // Status selesai tidak "menunggu" apa pun lagi → tampilkan keterangan K & selisih seperti biasa.
  if (sesi.status === 'selesai') return `<div class="kotak-info${waspada}">${isiDefault}</div>`;
  const ket = Number(tot.b) || 0 ? 'menunggu' : 'isi barang dibawa dulu';
  return `<div class="kotak-info${waspada}">${isi(ket)}</div>`;
}

exports.detail = function ({ sesi, items, base, pesan, scan, bolehUbah = true, bolehHapus = true, tambahan = [], rincian = new Map(), ambilan = [] }) {
  const tot = { b: 0, t: 0, k: 0, s: 0 };
  items.forEach((i) => {
    tot.b += i.b; tot.t += i.t; tot.k += i.k; tot.s += setoranEfektif(i);
  });
  const selisih = tot.b + tot.t - tot.k - tot.s;
  const ada = items.filter((i) => i.b + i.t + i.k > 0);

  /*
   * Permintaan user: rincian barang tanpa kolom NO & Kode, dan tanpa keterangan di atas tabel.
   *
   * Permintaan user (keluhan "setelah rekap kolom S yang kosong kolomnya jadi full hitam, bukan lagi
   * nol"): kolom **S selalu ditulis angkanya** — barang yang setorannya 0 (semua bawaannya kembali)
   * ditulis "0", bukan sel KOSONG. Sebelumnya selnya dibiarkan kosong (`${s || ''}`), sehingga setelah
   * rekap separuh kolom S tampak kosong/gelap. Aturan yang sama sudah dipakai dokumen cetak
   * (`views/print.js → barisBTKS`) dan halaman Overview, jadi sekarang layar & kertas sama.
   * Kolom B & T tetap dikosongkan saat 0 (sama seperti kertas).
   */
  const baris = ada
    .map((i) => {
      const s = setoranEfektif(i);
      return `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num">${i.b || ''}</td>
        <td class="num">${i.t || ''}</td>
        <td class="num">${i.k || ''}</td>
        <td class="num">${angka(s)}</td>
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
  if (sesi.status === 'kirim') {
    if (bolehUbah) {
      aksiIkon.push({ href: `${base}/sesi/${sesi.id}/tambahan`, ikon: PLUS, judul: 'Input Tambahan Barang (T)', ket: 'Tambahan' });
      // Permintaan user: ikon Retur di samping Tambahan MENGGANTIKAN ikon Rekap; mulai rekap lewat
      // kotak "Rekap" di baris kotak B/T/Rekap (lihat kotakRekap()).
      aksiIkon.push({ href: `${base}/sesi/${sesi.id}/retur`, ikon: RETUR, judul: 'Retur / kembalikan barang ke gudang', ket: 'Retur' });
    }
  }
  if (sesi.status === 'rekap') {
    if (bolehUbah) {
      // Lanjut hitung rekap TIDAK lagi berupa ikon (permintaan user: ikon Rekap diganti Retur) —
      // melanjutkan rekap dari kotak "Rekap" di baris kotak B/T/Rekap.
      aksiIkon.push({ href: `${base}/sesi/${sesi.id}/tambahan`, ikon: PLUS, judul: 'Input Tambahan (T)', ket: 'Tambahan' });
      aksiIkon.push({ href: `${base}/sesi/${sesi.id}/retur`, ikon: RETUR, judul: 'Retur / kembalikan barang ke gudang', ket: 'Retur' });
      aksiIkon.push({
        form: `${base}/sesi/${sesi.id}/selesai`,
        ikon: SELESAI,
        judul: 'Selesaikan Rekap & Kunci',
        ket: 'Selesai',
        attr: konfirmasi('Selesaikan rekap & kunci semua data?', 'Angka tidak dapat diubah lagi setelah ini dan laporan lengkap F4 siap dicetak.', 'Ya, selesaikan'),
      });
    }
  }
  /*
   * Semua opsi cetak sekarang = berkas PDF yang dibuat server (permintaan user: "Semua cetak dokumen
   * laporan digabung ke cetak PDF, langsung cetak PDF saja, 1 ikon"):
   *  - surat jalan & laporan lengkap → PDF F4 (1 halaman, tanpa header/footer);
   *  - barcode barang → PDF label (kertas gulungan 58 mm, QR).
   * Permintaan user terbaru: "cetak memo di logo print tidak usah" → opsi **PDF Memo Pengambilan
   * DIHAPUS dari menu logo printer** di halaman ini (dan halaman rekap). Memonya tetap bisa dilihat
   * per penginputan lewat kolom **View Memo** di kartu "Ekspedisi Barang" serta dari menu baris
   * halaman Laporan — jadi tidak ada fungsi yang hilang. Jangan dihidupkan lagi di menu cetak.
   */
  if (sesi.status !== 'draft')
    cetak(`/cetak/surat-jalan-pdf/${sesi.id}`, 'PDF Surat Jalan & Setoran (F4)', 'terbuka di penampil PDF · kertas F4');
  if (sesi.status === 'selesai')
    cetak(`/cetak/laporan-pdf/${sesi.id}`, 'PDF Laporan Lengkap (F4)', 'terbuka di penampil PDF · semua kolom B/T/K/S');
  // Permintaan user: opsi "Cetak Barcode Barang" DIHAPUS untuk surat jalan yang masih ONGOING
  // (kirim/rekap) — hanya status selesai yang menyediakannya di halaman ini. Cetak barcode tetap bisa
  // dilakukan dari halaman Inventory (`/label`), jadi tidak ada fungsi yang hilang.
  if (sesi.status === 'selesai') cetak(`/cetak/label-pdf?sesi=${sesi.id}`, 'PDF Barcode Barang', 'terbuka di penampil PDF · label QR gulungan 58 mm');

  // Audit: ikon sejajar dengan ikon aksi lainnya (permintaan user)
  aksiIkon.push({ href: `${base}/sesi/${sesi.id}/audit`, ikon: AUDIT, judul: 'Audit perubahan perjalanan', ket: 'Audit' });

  const grupIkonAksi = grupAksi({
    items: aksiIkon,
    // Permintaan user: setiap ikon punya keterangan kecil di bawahnya — termasuk ikon cetak.
    // Status draft tidak dirender sama sekali (tidak ada opsi cetak).
    ekstra: sesi.status === 'draft' ? '' : opsiCetak({
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
  const kartuAmbil = kartuPengambilan({ base, sesi, tambahan, rincian });

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
  Jumlah = satu baris berisi 3 kotak: B · T · REKAP.
  Permintaan user: "kolom k dan s diganti ke rekap, 2 kolom dijadikan 1" + "rekap dihapus, mulai rekap
  dari kolom/kotak Rekap yang baru" + "pada kolom rekap gunakan warna kontras tapi senada".
  Jadi kotak K dan S digabung menjadi satu kotak **Rekap** yang:
   - menampilkan angka Setoran (S) sebagai angka utama dengan keterangan K dan selisihnya,
   - menjadi SATU-SATUNYA jalan untuk mulai rekap (status kirim → tombol POST rekap/mulai dengan popup
     konfirmasi bertema) atau melanjutkan hitung (status rekap → tautan ke halaman rekap),
   - berwarna kontras tapi senada: memakai gradien aksen (indigo→violet sesuai tema pengguna).
-->
<div class="info-kotak tiga" style="margin-top:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  ${kotakRekap(tot, selisih, { base, sesi, bolehUbah })}
</div>

<!-- Kepala tabel pekat / tidak transparan (permintaan user). Judul di atas kolom DIHAPUS atas permintaan
     user ("hapus tulisan di atas kolom pada halaman surat jalan") — catatan ini sengaja TIDAK menulis
     nama judulnya, karena komentar HTML ikut terkirim ke browser dan skrip uji memeriksa HTML mentah
     (jebakan #30). Jangan hidupkan lagi judulnya. -->
<div class="card" style="margin-top:22px">
  <div class="tbl-wrap" style="max-height:520px;overflow:auto">
    <table class="tbl rapat tbl-pekat">
      <thead><tr><th>Nama Barang</th><th class="num">B</th><th class="num">T</th><th class="num">K</th><th class="num">S</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="5" class="kosong">Belum ada jumlah yang diinput.</td></tr>'}</tbody>
    </table>
  </div>
</div>
${kartuAmbil}
${kartuCatatan({ base, sesi })}
${pesanKunci}`;
};

/** OVERVIEW — tampilan laporan perjalanan (hanya baca) + opsi cetak. */
exports.overview = function ({ sesi, items, base, pesan, tambahan = [], rincian = new Map(), ambilan = [] }) {
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
  const tot = { b: 0, t: 0, k: 0, s: 0 };
  ada.forEach((i) => {
    tot.b += i.b; tot.t += i.t; tot.k += i.k; tot.s += setoranEfektif(i);
  });
  const selisih = tot.b + tot.t - tot.k - tot.s;

  // Permintaan user: tidak ada kolom NO/Kode/K — cukup Nama Barang + B + T + Total.
  // "kolom b,t, dan total rata tengah" → kelas `tengah` pada th & td (menang atas `.num` yang rata kanan).
  const baris = ada
    .map(
      (i) => `<tr data-kode="${esc(i.kode)}">
        <td>${esc(i.nama)}</td>
        <td class="num tengah">${i.b || ''}</td>
        <td class="num tengah">${i.t || ''}</td>
        <td class="num tengah">${setoranEfektif(i) || 0}</td>
      </tr>`
    )
    .join('');

  /*
   * Ikon Audit = pojok kanan atas, LURUS dengan nama sales (permintaan user). Ditaruh lewat
   * `opsi.ikonAtas` — bukan lagi `.pjl-alat`, karena wadah itu di HP melebar penuh sehingga ikonnya
   * turun ke baris sendiri (terukur 65–94 px di bawah nama).
   */
  const ikonAudit = `
    <a class="ttk-tombol pjl-ikon" href="${base}/sesi/${sesi.id}/audit"
       title="Audit perubahan perjalanan" aria-label="Audit perubahan perjalanan">${AUDIT}</a>`;

  return `
${kepalaPerjalanan(sesi, `<span class="pjl-extra">Overview laporan</span>`, '', { geserKembali: base + '/', ikonAtas: ikonAudit })}
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="info-kotak tiga" style="margin-bottom:20px">
  <div class="kotak-info"><div class="label">B</div><div class="value">${angka(tot.b)}</div><div class="note">dibawa</div></div>
  <div class="kotak-info"><div class="label">T</div><div class="value">${angka(tot.t)}</div><div class="note">tambahan</div></div>
  <div class="kotak-info${selisih === 0 ? '' : ' kotak-waspada'}"><div class="label">Total</div><div class="value">${angka(tot.s)}</div><div class="note">${selisih === 0 ? 'jumlah barang' : `jumlah barang · selisih ${angka(selisih)}`}</div></div>
</div>

<div class="card" style="margin-bottom:22px">
  <h2 class="card-title-heading">Daftar Barang Dibawa</h2>
  <div class="tbl-wrap" style="max-height:520px;overflow:auto">
    <table class="tbl rapat tbl-pekat">
      <thead><tr><th>Nama Barang</th><th class="num tengah">B</th><th class="num tengah">T</th><th class="num tengah">Total</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="4" class="kosong">Belum ada barang yang dibawa di perjalanan ini.</td></tr>'}</tbody>
    </table>
  </div>
</div>
${kartuPengambilan({ base, sesi, tambahan, rincian })}
${kartuCatatan({ base, sesi })}`;
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
