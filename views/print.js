'use strict';
const { esc, angka, tanggalPanjang, tanggalPendek, setoranEfektif, pisahCatatan, namaAdminSesi, urutNama } = require('../lib/util');
const barcode = require('../lib/barcode');
const { noSurat } = require('../lib/kode');
const { semua: setelanSemua, logoDokumen, UKURAN: UKURAN_LOGO } = require('../lib/setelan');

/**
 * Pengali tinggi logo di kop menurut pilihan "Ukuran logo" (Setting → Edit Logo & Layout Surat).
 * `sedang` = 1 → logo pas setinggi blok No/Nama/Tanggal (perilaku lama, lihat rumus .kop-logo di
 * print.css); nilai ini ditulis ke variabel CSS `--logo-skala` pada elemen gambarnya.
 */
const SKALA_LOGO = Object.keys(UKURAN_LOGO).reduce((a, k) => {
  a[k] = UKURAN_LOGO[k].skala;
  return a;
}, {});

/**
 * Kerangka halaman cetak.
 *
 * Catatan penting (permintaan user: "Semua cetak dokumen laporan digabung ke cetak PDF … halaman cetak
 * HTML lama beserta panduan kertasnya hapus saja"): halaman-halaman ini **tidak lagi dibuka pengguna**
 * — semuanya hanya dipakai SERVER sebagai sumber berkas PDF (`lib/pdfF4.js` merender halaman ini di
 * Chromium lalu menyimpannya sebagai PDF). Karena itu:
 *  - panel "Panduan cetak" (memilih kertas F4 di dialog cetak) DIHAPUS — pengguna tidak pernah menyetel
 *    kertas lagi karena ukuran kertas sudah pasti dari `print.css`;
 *  - tombol "Unduh PDF F4" di sini DIHAPUS (tautan PDF sekarang ada di menu aplikasi, `/cetak/*-pdf`).
 * Bilah `no-print` (tidak ikut tercetak) tetap ada untuk keperluan darurat: kalau ada yang membuka URL
 * halaman ini langsung, tombol Cetak/Kembali tetap bekerja.
 */
function kerangka({ base, judul, isi, extraCss = '', kembali = '' }) {
  // Semua dokumen kertas memakai F4 standar 215 x 330 mm dengan margin standar 10 mm (lihat print.css).
  // `kembali` = URL cadangan tombol "Kembali" (permintaan user: "Tombol kembali di halaman cetak tidak
  // berfungsi"). Dulu tombolnya `href="javascript:history.back()"` — mati total kalau halaman dibuka di
  // TAB BARU (target="_blank", tidak ada riwayat). Sekarang tautannya URL sungguhan + skrip kecil yang
  // memakai `history.back()` HANYA kalau memang ada halaman sebelumnya dari aplikasi ini.
  const urlKembali = kembali || `${base || ''}/`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(judul)}</title>
<link rel="stylesheet" href="${base}/print.css">
<style>${extraCss}</style>
</head>
<body class="lembar" data-kembali="${esc(urlKembali)}">
<div class="bar-cetak">
  <button class="utama" type="button" id="btnCetak">Cetak / Simpan PDF</button>
  <a href="${esc(urlKembali)}" id="btnKembali" rel="prev">Kembali</a>
</div>

<script>
(function () {
  /* Tombol Cetak: beberapa browser/WebView memblokir window.print() langsung dari atribut onclick
     kalau tab-nya tidak fokus — lewat handler ini tombolnya tetap bekerja, dan kalau gagal pengguna
     diberi tahu lewat judul tombol + panggilan ulang setelah tab difokuskan. */
  document.getElementById('btnCetak').addEventListener('click', function () {
    try { window.focus(); window.print(); }
    catch (e) { alert('Pencetakan diblokir browser ini — silakan tekan Ctrl+P / Cmd+P.'); }
  });
  /* Tombol Kembali: pakai riwayat HANYA kalau ada halaman sebelumnya dari aplikasi ini, kalau tidak
     ikuti tautan cadangannya (halaman cetak sering dibuka di tab baru sehingga riwayatnya kosong). */
  document.getElementById('btnKembali').addEventListener('click', function (ev) {
    var kembali = document.body.getAttribute('data-kembali') || '';
    var adaRiwayat = false;
    try { adaRiwayat = window.history.length > 1 && document.referrer && document.referrer.indexOf(location.origin) === 0; } catch (e) { adaRiwayat = false; }
    if (!adaRiwayat) return;            // ikuti href (URL cadangan)
    ev.preventDefault();
    window.history.back();
    // kalau ternyata tetap tidak berpindah (riwayat kosong), baru pakai URL cadangan
    setTimeout(function () { if (kembali) location.href = kembali; }, 400);
  });
})();
</script>
${isi}
<script>
/*
 * Ukuran font laporan: mulai dari 12pt (permintaan user: "font 12") dan diturunkan
 * sedikit hanya kalau daftar barangnya panjang, supaya tetap muat 1 halaman F4.
 *
 * Surat jalan (permintaan user): baris barang mengisi kolom KIRI dulu sampai bawah halaman, baru
 * sisanya dipindah ke kolom KANAN. Dipanggil dari pasFontLaporan supaya ikut disesuaikan setiap kali
 * ukuran huruf berubah — jumlah baris yang muat bergantung pada tinggi baris huruf terpilih.
 */
