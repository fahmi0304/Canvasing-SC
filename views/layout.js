'use strict';
const { esc, statusInfo, statusSesi } = require('../lib/util');
const { peranInfo } = require('../lib/auth');
const { DASBOR, SETTING: IKO_SETTING, LAPOR, INVENTORY } = require('./ikon');

/**
 * Menu kotak (permintaan user): 4 kotak di dalam panel menu tiga garis.
 * Tambah Transaksi · Laporan · Inventory · Setting (Setting membuka submenu di bawahnya).
 */
// Catatan: menu "Tambah Transaksi" TIDAK di sini — ikonnya ada di dasbor, di samping judul
// "Transaksi Berjalan" (permintaan user). Jangan ditambahkan kembali ke daftar ini.
// Permintaan user: hanya NAMA menu yang tampil (tanpa penjelasan/deskripsi) + ikon.
const KOTAK = [
  { id: 'laporan', href: '/laporan', ikon: LAPOR, label: 'Laporan', cocok: ['/laporan', '/cetak/laporan-sales'] },
  { id: 'inventory', href: '/barang', ikon: INVENTORY, label: 'Inventory', cocok: ['/barang', '/impor', '/label', '/thermal'] },
  { id: 'setting', ikon: IKO_SETTING, label: 'Setting' },
];

/**
 * Isi submenu Setting: Customize Tema · Kelola Nama Sales · Kelola Pengguna.
 * permintaan user: "kelola pengguna masuk pada halaman setting" → tautan /petugas tinggal SATU
 * dan letaknya di submenu Setting ini (blok pengguna bawah hanya berisi Keluar).
 * Jangan menaruh tautan /petugas kedua di tempat lain — skrip uji memeriksa jumlahnya tepat 1.
 * Label menyesuaikan peran: administrator → "Kelola Pengguna", peran lain → "Daftar Pengguna".
 */
const SETTING = [
  { ikon: '◐', label: 'Customize Tema', data: 'data-tema-buka' },
  /*
   * Permintaan user: "di setting ada pilihan edit logo, dan bisa upload logo jpg/png, yang akan di pakai
   * dan ada opsi edit layout surat". Hanya **administrator** — itemnya tidak dirender untuk peran lain
   * (butuhAdmin) dan rutenya juga dijaga di server.js.
   */
  { ikon: '🖼', label: 'Edit Logo & Layout Surat', href: '/setting/logo', butuhAdmin: true },
  /*
   * Permintaan user (revisi ke-139): "Kelola nama sales dan daftar pengguna di halaman sales dan admin
   * di hapus" — jawaban pilihannya: tautan di SUBMENU SETTING dihapus untuk **sales & admin gudang**,
   * sedangkan **administrator tetap bisa mengelola**. Halamannya sendiri (`/sales`, `/petugas`) TETAP
   * ADA dan masih bisa dibuka lewat alamat langsung (khusus `/sales` kini hanya-baca untuk non-admin —
   * lihat `server.js`); yang hilang hanya tautannya di menu.
   */
  { ikon: '👤', label: 'Kelola Nama Sales', href: '/sales', butuhAdmin: true },
  { ikon: '☰', label: 'Kelola Pengguna', href: '/petugas', butuhAdmin: true },
  // permintaan user: aplikasi bisa dipasang di layar utama HP (tampil penuh, tanpa bar browser).
  // Tombol ini membuka penjelasan / memicu dialog pemasangan bawaan browser (lihat `pasangAplikasi`).
  { ikon: '📲', label: 'Pasang Aplikasi (HP)', data: 'data-pasang-buka' },
];

/**
 * Skrip kecil di <head> (jalan sebelum halaman digambar) yang menerapkan pilihan
 * "Customize Tema" dari localStorage — supaya tidak berkedip terang lalu gelap.
 */
const TEMA_SCRIPT = `<script>(function(){try{var t=JSON.parse(localStorage.getItem('sc_tema')||'{}')||{};var r=document.documentElement;r.setAttribute('data-tema',t.mode==='gelap'?'gelap':'terang');r.setAttribute('data-aksen',t.aksen||'indigo');var u=t.ukuran;if(['sangat-kecil','kecil','normal','besar','sangat-besar'].indexOf(u)<0)u='normal';r.setAttribute('data-ukuran',u);}catch(e){}})();</script>`;

