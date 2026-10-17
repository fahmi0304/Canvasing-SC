'use strict';
const { Dokumen } = require('./pdf');
const { angka, tanggalPanjang, tanggalPendek, urutNama } = require('./util');
const { noSurat } = require('./kode');
const { semua: setelanSemua } = require('./setelan');

/**
 * MEMO PENAMBAHAN BARANG per PENGINPUTAN (entri) — berkas PDF sungguhan.
 *
 * Permintaan user:
 *  - "kolom memo penginputan dibagi menjadi 3 … di memo berisi tiga dengan format kolom NO, NAMA BARANG,
 *    JUMLAH" → daftar barang ditulis dalam **TIGA blok kolom** (tanpa kolom kode), tiap blok punya
 *    kepala sendiri NO | NAMA BARANG | JUMLAH.
 *  - "memaksimalkan ke bawah dulu baru mengisi sebelahnya" → kolom 1 diisi **ke bawah** dulu sampai
 *    penuh (baru kolom 2, lalu kolom 3) — BUKAN diratakan; ini permintaan terakhir dan menggantikan
 *    aturan "diratakan" sebelumnya (16 barang → 6/6/4).
 *  - "tiap blok minimal 5 baris (3 barang → 3 baris terisi + 12 baris kosong bergaris)" → kolom tetap
 *    punya sedikitnya `BARIS_MINIMAL` baris bergaris untuk ditulis tangan, walau barangnya sedikit.
 *  - "kolom tanda tangan tidak diletakkan paling bawah, tapi pas di bawah tulisan akumulasi"
 *    → blok tanda tangan langsung menyusul catatan akumulasi, bukan dipatok di dasar halaman.
 *
 * Ukuran kertas mengikuti dokumen lain di aplikasi ini: F4 215 × 330 mm, margin 10 mm.
 * (Di laporan/surat jalan daftar barangnya tetap 2 kolom — lihat views/print.js.)
 */
/*
 * VERSI_MEMO = waktu ubah berkas ini. Dipakai sebagai `?v=` pada tautan View Memo supaya PDF lama yang
 * masih tersimpan di cache browser/ponsel pengguna TIDAK pernah dipakai lagi setelah kode diperbarui
 * (pernah terjadi: pengguna melihat memo versi lama karena penampil PDF-nya menyimpan berkas lama).
 */
const VERSI_MEMO = (() => {
  try {
    return String(Math.round(require('fs').statSync(__filename).mtimeMs));
  } catch (e) {
    return '1';
  }
})();

const F4 = { lebarMm: 215, tinggiMm: 330 };
const MARGIN = 10;
const LEBAR_ISI = F4.lebarMm - MARGIN * 2; // 195 mm

/* ---------- daftar barang: 3 kolom ---------- */
const JENIS_KOLOM = 3;
const JARAK_KOLOM = 4; // mm antar blok kolom
const LEBAR_KOLOM = (LEBAR_ISI - JARAK_KOLOM * (JENIS_KOLOM - 1)) / JENIS_KOLOM; // 62,33 mm per blok
const LEBAR_NO = 8;
const LEBAR_QTY = 14;
/*
 * Permintaan user: "semua teks di kolom rata tengah, nama barang rata kiri namun tetap di tengah"
 * → kepala kolom & angka rata TENGAH, sedangkan teks nama barang rata KIRI (tetap di tengah barisnya
 * secara vertikal, lewat opsi `tengahBaris` di Dokumen.teks()).
 * `judulRata` = perataan teks KEPALA kolom, `rata` = perataan isi sel.
 */
const KOLOM_ISI = [
  { judul: 'NO', x: 0, lebar: LEBAR_NO, judulRata: 'tengah', rata: 'tengah', kunci: 'no' },
  { judul: 'NAMA BARANG', x: LEBAR_NO, lebar: LEBAR_KOLOM - LEBAR_NO - LEBAR_QTY, judulRata: 'tengah', rata: 'left', kunci: 'nama' },
  { judul: 'JUMLAH', x: LEBAR_KOLOM - LEBAR_QTY, lebar: LEBAR_QTY, judulRata: 'tengah', rata: 'tengah', kunci: 'qty' },
];
const UKURAN_BARIS = 8.6;
const TINGGI_BARIS = 5.8;
const TINGGI_KEPALA = 6;
const BARIS_MINIMAL = 5;                       // permintaan user: setiap blok minimal 5 baris
const BATES_KOLOM = F4.tinggiMm - MARGIN - 52; // baris terakhir kolom tidak melewati ini
const TINGGI_TTD = 26;                         // tinggi blok tanda tangan (jabatan + ruang + nama)