function bagiKolomSuratJalan(dok, tinggiRuang) {
  var kiri = dok.querySelector('#tblKiri');
  var kanan = dok.querySelector('#tblKanan');
  if (!kiri || !kanan || !kiri.tBodies[0] || !kanan.tBodies[0]) return; // bukan dokumen surat jalan
  var bk = kiri.tBodies[0];
  var bn = kanan.tBodies[0];

  // semua baris dikembalikan ke kolom kiri dulu, lalu dipindah lagi sesuai ruang yang ada
  var semua = Array.prototype.slice.call(bk.rows).concat(Array.prototype.slice.call(bn.rows));
  var frag = document.createDocumentFragment();
  semua.forEach(function (tr) { frag.appendChild(tr); });
  bk.appendChild(frag);

  if (semua.length < 2 || semua[0].classList.contains('kosong-doc')) {
    kanan.classList.add('sembunyi'); // tidak ada barang bergerak
    return;
  }

  var px = 96 / 25.4;
  var batas = dok.getBoundingClientRect().top + tinggiRuang * px; // dasar area cetak
  var awal = kiri.getBoundingClientRect();
  var kepala = kiri.tHead ? kiri.tHead.getBoundingClientRect().height : 0;
  var tinggiBaris = (awal.height - kepala) / bk.rows.length || 1;
  var muat = Math.floor((batas - awal.top - kepala) / tinggiBaris);
  if (muat < 1) muat = 1;
  if (muat > bk.rows.length) muat = bk.rows.length;

  var sisa = Array.prototype.slice.call(bk.rows).slice(muat);
  var frag2 = document.createDocumentFragment();
  sisa.forEach(function (tr) { frag2.appendChild(tr); });
  bn.appendChild(frag2);

  // baris bisa berbeda tinggi (nama panjang terbungkus dua baris) — periksa & rapikan
  var jaga = 0;
  while (bk.rows.length > 1 && kiri.getBoundingClientRect().bottom > batas - 0.5 && jaga++ < 800) {
    bn.insertBefore(bk.rows[bk.rows.length - 1], bn.firstChild);
  }
  jaga = 0;
  while (bn.rows.length && jaga++ < 800) {
    var tr = bn.rows[0];
    bk.appendChild(tr);
    if (kiri.getBoundingClientRect().bottom > batas - 0.5) {
      bn.insertBefore(tr, bn.firstChild);
      break;
    }
  }

  /*
   * KOLOM KANAN juga tidak boleh melewati dasar halaman: kolom kanan memuat sisa baris + akumulasi
   * B/T/K/S + catatan + tanda tangan. Tanpa pemeriksaan ini, dokumen bisa pecah jadi 2 HALAMAN walau
   * kolom kiri sudah pas (mis. catatan panjang atau banyak sisa baris) — dan mengecilkan huruf pun
   * tidak selalu cukup karena sisanya tetap di kolom kanan.
   * Caranya: kalau kolom kanan melewati batas, pindahkan baris PERTAMA kolom kanan ke kolom KIRI
   * (kolom kanan jadi lebih pendek); kalau kolom kiri ikut melewati batas, batalkan (dokumen memang
   * terlalu besar → biarkan pemilihan ukuran huruf yang mengecilkannya).
   */
  var sjKanan = dok.querySelector('.sj-kanan');
  jaga = 0;
  while (sjKanan && bn.rows.length > 1 && jaga++ < 800) {
    var tKanan = sjKanan.getBoundingClientRect();
    if (tKanan.bottom <= batas - 0.5) break;
    var pindah = bn.rows[0];
    bk.appendChild(pindah);
    if (kiri.getBoundingClientRect().bottom > batas - 0.5) {
      bn.insertBefore(pindah, bn.firstChild);   // kolom kiri jadi terlalu tinggi → batalkan
      break;
    }
  }

  if (bn.rows.length) kanan.classList.remove('sembunyi');
  else kanan.classList.add('sembunyi');
}