/**
 * Tag <head> + skrip untuk "PASANG APLIKASI DI HP" (PWA). Dipakai layout (semua halaman) DAN halaman
 * login (`views/login.js`) supaya aplikasi bisa dipasang langsung dari halaman masuk.
 *
 * Yang ada di sini:
 *  - `<link rel="manifest">`: nama, ikon, `start_url`/`scope` RELATIF (".") di dalam manifest — jadi
 *    tetap benar baik di alamat subpath `/canvasing/` maupun kalau nanti dipasang custom domain.
 *  - `theme-color`: warna bilah status HP saat aplikasi dibuka dari layar utama.
 *  - meta `apple-*` + `apple-touch-icon`: iOS/Safari tidak membaca ikon dari manifest, jadi butuh ini.
 *  - `viewport-fit=cover`: supaya di HP berponi halamannya benar-benar PENUH (padding aman di app.css).
 *  - pendaftaran service worker (`sw.js`): syarat browser supaya aplikasi dianggap bisa dipasang.
 *    Service workernya sendiri TIDAK menyimpan cache apa pun (lihat `public/sw.js`).
 *
 * Kalau ada perubahan, ingat skrip uji `uji-pasang.js` memeriksa semua penanda ini.
 */
const PWA_HEAD = (base) => `<link rel="manifest" href="${base}/manifest.webmanifest">
<meta name="theme-color" content="#4F46E5">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Canvasing">
<link rel="apple-touch-icon" href="${base}/icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="${base}/icons/icon-192.png">
<script>(function(){if(!('serviceWorker' in navigator))return;var b=${JSON.stringify(base || '')};window.addEventListener('load',function(){try{navigator.serviceWorker.register(b+'/sw.js',{scope:b+'/'}).catch(function(){});}catch(e){}});})();</script>`;

function badge(status) {
  /*
   * Menerima STRING status ATAU satu baris perjalanan (objek berisi kolom rekap_at) — lewat statusSesi()
   * supaya "Ongoing" dan "Menunggu Data Penjualan" dibedakan dengan aturan yang sama di semua layar.
   */
  const s = status && typeof status === 'object' ? statusSesi(status) : statusInfo(status);
  return `<span class="badge b-${s.warna}">${esc(s.label)}</span>`;
}

function inisial(nama) {
  return String(nama || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k[0])
    .join('')
    .toUpperCase();
}

function cocokAktif(aktif, daftar) {
  return (daftar || []).some((p) => aktif === p || aktif.startsWith(p));
}

/**
 * Layout halaman: topbar berisi logo + nama toko "SYAIF COLLECTION" dengan baris kedua
 * "<judul halaman> | CANVASING PENJUALAN" (permintaan user) dan SATU tombol menu tiga garis di KANAN;
 * panel menu berisi menu kotak (Laporan · Inventory · Setting), submenu Setting, dan blok pengguna.
 */
