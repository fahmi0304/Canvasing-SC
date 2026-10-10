'use strict';
/*
 * PEMBUAT IKON APLIKASI (ikon di layar utama HP) DARI LOGO YANG DIUNGGAH.
 *
 * Permintaan user: "Samakan ikon aplikasi HP dengan logo yang saya unggah".
 *
 * Cara kerja:
 *   1. Server menyimpan SALINAN logo unggahan di `tools/logo-sumber.png` (byte aslinya sudah dikirim ke
 *      penyimpanan media platform; yang di sini hanya bahan baku pembuat ikon).
 *   2. Skrip ini menggambar ulang logo itu menjadi 4 berkas PNG ikon di `public/icons/` dengan
 *      kebijakan yang SAMA seperti ikon bawaan (`tools/buat-logo.js`).
 *   3. Ikon lama (bawaan) DICADANGKAN ke `tools/bawaan/` sebelum ditimpa, supaya tombol
 *      "Kembalikan logo bawaan" bisa mengembalikan ikonnya juga (`kembalikanIkonBawaan()`).
 *
 * Pakai:
 *   cd canvasing && node tools/ikon-dari-logo.js            (dari tools/logo-sumber.png)
 *   node tools/ikon-dari-logo.js https://…/logo.png         (dari URL, sekaligus disalin ke logo-sumber.png)
 *   node tools/ikon-dari-logo.js /jalur/ke/logo.png
 *
 * Dipakai juga oleh `server.js` (otomatis setiap kali administrator mengunggah logo baru) dan oleh
 * `uji-logo.js` (membandingkan ikon di disk dengan hasil gambar ulang dari sumber yang sedang aktif).
 *
 * KEBIJAKAN UKURAN (jangan diubah tanpa menyesuaikan uji-logo.js):
 *   - ikon `any` (192 & 512) : logo memenuhi seluruh kotak + sudut dibulatkan 15,6% (sudut transparan).
 *     Logo yang diunggah sudah memuat latarnya sendiri, jadi menampilkannya penuh = "sama persis
 *     dengan logo yang diunggah".
 *   - ikon `maskable` (512)  : latar diambil dari warna sudut logo, logo digambar 72% di tengahnya —
 *     launcher Android memotongnya bulat, jadi isi penting harus tetap di dalam area aman.
 *   - `apple-touch-icon`     : penuh sampai tepi (iOS membulatkan sendiri; sudut transparan jadi hitam).
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
/*
 * Letak berkas bisa digeser lewat env supaya SKRIP UJI bisa memakai folder sendiri dan tidak menimpa
 * ikon aplikasi yang sebenarnya (`uji-setting-logo.js` memakai SC_IKON_*).
 */
const IKON_DIR = process.env.SC_IKON_DIR ? path.resolve(process.env.SC_IKON_DIR) : path.join(PUB, 'icons');
const DIR_BAWAAN = process.env.SC_IKON_BAWAAN ? path.resolve(process.env.SC_IKON_BAWAAN) : path.join(__dirname, 'bawaan');
const SUMBER_LOGO = process.env.SC_IKON_SUMBER ? path.resolve(process.env.SC_IKON_SUMBER) : path.join(__dirname, 'logo-sumber.png');

/** Daftar ikon: radius = % sisi (0 = penuh/lancip), porsi = % sisi yang dipakai gambar logo. */
const IKON = [
  { nama: 'icon-192.png', ukuran: 192, radius: 15.6, porsi: 100 },
  { nama: 'icon-512.png', ukuran: 512, radius: 15.6, porsi: 100 },
  { nama: 'icon-maskable-512.png', ukuran: 512, radius: 0, porsi: 72 },
  { nama: 'apple-touch-icon.png', ukuran: 180, radius: 0, porsi: 100 },
];

/** Jenis gambar dari magic bytes (server hanya mengizinkan jpg/png untuk logo). */
function jenisGambar(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  throw new Error('berkas logo harus PNG atau JPG');
}