window.pasFontLaporan = function () {
  var ruang = 310; // mm: F4 330mm - margin 10mm atas+bawah
  try {
    for (var i = 0; i < document.styleSheets.length; i++) {
      var aturan;
      try { aturan = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; j < aturan.length; j++) {
        if ((aturan[j].cssText || '').indexOf('@page') !== 0) continue;
        var ukuran = (aturan[j].style.size || '').replace(/mm/g, '').trim().split(/\s+/).map(Number);
        var marg = (aturan[j].style.margin || '').replace(/mm/g, '').trim().split(/\s+/).map(Number);
        var tinggi = ukuran[1] || 330;
        var atas = marg[0] || 0;
        var bawah = marg.length > 2 ? marg[2] : atas;
        ruang = tinggi - atas - bawah;
        i = document.styleSheets.length;
        break;
      }
    }
  } catch (e) { /* pakai nilai bawaan */ }

  var px = 96 / 25.4;
  function tinggiIsi(el) {
    var atas = el.getBoundingClientRect().top, bawah = 0;
    Array.prototype.forEach.call(el.children, function (c) {
      var r = c.getBoundingClientRect();
      if (r.height > 0) bawah = Math.max(bawah, r.bottom - atas);
    });
    return bawah / px;
  }

  /*
   * Kandidat ukuran huruf. Permintaan user: "laporan surat jalan jangan sampai 2 halaman" — jadi
   * daftarnya diperpanjang sampai **6pt** (dulu berhenti di 7pt): kalau daftar barangnya sangat banyak
   * atau barisnya lebih tinggi karena font perangkat berbeda, dokumen tetap bisa dipaksa muat 1 halaman.
   */
  /*
   * CADANGAN_MM = ruang aman di bawah isi dokumen (mm). Permintaan user: "laporan surat jalan jangan
   * sampai 2 halaman". Setiap printer/aplikasi cetak bisa memakai area cetak yang sedikit berbeda
   * (margin perangkat, skala, dsb), jadi isi dokumen TIDAK diisi sampai dasar area cetak: disisakan
   * 6 mm supaya baris terakhir tidak pernah tergeser ke halaman kedua.
   */
  var CADANGAN_MM = 6;
  var KANDIDAT = [12, 11.5, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6]; // 12pt dipakai selama muat 1 halaman
  var dipakai = [];
  Array.prototype.forEach.call(document.querySelectorAll('.dok'), function (dok) {
    if (dok.querySelector('.lbl')) return; // halaman label punya ukuran sendiri
    var pilih = KANDIDAT[KANDIDAT.length - 1];
    for (var k = 0; k < KANDIDAT.length; k++) {
      dok.style.fontSize = KANDIDAT[k] + 'pt';
      bagiKolomSuratJalan(dok, ruang - CADANGAN_MM); // jumlah baris yang muat ikut berubah saat huruf mengecil
      if (tinggiIsi(dok) <= ruang - CADANGAN_MM) { pilih = KANDIDAT[k]; break; }
    }
    dok.style.fontSize = pilih + 'pt';
    bagiKolomSuratJalan(dok, ruang - CADANGAN_MM);
    dok.dataset.font = String(pilih);
    dipakai.push(pilih);
  });
  window.FONT_LAPORAN = dipakai;
  window.RUANG_CETAK_MM = ruang;
};
window.pasFontLaporan();
window.addEventListener('beforeprint', window.pasFontLaporan);
</script>
</body>
</html>`;
}

/**
 * Barang yang jumlahnya TIDAK BALANCE (ada selisih) — ditandai MERAH di dokumen cetak.
 * permintaan user: "barang yang selisih dan berwarna merah di rekap barang kembali juga akan berwarna
 * merah di laporan cetak".
 * Selisih satu barang = (B + T − K) berbeda dengan nilai Setoran (S) yang tersimpan; kalau K lebih banyak
 * dari B + T, setoran efektifnya 0 sehingga selisihnya juga terdeteksi (persis penanda merah di rekap).
 */
function adaSelisih(i) {
  const b = Number(i.b) || 0;
  const t = Number(i.t) || 0;
  const k = Number(i.k) || 0;
  return b + t - k !== Number(setoranEfektif(i)) || k > b + t;
}

/** Baris tabel dokumen F4: NO | NAMA BARANG | B | T | K | S */
function barisBTKS(daftar, mulai) {
  return daftar
    .map((i, n) => {
      /*
       * KOLOM S (permintaan user, revisi ke-143): kalau setorannya **0** selnya DIBIARKAN KOSONG —
       * angka 0 tidak ditulis, selnya tetap bergaris seperti sel lain (jadi kolomnya tidak penuh angka 0).
       * Blok hitam yang sempat dipakai (revisi ke-142) sudah DIBATALKAN atas permintaan user.
       *
       * Yang berubah hanya DOKUMEN CETAK (surat jalan & laporan lengkap). Tabel di LAYAR
       * (halaman perjalanan & Overview) tetap MENULIS angkanya — itu permintaan user sebelumnya
       * ("kolom S yang kosong kolomnya jadi full hitam, bukan lagi nol" → di layar harus tertulis 0),
       * dan dijaga butir "detail perjalanan: kolom S selalu TERTULIS angkanya" di uji-canvasing.js.
       */
      const s = setoranEfektif(i);
      const merah = adaSelisih(i);
      return `<tr class="${merah ? 'baris-selisih' : ''}"${merah ? ' data-selisih="1"' : ''}>
        <td class="no">${mulai + n}</td>
        <td class="nm">${esc(i.nama)}</td>
        <td class="b">${i.b || ''}</td>
        <td class="t">${i.t || ''}</td>
        <td class="k">${i.k || ''}</td>
        <td class="s">${s === 0 ? '' : angka(s)}</td>
      </tr>`;
    })
    .join('');
}

/** Kepala tabel barang (dipakai kolom kiri & kolom kanan surat jalan). */
const KEPALA_BTKS = '<thead><tr><th class="no">NO</th><th>NAMA BARANG</th><th class="b">B</th><th class="t">T</th><th class="k">K</th><th class="s">S</th></tr></thead>';

/** Blok tanda tangan: jabatan + nama yang sudah tertulis (nama petugas yang merekap & nama sales). */
function kolomTtd(jabatan, nama) {
  return `<div class="kolom">
    <div class="jabatan">${jabatan}</div>
    <div class="ruang"></div>
    <div class="garis"></div>
    <div class="nama">${nama ? esc(nama) : '&nbsp;'}</div>
  </div>`;
}

function blokTandaTangan(kiri, kanan) {
  return `<div class="ttd">${kolomTtd(kiri.jabatan, kiri.nama)}${kolomTtd(kanan.jabatan, kanan.nama)}</div>`;
}

const TTD_ADMIN = 'Mengetahui<br>Admin Gudang,';
const TTD_SALES = 'Sales,';

/** SURAT JALAN DAN SETORAN — F4, daftar barang 2 kolom: kiri diisi penuh dulu, kanan lanjutannya
 *  (+ akumulasi B/T/K/S, catatan, dan tanda tangan selalu di sisi kanan). */
/** Barang yang benar-benar ada gerak (dibawa / tambahan / kembali) — yang lain tidak dicetak. */
function adaGerak(i) {
  return (Number(i.b) || 0) + (Number(i.t) || 0) + (Number(i.k) || 0) > 0;
}

const BARIS_KOSONG = (kolom) =>
  `<tr class="kosong-doc"><td colspan="${kolom}">Belum ada barang yang dibawa / tambahan / kembali.</td></tr>`;

/*
 * permintaan user: daftar barang memenuhi KOLOM KIRI dulu sampai bawah halaman, baru sisanya
 * lanjut ke KOLOM KANAN; akumulasi B/T/K/S, catatan, dan tanda tangan tetap di sisi kanan
 * (meski kolom kiri belum penuh). Pembagian barisnya dihitung di browser (bagiKolomSuratJalan
 * di kerangka()) karena jumlah baris yang muat bergantung pada ukuran huruf terpilih.
 */
exports.suratJalan = function ({ sesi, items, base, judul, info, namaAdmin, setelan }) {
  /*
   * Setelan "Edit Logo & Layout Surat" (menu Setting) — permintaan user: logo unggahan otomatis dipakai
   * di surat, ukurannya bisa dipilih, judul & tulisan kop bisa diketik sendiri, garis kop dan blok
   * tanda tangan bisa dihidupkan/dimatikan. Kalau pemanggil tidak mengirim `setelan`, dibaca dari
   * database (lib/setelan.js) supaya tidak ada jalur cetak yang lupa memakainya.
   */
  const s = setelan || setelanSemua();
  const logoSurat = logoDokumen(s, base);
  /*
   * permintaan user: jangan masukkan barang yang tidak dibawa (B/T/K = 0).
   * Permintaan user terbaru (pilihan "cukup urutkan A–Z saat mencetak saja"): barang di KERTAS disusun
   * A–Z menurut namanya supaya mudah dicentang/dihitung. Pengurutan dilakukan di sini (view dokumen),
   * jadi urutan di layar/label/penomoran kode TIDAK ikut berubah. Pengurutan harus SEBELUM pembagian
   * kolom — fungsi bagiKolomSuratJalan memindahkan baris mengikuti urutan DOM-nya.
   */
  const semua = urutNama(items.filter(adaGerak));
  const tot = { b: 0, t: 0, k: 0, s: 0 };
  semua.forEach((i) => {
    tot.b += i.b; tot.t += i.t; tot.k += i.k; tot.s += setoranEfektif(i);
  });
  const selisih = tot.b + tot.t - tot.k - tot.s;

  /*
   * permintaan user: "catatan tidak usah kolom, setelah tulisan catatan … di bawah catatan pesan
   * otomatis diurut dengan angka 1 2 dst" → catatan MANUAL ditulis tanpa kotak, lalu baris-baris
   * catatan OTOMATIS (pengambilan barang / barang diambil sales lain) dicetak di bawahnya bernomor.
   */
  const catatanDok = pisahCatatan(sesi.catatan);

  const isi = `
