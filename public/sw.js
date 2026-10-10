/*
 * Service worker aplikasi Canvasing (SC Sunglasses).
 *
 * Tujuannya HANYA satu: membuat aplikasi memenuhi syarat "bisa dipasang di layar utama HP"
 * (browser mensyaratkan ada service worker dengan handler `fetch`).
 *
 * PENTING — service worker ini SENGAJA TIDAK menyimpan apa pun di cache (tidak ada `caches.open`,
 * tidak ada precache, tidak ada halaman offline). Semua permintaan diteruskan ke jaringan seperti
 * biasa, jadi:
 *   - halaman & dokumen cetak selalu versi TERBARU (lihat catatan anti-cache di AGENTS.md),
 *   - tidak ada risiko pengguna melihat data/halaman lama dari cache,
 *   - kalau server mati, browser tetap menampilkan pesan offline bawaannya (jujur, bukan halaman palsu).
 *
 * Kalau nanti benar-benar mau mode offline, tambahkan cache di sini dengan sangat hati-hati —
 * data canvasing selalu berubah dan halaman lama bisa menyesatkan petugas.
 */
'use strict';

self.addEventListener('install', () => {
  // langsung aktif, tidak menunggu tab lama ditutup
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // ambil alih tab yang sudah terbuka supaya tidak perlu dua kali muat
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // handler kosong: permintaan tidak diintersepsi, langsung ke jaringan (lihat catatan di atas).
});
