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

/** Galat terakhir dari pembuatan context/halaman — dilaporkan `diagnosa()` supaya sebabnya terlihat. */
let galatContext = '';

function catatGalat(nama, e) {
  const pesan = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 300);
  galatContext = `${nama}: ${pesan}`;
  console.error('[pdf-f4]', galatContext);
}

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

/*
 * SATU BROWSER + SATU HALAMAN YANG DIPAKAI ULANG (penting — jangan diubah tanpa membaca).
 *
 * Dua alasan:
 *  1. Instalasi Playwright di server ini membatasi **satu halaman per browser** (permintaan kedua
 *     langsung ditolak), jadi halaman TIDAK boleh ditutup lalu dibuka lagi untuk tiap PDF.
 *  2. Di aplikasi LIVE, `browserContext.newPage()` yang dipanggil berulang bisa gagal dengan
 *     **"Target crashed"**, dan menutup context terakhir membuat browsernya mati sama sekali
 *     (pernah terjadi: halaman uji berhasil dibuka, lalu setelah `ctx.close()` semua langkah
 *     berikutnya gagal dengan "Target page, context or browser has been closed").
 *
 * Jadi: buat SATU sesi (browser + context + halaman) saat PDF pertama diminta, pakai ulang terus,
 * dan tutup hanya kalau menganggur (JEDA_MATI) atau kalau ada kegagalan/waktu habis.
 */
let janjiSesi = null;
let waktuIdle = null;
let rantai = Promise.resolve();

/*
 * BATAS WAKTU SATU PEKERJAAN PDF (penting — jangan dihapus).
 *
 * Kejadian nyata di aplikasi LIVE: permintaan `/cetak/surat-jalan-pdf/:id` MENGGANTUNG tanpa batas
 * (diuji dari luar: 170 detik tanpa balasan sama sekali, sedangkan halaman cetak HTML-nya hanya 0,25 s).
 * Karena pekerjaan diantrekan (`antre`), satu pekerjaan yang tidak pernah selesai membuat SEMUA
 * permintaan PDF berikutnya ikut menunggu selamanya — pengguna melihat "PDF tidak bisa dibuka"
 * untuk semua status (bukan hanya ongoing).
 *
 * Solusinya: setiap pekerjaan dibungkus batas waktu; kalau lewat, Chromium ditutup (pekerjaan yang
 * tersangkut ikut mati) dan antrean dilepas supaya permintaan berikutnya bisa jalan lagi — jadi
 * kegagalan selalu berakhir dengan pesan jelas, tidak pernah menggantung.
 */
const BATAS_KERJA = Number(process.env.SC_PDF_TIMEOUT_MS || 45000);

