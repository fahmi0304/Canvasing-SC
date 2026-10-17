'use strict';

const BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function rp(n) {
  const v = Number(n || 0);
  return 'Rp ' + v.toLocaleString('id-ID');
}

function angka(n) {
  return Number(n || 0).toLocaleString('id-ID');
}

/** '2026-10-06' -> '06 Oktober 2026' */
function tanggalPanjang(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${m[3]} ${BULAN[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

function tanggalPendek(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * NAMA HARI versi Indonesia (indeks 0 = Minggu, sama dengan `Date.getDay()`).
 * Dipakai `tanggalLengkap()` & `kelompokCatatan()` (catatan otomatis) dan sudah ada juga di
 * `views/dashboard.js` (kolom tanggal dasbor) — nilai keduanya harus sama.
 */
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** "Kamis, 09 Oktober 2026" dari `YYYY-MM-DD` (permintaan user: "format hari tanggal nama bulan dan tahun"). */
function tanggalLengkap(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  // `new Date(y, m-1, d)` (bukan `new Date('YYYY-MM-DD')`) supaya hari dihitung di zona waktu toko,
  // bukan UTC — kalau tidak, tanggal bisa bergeser satu hari.
  const hari = HARI[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] || '';
  return `${hari}, ${m[3]} ${BULAN[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

function hariIni() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Jam sekarang menurut jam dinding toko (WITA): "HH:MM". Zona diatur `process.env.TZ` (lihat server.js). */
function jamSekarang() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Penanda JAM penginputan ("HH", dua digit) — dipakai sebagai bagian kunci "penginputan" (entri)
 * penambahan barang: jam berbeda = penginputan baru (permintaan user).
 */
function jamPenanda(jam) {
  const j = String(jam || jamSekarang());
  const m = /^(\d{2})/.exec(j);
  return m ? m[1] : '00';
}

/** Tanggal + jam saat ini sekaligus (dipakai catatan otomatis & cap waktu). */
function sekarang() {
  const jam = jamSekarang();
  return { tanggal: hariIni(), tanggalPendek: tanggalPendek(hariIni()), jam, jamPenanda: jamPenanda(jam) };
}

/** Nilai setoran efektif: manual kalau diisi, kalau null -> b + t - k */
function setoranEfektif(item) {
  if (item.s === null || item.s === undefined) return Math.max(0, (item.b || 0) + (item.t || 0) - (item.k || 0));
  return item.s;
}

const STATUS = {
  draft: { label: 'Input Barang Dibawa', warna: 'kuning' },
  /*
   * STATUS `tunggu_jual` = **"Ongoing"** (label diubah atas permintaan user: "Keterangan menunggu data penjualan, ubah ke ongoing") — permintaan awalnya: *"Buat surat jalan tetap
   * bisa di rekap meski penjualan bisa di imput, tapi jika penjualan belum di imput statusnya menunggu
   * data penjualan"* (pilihan pemilik aplikasi: status tersendiri di database, terpisah dari yang ada).
   *
   * Dipakai `POST /sesi/:id/kunci` (surat jalan terbit, kolom P belum diisi). Begitu sales/admin mengisi
   * penjualan → `jual` (Menunggu Rekap). Urutan lengkap:
   *   draft → tunggu_jual → jual → rekap → selesai.
   *
   * `kirim` DIPERTAHANKAN sebagai status LAMA (alias) supaya data lama / backup lama tetap terbaca —
   * perjalanan dengan status itu diperlakukan sama seperti `tunggu_jual` di semua penjagaan, dan
   * `bootstrap()` menuliskannya ulang menjadi `tunggu_jual` sekali saat aplikasi dimuat.
   */
  tunggu_jual: { label: 'Ongoing', warna: 'biru' },
  kirim: { label: 'Surat Jalan Terbit', warna: 'biru' },
  /*
   * STATUS BARU (permintaan user: *"Pada status surat jalan ongoing, sales harus memasukkan dulu jumlah
   * barang yang di jual mereka ke surat jalan yang ongoing, setelah sales memasukkan barang penjualan
   * mereka surat berubah status menjadi menunggu rekap"*). Urutan status jadi:
   *   draft → kirim → **jual (Menunggu Rekap)** → rekap → selesai.
   * Warnanya `tosca` supaya tidak sama dengan kirim (biru) maupun rekap (ungu).
   */
  jual: { label: 'Menunggu Rekap', warna: 'tosca' },
  rekap: { label: 'Sedang Rekap', warna: 'ungu' },
  selesai: { label: 'Selesai', warna: 'hijau' },
};

function statusInfo(s) {
  return STATUS[s] || { label: s, warna: 'abu' };
}

/*
 * STATUS "MENUNGGU DATA PENJUALAN" — permintaan user: *"Jika rekap sudah di kunci namun data penjualan
 * kosong maka statusnya bukan lagi ongoing, tapi menunggu data penjualan"*.
 *
 * Status di database TETAP `tunggu_jual` (tidak ada status baru, jadi seluruh penjagaan/tombol yang ada
 * ikut berlaku: kolom P masih bisa diisi, rekap bisa dijalankan lagi). Pembedaannya lewat cap waktu
 * **`rekap_at`**:
 *   - `tunggu_jual` TANPA `rekap_at` = surat jalan baru dikunci, belum pernah direkap → **"Ongoing"**;
 *   - `tunggu_jual` DENGAN `rekap_at`   = rekap sudah dijalankan & dikunci tanpa penjualan →
 *     **"Menunggu Data Penjualan"** (baris tetap tampil di dasbor, kolom P masih menunggu diisi).
 */
const STATUS_MENUNGGU_PENJUALAN = { label: 'Menunggu Data Penjualan', warna: 'biru' };

/** true kalau rekapnya sudah dikunci tetapi penjualan (kolom P) belum pernah diisi sama sekali. */
function perluDataPenjualan(s) {
  return !!s && (s.status === 'tunggu_jual' || s.status === 'kirim') && !!s.rekap_at;
}

/**
 * Info status (label + warna) untuk satu BARIS perjalanan — bukan hanya string statusnya.
 * Dipakai seluruh layar (badge kepala perjalanan, badge daftar dasbor/laporan) supaya
 * "Ongoing" dan "Menunggu Data Penjualan" selalu dibedakan dengan aturan yang SAMA.
 */
function statusSesi(s) {
  if (!s) return { label: '', warna: 'abu' };
  return perluDataPenjualan(s) ? STATUS_MENUNGGU_PENJUALAN : statusInfo(s.status);
}

/**
 * DUA SELISIH pada satu perjalanan (permintaan user: *"selisih di hitung dari s dikurangi p"*, dengan
 * jawaban pilihan: **selisih lama (B+T−K−S) tetap ada sebagai keterangan tambahan**).
 *
 *  - `selisihJual(tot)`   = **S − P** → selisih PENJUALAN (selisih UTAMA sejak revisi ini): beda antara
 *    hasil rekap (Setoran) dengan jumlah yang dilaporkan terjual oleh sales (P).
 *  - `selisihBarang(tot)` = **B + T − K − S** → selisih lama, TETAP ditampilkan sebagai keterangan
 *    tambahan (dipakai juga dokumen F4 & penanda baris merah seperti sebelumnya).
 *
 * `tot` = objek berisi angka b/t/k/s/p (mis. hasil `q.itemTotals()` atau hasil penjumlahan di view).
 */
function selisihJual(tot) {
  return (Number(tot.s) || 0) - (Number(tot.p) || 0);
}
function selisihBarang(tot) {
  return (Number(tot.b) || 0) + (Number(tot.t) || 0) - (Number(tot.k) || 0) - (Number(tot.s) || 0);
}

/**
 * CATATAN OTOMATIS untuk barang yang SELISIH — satu baris per barang.
 *
 * Permintaan user: *"Pada surat jalan percobaan sebagai contoh, buat catatan otomatis barang yang selisih
 * 'jumlah setoran kurang 00' karena YSL bawa satu tapi tidak dikembalikan"*, dengan pilihan pemilik
 * aplikasi: dibuat sistem untuk **semua surat jalan & laporan lengkap**.
 *
 * Bunyinya (contoh nyata dari data produksi — surat jalan PER004: YSL 8410 dibawa 1, tidak dikembalikan
 * sehingga setoran 1 sedangkan penjualan yang dilaporkan 0):
 *   - setoran LEBIH banyak dari penjualan → `Jumlah setoran lebih N (NAMA BARANG)`
 *   - setoran KURANG dari penjualan      → `Jumlah setoran kurang N (NAMA BARANG)`
 * dengan N = |S − P| (selalu positif; arahnya dibaca dari kata "lebih"/"kurang") dan nama barangnya di
 * dalam kurung supaya jelas barang yang mana (kode barang tidak dicetak di dokumen).
 *
 * `bandingP` = perbandingan S vs P baru BERARTI (status rekap/selesai). Sebelum rekap, S masih sebesar
 * seluruh barang yang dibawa sehingga semua baris akan dianggap selisih — jadi catatannya pun tidak dibuat.
 *
 * Dipakai BERSAMA oleh `views/print.js` (surat jalan & laporan lengkap) dan `views/sesi.js` (kartu Catatan
 * di layar) supaya layar & kertas berbunyi persis sama. Catatannya **tidak** disimpan di `sesi.catatan`
 * karena sifatnya hasil hitungan yang bisa berubah.
 */
function catatanSelisihSPRinci(items, bandingP) {
  if (!bandingP) return [];
  return (items || [])
    .filter((i) => (Number(i.b) || 0) + (Number(i.t) || 0) + (Number(i.k) || 0) > 0)
    .map((i) => {
      const arah = arahBedaSP(i);
      if (!arah) return null;
      const beda = Math.abs(Number(setoranEfektif(i)) - (Number(i.p) || 0));
      return {
        teks: `${arah === 'lebih' ? 'Jumlah setoran lebih' : 'Jumlah setoran kurang'} ${angka(beda)} (${i.nama})`,
        arah,
      };
    })
    .filter(Boolean);
}

/** Versi teks saja dari `catatanSelisihSPRinci()` (dipakai bila warnanya tidak dibutuhkan). */
function catatanSelisihSP(items, bandingP) {
  return catatanSelisihSPRinci(items, bandingP).map((x) => x.teks);
}

/**
 * Benar kalau angka **Setoran (S)** sebuah baris TIDAK SAMA dengan laporan **penjualan sales (P)** —
 * dasar penanda MERAH pada sel P & S (permintaan user: *"jika kolom s tidak sama dengan p maka kolomnya
 * merah"*). Dipakai dokumen F4 (`views/print.js`), halaman perjalanan & Overview (`views/sesi.js`), dan
 * halaman rekap (`views/rekap.js`, dihitung ulang di browser setiap kolom K diisi).
 *
 * `item` = baris `sesi_item` (punya kolom `p` dan `s`/`b`/`t`/`k`); `nilaiS` boleh dikirim kalau
 * pemanggil sudah lebih dulu menghitung setoran efektifnya (mis. lewat `setoranEfektif()`).
 */
function bedaSP(item, nilaiS) {
  return arahBedaSP(item, nilaiS) !== '';
}

/**
 * ARAH selisih antara **Setoran (S)** dan **Penjualan (P)** satu baris:
 *   'lebih'  → setoran LEBIH banyak dari penjualan  → **HIJAU**
 *   'kurang' → setoran KURANG dari penjualan         → **MERAH**
 *   ''       → angkanya sama (tidak ada penanda)
 *
 * Permintaan user: *"Jika barang setoran lebih, maka tulisan nya Hijau"* — dengan jawaban pilihan pemilik
 * aplikasi: berlaku untuk **sel S & P DAN tulisan catatan otomatisnya** (dokumen + layar), sedangkan
 * setoran KURANG tetap MERAH seperti sebelumnya.
 *
 * Dipakai `bedaSP()` (penanda ada/tidak), `catatanSelisihSPRinci()` (warna baris catatan), dan view
 * layar/dokumen (`views/print.js`, `views/sesi.js`, `views/rekap.js`).
 */
function arahBedaSP(item, nilaiS) {
  const s = nilaiS === undefined ? setoranEfektif(item) : Number(nilaiS) || 0;
  const p = Number(item && item.p) || 0;
  if (Number(s) === p) return '';
  return Number(s) > p ? 'lebih' : 'kurang';
}

/* ---------------------------------------------------------------- nama sales */

/** Normalisasi nama untuk perbandingan: huruf kecil, tanda baca jadi spasi, spasi dirapatkan. */
function normalNama(x) {
  return String(x || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Bentuk "ejaan longgar" sebuah nama: huruf **h** dibuang & huruf kembar dirapatkan.
 * Dipakai untuk menganggap sama ejaan yang lazim berbeda di lapangan — mis. **Ardi/Ardhi**,
 * Muhamad/Muhammad, Rahmat/Ramat. Aturan ini hanya diterapkan pada kata sepanjang ≥ 3 huruf
 * (lihat `tokenNamaSama()`) supaya kata pendek tidak ikut tercampur.
 */
function longgarNama(teks) {
  return String(teks || '').replace(/h/g, '').replace(/(.)\1+/g, '$1');
}

/**
 * Satu kata nama dianggap sama kalau sama persis, atau sama setelah ejaan dilonggarkan
 * (`longgarNama()`: huruf h dibuang & huruf kembar dirapatkan) untuk kata sepanjang ≥ 3 huruf.
 *
 * **Toleransi salah-ketik 1 huruf sengaja TIDAK dipakai**: pernah dicoba (jarak edit ≤ 1) dan langsung
 * membuat **"Zainal"** dianggap sama dengan **"Zainul"** — dua orang yang berbeda. Aturan berbasis ejaan
 * (buang h & rapatkan huruf kembar) cukup untuk kasus nyata Ardi/Ardhi dan Muhamad/Muhammad tanpa
 * risiko itu — jangan ditambah tanpa menguji daftar nama pasangan di aplikasi ini.
 */
function tokenNamaSama(x, y) {
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && longgarNama(x) === longgarNama(y)) return true;
  return false;
}

/**
 * Apakah dua nama sales merujuk ORANG YANG SAMA?
 *
 * Permintaan user: *"sales bisa mengimput data p saat surat jalan ongoing"*, dengan jawaban pilihan
 * pemilik aplikasi: **cocokkan nama yang mirip** (abaikan beda ejaan seperti Ardi/Ardhi).
 *
 * Alasan nyatanya ada di data produksi: petugas bernama **"Zainal Ardi"** sedangkan surat jalan miliknya
 * bernama **"Zainal Ardhi"** — dengan perbandingan persis, sales itu selalu ditolak saat mengisi kolom
 * penjualan (P). Setelah fitur ini, keduanya dianggap sama.
 *
 * Aturannya menuntut **jumlah katanya sama** dan **setiap kata berpasangan cocok** (urutannya diperhatikan)
 * supaya nama berbeda tidak ikut tercampur — mis. "Ahmad Zaki" tetap tidak dianggap "Zainal Ardhi".
 * Dipakai `server.js → bolehJual()` (pemilik surat jalan) — satu tempat, dipakai rute & view.
 */
function namaSalesSama(a, b) {
  const A = normalNama(a);
  const B = normalNama(b);
  if (!A || !B) return false;
  if (A === B) return true;
  const ta = A.split(' ');
  const tb = B.split(' ');
  if (ta.length !== tb.length) return false;
  return ta.every((x, i) => tokenNamaSama(x, tb[i]));
}

/** Bagi daftar jadi 2 kolom seperti format kertas (kolom kiri lebih dulu). */
function duaKolom(list, barisKiri) {
  const n = list.length;
  const kiri = barisKiri || Math.ceil(n / 2);
  return [list.slice(0, kiri), list.slice(kiri)];
}

/**
 * Catatan otomatis pengambilan barang (permintaan user):
 *   "<dd/mm/yyyy> <hh:mm> mengambil barang dari <gudang|NAMA (KODE)> sebanyak 000 pcs (dicatat oleh NAMA)"
 *     → penginputan di perjalanan ini sendiri. Permintaan user: nama sales/petugas sumber ditulis
 *       langsung TANPA kata "sales" dan kode perjalanannya di dalam kurung.
 *   "<dd/mm/yyyy> <hh:mm> telah diambil barangnya oleh NAMA sebanyak 000 pcs (dicatat oleh NAMA)"
 *     → perjalanan sales yang barangnya diambil/dikurangi
 * Bagian "(dicatat oleh NAMA)" ada di SEMUA baris catatan otomatis (permintaan user: "pada semua catatan
 * juga disebutkan siapa yang mencatat").
 * SATU baris untuk SETIAP PENGINPUTAN (entri `tambahan_batch`) — penginputan yang disimpan langsung
 * terkunci, jadi barisnya tidak pernah berubah lagi setelah tersimpan.
 *
 * RE_* di bawah dipakai untuk MEMISAHKAN catatan otomatis dari catatan manual: catatan otomatis
 * dibangun ulang dari data (tidak bisa diedit di layar), sedangkan catatan manual petugas dibiarkan
 * apa adanya. Pola lama ("menambah barang sebanyak N", "… dari KODE (sales NAMA) …", versi tanpa jam,
 * dan versi tanpa "(dicatat oleh …)") tetap dikenali supaya database lama tidak kehilangan barisnya
 * saat dibangun ulang — karena itu penutupnya dibuat OPSIONAL di setiap pola.
 */
const RE_TAMBAHAN = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? menambah barang sebanyak (\d+)(?: pcs)?(?: \(.+\))?(?: \(dicatat oleh .+?\))?$/;
// Bagian "(NAMA 1 pcs, NAMA 2 pcs)" OPSIONAL — catatan LAMA (tanpa daftar barang) tetap dikenali, dan
// daftar itu tidak boleh tertukar dengan penutup "(dicatat oleh …)".
const RE_AMBIL = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? mengambil barang dari (.+?) sebanyak (\d+)(?: pcs)?(?: \(.+\))?(?: \(dicatat oleh .+?\))?$/;
const RE_DIAMBIL = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? telah diambil barangnya oleh (.+?) sebanyak (\d+)(?: pcs)?(?: \(.+\))?(?: \(dicatat oleh .+?\))?$/;
// Pengembalian barang ke gudang (permintaan user): kolom Dibawa (B) perjalanan ini BERKURANG.
// Sejak revisi ke-187 daftar barangnya ikut ditulis di dalam kurung — bagian itu OPSIONAL di pola supaya
// catatan LAMA (tanpa nama barang) tetap dikenali sebagai catatan otomatis dan bisa dibangun ulang.
const RE_KEMBALI = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? mengembalikan barang ke gudang sebanyak (\d+)(?: pcs)?(?: \(.+\))?(?: \(dicatat oleh .+?\))?$/;

/** Benar kalau baris ini catatan OTOMATIS (dibuat sistem, bukan tulisan petugas). */
function barisOtomatis(baris) {
  const b = String(baris || '').trim();
  return RE_TAMBAHAN.test(b) || RE_AMBIL.test(b) || RE_DIAMBIL.test(b) || RE_KEMBALI.test(b);
}

/**
 * Penutup baris catatan otomatis: " (dicatat oleh NAMA)".
 * Permintaan user: "pada semua catatan juga di sebutkan siapa yang mencatat, (dicatat oleh nama)".
 * Nama petugas yang mencatat = kolom `petugas` pada entri penginputan (`tambahan_batch`). Kalau tidak
 * diketahui, penutupnya tidak ditulis supaya tidak muncul "(dicatat oleh )".
 */
function olehDicatat(petugas) {
  const n = String(petugas || '').trim();
  return n ? ` (dicatat oleh ${n})` : '';
}

/**
 * Baris catatan pengambilan barang pada surat jalan ini.
 * Sumbernya gudang, atau SURAT JALAN sales lain. Permintaan user: nama salesnya ditulis langsung dan
 * kode perjalanannya di dalam KURUNG (tanpa kata "sales") → "mengambil barang dari CICI (CIC001) …".
 *
 * Permintaan user TERBARU: *"Mengambil barang dari gudang tidak usah disebutkan barang yang di ambil,
 * hanya yang mengambil dari sales lain, dan pengembalian"* → daftar barang **HANYA** ditulis kalau
 * sumbernya surat jalan sales lain:
 *   gudang      → 17/10/2026 22:15 mengambil barang dari gudang sebanyak 3 pcs (dicatat oleh Wati)
 *   sales lain  → 17/10/2026 22:15 mengambil barang dari CICI (CIC001) sebanyak 3 pcs
 *                 (YSL 8410 2 pcs, Prada H504 Oval 1 pcs) (dicatat oleh Wati)
 */
function barisPengambilan({ tanggalPendek: tgl, jam, sumber, kodeSumber, total, petugas, items }) {
  const nama = String(sumber || '').trim();
  const dariGudang = !nama || nama.toLowerCase() === 'gudang';
  const asal = dariGudang ? 'gudang' : kodeSumber ? `${nama} (${kodeSumber})` : nama;
  // pengambilan dari GUDANG tidak menyebut barangnya (permintaan user) — hanya dari sales lain
  const rinci = dariGudang ? '' : rincianBarang(items);
  return `${tgl} ${jam} mengambil barang dari ${asal} sebanyak ${total} pcs${rinci ? ` (${rinci})` : ''}${olehDicatat(petugas)}`;
}

/**
 * Baris catatan pada perjalanan sales yang barangnya diambil sales lain.
 * Permintaan user: *"sales yang di ambil juga disebut apa yang di ambil"* → daftar barangnya ikut
 * dicantumkan (jumlahnya = yang BENAR-BENAR dipotong, lihat `itemsDiambil()` di server/lib/db).
 */
function barisDiambil({ tanggalPendek: tgl, jam, oleh, total, petugas, items }) {
  const rinci = rincianBarang(items);
  return `${tgl} ${jam} telah diambil barangnya oleh ${oleh} sebanyak ${total} pcs${rinci ? ` (${rinci})` : ''}${olehDicatat(petugas)}`;
}

/**
 * Baris catatan PENGEMBALIAN BARANG KE GUDANG (permintaan user: "buat opsi pengembalian barang ke gudang
 * di surat jalan ongoing … kolom b berkurang karena dikembalikan ke gudang, ada catatan otomatis juga").
 * Berbeda dengan pengambilan: kolom Dibawa (B) perjalanan INI yang berkurang (barangnya turun ke gudang).
 *
 * Permintaan user terbaru: *"Jika mengembalikan barang, cantumkan nama barang yang di kembalikan di catatan
 * laporan"* → daftar barang + jumlahnya ditulis di dalam tanda kurung sebelum penutup "(dicatat oleh …)":
 *
 *   17/10/2026 02:15 mengembalikan barang ke gudang sebanyak 3 pcs (YSL 8410 1 pcs, Cartier B05 2 pcs)
 *   (dicatat oleh Wati)
 *
 * Daftarnya dibatasi MAKS_RINCIAN_KEMBALI nama; sisanya diringkas "dan N barang lain" supaya catatan di
 * dokumen F4 (kolom kanan yang sempit) tidak memanjang dan dokumen tetap 1 halaman.
 */
const MAKS_RINCIAN_KEMBALI = 6;

function rincianBarang(items, maks = MAKS_RINCIAN_KEMBALI) {
  const daftar = (items || [])
    .map((i) => ({ nama: String((i && i.nama) || '').trim(), qty: Number(i && i.qty) || 0 }))
    .filter((i) => i.nama && i.qty > 0);
  if (!daftar.length) return '';
  const tampil = daftar.slice(0, maks).map((i) => `${i.nama} ${i.qty} pcs`);
  const sisa = daftar.length - tampil.length;
  if (sisa > 0) tampil.push(`dan ${sisa} barang lain`);
  return tampil.join(', ');
}

function barisPengembalian({ tanggalPendek: tgl, jam, total, petugas, items }) {
  const rinci = rincianBarang(items);
  return `${tgl} ${jam} mengembalikan barang ke gudang sebanyak ${total} pcs${rinci ? ` (${rinci})` : ''}${olehDicatat(petugas)}`;
}

/**
 * Susun ulang isi catatan: teks MANUAL petugas tetap apa adanya di atas, lalu seluruh baris OTOMATIS
 * (urut tanggal + jam) di bawahnya. Baris otomatis yang sudah ada di teks tidak diduplikasi.
 * `auto`: [{ tanggal: 'YYYY-MM-DD', jam: 'HH:MM', teks: '...' }]
 */
function susunCatatan(catatan, auto = []) {
  const manual = String(catatan || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b !== '' && !barisOtomatis(b));
  const urut = auto
    .slice()
    .sort((a, b) => {
      const ka = `${a.tanggal || ''} ${a.jam || ''}`;
      const kb = `${b.tanggal || ''} ${b.jam || ''}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const lihat = new Set(manual);
  const teks = [];
  urut.forEach((a) => {
    const t = String(a.teks || '').trim();
    if (!t || lihat.has(t)) return;
    lihat.add(t);
    teks.push(t);
  });
  return manual.concat(teks).join('\n').trim();
}

/** Pisahkan catatan tersimpan menjadi catatan manual (bisa diedit) & catatan otomatis (terkunci). */
function pisahCatatan(catatan) {
  const manual = [];
  const otomatis = [];
  String(catatan || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b !== '')
    .forEach((b) => (barisOtomatis(b) ? otomatis : manual).push(b));
  return { manual: manual.join('\n'), otomatis };
}

/**
 * TANGGAL YANG SAMA TIDAK DITULIS LAGI (permintaan user revisi ke-144: "tanggal yang sama di catatan
 * otomatis laporan tidak usah di tulis lagi").
 *
 * Dipakai saat MENAMPILKAN catatan otomatis (kartu Catatan di layar & dokumen F4): baris yang tanggalnya
 * sama dengan baris sebelumnya hanya menampilkan bagian setelah tanggalnya (jam + isi catatan). Baris
 * pertama selalu lengkap, dan begitu tanggalnya berganti, tanggalnya ditulis lagi.
 *
 * PENTING: ini hanya untuk TAMPILAN. Baris catatan yang TERSIMPAN di `sesi.catatan` tetap lengkap
 * bertanggal — pola `RE_TAMBAHAN`/`RE_AMBIL`/`RE_DIAMBIL`/`RE_KEMBALI` (dan `segarkanSemuaCatatan()` yang
 * membangun ulang seluruh catatan dari `tambahan_batch`) bergantung pada format bertanggal itu, jadi
 * format simpan jangan diubah.
 */
const RE_TANGGAL_AWAL = /^(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;
function tanpaTanggalSama(baris = []) {
  let terakhir = '';
  return (Array.isArray(baris) ? baris : []).map((b) => {
    const teks = String(b == null ? '' : b);
    const m = RE_TANGGAL_AWAL.exec(teks);
    if (!m) return teks;
    if (m[1] === terakhir) return m[2];
    terakhir = m[1];
    return teks;
  });
}

/**
 * KELOMPOKKAN CATATAN OTOMATIS PER TANGGAL (permintaan user revisi ke-145).
 *
 * Permintaan user: *"Tanggal catatan tulis di atas nomer lurus dengan awal nomer dengan format hari
 * tanggal nama bulan dan tahun, jika tanggal baru, nomer mulai dari 1, itu berlaku jika dalam 1 hari ada
 * 2 catatan, jika hanya terdapat 1 catatan maka format nya sama dengan format awal"*.
 *
 * Hasilnya: daftar blok per tanggal, masing-masing
 *   - `kepala` = "Kamis, 09 Oktober 2026" → **hanya diisi kalau tanggal itu punya ≥ 2 catatan**
 *     (itulah yang dimaksud "berlaku jika dalam 1 hari ada 2 catatan");
 *   - `baris` = `[{ no, teks }]` → penomoran **selalu mulai dari 1 di tiap tanggal**;
 *   - kalau tanggalnya hanya punya **1 catatan** → `kepala` kosong dan `teks`-nya memakai **format awal**
 *     (tanggal lengkap `dd/mm/yyyy hh:mm …` ditulis di baris itu sendiri, tidak dipisah jadi kepala).
 *
 * Dipakai layar (`views/sesi.js → kartuCatatan`) & dokumen (`views/print.js`). Hanya untuk TAMPILAN —
 * baris yang tersimpan di `sesi.catatan` tetap lengkap bertanggal (dipakai `segarkanSemuaCatatan()`).
 */
function kelompokCatatan(daftar = []) {
  const blok = [];
  (Array.isArray(daftar) ? daftar : []).forEach((b) => {
    const teks = String(b == null ? '' : b);
    const m = RE_TANGGAL_AWAL.exec(teks);
    // baris tanpa tanggal → blok kecil apa adanya (tidak ada kepala, nomor 1)
    if (!m) {
      blok.push({ tanggal: '', kepala: '', punyaTanggal: false, baris: [{ no: 1, teks }] });
      return;
    }
    const [dd, mm, yyyy] = m[1].split('/');      // grup 1 = dd/mm/yyyy
    const tanggal = `${yyyy}-${mm}-${dd}`;         // → YYYY-MM-DD (untuk nama hari & bulan)
    const sisa = m[2] || '';                     // "08:15 mengambil barang …" (tanpa tanggal)
    let terakhir = blok[blok.length - 1];
    if (!terakhir || terakhir.tanggal !== tanggal) {
      terakhir = { tanggal, kepala: '', punyaTanggal: true, baris: [], _lengkap: [] };
      blok.push(terakhir);
    }
    terakhir.baris.push({ no: terakhir.baris.length + 1, teks: sisa });
    terakhir._lengkap.push(teks);
  });

  return blok.map((b) => {
    // 1 catatan saja di tanggal itu → format awal (tanggalnya ditulis di baris itu sendiri)
    if (b.punyaTanggal && b._lengkap.length === 1) {
      return { tanggal: b.tanggal, kepala: '', punyaTanggal: true, baris: [{ no: 1, teks: b._lengkap[0] }] };
    }
    return {
      tanggal: b.tanggal,
      kepala: b.punyaTanggal ? tanggalLengkap(b.tanggal) : '',
      punyaTanggal: b.punyaTanggal,
      baris: b.baris,
    };
  });
}
/** Isi catatan versi LAMA (tanpa fungsi pemisah) — dipertahankan untuk pemanggil lama. */
function catatanDenganEntri(catatan, entries = []) {
  return susunCatatan(
    catatan,
    entries.map((e) => ({
      tanggal: e.tanggal || '',
      jam: e.jam || '',
      teks: barisPengambilan({ tanggalPendek: e.tanggalPendek, jam: e.jam, sumber: e.sumber, total: e.total }),
    }))
  );
}

/** Daftar entri penambahan yang terbaca dari teks catatan (format lama & baru). */
function daftarTambahan(catatan) {
  const hasil = [];
  String(catatan || '').split('\n').forEach((b) => {
    const baris = b.trim();
    const m = RE_TAMBAHAN.exec(baris) || RE_AMBIL.exec(baris);
    if (!m) return;
    const tanggal = `${m[3]}-${m[2]}-${m[1]}`;
    hasil.push({ tanggal, tanggalPendek: `${m[1]}/${m[2]}/${m[3]}`, jam: m[4] || '', qty: Number(m[5]) });
  });
  return hasil.sort((a, b) => {
    const ka = `${a.tanggal} ${a.jam}`;
    const kb = `${b.tanggal} ${b.jam}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * NAMA ADMIN UNTUK TANDA TANGAN DOKUMEN — petugas yang MENGINPUT, bukan yang sedang mencetak.
 *
 * Permintaan user: "Nama yang ada di tanda tangan admin itu admin yang mengimput, bukan yang mencetak".
 * Sebelumnya beberapa rute cetak memakai `req.petugas.nama` (petugas yang sedang login) sebagai cadangan,
 * sehingga siapa pun yang menekan tombol cetak namanya yang tercetak di dokumen (kejadian nyata:
 * surat jalan yang diinput oleh admin gudang lain ikut tertulis nama administrator yang mencetak).
 *
 * Urutannya:
 *   1. `rekap_oleh` — petugas yang memulai/menyelesaikan rekap (input kolom K/S),
 *   2. `dibuat_oleh` — petugas yang membuat & menginput transaksinya (barang dibawa),
 *   3. kosong — garis tanda tangan dibiarkan untuk diisi tangan.
 * `data_ttd`/`namaAdmin` yang dikirim pemanggil TIDAK dipakai sebagai cadangan petugas login.
 */
function namaAdminSesi(sesi) {
  const t = (v) => String(v == null ? '' : v).trim();
  return t(sesi && sesi.rekap_oleh) || t(sesi && sesi.dibuat_oleh);
}

/**
 * URUT NAMA A–Z untuk daftar barang yang DICETAK di kertas (permintaan user 2026-10-11: pilihan
 * "cukup urutkan nama A–Z saat mencetak saja").
 *
 * Dipakai `views/print.js` (surat jalan/laporan lengkap & laporan penjualan per sales) supaya barang di
 * kertas selalu berurutan abjad — memudahkan mencentang/menghitung barang secara manual. Pengurutan
 * hanya di dokumen CETAK: urutan master (`produk.urutan`) dan urutan layar (Inventory, layar input,
 * rekap) TIDAK ikut berubah, jadi label barcode & penomoran kode tetap seperti sekarang.
 *
 * Memakai `Intl.Collator` locale `id` dengan `numeric` (supaya "Barang 2" mendahului "Barang 10") dan
 * `sensitivity: 'base'` (huruf besar/kecil tidak memengaruhi urutan). Mengembalikan DAFTAR BARU —
 * pemanggil aslinya tidak diubah (array dari `q.*` kadang dipakai lagi untuk perhitungan lain).
 */
const COLLATOR_ID = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
function urutNama(daftar, ambil = 'nama') {
  return (Array.isArray(daftar) ? daftar.slice() : []).sort((a, b) =>
    COLLATOR_ID.compare(String((a && a[ambil]) || ''), String((b && b[ambil]) || ''))
  );
}

module.exports = {
  esc, rp, angka, tanggalPanjang, tanggalPendek, hariIni, jamSekarang, jamPenanda, sekarang,
  setoranEfektif, statusInfo, statusSesi, perluDataPenjualan, selisihJual, selisihBarang, bedaSP, arahBedaSP, catatanSelisihSP, catatanSelisihSPRinci, namaSalesSama, normalNama, duaKolom, BULAN, HARI, namaAdminSesi, urutNama, tanggalLengkap,
  barisPengambilan, barisDiambil, barisPengembalian, barisOtomatis, susunCatatan, pisahCatatan,
  catatanDenganEntri, daftarTambahan, tanpaTanggalSama, kelompokCatatan, RE_TAMBAHAN, RE_AMBIL, RE_DIAMBIL, RE_KEMBALI,
};
