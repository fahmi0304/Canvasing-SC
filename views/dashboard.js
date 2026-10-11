'use strict';
const { esc, angka, tanggalPendek } = require('../lib/util');

/**
 * Nama hari Indonesia dari tanggal ISO ('2026-10-08' → 'Kamis').
 * permintaan user: "format tanggal menggunakan Hari lalu di bawahnya 08/10/2026".
 */
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
function namaHari(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return HARI[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] || '';
}
const { menuBaris, attrBarisKlik, opsiUndo } = require('./menu-baris');
const { PLUS } = require('./ikon');
const { kartuGrafik } = require('./grafik');
const { noSurat } = require('../lib/kode');

/**
 * Keterangan status versi ringkas untuk tabel dasbor.
 * Permintaan user (revisi ke-116): "jika di laporan keterangannya sedang rekap, di dasbor juga sedang
 * rekap" — jadi label & warna status **sedang rekap disamakan dengan laporan** (`statusInfo()` di
 * lib/util.js → "Sedang Rekap", badge ungu), SEDANGKAN draft & kirim tetap memakai istilah dasbor
 * ("Draft" / "Ongoing", kuning/biru) sesuai pilihan user.
 * Status ASLI (dipakai skrip uji & filter) tetap ditulis di atribut `data-status` tiap baris.
 */
const STATUS_RINGKAS = {
  draft: { label: 'Draft', warna: 'kuning' },
  kirim: { label: 'Ongoing', warna: 'biru' },
  rekap: { label: 'Sedang Rekap', warna: 'ungu' },
  selesai: { label: 'Selesai', warna: 'hijau' },
};

/**
 * Semua opsi baris perjalanan dikumpulkan di satu tombol GARIS TIGA
 * (permintaan user) lewat komponen bersama `views/menu-baris.js`.
 *
 * Permintaan user: "Pada dasbor, tombol audit dan edit tidak usah tampilkan di ikon aksi" →
 * di **dasbor** menu baris hanya berisi **Buka · (opsi cetak) · Hapus (administrator)**.
 * Opsi **Edit** & **Audit** TIDAK dirender di sini karena keduanya sudah tersedia sebagai ikon aksi
 * di **halaman perjalanannya** (`/sesi/:id`: Edit/Pensil, Tambahan, Retur, Kunci/Selesai, Audit) —
 * jadi tidak ada fungsi yang hilang. **Jangan dihidupkan lagi.** Halaman **Laporan** tidak ikut
 * berubah (menu per statusnya diatur di `views/laporan.js → exports.hub`).
 */
