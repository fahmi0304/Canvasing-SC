'use strict';
/**
 * PDF F4 DIBUAT APLIKASI (permintaan user) — "Unduh PDF F4 (pasti 1 halaman, tanpa header/footer,
 * tanpa menyetel ukuran kertas)" untuk SURAT JALAN & LAPORAN LENGKAP.
 *
 * Masalah yang dijawab: kalau pengguna memakai dialog cetak ponsel (terutama iPhone/Safari), ukuran
 * kertas TIDAK bisa dipilih dari halaman web — pilihan kertas selalu datang dari setelan perangkat
 * (default A4/Letter), dan Safari iPhone ikut mencetak tanggal + alamat situs (headers/footers).
 * Terukur pada dokumen nyata: kertas F4 = 1 halaman, kertas A4/Letter = 2 halaman → kolom & isi
 * laporan jadi tidak sesuai (keluhan user: "laporan yang dibuat di iOS bentuknya tidak sesuai").
 *
 * Cara kerjanya: halaman cetak aplikasi (`/cetak/surat-jalan/:id` atau `/cetak/laporan/:id`) dibuka di
 * Chromium headless (Playwright) LALU dicetak jadi PDF dengan `preferCSSPageSize: true` sehingga
 * memakai `@page { size: 215mm 330mm; margin: 10mm }` dari `print.css` — pasti F4, dan TIDAK pernah
 * ada header/footer (`displayHeaderFooter` bawaannya false). Jadi hasilnya sama persis dengan halaman
 * cetak yang dilihat pengguna, hanya saja kertasnya sudah pasti benar.
 *
 * Catatan teknis (jangan diubah tanpa membaca):
 *  - Halaman cetaknya diambil lewat HTTP dari server aplikasi SENDIRI dan cookie login pengguna
 *    diteruskan. Ini WAJIB: kalau HTML-nya disetel lewat `setContent()`, dokumennya ber-origin opaque
 *    sehingga permintaan font (`woff2`) diblokir CORS (`net::ERR_FAILED`) → dokumen tercetak memakai
 *    font pengganti (FreeSerif!) dan ukuran baris/lebar kolomnya berubah. Lewat HTTP, origin-nya sama
 *    dan `@font-face` termuat normal.
 *  - Chromium dijalankan SATU kali lalu dipakai bersama (hemat memori & cepat: ~0,3 s per PDF setelah
 *    browser hidup), dan ditutup otomatis kalau sudah menganggur (`JEDA_MATI`).
 *  - Playwright membatasi SATU halaman per browser: pekerjaan PDF diantrekan (`antre`), tiap halaman
 *    ditutup sebelum yang berikutnya dibuka.
 *  - Kalau Playwright/Chromium tidak tersedia, `alasan()` mengembalikan sebabnya supaya rute bisa
 *    memberi pesan jelas (pengguna tetap bisa memakai dialog cetak biasa).
 */

const JEDA_MATI = 120000;   // tutup browser kalau menganggur 2 menit

/*
 * ---------- MEMUAT PLAYWRIGHT + CHROMIUM TANPA BERGANTUNG PADA ENV SANDBOX ----------
 * Di server ini Playwright TIDAK dipasang di `node_modules` aplikasi, melainkan disediakan bersama
 * (`/var/lib/vibecoderco/shared-node-modules/node_modules`) dan browser-nya di
 * `/var/lib/vibecoderco/shared-playwright-cache`. Shell agen menerima `NODE_PATH` +
 * `PLAYWRIGHT_BROWSERS_PATH` dari sandbox-nya, TETAPI proses aplikasi yang dijalankan platform belum
 * tentu mewarisi keduanya — dan kalau tidak, `require('playwright')` gagal / Chromium tidak ketemu
 * sehingga rute PDF hanya membalas "PDF belum bisa dibuat di server ini" (gejala: tombol cetak PDF
 * tidak menghasilkan berkas). Karena itu keduanya dicari sendiri di sini (bisa ditimpa lewat env
 * `SC_PLAYWRIGHT_MODULES` / `SC_PLAYWRIGHT_BROWSERS`). Semua pencarian bersifat "coba kalau ada" —
 * kalau tidak ditemukan, aplikasi tetap hidup dan rutenya memberi pesan jelas lewat `alasan()`.
 */
const CANDIDATE_MODULES = [
  process.env.SC_PLAYWRIGHT_MODULES || '',
  ...String(process.env.NODE_PATH || '').split(pathDelimiter()).filter(Boolean),
  '/var/lib/vibecoderco/shared-node-modules/node_modules',
].filter((d, i, a) => d && a.indexOf(d) === i);
const CANDIDATE_BROWSERS = [
  process.env.SC_PLAYWRIGHT_BROWSERS || '',
  '/var/lib/vibecoderco/shared-playwright-cache',
].filter(Boolean);

function pathDelimiter() {
  return process.platform === 'win32' ? ';' : ':';
}

/** Pakai folder browser bersama kalau env-nya tidak diisi dan foldernya memang ada. */
function siapkanFolderBrowser(fs) {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return;
  const ada = CANDIDATE_BROWSERS.find((d) => {
    try { return fs.existsSync(d); } catch (e) { return false; }
  });
  if (ada) process.env.PLAYWRIGHT_BROWSERS_PATH = ada;
}

