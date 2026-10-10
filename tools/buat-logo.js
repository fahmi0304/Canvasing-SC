'use strict';
/*
 * Pembuat logo + ikon aplikasi (dijalankan manual, bukan bagian dari server).
 *
 * Pakai:  cd canvasing && node tools/buat-logo.js     (atau dari mana saja, path absolut)
 * Sesudah dijalankan, WAJIB jalankan `node uji-logo.js` dari root workspace untuk memastikan
 * geometrinya masih benar (isi tetap di dalam viewBox + papan catur/simetri ikon).
 *
 * Latar (permintaan user): "Gunakan itu sebagai logo, dan logo aplikasi buat lancipnya menjadi agak bulat" —
 * mengikuti gambar acuan pemilik aplikasi: latar TEAL, papan catur EMAS berisi huruf "SC" teal,
 * lalu tulisan "SYAIF COLLECTION" dan "SUNGLASSES STORE" sama-sama emas.
 *
 * Menghasilkan:
 *   canvasing/public/logo.svg        — lockup lengkap (latar teal 4:3 + mark emas + kedua tulisan)
 *   canvasing/public/logo-mark.svg   — mark saja (kotak teal membulat + papan catur emas "SC") untuk topbar
 *   canvasing/public/icons/*.png     — ikon PWA (192, 512, maskable 512, apple-touch-icon 180)
 *
 * Warna & bentuk:
 *   TEAL #1B6171 · GOLD #D6A45E (sesuai gambar acuan; keduanya dipakai di SVG & ikon).
 *   MARK: papan catur 9x9 sel (sel 14 satuan, total 126) — cincin 2 sel pola catur dengan JARAK seragam
 *   antar kotak kecil (rapi & ukurannya sama), lalu papan tengah 5x5 berupa SATU kotak SEMPURNA (lebar =
 *   tinggi) tempat huruf "SC" teal. Semua sudut DIBERI radius (`rx`) supaya "lancipnya agak bulat"
 *   (permintaan user) — jangan disetel 0, pola akan terlihat tajam/kaku lagi. Papan tengah WAJIB satu
 *   kotak utuh: kalau dipecah per sel, garis sambungannya terlihat seperti titik-titik yang menutupi "SC".
 *   IKON: ikon `any` (192 & 512) sudutnya dibulatkan 18% — ini yang dimaksud "agak bulat";
 *   ikon maskable & apple-touch-icon sengaja PENUH sampai tepi karena launcher Android/iOS
 *   membulatkan sendiri (sudut transparan pada apple-touch-icon akan jadi hitam di iOS).
 *
 * Catatan: SVG tulisan memakai `textLength` + `lengthAdjust` (jebakan #22) supaya panjang huruf tidak
 * bergantung font mesin dan tidak keluar dari viewBox.
 */
const fs = require('fs');
const path = require('path');

/* Ukuran intrinsik SVG ditulis EKSPLISIT (width/height) — tanpa itu browser memakai ukuran bawaan
   (300x150) dan perhitungan `object-fit: contain` bisa mengubah besar logo di topbar. */
const PUB = path.join(__dirname, '..', 'public');
/*
 * WARNA & GEOMETRI mengikuti LOGO KIRIMAN USER (permintaan: "jadikan itu logo dan ikon").
 *  - TEAL #1a5b69  → diambil PERSIS dari kode SVG kiriman user (`fill="#1a5b69"`).
 *  - GOLD #c9a05f  → diperkirakan dari gambar kiriman (emas tan redup); kalau user menyebut kode
 *                    warnanya yang tepat, cukup ganti di sini lalu jalankan ulang skrip ini.
 *  - GRID 11x11 sel: cincin catur 2 sel + papan tengah emas 7x7 tempat huruf "SC" (rasio papan/lebar
 *    mark = 7/11 = 0,636 — cocok dengan ukuran pada gambar kiriman; sebelumnya 9x9/5x5 = 0,556).
 *    Ukuran total mark tetap 126 satuan supaya tata letak & penjaga uji tidak perlu dihitung ulang.
 */
const TEAL = '#1a5b69';
const GOLD = '#c9a05f';