/** Ambil byte sumber: dari URL (http/https) atau dari berkas di disk. */
async function ambilSumber(sumber) {
  if (/^https?:\/\//i.test(String(sumber))) {
    const r = await fetch(String(sumber));
    if (!r.ok) throw new Error(`gagal mengunduh logo (HTTP ${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  return fs.readFileSync(sumber);
}

/** HTML satu ikon (dipakai juga oleh uji-logo.js sebagai acuan pembanding). */
function htmlIkon({ ukuran, radius, porsi, dataUri }) {
  const r = ((radius / 100) * ukuran).toFixed(2);
  const p = Math.round((porsi / 100) * ukuran);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
#kotak{width:${ukuran}px;height:${ukuran}px;display:flex;align-items:center;justify-content:center;
  border-radius:${r}px;overflow:hidden}
#logo{width:${p}px;height:${p}px;object-fit:cover;display:block}
</style></head><body><div id="kotak"><img id="logo" alt="" src="${dataUri}"></div>
<script>
/* Latar = warna sudut logo (dipakai ikon maskable & sebagai pengisi sisa kotak). Kalau sudutnya
   tembus pandang, dipakai putih supaya ikon maskable tidak berlubang. */
window.siapkan = async function () {
  const im = new Image();
  im.src = document.getElementById('logo').src;
  await im.decode();
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const x = c.getContext('2d');
  x.drawImage(im, 2, 2, 1, 1, 0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  const warna = d[3] < 40 ? '#ffffff' : 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
  document.getElementById('kotak').style.background = warna;
  return warna;
};
</script></body></html>`;
}

/**
 * Buat ulang seluruh ikon dari sumber tertentu.
 * @param sumber   jalur berkas / URL (bawaan: tools/logo-sumber.png)
 * @param tulis    false = jangan tulis ke disk, kembalikan saja byte-nya (dipakai uji-logo.js)
 * @param cadangkan true = simpan ikon lama ke tools/bawaan/ sebelum ditimpa (sekali saja)
 */
async function buatIkon({ sumber = SUMBER_LOGO, tulis = true, cadangkan = true } = {}) {
  const buf = await ambilSumber(sumber);
  const dataUri = `data:${jenisGambar(buf)};base64,${buf.toString('base64')}`;
  if (tulis && cadangkan) cadangkanIkon();

  const { chromium } = require('playwright');
  const br = await chromium.launch();
  const berkas = [];
  try {
    for (const ik of IKON) {
      const pg = await br.newPage({ viewport: { width: ik.ukuran, height: ik.ukuran }, deviceScaleFactor: 1 });
      await pg.setContent(htmlIkon({ ...ik, dataUri }), { waitUntil: 'load' });
      await pg.evaluate(() => window.siapkan());
      const opsi = { omitBackground: true, clip: { x: 0, y: 0, width: ik.ukuran, height: ik.ukuran } };
      if (tulis) {
        await pg.screenshot({ ...opsi, path: path.join(IKON_DIR, ik.nama) });
        berkas.push(ik.nama);
      } else {
        berkas.push({ nama: ik.nama, ukuran: ik.ukuran, radius: ik.radius, porsi: ik.porsi, isi: await pg.screenshot(opsi) });
      }
      await pg.close();
    }
  } finally {
    await br.close();
  }
  return { sumber, berkas };
}

/** Salin ikon yang ADA SEKARANG ke tools/bawaan/ (hanya sekali — tidak menimpa cadangan lama). */
function cadangkanIkon() {
  if (fs.existsSync(path.join(DIR_BAWAAN, 'icon-512.png'))) return false;
  fs.mkdirSync(DIR_BAWAAN, { recursive: true });
  for (const ik of IKON) {
    const dari = path.join(IKON_DIR, ik.nama);
    if (fs.existsSync(dari)) fs.copyFileSync(dari, path.join(DIR_BAWAAN, ik.nama));
  }
  return true;
}

/**
 * Kembalikan ikon BAWAAN (dipakai tombol "Kembalikan logo bawaan") + buang salinan logo unggahan.
 * Kalau cadangan tidak ada (belum pernah ada logo unggahan), tidak ada yang diubah.
 */
function kembalikanIkonBawaan() {
  const ada = fs.existsSync(path.join(DIR_BAWAAN, 'icon-512.png'));
  if (!ada) return { dipulihkan: false, berkas: [] };
  const berkas = [];
  for (const ik of IKON) {
    const dari = path.join(DIR_BAWAAN, ik.nama);
    if (!fs.existsSync(dari)) continue;
    fs.copyFileSync(dari, path.join(IKON_DIR, ik.nama));
    berkas.push(ik.nama);
  }
  if (fs.existsSync(SUMBER_LOGO)) fs.unlinkSync(SUMBER_LOGO);
  return { dipulihkan: true, berkas };
}

module.exports = { IKON, buatIkon, kembalikanIkonBawaan, cadangkanIkon, htmlIkon, SUMBER_LOGO, DIR_BAWAAN, IKON_DIR };

if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    let sumber = arg || SUMBER_LOGO;
    if (/^https?:\/\//i.test(String(sumber))) {
      // Dari URL: simpan dulu salinannya supaya bisa dibuat ulang tanpa internet.
      const buf = await ambilSumber(sumber);
      fs.writeFileSync(SUMBER_LOGO, buf);
      console.log('disimpan: tools/logo-sumber.png (' + (buf.length / 1024).toFixed(1) + ' KB)');
      sumber = SUMBER_LOGO;
    }
    const hasil = await buatIkon({ sumber });
    for (const ik of IKON) {
      const st = fs.statSync(path.join(IKON_DIR, ik.nama));
      console.log(`ditulis: icons/${ik.nama} ${ik.ukuran}px sudut ${ik.radius}% porsi ${ik.porsi}% (${(st.size / 1024).toFixed(1)} KB)`);
    }
    console.log('ikon aplikasi dibuat dari:', hasil.sumber);
  })().catch((e) => {
    console.error('GAGAL membuat ikon:', e && e.message);
    process.exit(1);
  });
}