function layout({ judul, aktif = '', base = '', isi, scriptExtra = '', petugas = null, bolehUbah = true, setelan = null }) {
  const peran = petugas ? peranInfo(petugas.peran) : null;
  const bisaUbah = bolehUbah && !!peran && peran.bolehUbah;
  const isAdmin = !!petugas && petugas.peran === 'administrator';
  // Logo topbar: logo UNGGAHAN pengguna kalau ada, kalau tidak mark bawaan aplikasi (permintaan user:
  // "logo yang di upload sebagai logo dasbor otomatis terpakai di logo surat").
  const logoTopbar = (setelan && setelan.logo_url) || `${base}/logo-mark.svg`;

  const kotak = KOTAK.filter((k) => !k.butuhUbah || bisaUbah)
    .map((k) => {
      const aktifKotak = k.href && (k.href === '/' ? aktif === '/' : cocokAktif(aktif, k.cocok) || aktif === k.href);
      const isiKotak = `<span class="kotak-ikon">${k.ikon}</span><b>${esc(k.label)}</b>`;
      return k.href
        ? `<a class="kotak${aktifKotak ? ' aktif' : ''}" data-kotak="${k.id}" href="${base}${k.href}">${isiKotak}</a>`
        : `<button class="kotak" type="button" data-kotak="${k.id}" data-setting-buka aria-expanded="false" aria-controls="menuSetting">${isiKotak}</button>`;
    })
    .join('');

  const setting = SETTING.filter((s) => !s.butuhAdmin || isAdmin).map((s) => {
    const ikon = `<span class="nav-ikon">${s.ikon}</span>`;
    /*
     * Catatan: properti `labelNonAdmin` ("Daftar Pengguna") sudah TIDAK dipakai lagi — sejak revisi
     * ke-139 tautan Kelola Pengguna hanya dirender untuk administrator, jadi label versi non-admin tidak
     * pernah tampil. Jangan dihidupkan lagi tanpa alasan.
     */
    const teks = `<span>${esc(s.label)}</span>`;
    return s.href
      ? `<a href="${base}${s.href}" class="${aktif === s.href ? 'aktif' : ''}">${ikon}${teks}</a>`
      : `<button type="button" ${s.data}>${ikon}${teks}</button>`;
  }).join('');

  // Blok "Masuk sebagai" ditaruh PALING ATAS di menu pojok kanan atas (permintaan user:
  // keterangan pengguna pindah dari panel logo ke menu ini).
  const kepalaPengguna = petugas
    ? `<div class="nav-user-head">
      <span class="avatar">${esc(inisial(petugas.nama))}</span>
      <span class="nav-judul">Masuk sebagai<b>${esc(petugas.nama)}</b></span>
    </div>`
    : `<div class="nav-user-head">
      <span class="avatar">?</span>
      <span class="nav-judul">Belum masuk<b>Silakan masuk dulu</b></span>
    </div>`;

  // Aksi pengguna tetap di bagian bawah menu. Tautan /petugas sekarang ada di submenu Setting
  // (permintaan user: "kelola pengguna masuk pada halaman setting") — jangan dihidupkan lagi di sini.
  const aksiPengguna = petugas
    ? `<div class="nav-aksi nav-user">
      <a href="${base}/logout" class="nav-baris keluar"><span class="nav-ikon">⎋</span><span>Keluar</span></a>
    </div>`
    : `<div class="nav-aksi nav-user">
      <a href="${base}/login" class="nav-baris masuk"><span class="nav-ikon">→</span><span>Masuk</span></a>
    </div>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(judul)} · Canvasing SC Sunglasses</title>
${TEMA_SCRIPT}
${PWA_HEAD(base)}
<link rel="stylesheet" href="${base}/app.css">
<noscript><style>.nav { display: flex !important; position: fixed !important; right: 22px !important; left: auto !important; top: auto !important; } .burger { display: none; }</style></noscript>
</head>
<body>
<header class="topbar no-print">
  <div class="brand">
    <img class="logo-img" src="${esc(logoTopbar)}" alt="Logo toko" width="40" height="40">
    <span class="brand-teks">SYAIF COLLECTION<small>${esc(judul)} | Canvasing Penjualan</small></span>
  </div>
  <button class="burger" id="btnMenu" type="button" aria-expanded="false" aria-controls="menuUtama" aria-label="Buka menu">
    <span></span><span></span><span></span>
  </button>
  <nav class="nav" id="menuUtama">
    ${kepalaPengguna}
    <a href="${base}/" class="nav-dasbor${aktif === '/' ? ' aktif' : ''}"><span class="nav-ikon">${DASBOR}</span><span>Dasbor</span></a>
    <div class="kotak-menu">${kotak}</div>
    <div class="nav-aksi nav-set" id="menuSetting">${setting}</div>
    ${aksiPengguna}
  </nav>
</header>
<main class="container">
${isi}
</main>
<script>window.APP_BASE = ${JSON.stringify(base)};</script>
<script src="${base}/app.js"></script>
${scriptExtra}
</body>
</html>`;
}

module.exports = { layout, badge, KOTAK, SETTING, TEMA_SCRIPT, PWA_HEAD };