<div class="dok sj">
  <div class="kop${s.kop_garis === '0' ? ' tanpa-garis' : ''}">
    <!--
      LOGO (PNG) di POJOK KIRI ATAS + judul di sebelahnya (permintaan user):
       - "gunakan png … untuk logo di surat jalan"      → public/logo-mark.png
       - "tulisan surat jalan dan sc … mepet ke logo"   → jarak hanya 1,5 mm (kelas .kop-kiri)
       - "kecilkan logo agar tingginya sama dengan tulisan surat ditambah sc" → logo di-STRETCH setinggi
         blok judul (h1 + baris "SC SUNGLASSES STORE") lewat align-self: stretch
       - "tulisannya rata kiri"                         → blok judul rata kiri
      alt="" karena nama usaha sudah tertulis di sebelahnya (tidak perlu dibacakan dua kali).
      Sejak fitur "Edit Logo" (menu Setting) sumbernya bisa logo UNGGAHAN pengguna dan ukurannya
      dipilih (kecil/sedang/besar) lewat variabel --logo-skala; logo juga bisa disembunyikan.
    -->
    <div class="kop-kiri">${
      s.logo_tampil === '0'
        ? ''
        : `<img class="kop-logo" src="${esc(logoSurat)}" alt="" width="512" height="512" style="--logo-skala:${SKALA_LOGO[s.logo_ukuran] || 1}">`
    }
      <div class="kop-judul">
        <h1>${esc(s.kop_judul || judul || 'SURAT JALAN DAN SETORAN')}</h1>
        <div class="sub">${esc(s.kop_sub)}</div>
      </div>
    </div>
    <!--
      Keterangan surat — permintaan user: label nomor dipendekkan menjadi "No" (tanpa kata Surat Jalan),
      label rata KIRI,
      TITIK DUA lurus, dan permulaan teks setelah titik dua juga lurus.
      Karena itu tiap baris dipecah menjadi 3 bagian (label · titik dua · nilai) di dalam SATU grid
      3 kolom: kolom label selebar label terpanjang ("Tanggal") sehingga titik duanya sejajar, lalu
      kolom nilai mulai pada x yang sama untuk ketiga baris.
    -->
    <div class="ident">
      <span class="lab">No</span><span class="ttk-d">:</span><span class="nilai" data-no>${esc(noSurat(sesi))}</span>
      <span class="lab">Nama</span><span class="ttk-d">:</span><span class="nilai sales-nm">${esc((sesi.sales_nama || '').toUpperCase())}</span>
      <span class="lab">Tanggal</span><span class="ttk-d">:</span><span class="nilai">${esc(tanggalPendek(sesi.tanggal))}</span>
    </div>
  </div>
  <div class="sj-dua">
    <div class="sj-kiri">
      <table class="grid" id="tblKiri">${KEPALA_BTKS}<tbody>${semua.length ? barisBTKS(semua, 1) : BARIS_KOSONG(6)}</tbody></table>
    </div>
    <div class="sj-kanan">
      <table class="grid sj-lanjutan sembunyi" id="tblKanan">${KEPALA_BTKS}<tbody></tbody></table>
      <table class="rekap">
        <tr><td class="k">B</td><td>Jumlah Produk dibawa</td><td class="v">${angka(tot.b)}</td><td class="sel${selisih !== 0 ? ' selisih-ada' : ''}" rowspan="4"${selisih !== 0 ? ' data-selisih="1"' : ''}>Selisih<div>${angka(selisih)}</div></td></tr>
        <tr><td class="k">T</td><td>Jumlah Tambahan</td><td class="v">${angka(tot.t)}</td></tr>
        <tr><td class="k">K</td><td>Jumlah Kembali</td><td class="v">${angka(tot.k)}</td></tr>
        <tr><td class="k">S</td><td>Jumlah Setoran</td><td class="v">${angka(tot.s)}</td></tr>
      </table>
      <div class="kotak-catatan tanpa-kotak"><b>Catatan:</b> <span class="catatan-manual">${esc(catatanDok.manual || '')}</span>${
        catatanDok.otomatis.length
          ? `<div class="catatan-otomatis-dok">${catatanDok.otomatis
              .map((b, i) => `<div class="baris-otomatis"><span class="no">${i + 1}.</span> ${esc(b)}</div>`)
              .join('')}</div>`
          : ''
      }</div>
      ${info || ''}
      ${s.ttd_tampil === '0' ? '' : blokTandaTangan({ jabatan: TTD_ADMIN, nama: namaAdmin }, { jabatan: TTD_SALES, nama: sesi.sales_nama })}
    </div>
  </div>
