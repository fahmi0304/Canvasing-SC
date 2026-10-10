'use strict';

/**
 * Ikon GARIS TIGA untuk tombol menu per baris (permintaan user: "tombol titik tiga ubah ke
 * garis tiga … ubah ikon titik tiga ke yang lebih menarik").
 * Garis membulat dengan panjang berbeda supaya terlihat hidup, bukan tiga strip kaku.
 */
const GARIS = `<svg class="ikon-garis" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true">
<path d="M4.5 7h15M4.5 12h9.5M4.5 17h13"/></svg>`;

/** Ikon printer (sama dengan views/cetak.js). */
const PRINTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M7 9V4h10v5"/><path d="M7 18H5.5A2.5 2.5 0 0 1 3 15.5v-4A2.5 2.5 0 0 1 5.5 9h13A2.5 2.5 0 0 1 21 11.5v4A2.5 2.5 0 0 1 18.5 18H17"/>
<rect x="7" y="14" width="10" height="7" rx="1.5"/><path d="M17.5 12h.01"/></svg>`;

/** Ikon kalender untuk tombol filter tanggal. */
const KALENDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;

/** Ikon corong (filter) untuk tombol filter tanggal & sales. */
const FILTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M3 5h18l-7 8v6l-4-2v-4L3 5z"/></svg>`;

/** Ikon orang (petugas/sales) untuk judul blok filter sales. */
const ORANG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6S19.5 16.4 19.5 20"/></svg>`;

/** Ikon daftar/laporan (dokumen berbaris) untuk tombol "laporan lengkap". */
const LAPORAN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`;

/** Ikon tambah (plus). */
const PLUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
<path d="M12 5v14M5 12h14"/></svg>`;

/** Ikon dasbor (panel/beranda) untuk menu Dasbor. */
const DASBOR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<rect x="3" y="3" width="7.5" height="8.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="3" y="14.5" width="7.5" height="6.5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/></svg>`;

/** Ikon setting (roda gigi). */
const SETTING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.09A1.7 1.7 0 0 0 10.12 3.04V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>`;

/** Ikon laporan (dua batang grafik). */
const LAPOR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M4 20V9M11 20V4M18 20v-7"/></svg>`;

/** Ikon inventory (kotak/etalase barang). */
const INVENTORY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/></svg>`;

/** Ikon rekap / hitung (daftar centang). */
const REKAP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M8 6h12M8 12h12M8 18h12M3.6 6l1.2 1.2L7 4.6M3.6 12l1.2 1.2L7 10.6M3.6 18l1.2 1.2L7 16.6"/></svg>`;

/** Ikon selesai (centang di lingkaran). */
const SELESAI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<circle cx="12" cy="12" r="9"/><path d="M8 12.4l2.7 2.6L16 9.6"/></svg>`;

/** Ikon kunci (kunci & terbitkan). */
const KUNCI = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>`;

/** Ikon memo / struk (kertas bergerigi). */
const MEMO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M6 3h12v18l-3-1.6-3 1.6-3-1.6L6 21z"/><path d="M9 8h6M9 12h6"/></svg>`;

/** Ikon audit (riwayat / jam mundur). */
const AUDIT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/><path d="M12 8v4.5l3 1.8"/></svg>`;

/** Ikon hapus (tong sampah). */
const HAPUS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M4.5 7h15M9.5 7V4.6h5V7M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5M13.5 11v5"/></svg>`;

/**
 * Ikon RETUR / PENGEMBALIAN BARANG — SIMBOL SAJA: panah turun yang masuk ke dalam kotak
 * (barang kembali ke gudang).
 * Riwayat permintaan user: mula-mula diminta "tulisan retur di ikon beserta simbolnya", tetapi setelah
 * dilihat hasilnya ada DUA tulisan "Retur" (satu di dalam gambar, satu keterangan di bawah ikon) —
 * user lalu minta: "hapus tulisan yang tengah pertahankan yang bawah". Karena tulisan di gambar sudah
 * dihapus, ukurannya kembali **sama dengan ikon lain (19×19, viewBox 24×24, stroke 2)** sehingga seragam
 * dan sejajar; keterangannya tetap "Retur" di bawah ikon (`.ikon-aksi-ket`).
 * Kelas `ikon-retur` DIPERTAHANKAN sebagai penanda untuk skrip uji — jangan diberi ukuran khusus lagi.
 */
const RETUR = `<svg class="ikon-retur" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M4 10.5h16v9.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19.9z"/>
<path d="M12 2.6v10.1M7.7 8.6L12 12.9l4.3-4.3"/></svg>`;

/** Ikon edit (pensil) untuk halaman surat jalan yang BELUM dikunci (permintaan user:
 *  "ikon tambah ubah ke Edit" — input barang dibawa di status draft = mengedit, bukan menambah). */
const PENSIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M4 20h4.2L20 8.2a2.3 2.3 0 0 0-3.2-3.2L5 16.8z"/><path d="M14.6 6.4l3 3"/></svg>`;

module.exports = { GARIS, PRINTER, KALENDER, FILTER, ORANG, LAPORAN, PLUS, PENSIL, RETUR, DASBOR, SETTING, LAPOR, INVENTORY, REKAP, SELESAI, KUNCI, MEMO, AUDIT, HAPUS };