/** Jalankan `p` dengan batas waktu; kalau lewat, janji ditolak (pekerjaan aslinya dibiarkan gagal sendiri). */
function denganBatas(p, ms, nama) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${nama} melewati batas ${Math.round(ms / 1000)} detik`)), ms);
    if (t.unref) t.unref();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

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
  const janji = janjiSesi;
  janjiSesi = null;
  if (janji) janji.then((s) => s.b.close().catch(() => {})).catch(() => {});
}

/*
 * CARA MENJALANKAN CHROMIUM — DICOBA SATU PER SATU SAMPAI ADA YANG BENAR-BENAR BISA MEMBUKA HALAMAN
 * (penting; jangan disederhanakan jadi satu `launch()` saja).
 *
 * Kejadian nyata di aplikasi LIVE: `launch()` sukses (0,1 detik) dan context dibuat, tetapi
 * `browserContext.newPage` gagal dengan **"Target crashed"** — proses renderer Chromium mati di
 * lingkungan sandbox platform. Akibatnya SEMUA rute PDF menggantung/gagal, padahal di shell pengembang
 * (sandbox berbeda) hal yang sama berjalan normal, jadi bug ini tidak pernah tertangkap skrip uji.
 *
 * Solusinya: setiap kombinasi argumen diuji dengan benar-benar MEMBUKA HALAMAN KOSONG
 * (`newPage` + `evaluate`); kombinasi pertama yang lolos itulah yang dipakai, dan hasilnya diingat
 * (`komboDipakai`) supaya pemakaian berikutnya cepat. Urutannya dari paling ringan ke paling agresif:
 *   A. dasar (--no-sandbox + --disable-dev-shm-usage)
 *   B. tanpa zygote/GPU (--no-zygote) — biasanya cukup di container
 *   C. satu proses (--single-process) — pilihan terakhir, paling kompatibel di sandbox ketat
 */
const DASAR = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
const KOMBO_LAUNCH = [
  { nama: 'A-dasar', args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  { nama: 'B-tanpa-zygote', args: [...DASAR, '--no-zygote'] },
  { nama: 'C-satu-proses', args: [...DASAR, '--no-zygote', '--single-process'] },
  // Chromium PENUH (bukan headless-shell) — di beberapa sandbox ia justru berjalan sementara
  // headless-shell-nya crash; keduanya tersedia di cache bersama server ini.
  { nama: 'D-chromium-penuh', channel: 'chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  { nama: 'E-chromium-tanpa-zygote', channel: 'chromium', args: [...DASAR, '--no-zygote'] },
  { nama: 'F-chromium-satu-proses', channel: 'chromium', args: [...DASAR, '--no-zygote', '--single-process'] },
];
/** Batas tiap percobaan saat mencari cara menjalankan Chromium (jangan terlalu besar: user menunggu). */
const BATAS_COBA_LAUNCH = Number(process.env.SC_PDF_LAUNCH_MS || 12000);
const BATAS_CARI = Number(process.env.SC_PDF_CARI_MS || 60000);   // total anggaran pencarian
let komboDipakai = '';

/*
 * Kombinasi yang berhasil DIINGAT di berkas kecil di folder aplikasi (`.pdf-kombo.json`), supaya setelah
 * aplikasi di-restart (setiap publish) tidak perlu mencari dari awal lagi — pencarian itu memakan waktu
 * dan di server ini peluncuran Chromium yang gagal bisa menggantung sampai batas waktunya.
 */
const BERKAS_KOMBO = () => require('path').join(__dirname, '..', '.pdf-kombo.json');

function bacaKomboTersimpan() {
  try {
    const t = JSON.parse(require('fs').readFileSync(BERKAS_KOMBO(), 'utf8'));
    if (t && typeof t.nama === 'string' && KOMBO_LAUNCH.some((k) => k.nama === t.nama)) return t.nama;
  } catch (e) { /* belum ada / rusak → cari lagi */ }
  return '';
}

function simpanKombo(nama) {
  try { require('fs').writeFileSync(BERKAS_KOMBO(), JSON.stringify({ nama, waktu: new Date().toISOString() })); } catch (e) { /* tidak wajib */ }
}

/**
 * Buka satu kombinasi: launch + context + SATU halaman, lalu buktikan halamannya benar-benar hidup
 * (`evaluate`). Halaman itu TIDAK ditutup — langsung dipakai untuk pekerjaan PDF berikutnya.
 */
async function bukaSesi(k) {
  // batas launch dibuat pendek: di aplikasi live, launch yang gagal bisa MENGGANTUNG tanpa batas
  // (terukur: rute diagnosa berhenti di langkah launch setelah 45 detik).
  const opsi = { args: k.args, timeout: BATAS_COBA_LAUNCH };
  if (k.channel) opsi.channel = k.channel;
  const b = await playwright.chromium.launch(opsi);
  /*
   * DUA CARA membuka halaman dicoba berurutan — perbedaan ini NYATA di aplikasi live:
   *  1. `browser.newContext()` + `context.newPage()` (cara bawaan)
   *  2. `browser.newPage()` (memakai context bawaan browser)
   * Di server ini Playwright-nya dipatch untuk satu halaman per browser, dan mode headless-shell bisa
   * membuat salah satu cara gagal ("Target crashed") sementara cara lainnya jalan.
   */
  const cara = [
    { nama: 'context+page', buka: async () => { const ctx = await b.newContext({ viewport: { width: 900, height: 1300 } }); return { ctx, pg: await ctx.newPage() }; } },
    { nama: 'page-bawaan', buka: async () => ({ ctx: null, pg: await b.newPage() }) },
  ];
  let galatTerakhir = null;
  for (const c of cara) {
    try {
      const { ctx, pg } = await c.buka();
      await pg.evaluate(() => 1 + 1);       // pembuktian halaman benar-benar hidup
      return { b, ctx, pg, cara: c.nama };
    } catch (e) {
      catatGalat(`kombo ${k.nama} (${c.nama})`, e);
      galatTerakhir = e;
    }
  }
  await b.close().catch(() => {});
  throw galatTerakhir || new Error('tidak bisa membuka halaman Chromium');
}

/** Sesi Chromium (browser + context + satu halaman) yang dipakai ulang. */
async function browser() {
  if (janjiSesi) return janjiSesi;
  janjiSesi = (async () => {
    // kombinasi yang terakhir berhasil (atau tersimpan dari sesi sebelumnya) dicoba lebih dulu
    const favorit = komboDipakai ? komboDipakai.split(' ')[0] : bacaKomboTersimpan();
    const urut = favorit
      ? [...KOMBO_LAUNCH].sort((x, y) => (x.nama === favorit ? -1 : y.nama === favorit ? 1 : 0))
      : KOMBO_LAUNCH;
    const mulai = Date.now();
    let galatTerakhir = null;
    for (const k of urut) {
      if (Date.now() - mulai > BATAS_CARI) {
        galatTerakhir = new Error(`pencarian cara menjalankan Chromium melewati ${Math.round(BATAS_CARI / 1000)} detik`);
        break;
      }
      try {
        const s = await bukaSesi(k);
        komboDipakai = `${k.nama} (${s.cara})`;
        simpanKombo(k.nama);
        console.log(`[pdf-f4] Chromium dipakai dengan kombo ${komboDipakai}`);
        s.b.on('disconnected', () => { janjiSesi = null; });
        return s;
      } catch (e) {
        galatTerakhir = e;
      }
    }
    throw new Error(`semua cara menjalankan Chromium gagal (${(galatTerakhir && galatTerakhir.message) || 'tidak diketahui'})`);
  })();
  try {
    return await janjiSesi;
  } catch (e) {
    janjiSesi = null;
    throw e;
  }
}

/*
 * PANASKAN di latar belakang saat aplikasi dimuat: pencarian cara menjalankan Chromium memakan waktu
 * (di server ini bisa puluhan detik), jadi dilakukan lebih dulu supaya permintaan PDF pengguna tidak
 * ikut menunggu. Kegagalan di sini tidak apa-apa — rutenya akan mencoba lagi dan memberi pesan.
 */
function panaskan() {
  setTimeout(() => {
    if (alasan()) return;
    browser()
      .then(() => console.log(`[pdf-f4] pemanasan selesai (kombo ${komboDipakai})`))
      .catch((e) => console.error('[pdf-f4] pemanasan gagal:', (e && e.message) || e));
  }, 1500).unref?.();
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

  return antre(() => denganBatas(kerja(), BATAS_KERJA, 'Pembuatan PDF').catch((e) => {
    /*
     * Gagal/melampaui batas → tutup Chromium supaya halaman yang tersangkut tidak menahan pekerjaan
     * berikutnya (Playwright di server ini membatasi SATU halaman per browser).
     */
    matikan();
    throw e;
  }));

  async function kerja() {
    const s = await browser();
    const pg = s.pg;
    try {
      /*
       * Cookie pengguna dititipkan ke halaman yang dipakai ulang ini (halaman sama dipakai untuk
       * pengguna berbeda), jadi SELALU disetel ulang — termasuk dikosongkan bila tidak ada cookie.
       */
      await pg.setExtraHTTPHeaders(cookie ? { cookie } : {});
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
      // Halaman TIDAK ditutup (dipakai ulang); browser ditutup hanya kalau menganggur.
      jadwalkanMatikan();
    }
  }
}

/**
 * DIAGNOSA pembuat PDF (dipakai rute `/cetak/pdf-diagnosa`, administrator saja) — menjalankan tiap
 * langkah dengan batas waktu sendiri lalu melaporkan langkah mana yang gagal/berat. Berguna karena
 * kegagalan PDF di server hanya terlihat sebagai "tidak bisa dibuka" di sisi pengguna.
 */
async function diagnosa({ cookie = '', alamat = '' } = {}) {
  const out = {
    alasan: alasan(),
    sumberPlaywright,
    browsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || '(tak diset)',
    nodePath: process.env.NODE_PATH || '(tak diset)',
    versiPlaywright: (playwright && playwright._version) || '',
    langkah: {},
  };
  if (out.alasan) return out;
  const catat = async (nama, kerja, ms = 25000) => {
    const mulai = Date.now();
    try {
      const hasil = await denganBatas(kerja(), ms, nama);
      out.langkah[nama] = { ok: true, ms: Date.now() - mulai, hasil: hasil === undefined ? null : hasil };
    } catch (e) {
      out.langkah[nama] = { ok: false, ms: Date.now() - mulai, galat: String((e && e.message) || e).slice(0, 200) };
      matikan();
      throw new Error('berhenti');
    }
  };
  let pg = null;
  try {
    await catat('launch', async () => {
      const s = await browser();
      const v = s.b.version ? await s.b.version() : 'ok';
      pg = s.pg;
      return v;
    }, 45000);
    out.komboChromium = komboDipakai || '(belum diuji)';
    out.galatContext = galatContext;
    try {
      if (alamat) {
        await catat('cookie', async () => { await pg.setExtraHTTPHeaders(cookie ? { cookie } : {}); return 'ok'; }, 10000);
        await catat('goto', async () => {
          const r = await pg.goto(alamat, { waitUntil: 'load', timeout: 20000 });
          return r ? r.status() : 0;
        }, 25000);
        await catat('cekDokumen', async () => pg.evaluate(() => !!document.querySelector('.dok')), 10000);
        await catat('pdf', async () => {
          const buf = await pg.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 30000 });
          return buf.length;
        }, 40000);
      }
    } finally {
      jadwalkanMatikan();
    }
  } catch (e) { /* langkah gagal sudah dicatat */ }
  out.galatContext = galatContext;
  return out;
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

module.exports = { dariHalaman, alasan, headerNama, matikan, diagnosa, panaskan };