function xKolom(kolom) {
  return MARGIN + kolom * (LEBAR_KOLOM + JARAK_KOLOM);
}

function barisField(d, y, pasangan, ukuran = 9) {
  const lebar = LEBAR_ISI / 2;
  pasangan.forEach(([label, nilai], i) => {
    const x = MARGIN + i * lebar;
    d.teks(x, y, label, { ukuran, tebal: true });
    d.teks(x + 34, y, `: ${nilai}`, { ukuran });
  });
  return y;
}

/** Kepala satu blok kolom (NO | NAMA BARANG | JUMLAH); `yAtas` = sisi atas kotak kepala. */
function kepalaKolom(d, kolom, yAtas) {
  const x0 = xKolom(kolom);
  d.kotak(x0, yAtas, LEBAR_KOLOM, TINGGI_KEPALA);
  KOLOM_ISI.forEach((k) =>
    d.teks(x0 + k.x + 1, yAtas + 0.6, k.judul, {
      ukuran: 8,
      tebal: true,
      rata: k.judulRata || 'tengah',
      lebar: k.lebar - 2,
      tengahBaris: TINGGI_KEPALA - 1.2,
    })
  );
}

/**
 * Satu baris barang. `nilai` kosong (null) = baris KOSONG yang tetap digambar bergaris supaya bisa
 * ditulis tangan (permintaan user: "biarkan tampil 12 kolom kosong yang berisi 5 per blok").
 */
function barisBarang(d, kolom, y, nilai) {
  const x0 = xKolom(kolom);
  if (nilai) {
    KOLOM_ISI.forEach((k) =>
      d.teks(x0 + k.x + 1, y + 0.2, nilai[k.kunci], {
        ukuran: UKURAN_BARIS,
        rata: k.rata,
        lebar: k.lebar - 2,
        tengahBaris: TINGGI_BARIS - 0.4,
      })
    );
  }
  d.garis(x0, y + TINGGI_BARIS, x0 + LEBAR_KOLOM, y + TINGGI_BARIS, { tebal: nilai ? 0.15 : 0.1, putus: nilai ? 0.6 : 0.9 });
}

/*
 * BLOK TANDA TANGAN DIHAPUS dari memo penginputan (permintaan user: "hapus kolom tanda tangan di cetak
 * laporan", pilihan pemilik aplikasi: semua dokumen — termasuk memo). Fungsi `blokTandaTangan()` dan
 * pemanggilannya sudah dibuang; jangan dihidupkan kembali tanpa permintaan baru.
 */

/**
 * Pembagian halaman daftar barang (permintaan user):
 *  - baris per kolom **DIRATAKAN**: `baris = max(BARIS_MINIMAL, ceil(sisa / 3))`, dibatasi kapasitas
 *    halaman (16 barang → 6/6/4; 96 barang → 32/32/32).
 *  - tiap blok tetap punya sedikitnya `BARIS_MINIMAL` (5) baris bergaris untuk ditulis tangan, jadi
 *    3 barang → 3 baris terisi + 12 baris kosong bergaris.
 *  - baris ke-i masuk kolom `floor(i / baris)` → pengisian urut KE BAWAH dulu di kolom 1, baru kolom 2
 *    & 3 (bukan mengisi satu baris penuh lalu turun).
 *  - kapasitas satu halaman = `baris * 3` (paling banyak 96 barang), sisanya halaman berikutnya dengan
 *    susunan yang sama.
 */
function bagiHalaman(jumlah, kapasitas) {
  const halaman = [];
  let sisa = jumlah;
  do {
    const baris = Math.min(kapasitas, Math.max(BARIS_MINIMAL, Math.ceil(sisa / JENIS_KOLOM)));
    const ambil = Math.min(sisa, baris * JENIS_KOLOM);
    halaman.push({ baris, ambil });
    sisa -= ambil;
  } while (sisa > 0 && halaman.length < 200);
  return halaman;
}

