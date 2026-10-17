'use strict';
/*
 * VERSI DOKUMEN F4 (surat jalan & laporan lengkap) = waktu ubah berkas templat/cetaknya.
 *
 * Dipakai sebagai `?v=` pada SEMUA tautan PDF F4. Alasannya pola keluhan yang berulang: setelah kode
 * diperbaiki, pengguna membuka PDF lewat penampil PDF di ponselnya dan **berkas LAMA** yang tersimpan
 * untuk alamat yang sama masih ditampilkan — sehingga terlihat "perbaikannya tidak jalan" padahal
 * server sudah mengirim dokumen baru (kejadian nyata: laporan ZA008 masih penuh ikon centang).
 * Karena alamatnya berubah setiap kali templat dokumen diperbarui, berkas lama tidak mungkin dipakai lagi.
 *
 * Pola yang sama sudah dipakai VERSI_MEMO (lib/memoEntri.js), VERSI_EKSPEDISI (lib/rekapEkspedisi.js),
 * dan VERSI_STOK (lib/rekapStok.js). Kalau templat dokumen dipecah ke berkas baru, tambahkan berkasnya
 * di daftar bawah supaya versinya ikut berubah.
 */
const path = require('path');
const fs = require('fs');

const VERSI_DOKUMEN = (() => {
  try {
    const berkas = ['../views/print.js', '../lib/pdfF4.js', '../public/print.css'];
    const waktu = berkas.map((b) => fs.statSync(path.join(__dirname, b)).mtimeMs);
    return String(Math.floor(Math.max.apply(null, waktu)));
  } catch (e) {
    return '1'; // tanpa versi pun tautannya tetap bekerja (hanya kehilangan penanda anti-cache)
  }
})();

module.exports = { VERSI_DOKUMEN };
