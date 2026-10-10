'use strict';
/**
 * PENGATURAN APLIKASI — fitur "Edit Logo & Layout Surat" (menu Setting).
 *
 * Permintaan user:
 *  - "di setting ada pilihan edit logo, dan bisa upload logo jpg/png, yang akan di pakai dan ada opsi
 *     edit layout surat, entah itu surat jalan atau memo, logo yang di upload sebagai logo dasbor
 *     otomatis terpakai di logo surat".
 *  - Opsi layout yang diminta (user memilih "semuanya"): logo tampil/tidak + ukurannya, judul surat &
 *    tulisan kop bisa diketik sendiri, garis kop hidup/mati, dan tanda tangan hidup/mati.
 *  - Yang boleh mengubah: **administrator saja** (dijaga di server.js, bukan hanya di tampilan).
 *
 * Nilai disimpan di tabel `pengaturan` (kunci/nilai) di dalam database aplikasi, bukan di berkas
 * konfigurasi — supaya ikut terbawa saat aplikasi dipindah/di-backup.
 * Foto/logo yang diunggah TIDAK disimpan di disk server: berkasnya dikirim ke penyimpanan media
 * platform dari sisi server (lihat unggahLogo() di server.js) dan yang disimpan di sini hanya URL-nya.
 *
 * Kunci yang dikenal (semua TEKS):
 *   logo_url     : URL logo hasil unggahan (kosong = pakai logo bawaan aplikasi)
 *   logo_tampil  : '1' tampil / '0' tidak tampil di kop surat
 *   logo_ukuran  : 'kecil' | 'sedang' | 'besar'
 *   kop_judul    : judul surat (kosong = judul bawaan dokumen)
 *   kop_sub      : tulisan kop di bawah judul (nama toko)
 *   kop_garis    : '1' garis kop tampil / '0' tanpa garis
 *   ttd_tampil   : '1' blok tanda tangan tampil / '0' disembunyikan
 */
/*
 * `lib/db.js` di-require secara MALAS (di dalam fungsi), bukan di atas berkas: tanpa itu modul ini
 * membuka database aplikasi begitu di-require — termasuk di skrip uji yang hanya ingin memakai
 * fungsi render (mis. uji-cetak.js me-require lib/memoEntri.js) sehingga diam-diam menyentuh database
 * produksi. Dengan cara ini database hanya dibuka saat ada setelan yang benar-benar dibaca/ditulis.
 */
function kueri() {
  return require('./db').q;
}

/** Nilai bawaan — dipakai kalau pengguna belum pernah mengubah apa pun (harus = tampilan lama). */
const BAWAAN = {
  logo_url: '',
  logo_tampil: '1',
  logo_ukuran: 'sedang',
  kop_judul: '',
  kop_sub: 'SC SUNGLASSES STORE',
  kop_garis: '1',
  ttd_tampil: '1',
};

/** Tiga pilihan ukuran logo di kop surat; angkanya = pengali tinggi logo bawaan (fit tinggi blok No/Nama/Tanggal). */
const UKURAN = {
  kecil: { label: 'Kecil', skala: 0.74 },
  sedang: { label: 'Sedang (pas dengan No/Nama/Tanggal)', skala: 1 },
  besar: { label: 'Besar', skala: 1.18 },
};

const judulBawaanSurat = 'SURAT JALAN DAN SETORAN';

function teks(nilai, maks) {
  return String(nilai == null ? '' : nilai).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maks);
}

/** Setelan yang berlaku sekarang (sudah dinormalkan & sudah digabung dengan bawaan). */
function semua() {
  const t = kueri().pengaturanAll();
  const ukuran = UKURAN[t.logo_ukuran] ? t.logo_ukuran : BAWAAN.logo_ukuran;
  return {
    // Hanya URL yang masuk akal yang diterima (hasil penyimpanan media platform) — jangan pernah
    // memasang nilai apa pun dari luar sebagai alamat gambar.
    logo_url: /^(https?:\/\/|\/)/.test(teks(t.logo_url, 400)) ? teks(t.logo_url, 400) : '',
    logo_tampil: t.logo_tampil === '0' ? '0' : '1',
    logo_ukuran: ukuran,
    kop_judul: teks(t.kop_judul, 70),
    kop_sub: teks(t.kop_sub === undefined ? BAWAAN.kop_sub : t.kop_sub, 70) || BAWAAN.kop_sub,
    kop_garis: t.kop_garis === '0' ? '0' : '1',
    ttd_tampil: t.ttd_tampil === '0' ? '0' : '1',
  };
}

/** Simpan sebagian kunci (yang tidak dikirim dibiarkan seperti semula). */
function simpan(ubah) {
  const boleh = ['logo_url', 'logo_tampil', 'logo_ukuran', 'kop_judul', 'kop_sub', 'kop_garis', 'ttd_tampil'];
  boleh.forEach((k) => {
    if (!(k in ubah)) return;
    let v = ubah[k];
    if (k === 'logo_tampil' || k === 'kop_garis' || k === 'ttd_tampil') v = v === '0' || v === false ? '0' : '1';
    if (k === 'logo_ukuran') v = UKURAN[v] ? v : BAWAAN.logo_ukuran;
    if (k === 'logo_url') {
      v = teks(v, 400);
      if (!/^(https?:\/\/|\/)/.test(v)) v = '';
    }
    if (k === 'kop_judul') v = teks(v, 70);
    if (k === 'kop_sub') v = teks(v, 70);
    kueri().pengaturanSet(k, v);
  });
  return semua();
}

/**
 * URL logo untuk KOP DOKUMEN CETAK: logo unggahan kalau ada, kalau tidak logo bawaan (PNG).
 * `base` = prefix aplikasi (header X-Public-Base-Path) supaya berkas bawaan tetap ditemukan.
 */
function logoDokumen(s, base) {
  return (s && s.logo_url) || `${base}/logo-mark.png`;
}

/** URL logo untuk TOPBAR (halaman aplikasi): logo unggahan kalau ada, kalau tidak mark SVG bawaan. */
function logoTopbar(s, base) {
  return (s && s.logo_url) || `${base}/logo-mark.svg`;
}

module.exports = { BAWAAN, UKURAN, semua, simpan, logoDokumen, logoTopbar, judulBawaanSurat };