function menuPerjalanan(s, opsi) {
  const { base, bolehHapus, bolehBuka = true, balikKe = '' } = opsi;

  /*
   * Opsi **"Buka" (keterangan "Lanjutkan alur perjalanan")** untuk membuka/melanjutkan perjalanan dari
   * daftar dasbor.
   *
   * Riwayat permintaan user (revisi ke-138 → dikembalikan di revisi ke-140): dulu opsi ini dihapus untuk
   * SEMUA peran ("Pada dasbor sales, ikon aksi buka dan lanjutkan perjalanan hapus"), lalu user meminta
   * dikembalikan **hanya untuk administrator & admin gudang** — jadi sales tetap tanpa opsi ini.
   * Nilainya datang dari \`opsi.bolehBuka\` (= \`auth.bolehUbah(req)\`, yaitu benar untuk administrator &
   * admin gudang, salah untuk sales) yang diisi route `/` lewat \`vDashboard.render()\`.
   *
   * Catatan yang tetap berlaku: SELURUH baris dasbor bisa diklik (\`attrBarisKlik()\` +
   * \`pasangKlikBaris()\`) sehingga perjalanan tetap bisa dibuka tanpa opsi ini, dan opsi "Overview" tetap
   * tidak ada di menu ini (fungsinya ada di klik baris). Untuk baris yang daftar opsinya benar-benar
   * kosong (mis. draft milik sales), \`menuBaris()\` mengembalikan string kosong sehingga tombol garis
   * tiganya tidak dirender (tidak ada menu kosong).
   */
  const daftar = [];
  if (bolehBuka) daftar.push({ href: `${base}/sesi/${s.id}`, ikon: '▸', label: 'Buka', ket: 'Lanjutkan alur perjalanan' });
  /*
   * Permintaan user: "Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak PDF saja,
   * 1 ikon" → opsi cetak di sini tinggal SATU berkas PDF (surat jalan atau laporan lengkap sesuai
   * statusnya), tidak ada lagi pasangan "Cetak … (F4)" + "Unduh PDF F4". Tautannya dibuka di tab baru
   * (penampil PDF) lewat `data-pdf-buka` — kalau tab baru diblokir (PWA/WebView), public/app.js
   * membukanya di tab ini supaya tombolnya tidak terlihat mati.
   */
  if (s.status !== 'draft') {
    daftar.push({
      href: `${base}${s.status === 'selesai' ? `/cetak/laporan-pdf/${s.id}` : `/cetak/surat-jalan-pdf/${s.id}`}`,
      target: true,
      attr: 'data-pdf-buka',
      ikon: '🖨',
      label: s.status === 'selesai' ? 'PDF Laporan Lengkap (F4)' : 'PDF Surat Jalan & Setoran (F4)',
      ket: 'terbuka di penampil PDF · 1 halaman F4',
    });
  }
  /*
   * UNDO untuk administrator (permintaan user: "Administrator bisa meng undo surat jalan").
   * Satu langkah: Selesai → Sedang Rekap, Sedang Rekap → Ongoing, Ongoing → Draft. Baris yang sudah
   * draft tidak diberi opsi ini (tidak ada yang perlu dibuka). Hanya administrator (`bolehHapus` =
   * `auth.admin(req)` untuk menu ini).
   */
  if (bolehHapus) {
    // `opsiUndo()` mengembalikan null untuk baris yang sudah draft (tidak ada yang perlu dibuka)
    const undo = opsiUndo(s, base, balikKe);
    if (undo) daftar.push(undo);
  }

  if (bolehHapus) {
    daftar.push({
      form: `${base}/sesi/${s.id}/hapus`,
      kelas: 'ttk-hapus',
      ikon: '🗑',
      label: 'Hapus',
      ket: 'Hapus perjalanan ini beserta inputannya',
      attr: `data-konfirmasi-tema data-judul="Hapus surat jalan ${esc(noSurat(s))}?" data-pesan="Surat jalan ${esc(noSurat(s))} (${esc(s.sales_nama || '-')}) beserta semua inputannya akan dihapus. Tindakan ini tidak bisa dibatalkan." data-ok="Ya, hapus"`,
    });
  }

  return menuBaris({ judul: `${noSurat(s)} · ${s.sales_nama || '-'}`, opsi: daftar });
}

/**
 * Satu tabel perjalanan. Susunan sel (permintaan user): kolom tanggal = **nama HARI di atas** lalu
 * tanggalnya (`08/10/2026`) di bawahnya; kolom nama sales = nama, lalu **kode surat jalan + keterangan
 * status (Draft/Ongoing) sebaris di bawahnya** ("tulisan ongoing dan draft berada di bawah kode sales");
 * kolom **B & T rata tengah**.
 * Huruf nama sales & tanggal diperkecil supaya tetap satu baris di layar HP (Android). Urut dari tanggal terbaru.
 */