const N = 11;
const TOTAL = 126;          // ukuran total mark (satuan) — dipertahankan 126
const SEL = TOTAL / N;      // 11,45 satuan per sel
const RX = SEL * 0.19;      // radius sudut tiap kotak KECIL (≈19% sel) — "agak bulat"
/*
 * Permintaan user: "tulisan SC tersamarkan oleh titik titik …, biarkan kotak yang mengelilingi SC kotak
 * sempurna, namun kotaknya tidak runcing, lalu kotak kotak kecil yang tercerai berai rapi dan ukurannya
 * sama".
 *
 * Sebelumnya papan tengah 5x5 digambar sebagai 25 kotak terpisah, sehingga garis sambungan antar kotak
 * terlihat menembus di belakang huruf "SC" (terukur: 5 potongan emas mendatar / 4 tegak pada garis di
 * dalam papan itu → hurufnya seperti tertutup titik-titik). Sekarang:
 *   - papan tengah = SATU kotak SEMPURNA (5x5 sel, lebar = tinggi) dengan sudut agak bulat (tidak runcing);
 *   - kotak-kotak kecil (cincin catur) diberi JARAK seragam (`GAP`) sehingga tampak rapi & ukurannya sama
 *     semua (ukuran kotak = SEL − GAP), bukan saling menempel.
 */
const GAP = SEL * 0.26;     // jarak seragam antar kotak kecil (≈1/4 sel, seperti gambar kiriman)
const RX_PAPAN = RX * 2.6;  // radius sudut papan tengah "SC" — agak bulat, bukan runcing
const RING = 2;             // tebal cincin catur (sel)

/*
 * PARAMETER LOGO APLIKASI — satu sumber kebenaran untuk logo di dalam aplikasi (`logo-mark.svg`,
 * `logo-mark.png`) DAN ikon aplikasi (PWA), supaya semuanya punya bentuk yang sama
 * (permintaan user: "ikon aplikasi samakan dengan logo yang berada di aplikasi").
 *   RADIUS_LOGO = 15.6%  → sudut kotak teal "agak bulat" (sama dengan rx 20 pada logo-mark.svg 128px)
 *   PORSI_LOGO  = 72%    → luas yang dipakai mark emas (sama dengan scale(0.72) di logo-mark.svg)
 */
const RADIUS_LOGO = 15.6;
const PORSI_LOGO = 72;


/** Kotak-kotak emas mark: cincin 2 sel pola catur + SATU papan sempurna di tengah (tempat "SC"). */
function kotakMark(rx, gap = GAP) {
  const keluar = [];
  const sisi = SEL - gap;          // ukuran tiap kotak kecil — SAMA untuk semuanya
  const geser = gap / 2;           // supaya setiap kotak tepat di tengah selnya
  const dalamAwal = RING;
  const dalamAkhir = N - 1 - RING;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const dalam = r >= dalamAwal && r <= dalamAkhir && c >= dalamAwal && c <= dalamAkhir;
      if (dalam) continue;         // papan tengah digambar sebagai satu kotak di bawah
      const cincin = r < RING || r > dalamAkhir || c < RING || c > dalamAkhir;
      if (!(cincin && (r + c) % 2 === 0)) continue;
      const x = +(c * SEL + geser).toFixed(2);
      const y = +(r * SEL + geser).toFixed(2);
      keluar.push(`<rect x="${x}" y="${y}" width="${sisi}" height="${sisi}" rx="${rx}"/>`);
    }
  }
  // Papan tengah: satu kotak SEMPURNA (7x7 sel) mengelilingi huruf "SC", sudutnya agak bulat.
  const sisiPapan = (N - 2 * RING) * SEL - gap;
  const xPapan = +(RING * SEL + geser).toFixed(2);
  const yPapan = +(RING * SEL + geser).toFixed(2);
  const rxPapan = +(rx * 2.6).toFixed(2);
  keluar.push(`<rect x="${xPapan}" y="${yPapan}" width="${sisiPapan}" height="${sisiPapan}" rx="${rxPapan}"/>`);
  return keluar.join('');
}

/** Isi mark (kotak emas + huruf SC) dalam satu grup; dipakai di semua berkas. */
/**
 * HURUF "SC" SEBAGAI VEKTOR (permintaan user: "gunakan logo persis seperti ini di ikon dan logo di
 * halaman maupun surat").
 *
 * Sebelumnya huruf "SC" digambar sebagai <text> memakai font brand, sehingga bentuknya bergantung font
 * dan berbeda dari logo kiriman user (huruf di logonya BALOK: batang mendatar + tiang tegak dengan
 * sudut siku dan ujung rata). Sekarang hurufnya digambar dari kotak-kotak (vektor), jadi:
 *  - bentuknya selalu sama di semua perangkat & ukuran (tidak bergantung font apa pun),
 *  - tajam sampai ukuran ikon terkecil,
 *  - berkas SVG jadi ringan (font tidak perlu ditanam lagi di logo-mark.svg).
 * Geometri: S = batang atas + tiang kiri + batang tengah + tiang kanan + batang bawah;
 *           C = batang atas + tiang kiri + batang bawah (huruf C balok).
 */