</div>`;

  return kerangka({
    base,
    judul: `Surat Jalan ${noSurat(sesi)}`,
    isi,
    kembali: `${base}/sesi/${sesi.id}`,
  });
};

/** LAPORAN LENGKAP setelah rekap selesai dikunci */
exports.laporan = function ({ sesi, items, base, namaAdmin }) {
  const info = `<div class="info-selesai">REKAP SELESAI &amp; DIKUNCI · ${esc(tanggalPanjang(sesi.tanggal))} · Sales: ${esc(sesi.sales_nama || '-')}${sesi.rekap_oleh ? ` · Direkap oleh: ${esc(sesi.rekap_oleh)}` : ''}</div>`;
  /*
   * nama admin pada tanda tangan = petugas yang MENGINPUT data perjalanan ini (`namaAdminSesi()`:
   * `rekap_oleh` lalu `dibuat_oleh`) — permintaan user: "Nama yang ada di tanda tangan admin itu admin
   * yang mengimput, bukan yang mencetak". `namaAdmin` dari pemanggil hanya cadangan untuk data lama yang
   * belum punya catatan petugas; **petugas yang sedang login (yang mencetak) TIDAK pernah dipakai**
   * (dulu ada cadangan `petugasLogin` di sini).
   */
  return exports.suratJalan({
    sesi,
    items,
    base,
    judul: 'SURAT JALAN DAN SETORAN',
    info,
    namaAdmin: namaAdminSesi(sesi) || namaAdmin || '',
  });
};

/** LABEL BARCODE / QR */
exports.label = function ({ isi, tipe, ukuran, tahun, base }) {  const css = {
    a4: `@page{size:A4;margin:8mm}.lembar-label .lbl{width:64mm;height:34mm}`,
    f4: `@page{size:215mm 330mm;margin:7mm}.lembar-label .lbl{width:64.5mm;height:35mm}`,
    thermal: `@page{size:50mm 30mm;margin:1mm}
      .lembar-label{display:block}
      .lembar-label .lbl{width:47mm;height:27mm;border:none;page-break-after:always;overflow:hidden;padding:0.6mm;justify-content:flex-start}
      .lembar-label .lbl:last-child{page-break-after:auto}
      .lembar-label .lbl .bc svg{max-height:8mm}
      .lembar-label .lbl .gabung{gap:1mm;margin-top:0.3mm}
      .lembar-label .lbl .gabung .qr{width:11mm;flex:0 0 11mm}
      .lembar-label .lbl .kd{font-size:6.5pt;margin-top:0}
      .lembar-label .lbl .nm{font-size:6pt;max-height:5.4mm;line-height:1.05;overflow:hidden}
      .lembar-label .lbl .hrg{font-size:6.6pt}`,
  }[ukuran];

  const satu = (p) => {
    const svgBarcode = `<div class="bc">${barcode.svg(p.kode, 'code128', { height: 10 })}</div>`;
    const svgQr = `<div class="qr">${barcode.svg(p.kode, 'qr')}</div>`;
    const teks = `<div class="teks">
      <div class="kd">${esc(p.kode)}</div>
      <div class="nm">${esc(p.nama)}</div>
    </div>`;

    if (tipe === 'qr') {
      return `<div class="lbl">${svgQr}<div class="kd">${esc(p.kode)}</div><div class="nm">${esc(p.nama)}</div></div>`;
    }
    if (tipe === 'keduanya') {
      return `<div class="lbl">${svgBarcode}<div class="gabung">${svgQr}${teks}</div></div>`;
    }
    return `<div class="lbl">${svgBarcode}<div class="kd">${esc(p.kode)}</div><div class="nm">${esc(p.nama)}</div></div>`;
  };

  const label = [];
  isi.forEach(({ produk, qty }) => {
    for (let i = 0; i < qty; i++) label.push(satu(produk));
  });

  const untukLembar = ukuran !== 'thermal';
  const kepala = untukLembar
    ? `<div style="font-size:8pt;margin-bottom:4mm;text-align:center">SC SUNGLASSES STORE ${esc(tahun || '')} · ${label.length} label · ${
        tipe === 'qr' ? 'QR Code' : tipe === 'keduanya' ? 'Barcode + QR' : 'Barcode Code128'
      }</div>`
    : '';

  const isiHtml = `<div class="dok" style="min-height:0;width:auto;margin:0;padding:${untukLembar ? '6mm' : '0'}">
  ${kepala}
  <div class="lembar-label">${label.join('')}</div>