function tabelPerjalanan(daftar, opsi) {
  // `base` (awalan subpath, mis. `/canvasing`) WAJIB dipakai untuk alamat klik baris — lihat menu-baris.js
  const { kosong = '', base = '' } = opsi;
  const urut = daftar
    .slice()
    .sort((a, b) => (a.tanggal === b.tanggal ? b.id - a.id : a.tanggal < b.tanggal ? 1 : -1));

  const baris = urut
    .map((s) => {
      const st = STATUS_RINGKAS[s.status] || { label: s.status, warna: 'abu' };
      /*
       * permintaan user: tanggal = NAMA HARI di atas lalu tanggalnya di bawah ("08/10/2026"), dan
       * keterangan Draft/Ongoing diletakkan DI BAWAH KODE SALES (bukan lagi di bawah tanggal).
       */
      return `<tr data-status="${esc(s.status)}"${attrBarisKlik(s, base)}>
        <td class="td-tanggal"><span class="hari">${esc(namaHari(s.tanggal))}</span><span class="tgl">${esc(tanggalPendek(s.tanggal))}</span></td>
        <td class="td-surat">
          <b class="nm-sales">${esc(s.sales_nama || '-')}</b>
          <span class="baris-kode"><span class="kode">${esc(noSurat(s))}</span><span class="badge b-${st.warna}">${esc(st.label)}</span></span>
        </td>
        <td class="tengah">${angka(s.tot_b)}</td>
        <td class="tengah">${angka(s.tot_t)}</td>
        <td class="aksi-sel">${menuPerjalanan(s, opsi)}</td>
      </tr>`;
    })
    .join('');

  return `<div class="tbl-wrap">
    <table class="tbl" id="tblPerjalanan">
      <thead>
        <tr><th>Tanggal</th><th>Nama Sales</th><th class="tengah">B</th><th class="tengah">T</th><th class="aksi-sel">Aksi</th></tr>
      </thead>
      <tbody>${baris || `<tr><td colspan="5" class="kosong">${esc(kosong || 'Belum ada transaksi.')}</td></tr>`}</tbody>
    </table>
  </div>`;
}

exports.render = function ({ daftar = [], base = '', pesan, bolehUbah = true, bolehHapus = true, bolehBuka = true }) {
  // Permintaan user: transaksi yang sudah SELESAI tidak ditampilkan di dasbor (biar tidak terlalu banyak);
  // seluruh riwayat lengkap ada di menu Laporan.
  const bukanSelesai = daftar.filter((s) => s.status !== 'selesai');
  /*
   * Permintaan user: "jika tambahan transaksi barang yang dimasukkan kosong, belum bisa dimasukkan sebagai
   * draft surat jalan" → transaksi BARU yang belum diisi barangnya (B, T, K semuanya 0) TIDAK dihitung
   * sebagai draft surat jalan: tidak tampil di daftar, tetapi diberi tahu di bawah tabel supaya pengguna
   * tidak bingung mencari transaksinya.
   */
  const belumDiisi = bukanSelesai.filter(
    (s) => s.status === 'draft' && (Number(s.tot_b) || 0) + (Number(s.tot_t) || 0) + (Number(s.tot_k) || 0) === 0
  );
  const aktif = bukanSelesai.filter((s) => !belumDiisi.includes(s));
  const jumlahSelesai = daftar.length - bukanSelesai.length;
  const opsi = {
    base,
    bolehUbah,
    bolehHapus,
    /*
     * Opsi "Buka" (buka/lanjutkan perjalanan) di menu baris: administrator & admin gudang saja
     * (permintaan user revisi ke-140) — sales tidak. Route '/' mengirim `auth.bolehUbah(req)`.
     */
    bolehBuka,
    kosong: jumlahSelesai
      ? `Tidak ada transaksi berjalan. ${angka(jumlahSelesai)} transaksi yang sudah selesai bisa dilihat di menu Laporan.`
      : 'Belum ada transaksi.',
  };

  return `
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
${bolehUbah ? '' : '<div class="alert alert-info">Peran kamu hanya melihat data — menambah atau mengubah perjalanan tidak diizinkan.</div>'}

<div class="blok-halaman" data-blok-halaman="dasbor">
  <div class="stack blok-wadah" data-blok-wadah>
    ${kartuGrafik({ judul: 'Grafik Penjualan', blok: 'grafik', judulBlok: 'Grafik Penjualan' })}
    <section class="card kartu-perjalanan" data-blok="perjalanan" data-blok-nama="Transaksi Berjalan">
      <div class="grafik-head kepala-transaksi">
        <h2 class="card-title-heading">Transaksi Berjalan</h2>
        ${bolehUbah
          ? `<a class="ttk-tombol ttk-tambah" href="${base}/sesi/baru" title="Tambah Transaksi" aria-label="Tambah Transaksi">${PLUS}</a>`
          : ''}
      </div>
      ${tabelPerjalanan(aktif, opsi)}
      ${
        belumDiisi.length
          ? `<div class="hint" data-belum-diisi>${angka(belumDiisi.length)} transaksi baru belum diisi barangnya — belum masuk daftar ini. Buka menu Inventory/Transaksi untuk melengkapinya.`
          : ''
      }
    </section>
  </div>
</div>`;
};
