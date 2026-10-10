'use strict';

/**
 * Penulis PDF sederhana (tanpa pustaka tambahan).
 *
 * Permintaan user: "tambah kolom view memo untuk melihat rincian barang yang ditambahkan, view memo
 * yang dilihat sudah berbentuk pdf". Jadi memo penambahan barang dibuat sebagai berkas PDF sungguhan
 * (Content-Type: application/pdf, dibuka dengan penampil PDF browser) — bukan halaman HTML yang harus
 * dicetak dulu.
 *
 * Isinya teks + garis saja (font standar PDF: Helvetica/Helvetica-Bold, tidak perlu ditanam), jadi
 * cukup ditulis tangan: katalog → halaman → stream isi. Semua koordinat dalam MILIMETER dari kiri-atas
 * (lebih mudah dibaca), dikonversi ke satuan PDF (poin, dari kiri-bawah) di dalam kelas ini.
 */

const MM = 72 / 25.4; // 1 mm = 2,8346 pt

/** Huruf yang tidak ada di font standar (ASCII/latin-1) diganti '?' supaya PDF tidak rusak. */
function aman(teks) {
  return String(teks === null || teks === undefined ? '' : teks)
    .replace(/\r?\n/g, ' ')
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}

/** Escape untuk string PDF: kurung & backslash wajib di-escape. */
function escPdf(teks) {
  return aman(teks).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Lebar teks (perkiraan Helvetica) dalam mm — dipakai untuk perataan kanan/tengah.
 * Tabel lebar per karakter (per 1000 em) seperlunya saja; sisanya memakai 0,5 em.
 */
const LEBAR_KARAKTER = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
  K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

function lebarTeks(teks, ukuran, tebal = false) {
  const t = aman(teks);
  let jum = 0;
  for (const ch of t) {
    const w = ch >= '0' && ch <= '9' ? 556 : LEBAR_KARAKTER[ch] !== undefined ? LEBAR_KARAKTER[ch] : 500;
    jum += tebal ? w * 1.04 : w; // Helvetica-Bold sedikit lebih lebar
  }
  return ((jum / 1000) * ukuran) / MM; // pt -> mm
}

class Dokumen {
  constructor({ lebarMm = 215, tinggiMm = 330 } = {}) {
    this.lebarMm = lebarMm;
    this.tinggiMm = tinggiMm;
    this.halaman = [];
    this.baru();
  }

  /** Mulai halaman baru (halaman pertama otomatis dibuat di constructor). */
  baru() {
    this.isi = [];
    this.halaman.push(this.isi);
    return this;
  }

  get jumlahHalaman() {
    return this.halaman.length;
  }

  /**
   * Tulis teks; (x, y) = mm dari kiri-atas. `rata`: left | tengah | kanan.
   * `tengahBaris` = tinggi baris (mm); kalau diisi, teks diletakkan di TENGAH baris itu secara
   * vertikal (tidak terlalu ke atas / ke bawah) — dipakai tabel memo penginputan.
   */
  teks(x, y, str, { ukuran = 10, tebal = false, rata = 'left', lebar = 0, tengahBaris = 0 } = {}) {
    const t = aman(str);
    if (!t) return this;
    let px = x;
    if (rata !== 'left' && lebar > 0) {
      const w = lebarTeks(t, ukuran, tebal);
      px = rata === 'kanan' ? x + lebar - w : x + (lebar - w) / 2;
    }
    const font = tebal ? '/F2' : '/F1';
    /*
     * Jarak garis dasar dari sisi ATAS (mm). Bawaan `ukuran * 0.36` (perilaku lama, jangan diubah —
     * dipakai semua dokumen lain). Kalau `tengahBaris` diisi, jaraknya dihitung supaya tinggi huruf
     * besar (0,72 em) tepat berada di tengah baris.
     */
    const turunMm = tengahBaris > 0 ? (tengahBaris + (0.72 * ukuran) / MM) / 2 : ukuran * 0.36;
    const py = (this.tinggiMm - y - turunMm) * MM;
    this.isi.push(
      `BT ${font} ${ukuran.toFixed(2)} Tf 1 0 0 1 ${(px * MM).toFixed(2)} ${py.toFixed(2)} Tm (${escPdf(t)}) Tj ET`
    );
    return this;
  }

  /** Garis dari (x1,y1) ke (x2,y2) mm dari kiri-atas. */
  garis(x1, y1, x2, y2, { tebal = 0.2, putus = 0 } = {}) {
    const d = putus > 0 ? `[${putus.toFixed(2)} ${putus.toFixed(2)}] 0 d ` : '[] 0 d ';
    this.isi.push(
      `${d}${tebal.toFixed(2)} w ${(x1 * MM).toFixed(2)} ${((this.tinggiMm - y1) * MM).toFixed(2)} m ` +
        `${(x2 * MM).toFixed(2)} ${((this.tinggiMm - y2) * MM).toFixed(2)} l S`
    );
    return this;
  }

  /** Kotak berisi warna (abu terang) — dipakai kepala tabel. */
  kotak(x, y, lebar, tinggi, { abu = 0.88 } = {}) {
    this.isi.push(
      `${abu.toFixed(3)} ${abu.toFixed(3)} ${abu.toFixed(3)} rg ` +
        `${(x * MM).toFixed(2)} ${((this.tinggiMm - y - tinggi) * MM).toFixed(2)} ${(lebar * MM).toFixed(2)} ${(tinggi * MM).toFixed(2)} re f ` +
        `0 0 0 rg`
    );
    return this;
  }

  /**
   * Beberapa kotak SEKALIGUS dengan aturan isian EVEN-ODD (`f*`) — lubang di dalam kotak tetap kosong.
   *
   * Dipakai untuk modul QR: bwip-js menggambar pola QR sebagai SATU path berisi banyak persegi
   * (mis. finder pattern = persegi hitam besar + persegi putih di dalamnya) dan mengisinya dengan
   * aturan even-odd. Kalau setiap persegi digambar terpisah sebagai kotak hitam, lubangnya hilang
   * dan QR-nya jadi blok hitam yang tidak bisa dipindai (kesalahan yang tertangkap saat menguji PDF).
   * PDF punya perintah yang sama: `... re ... f*`.
   *
   * @param {Array<{x:number,y:number,w:number,h:number}>} daftar satuan mm, y dari kiri-atas
   */
  kotakGrup(daftar, { abu = 0 } = {}) {
    if (!daftar || !daftar.length) return this;
    const bagian = daftar
      .map(
        (k) =>
          `${(k.x * MM).toFixed(3)} ${((this.tinggiMm - k.y - k.h) * MM).toFixed(3)} ` +
          `${(k.w * MM).toFixed(3)} ${(k.h * MM).toFixed(3)} re`
      )
      .join(' ');
    this.isi.push(`${abu.toFixed(3)} ${abu.toFixed(3)} ${abu.toFixed(3)} rg ${bagian} f* 0 0 0 rg`);
    return this;
  }

  /** Potong teks supaya muat `lebarMm` (dipakai kolom nama barang yang panjang). */
  potong(str, ukuran, lebarMm, tebal = false) {
    let t = aman(str);
    if (lebarTeks(t, ukuran, tebal) <= lebarMm) return t;
    while (t.length > 1 && lebarTeks(t + '…', ukuran, tebal) > lebarMm) t = t.slice(0, -1);
    return t + '...';
  }

  /** Susun berkas PDF. */
  buffer() {
    const objek = [];
    const tambahObjek = (isiObjek) => {
      objek.push(isiObjek);
      return objek.length; // nomor objek (1-based)
    };

    // 1 = katalog, 2 = pages, 3 = F1, 4 = F2 (nomornya dipatok dulu supaya bisa dirujuk)
    const katalog = tambahObjek('');           // 1
    const pages = tambahObjek('');             // 2
    const font1 = tambahObjek('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
    const font2 = tambahObjek('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'); // 4

    const nomorHalaman = this.halaman.map((isi) => {
      const stream = isi.join('\n');
      const isiObjek = tambahObjek(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const nomor = tambahObjek(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${(this.lebarMm * MM).toFixed(2)} ${(this.tinggiMm * MM).toFixed(2)}] ` +
          `/Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${isiObjek} 0 R >>`
      );
      return nomor;
    });

    objek[katalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
    objek[pages - 1] =
      `<< /Type /Pages /Kids [${nomorHalaman.map((n) => `${n} 0 R`).join(' ')}] /Count ${nomorHalaman.length} >>`;

    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offset = [];
    objek.forEach((isiObjek, i) => {
      offset.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${isiObjek}\nendobj\n`;
    });
    const mulaiXref = pdf.length;
    pdf += `xref\n0 ${objek.length + 1}\n0000000000 65535 f \n`;
    offset.forEach((o) => {
      pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objek.length + 1} /Root ${katalog} 0 R >>\nstartxref\n${mulaiXref}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
  }
}

module.exports = { Dokumen, lebarTeks, MM };