/**
 * Susun memo (Buffer PDF).
 * `items`: [{ kode, nama, qty }] — hanya barang dengan qty > 0.
 */
exports.memoEntri = function ({ sesi, batch, items, nomor, akumulasi, setelan }) {
  // barang di memo disusun A-Z (permintaan user: "cukup urutkan nama A-Z saat mencetak saja")
  items = urutNama(items);
  // Setelan "Edit Logo & Layout Surat": nama toko di kop + blok tanda tangan hidup/mati (lib/setelan.js).
  const st = setelan || setelanSemua();
  const d = new Dokumen(F4);
  let y = MARGIN;

  /*
   * ---------- kop ----------
   * Permintaan user: "Kop memo hanya SC Sunglasses Store, memo pengambilan, dan keterangan dikunci di
   * bawahnya, tidak usah garis" → tiga baris saja (tanpa "TAHUN …") dan tanpa garis pemisah.
   */
  d.teks(MARGIN, y, st.kop_sub, { ukuran: 13, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
  y += 6.4;
  // Judul memo menyesuaikan jenis entri: pengambilan barang atau PENGEMBALIAN ke gudang (permintaan user).
  const judulMemo = String(batch.sumber || '').toLowerCase() === 'kembali-gudang' ? 'MEMO PENGEMBALIAN BARANG' : 'MEMO PENGAMBILAN BARANG';
  d.teks(MARGIN, y, judulMemo, { ukuran: 12, tebal: true, rata: 'tengah', lebar: LEBAR_ISI });
  y += 5.2;
  // keterangan dikunci tepat di bawah judul
  d.teks(MARGIN, y, 'PENGINPUTAN TERKUNCI — tidak bisa diubah', { ukuran: 8, rata: 'tengah', lebar: LEBAR_ISI });
  y += 10;

  // ---------- keterangan ----------
  const jam = batch.jam_akhir && batch.jam_akhir !== batch.jam_mulai ? `${batch.jam_mulai} - ${batch.jam_akhir}` : batch.jam_mulai;
  const sumberKecil = String(batch.sumber || '').toLowerCase();
  const sumber =
    sumberKecil === 'kembali-gudang'
      ? 'Dikembalikan ke Gudang'
      : !batch.sumber || sumberKecil === 'gudang'
        ? 'Gudang'
        : batch.kode_sumber
          ? `${batch.kode_sumber} (sales ${batch.sumber})`
          : `Sales ${batch.sumber}`;
  barisField(d, y, [
    ['No. Surat Jalan', noSurat(sesi)],
    ['Nama Sales', String(sesi.sales_nama || '-')],
  ]);
  y += 5.4;
  barisField(d, y, [
    ['Tanggal Canvasing', tanggalPanjang(sesi.tanggal)],
    ['Tanggal penginputan', tanggalPendek(batch.tanggal)],
  ]);
  y += 5.4;
  barisField(d, y, [
    ['Jam penginputan', `${jam} WITA`],
    ['Penginputan ke', `${nomor}`],
  ]);
  y += 5.4;
  barisField(d, y, [
    ['Diambil dari', sumber],
    ['Total penginputan ini', `${angka(batch.total)} barang`],
  ]);
  y += 5.4;
  barisField(d, y, [
    ['Diinput oleh', String(batch.petugas || '-')],
    ['Jenis barang', `${items.length} jenis`],
  ]);
  // permintaan user: "beri jarak dari tulisan daftar barang yang ditambahkan ke teks di atasnya"
  y += 11;
  const yKeteranganDaftar = y;

  // baris pertama tiap kolom; kepala kolom digambar tepat di atasnya
  const yAwalUtama = yKeteranganDaftar + 4.4 + TINGGI_KEPALA + 0.6;
  const kapasitas = Math.max(BARIS_MINIMAL, Math.floor((BATES_KOLOM - yAwalUtama) / TINGGI_BARIS));
  const halaman = bagiHalaman(items.length, kapasitas);

  let yAkhirTerakhir = yAwalUtama; // posisi terbawah yang terpakai di halaman terakhir
  let sudah = 0;

  halaman.forEach((bagi, hal) => {
    let yAwal = yAwalUtama;
    if (hal > 0) {
      d.baru();
      d.teks(MARGIN, MARGIN, `${judulMemo} · ${noSurat(sesi)} · ${tanggalPendek(batch.tanggal)} ${jam} WITA (lanjutan hal. ${hal + 1})`, {
        ukuran: 8.4,
      });
      yAwal = MARGIN + 8 + TINGGI_KEPALA + 0.6;
      d.teks(MARGIN, yAwal - TINGGI_KEPALA - 2.6, `Daftar barang (lanjutan) — ${items.length} jenis barang:`, { ukuran: 8.4 });
    } else {
      d.teks(MARGIN, yKeteranganDaftar, `Daftar barang yang ditambahkan pada penginputan ini (${items.length} jenis barang):`, {
        ukuran: 8.4,
      });
    }

    for (let k = 0; k < JENIS_KOLOM; k++) kepalaKolom(d, k, yAwal - TINGGI_KEPALA - 0.6);

    // inti permintaan user: isi kolom 1 ke bawah dulu sampai `bagi.baris`, baru kolom 2, lalu kolom 3
    for (let i = 0; i < bagi.baris * JENIS_KOLOM; i++) {
      const kolom = Math.floor(i / bagi.baris);
      const baris = i % bagi.baris;
      const idx = sudah + i;
      const it = idx < items.length ? items[idx] : null;
      barisBarang(
        d,
        kolom,
        yAwal + baris * TINGGI_BARIS,
        it
          ? {
              no: String(idx + 1),
              nama: d.potong(it.nama || '-', UKURAN_BARIS, KOLOM_ISI[1].lebar - 3, false),
              qty: `${angka(it.qty)} Pcs`,
            }
          : null
      );
    }
    yAkhirTerakhir = yAwal + bagi.baris * TINGGI_BARIS;
    sudah += bagi.ambil;
    if (!bagi.ambil && !items.length) {
      d.teks(MARGIN + 1, yAwal + 1.4, 'Tidak ada barang yang ditambahkan pada penginputan ini.', { ukuran: 9 });
    }
    if (hal < halaman.length - 1) {
      d.teks(MARGIN, yAkhirTerakhir + 4, `(daftar barang lanjut di halaman berikutnya — sisa ${items.length - sudah} barang)`, { ukuran: 8.4 });
    }
  });

  /*
   * Total + akumulasi + tanda tangan diletakkan MENYUSUL di bawah blok kolom terbawah
   * (permintaan user: "kolom tanda tangan tidak diletakkan paling bawah, tapi pas di bawah tulisan
   * akumulasi"). Kalau sisa ruang di bawahnya tidak cukup, dibuatkan halaman baru supaya tidak
   * menabrak kolom yang sedang penuh.
   */
  const xKan = xKolom(JENIS_KOLOM - 1);
  let yTotal = yAkhirTerakhir + 4;
  if (yTotal + 14 + TINGGI_TTD > F4.tinggiMm - MARGIN) {
    d.baru();
    yTotal = MARGIN + 8;
  }
  // permintaan user: "tidak usah keterangan akumulasi seluruh penambahan dst" → TOTAL langsung disusul
  // tanda tangan (rata tengah pada blok kolom terakhir).
  d.garis(xKan, yTotal - 2.4, xKan + LEBAR_KOLOM, yTotal - 2.4, { tebal: 0.4 });
  d.teks(xKan, yTotal, `TOTAL PENGINPUTAN INI : ${angka(batch.total)}`, {
    ukuran: 9,
    tebal: true,
    rata: 'tengah',
    lebar: LEBAR_KOLOM,
    tengahBaris: 4.6,
  });

  return d.buffer();
};

/** Geometri tata letak memo — dipakai skrip uji supaya tata letaknya bisa diperiksa tanpa PDF viewer. */
exports.VERSI_MEMO = VERSI_MEMO;

exports.KOLOM_MEMO = {
  JENIS_KOLOM,
  LEBAR_KOLOM,
  JARAK_KOLOM,
  MARGIN,
  KOLOM_ISI,
  LEBAR_ISI,
  TINGGI_BARIS,
  TINGGI_KEPALA,
  BARIS_MINIMAL,
  BATES_KOLOM,
  LEBAR_NO,
  LEBAR_QTY,
  xKolom,
  bagiHalaman,
};
