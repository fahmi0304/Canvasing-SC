/**
 * Gambar struk MEMO PENGAMBILAN BARANG ke canvas, siap dikirim ke printer thermal
 * lewat ESC/POS raster (lihat bt-printer.js).
 *
 * Lebar 384 dot = kertas 58 mm, 576 dot = kertas 80 mm (printer 203 dpi).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SCStruk = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function lebar(ctx, teks, font) {
    ctx.font = font;
    return ctx.measureText(String(teks)).width;
  }

  /** Pecah teks jadi beberapa baris supaya tidak melebihi lebar kolom. */
  function bungkus(ctx, teks, font, maks) {
    const kata = String(teks || '').split(/\s+/).filter(Boolean);
    if (!kata.length) return [''];
    const hasil = [];
    let kini = '';
    kata.forEach(function (k) {
      const coba = kini ? kini + ' ' + k : k;
      if (!kini || lebar(ctx, coba, font) <= maks) kini = coba;
      else {
        hasil.push(kini);
        kini = k;
      }
    });
    hasil.push(kini);
    return hasil;
  }

  /**
   * @param {HTMLCanvasElement} kanvas
   * @param {{toko:string,judul:string,id:number|string,tanggal:string,sales:string,namaAdmin:string,total:string,baris:Array<{no:number,nama:string,qty:string|number}>}} data
   * @param {{lebarDots?:number}} opsi
   * @returns {HTMLCanvasElement}
   */
  function gambar(kanvas, data, opsi) {
    opsi = opsi || {};
    const W = opsi.lebarDots || 384;
    const sk = W / 384;
    const px = (n) => Math.max(1, Math.round(n * sk));
    const pad = px(9);
    const maks = W - pad * 2;

    const alat = (typeof document !== 'undefined' ? document.createElement('canvas') : kanvas).getContext('2d');
    const F = {
      toko: 'bold ' + px(24) + 'px monospace',
      tahun: px(18) + 'px monospace',
      judul: 'bold ' + px(21) + 'px monospace',
      meta: px(17) + 'px monospace',
      kepala: 'bold ' + px(16) + 'px monospace',
      baris: px(17) + 'px monospace',
      total: 'bold ' + px(18) + 'px monospace',
      kecil: px(15) + 'px monospace',
    };

    // ---------- 1. susun daftar baris gambar (diukur dulu, digambar setelah tinggi kanvas pasti) ----------
    const skema = [];
    const teks = (isi, font, align, tinggi) =>
      skema.push({ t: 'teks', isi: String(isi), font, align: align || 'left', tinggi: tinggi || Math.round(px(26)) });
    const pisah = () => skema.push({ t: 'pisah', tinggi: px(14) });
    const kiriKanan = (kiri, kanan, font) =>
      skema.push({ t: 'kiriKanan', kiri: String(kiri), kanan: String(kanan), font: font || F.meta, tinggi: Math.round(px(25)) });

    teks(data.toko, F.toko, 'center', px(30));
    if (data.tahun) teks(data.tahun, F.tahun, 'center', px(23));
    pisah();
    teks(data.judul, F.judul, 'center', px(30));
    kiriKanan('No.', '#' + data.id);
    kiriKanan('Tanggal', data.tanggal);
    kiriKanan('Sales', data.sales);
    pisah();

    // kepala tabel
    skema.push({ t: 'kepala', tinggi: Math.round(px(26)) });

    const kolomNo = px(20);
    const kolomQty = px(32);
    const xNama = pad + kolomNo + px(2);
    const maksNama = W - pad - kolomQty - px(4) - xNama;

    (data.baris || []).forEach(function (b) {
      const potong = b.nama ? bungkus(alat, b.nama, F.baris, maksNama) : [''];
      skema.push({
        t: 'baris',
        no: String(b.no),
        potong: potong,
        qty: b.qty === undefined || b.qty === null ? '' : String(b.qty),
        kosong: !b.nama,
        xNama,
        maksNama,
        tinggi: Math.round(px(23)) * potong.length,
      });
    });

    pisah();
    kiriKanan('Total Barang', data.total === '' || data.total === undefined ? '' : String(data.total), F.total);

    /*
     * Tanda tangan — bisa dimatikan dari Setting → Edit Logo & Layout Surat (`data.ttd === false`),
     * supaya hasil cetak struk sama dengan yang terlihat di halaman memo.
     */
    if (data.ttd !== false) {
      skema.push({ t: 'ttdJabatan', tinggi: Math.round(px(24)) });
      skema.push({ t: 'ruang', tinggi: px(46), label: data.namaAdmin });
      skema.push({ t: 'ttdNama', tinggi: Math.round(px(26)) });
    }
    pisah();
    // memo SELALU versi terisi (mode memo kosong sudah dihapus atas permintaan user)
    teks('Barang diambil sesuai daftar di atas', F.kecil, 'center', px(22));

    const tinggiKanvas = pad * 2 + skema.reduce((a, s) => a + s.tinggi, 0);
    kanvas.width = W;
    kanvas.height = tinggiKanvas;

    // ---------- 2. gambar ----------
    const ctx = kanvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, kanvas.width, kanvas.height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'alphabetic';

    let y = pad;
    skema.forEach(function (s) {
      const dasar = y + Math.round(s.tinggi * 0.72);
      if (s.t === 'teks') {
        ctx.font = s.font;
        ctx.textAlign = s.align;
        ctx.fillText(s.isi, s.align === 'center' ? W / 2 : pad, dasar);
      } else if (s.t === 'pisah') {
        ctx.save();
        ctx.setLineDash([px(5), px(4)]);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1, px(1.6));
        ctx.beginPath();
        ctx.moveTo(pad, dasar);
        ctx.lineTo(W - pad, dasar);
        ctx.stroke();
        ctx.restore();
      } else if (s.t === 'kiriKanan') {
        ctx.font = s.font;
        ctx.textAlign = 'left';
        ctx.fillText(s.kiri, pad, dasar);
        ctx.textAlign = 'right';
        ctx.fillText(s.kanan, W - pad, dasar);
      } else if (s.t === 'kepala') {
        ctx.font = F.kepala;
        ctx.textAlign = 'left';
        ctx.fillText('NO', pad, dasar);
        ctx.fillText('NAMA BARANG', xNama, dasar);
        ctx.textAlign = 'right';
        ctx.fillText('JML', W - pad, dasar);
        ctx.lineWidth = Math.max(1, px(1.6));
        ctx.beginPath();
        ctx.moveTo(pad, dasar + px(4));
        ctx.lineTo(W - pad, dasar + px(4));
        ctx.stroke();
      } else if (s.t === 'baris') {
        ctx.font = F.baris;
        ctx.textAlign = 'right';
        ctx.fillText(s.qty, W - pad, dasar);
        ctx.textAlign = 'left';
        ctx.fillText(String(s.no), pad, dasar);
        if (s.kosong) {
          ctx.save();
          ctx.setLineDash([px(3), px(3)]);
          ctx.lineWidth = Math.max(1, px(1));
          ctx.beginPath();
          ctx.moveTo(xNama, dasar);
          ctx.lineTo(xNama + s.maksNama, dasar);
          ctx.stroke();
          ctx.restore();
        } else {
          s.potong.forEach(function (barisTeks, i) {
            ctx.fillText(barisTeks, xNama, dasar + i * Math.round(px(23)));
          });
        }
      } else if (s.t === 'ttdJabatan') {
        ctx.font = F.meta;
        ctx.textAlign = 'center';
        ctx.fillText('Admin Gudang,', pad + maks * 0.25, dasar);
        ctx.fillText('Sales,', pad + maks * 0.75, dasar);
      } else if (s.t === 'ruang') {
        const lebarGaris = Math.round(maks / 2 - px(16));
        const kiri = Math.round(pad + maks * 0.25 - lebarGaris / 2);
        const kanan = Math.round(pad + maks * 0.75 - lebarGaris / 2);
        ctx.lineWidth = Math.max(1, px(1.6));
        [kiri, kanan].forEach(function (x) {
          ctx.beginPath();
          ctx.moveTo(x, dasar);
          ctx.lineTo(x + lebarGaris, dasar);
          ctx.stroke();
        });
      } else if (s.t === 'ttdNama') {
        ctx.font = F.baris;
        ctx.textAlign = 'center';
        ctx.fillText((data.namaAdmin || '').slice(0, 16), pad + maks * 0.25, dasar);
        ctx.fillText((data.sales || '').slice(0, 16), pad + maks * 0.75, dasar);
      }
      y += s.tinggi;
    });

    return kanvas;
  }

  return { gambar, bungkus };
});