let playwright = null;
let alasanTakAda = '';
let sumberPlaywright = '';
try {
  siapkanFolderBrowser(require('fs'));
  try {
    playwright = require('playwright');
    sumberPlaywright = 'node_modules/normal';
  } catch (ePertama) {
    // coba setiap lokasi bersama; `require.resolve` dipakai supaya pencarian mengikuti aturan Node
    for (const dir of CANDIDATE_MODULES) {
      try {
        playwright = require(require.resolve('playwright', { paths: [dir] }));
        sumberPlaywright = dir;
        break;
      } catch (e) { /* coba lokasi berikutnya */ }
    }
    if (!playwright) alasanTakAda = (ePertama && ePertama.message) || 'playwright tidak tersedia';
  }
} catch (e) {
  alasanTakAda = (e && e.message) || 'playwright tidak tersedia';
}
if (playwright && playwright.chromium) {
  console.log(`[pdf-f4] pembuat PDF siap (playwright dari ${sumberPlaywright || 'node_modules'}, browser ${process.env.PLAYWRIGHT_BROWSERS_PATH || 'bawaan'})`);
} else {
  console.error('[pdf-f4] pembuat PDF TIDAK tersedia:', alasanTakAda);
}

let janjiBrowser = null;
let waktuIdle = null;
let rantai = Promise.resolve();

/** Alasan pembuat PDF tidak bisa dipakai ('' = tersedia). Dipakai rute untuk memberi pesan jelas. */
function alasan() {
  return playwright && playwright.chromium ? '' : `pembuat PDF tidak tersedia di server (${alasanTakAda || 'chromium tidak ada'})`;
}

function jadwalkanMatikan() {
  if (waktuIdle) clearTimeout(waktuIdle);
  waktuIdle = setTimeout(() => { matikan(); }, JEDA_MATI);
  if (waktuIdle.unref) waktuIdle.unref();   // jangan menahan proses server tetap hidup
}

function matikan() {
  const janji = janjiBrowser;
  janjiBrowser = null;
  if (janji) janji.then((b) => b.close().catch(() => {})).catch(() => {});
}

async function browser() {
  if (janjiBrowser) return janjiBrowser;
  janjiBrowser = (async () => {
    const b = await playwright.chromium.launch({
      // `--no-sandbox` diperlukan karena proses server berjalan tanpa hak sandbox Chromium;
      // `--disable-dev-shm-usage` mencegah gagal render ketika /dev/shm kecil (khas container).
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    b.on('disconnected', () => { janjiBrowser = null; });
    return b;
  })();
  try {
    return await janjiBrowser;
  } catch (e) {
    janjiBrowser = null;
    throw e;
  }
}

/** Antrekan pekerjaan supaya hanya satu halaman Chromium terbuka pada satu waktu. */
function antre(kerja) {
  const hasil = rantai.then(kerja, kerja);
  rantai = hasil.then(() => {}, () => {});
  return hasil;
}

/**
 * Cetak satu halaman cetak aplikasi menjadi berkas PDF.
 * @param {string} alamat  URL halaman cetak di server aplikasi sendiri (mis. http://127.0.0.1:4123/canvasing/cetak/surat-jalan/12)
 * @param {object} opsi
 *   - `cookie`    = header Cookie milik pengguna (halaman cetak wajib login)
 *   - `periksa`   = selektor penanda dokumen benar-benar termuat (bawaan `.dok`; memo memakai `.struk`)
 *   - `siapkan`   = NAMA fungsi di halaman yang dipanggil sebelum dicetak (bawaan `pasFontLaporan`
 *                   — memilih ukuran huruf & membagi kolom; memo memakai `pasHalamanStruk`)
 * @returns {Promise<Buffer>} isi berkas PDF
 */
async function dariHalaman(alamat, { cookie = '', periksa = '.dok', siapkan = 'pasFontLaporan' } = {}) {
  const salah = alasan();
  if (salah) throw new Error(salah);
  if (!/^https?:\/\//.test(String(alamat || ''))) throw new Error('alamat halaman cetak tidak sah');

  return antre(async () => {
    const b = await browser();
    const ctx = await b.newContext({
      viewport: { width: 900, height: 1300 },
      extraHTTPHeaders: cookie ? { cookie } : {},
    });
    const pg = await ctx.newPage();
    try {
      await pg.goto(alamat, { waitUntil: 'load', timeout: 60000 });
      // pastikan yang tercetak benar-benar dokumen (bukan halaman login/kosong)
      const adaDok = await pg.evaluate((sel) => !!document.querySelector(sel), String(periksa || '.dok'));
      if (!adaDok) throw new Error('halaman cetak tidak memuat dokumen (sesi login mungkin tidak sah)');
      // Ukuran huruf dokumen dihitung dari tinggi baris NYATA, jadi font harus benar-benar termuat dulu
      // — kalau tidak, huruf bisa dipilih terlalu besar/kecil dan dokumen pecah 2 halaman.
      await pg.evaluate(async () => {
        try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* lanjut */ }
      });
      if (siapkan) await pg.evaluate((nama) => { if (typeof window[nama] === 'function') window[nama](); }, String(siapkan));
      return await pg.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 60000 });
    } finally {
      await ctx.close().catch(() => {});
      jadwalkanMatikan();
    }
  });
}

/**
 * Nama berkas yang aman untuk header `Content-Disposition` (bagian ASCII + versi UTF-8).
 *
 * `unduh = true` → `attachment` (berkas langsung terunduh). Bawaannya **`inline`**: permintaan user
 * terbaru — "Semua cetak dokumen laporan digabung ke cetak PDF … PDF-nya terbuka di tab baru untuk
 * dilihat/dicetak dari penampil PDF" — jadi tautan PDF menampilkan berkasnya di penampil PDF
 * (pengguna tetap bisa mengunduh/mencetak dari sana).
 */
function headerNama(nama, unduh = false) {
  const bersih = String(nama || 'dokumen.pdf').replace(/[\r\n"\\]/g, '').trim() || 'dokumen.pdf';
  const ascii = bersih.replace(/[^\x20-\x7E]/g, '_');
  return `${unduh ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(bersih)}`;
}

module.exports = { dariHalaman, alasan, headerNama, matikan };