function hurufSC({ warna = TEAL, porsi = 0.62 } = {}) {
  const T = 1.35;      // tebal guratan
  const W = 6;         // lebar satu huruf
  const H = 9;         // tinggi huruf
  const JARAK = 1.5;   // jarak antar huruf
  const totalW = W * 2 + JARAK;
  const lebarPapan = 7 * SEL - GAP;                 // papan tengah 7 sel
  const skala = (porsi * lebarPapan) / totalW;      // huruf ±62% lebar papan
  const x0 = 63 - (totalW * skala) / 2;
  const y0 = 63 - (H * skala) / 2;
  const kotak = (g, x, y, w, h) =>
    `<rect x="${(x0 + (g + x) * skala).toFixed(2)}" y="${(y0 + y * skala).toFixed(2)}"` +
    ` width="${(w * skala).toFixed(2)}" height="${(h * skala).toFixed(2)}"/>`;
  const S = [
    [0, 0, W, T],                             // batang atas
    [0, 0, T, H / 2 + T / 2],                 // tiang kiri (atas → tengah)
    [0, H / 2 - T / 2, W, T],                 // batang tengah
    [W - T, H / 2 - T / 2, T, H / 2 + T / 2], // tiang kanan (tengah → bawah)
    [0, H - T, W, T],                         // batang bawah
  ].map(([x, y, w, h]) => kotak(0, x, y, w, h)).join('');
  const C = [
    [0, 0, W, T],                             // batang atas
    [0, 0, T, H],                             // tiang kiri
    [0, H - T, W, T],                         // batang bawah
  ].map(([x, y, w, h]) => kotak(W + JARAK, x, y, w, h)).join('');
  return `<g fill="${warna}" class="huruf-sc">${S}${C}</g>`;
}

function mark({ rx = RX, idPrefix = '' } = {}) {
  return `<g id="${idPrefix}mark">
      <g fill="${GOLD}">${kotakMark(rx)}</g>
      ${hurufSC()}
    </g>`;
}

/*
 * FONT TERTANAM — dipakai HANYA pada `logo-mark.svg` (dan ikon PNG yang dirender dari SVG ini).
 * Saat SVG dipanggil sebagai `<img>` (logo topbar & logo di kepala dokumen cetak), browser TIDAK memuat
 * font dari halaman induk, sehingga huruf "SC" akan jatuh ke font lain. Karena itu Montserrat 800 (berkas
 * yang sama dengan brand aplikasi) ditanam sebagai data URI di dalam SVG mark.
 * `logo.svg` (lockup lengkap) TIDAK ditanam: berkas itu selalu dipasang INLINE di halaman login, jadi
 * memakai font brand dari app.css — dan tidak perlu dobel @font-face yang bisa mengacaukan pemuatan font.
 */
const FONT_TAG = (() => {
  const b64 = fs.readFileSync(path.join(PUB, 'fonts', 'montserrat-800.woff2')).toString('base64');
  return `<style>@font-face{font-family:'Montserrat';font-style:normal;font-weight:800;src:url(data:font/woff2;base64,${b64}) format('woff2')}</style>`;
})();

/* ---------- logo-mark.svg : kotak teal membulat + mark (untuk topbar 40x40) ---------- */
const LOGO_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img" aria-label="SC Sunglasses Store">
  <title>SC Sunglasses Store</title>
  <rect width="128" height="128" rx="${(RADIUS_LOGO / 100) * 128}" fill="${TEAL}"/>
  <g transform="translate(64 64) scale(${PORSI_LOGO / 100}) translate(-63 -63)">
    ${mark()}
  </g>
</svg>
`;

/* ---------- logo.svg : lockup lengkap seperti gambar acuan (latar teal 4:3) ---------- */
/*
 * Lockup lengkap — proporsinya mengikuti gambar kiriman user: kanvas PERSEGI, mark (papan "SC") di
 * tengah-atas (±30% lebar kanvas), lalu "SYAIF COLLECTION" (tebal, emas) dan "SUNGLASSES STORE"
 * (lebih tipis, huruf jarak lebar) di bawahnya.
 */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 520" width="520" height="520" role="img" aria-label="SYAIF COLLECTION — Sunglasses Store">
  <title>SYAIF COLLECTION — Sunglasses Store</title>
  <rect width="520" height="520" fill="${TEAL}"/>
  <g transform="translate(260 216) scale(1.22) translate(-63 -63)">
    ${mark({ idPrefix: 'besar-' })}
  </g>
  <text x="260" y="350" text-anchor="middle" textLength="372" lengthAdjust="spacingAndGlyphs" fill="${GOLD}"
        font-family="Montserrat, Arial, Helvetica, sans-serif" font-weight="800" font-size="38" letter-spacing="1">SYAIF COLLECTION</text>
  <text x="260" y="396" text-anchor="middle" textLength="300" lengthAdjust="spacingAndGlyphs" fill="${GOLD}"
        font-family="system-ui, 'Segoe UI', Arial, Helvetica, sans-serif" font-weight="400" font-size="19" letter-spacing="7">SUNGLASSES STORE</text>
</svg>
`;