</div>`;

  return kerangka({ base: base || '', judul: 'Label Barcode', isi: isiHtml, extraCss: css });
};

/** LAPORAN PENJUALAN BARANG PER SALES — F4, satu blok per sales, 2 kolom barang. */
exports.laporanSales = function ({ base, dari, sampai, rekap, total, hariIni, namaAdmin, setelan }) {
  // Setelan "Edit Logo & Layout Surat" (nama toko, garis kop, tanda tangan) — lihat lib/setelan.js.
  const st = setelan || setelanSemua();
  const kelasKop = st.kop_garis === '0' ? ' tanpa-garis' : '';
  const MAX = 50; // 2 kolom × 25 baris per lembar
  /*
   * Periode mengikuti TANGGAL REKAP (permintaan user: "rekap penjualan mengikuti tanggal rekap saat
   * rekap, bukan tanggal canvasing"). Label di dokumen ditulis "Periode rekap" supaya jelas.
   */
  const periode = `${dari ? tanggalPendek(dari) : 'awal'} s/d ${sampai ? tanggalPendek(sampai) : tanggalPendek(hariIni)}`;

  function tabelBarang(daftar, mulai) {
    const baris = daftar
      .map(
        (d, n) => `<tr>
        <td class="no">${mulai + n}</td>
        <td class="nm">${esc(d.nama)}</td>
        <td class="q">${angka(d.qty)}</td>
      </tr>`
      )
      .join('');
    return `<table class="grid mini">
      <thead><tr><th class="no">NO</th><th>NAMA BARANG</th><th class="q">TERJUAL</th></tr></thead>
      <tbody>${baris}</tbody>
    </table>`;
  }

  const lembar = [];
  if (!rekap.length) {
    lembar.push(`
<div class="dok">
  <!-- kelas kop-susun: judul dapat lebar penuh, keterangan periode turun ke barisnya sendiri
       supaya judul 18pt (font nama usaha) tetap SATU baris (permintaan user). -->
  <div class="kop kop-susun${kelasKop}">
    <div><h1>LAPORAN PENJUALAN BARANG PER SALES</h1>
    <div class="sub">${esc(st.kop_sub)}</div></div>
    <div class="ident">
      <span class="lab">Periode rekap</span><span class="ttk-d">:</span><span class="nilai">${esc(periode)}</span>
    </div>
  </div>
  <p style="margin-top:8mm;text-align:center;font-size:1em">Belum ada perjalanan yang masuk tahap rekap / selesai pada periode ini.</p>
</div>`);
  } else {
    rekap.forEach((s) => {
      // rincian barang urut A–Z di kertas (permintaan user) — diurutkan SEBELUM dipotong per lembar
      const detail = urutNama(s.detail);
      const jmlLembar = Math.max(1, Math.ceil(detail.length / MAX));
      for (let p = 0; p < jmlLembar; p++) {
        const potong = detail.slice(p * MAX, (p + 1) * MAX);
        const kiri = potong.slice(0, 25);
        const kanan = potong.slice(25, 50);
        lembar.push(`