/* ---------- ikon PNG ---------- */
/**
 * @param ukuran   sisi gambar (px)
 * @param radius   radius sudut kotak latar, dalam persen sisi (0 = penuh/lancip, dipakai maskable & iOS
 *                 karena launcher/iOS yang membulatkan sendiri)
 * @param porsi    luas yang dipakai mark (persen sisi)
 */
function ikon(ukuran, radius, porsi) {
  const r = ((radius / 100) * ukuran).toFixed(2);
  const skala = ((porsi / 100) * ukuran) / TOTAL;
  // Huruf "SC" sekarang VEKTOR (lihat hurufSC()), jadi tidak perlu menanam font di ikon lagi.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${ukuran}" height="${ukuran}" viewBox="0 0 ${ukuran} ${ukuran}">
  <rect width="${ukuran}" height="${ukuran}" rx="${r}" fill="${TEAL}"/>
  <g transform="translate(${ukuran / 2} ${ukuran / 2}) scale(${skala.toFixed(4)}) translate(-63 -63)">
    ${mark({ rx: RX * (ukuran / 190) })}
  </g>
</svg>
</body></html>`;
}

const ICONS = [
  ['icon-192.png', 192, RADIUS_LOGO, PORSI_LOGO],   // sama dengan logo di aplikasi
  ['icon-512.png', 512, RADIUS_LOGO, PORSI_LOGO],
  ['icon-maskable-512.png', 512, 0, 52],   // penuh + mark lebih kecil: launcher Android yang membulatkan
  ['apple-touch-icon.png', 180, 0, PORSI_LOGO],     // penuh: iOS membulatkan sendiri (sudut transparan jadi hitam)
];

/*
 * PNG khusus KEPALA DOKUMEN CETAK — `public/logo-mark.png` (permintaan user: "gunakan png … untuk logo
 * di surat jalan") + dipakai sebagai logo di aplikasi. Parameternya = parameter logo di atas.
 */
const LOGO_DOK = { nama: 'logo-mark.png', ukuran: 512, radius: RADIUS_LOGO, porsi: PORSI_LOGO };

(async () => {
  fs.mkdirSync(path.join(PUB, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(PUB, 'logo.svg'), LOGO);
  fs.writeFileSync(path.join(PUB, 'logo-mark.svg'), LOGO_MARK);
  console.log('ditulis: logo.svg', LOGO.length, 'bita | logo-mark.svg', LOGO_MARK.length, 'bita');

  const { chromium } = require('playwright');
  const br = await chromium.launch();
  for (const [nama, ukuran, radius, porsi] of ICONS) {
    const pg = await br.newPage({ viewport: { width: ukuran, height: ukuran }, deviceScaleFactor: 1 });
    await pg.setContent(ikon(ukuran, radius, porsi), { waitUntil: 'load' });
    await pg.screenshot({ path: path.join(PUB, 'icons', nama), omitBackground: true, clip: { x: 0, y: 0, width: ukuran, height: ukuran } });
    await pg.close();
    console.log('ditulis: icons/' + nama, ukuran + 'px sudut ' + radius + '% porsi mark ' + porsi + '%');
  }
  const pd = await br.newPage({ viewport: { width: LOGO_DOK.ukuran, height: LOGO_DOK.ukuran }, deviceScaleFactor: 1 });
  await pd.setContent(ikon(LOGO_DOK.ukuran, LOGO_DOK.radius, LOGO_DOK.porsi), { waitUntil: 'load' });
  await pd.screenshot({
    path: path.join(PUB, LOGO_DOK.nama),
    omitBackground: true,
    clip: { x: 0, y: 0, width: LOGO_DOK.ukuran, height: LOGO_DOK.ukuran },
  });
  await pd.close();
  console.log('ditulis: ' + LOGO_DOK.nama + ' ' + LOGO_DOK.ukuran + 'px (kepala dokumen cetak)');
  await br.close();
})();