<div class="dok">
  <div class="kop kop-susun${kelasKop}">
    <div>
      <h1>LAPORAN PENJUALAN BARANG PER SALES</h1>
      <div class="sub">${esc(st.kop_sub)}${p > 0 ? ` · lanjutan hal. ${p + 1}` : ''}</div>
    </div>
    <div class="ident">
      <span class="lab">Sales</span><span class="ttk-d">:</span><span class="nilai">${esc((s.sales || '').toUpperCase())}</span>
      <span class="lab">Periode rekap</span><span class="ttk-d">:</span><span class="nilai">${esc(periode)}</span>
    </div>
  </div>
  <div class="tabel-dua">
    <div><table class="grid mini"><thead><tr><th class="no">NO</th><th>NAMA BARANG</th><th class="q">TERJUAL</th></tr></thead>
      <tbody>${kiri.length ? tabelBarang(kiri, 1) : BARIS_KOSONG(3)}</tbody></table></div>
    <div><table class="grid mini"><thead><tr><th class="no">NO</th><th>NAMA BARANG</th><th class="q">TERJUAL</th></tr></thead>
      <tbody>${kanan.length ? tabelBarang(kanan, 26) : ''}</tbody></table></div>
  </div>
  <div class="kaki">
    <div class="kotak-catatan"><b>Ringkasan:</b> ${angka(s.perjalanan)} perjalanan · Dibawa ${angka(s.b)} · Tambahan ${angka(s.t)} · Kembali ${angka(s.k)} · <b>Terjual ${angka(s.s)}</b>${s.selisih !== 0 ? ` · Selisih ${angka(s.selisih)}` : ''}</div>
    <table class="rekap">
      <tr><td class="k">S</td><td>Jumlah Terjual (Setoran)</td><td class="v">${angka(s.s)}</td></tr>
      <tr><td class="k">B</td><td>Jumlah Produk dibawa</td><td class="v">${angka(s.b)}</td></tr>
      <tr><td class="k">T</td><td>Jumlah Tambahan</td><td class="v">${angka(s.t)}</td></tr>
      <tr><td class="k">K</td><td>Jumlah Kembali</td><td class="v">${angka(s.k)}</td></tr>
    </table>
  </div>
  ${p === jmlLembar - 1 && st.ttd_tampil !== '0' ? blokTandaTangan({ jabatan: TTD_ADMIN, nama: namaAdmin }, { jabatan: TTD_SALES, nama: s.sales }) : ''}
</div>`);
      }
    });
  }

  // lembar rekap total
  lembar.push(`
<div class="dok">
  <div class="kop${kelasKop}">
    <div><h1>REKAP PENJUALAN SEMUA SALES</h1>
    <div class="sub">${esc(st.kop_sub)} · Periode rekap ${esc(periode)}</div></div>
  </div>
  <table class="grid">
    <thead><tr><th class="no">NO</th><th>NAMA SALES</th><th class="b">JALAN</th><th class="t">B</th><th class="k">T</th><th class="s">K</th><th class="s">S</th><th class="s">SELISIH</th></tr></thead>
    <tbody>
      ${rekap
        .map(
          (s, n) => `<tr>
        <td class="no">${n + 1}</td>
        <td class="nm">${esc(s.sales)}</td>
        <td class="b">${angka(s.perjalanan)}</td>
        <td class="t">${angka(s.b)}</td>
        <td class="k">${angka(s.k)}</td>
        <td class="s">${angka(s.s)}</td>
        <td class="s${s.selisih === 0 ? '' : ' selisih-ada'}"${s.selisih === 0 ? '' : ' data-selisih="1"'}>${s.selisih === 0 ? '-' : angka(s.selisih)}</td>
        <td class="s"></td>
      </tr>`
        )
        .join('')}
      <tr style="font-weight:800;background:#eee">
        <td class="no"></td><td class="nm">TOTAL</td>
        <td class="b">${angka(total.perjalanan)}</td>
        <td class="t">${angka(total.b)}</td>
        <td class="k">${angka(total.k)}</td>
        <td class="s">${angka(total.s)}</td>
        <td class="s">${total.selisih === 0 ? '-' : angka(total.selisih)}</td>
        <td class="s"></td>
      </tr>
    </tbody>
  </table>
  <div class="memo-foot"><div class="total-barang"><b>Total Barang Terjual</b><span>${angka(total.s)}</span></div></div>
  ${blokTandaTangan({ jabatan: TTD_ADMIN, nama: namaAdmin }, { jabatan: 'Pimpinan,', nama: '' })}
</div>`);

  return kerangka({ base, judul: 'Laporan Penjualan per Sales', isi: lembar.join('') });
};
