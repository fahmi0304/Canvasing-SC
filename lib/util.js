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
  kirim: { label: 'Surat Jalan Terbit', warna: 'biru' },
  rekap: { label: 'Sedang Rekap', warna: 'ungu' },
  selesai: { label: 'Selesai', warna: 'hijau' },
};

function statusInfo(s) {
  return STATUS[s] || { label: s, warna: 'abu' };
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
const RE_TAMBAHAN = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? menambah barang sebanyak (\d+)(?: \(dicatat oleh .+?\))?$/;
const RE_AMBIL = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? mengambil barang dari (.+?) sebanyak (\d+)(?: pcs)?(?: \(dicatat oleh .+?\))?$/;
const RE_DIAMBIL = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? telah diambil barangnya oleh (.+?) sebanyak (\d+)(?: pcs)?(?: \(dicatat oleh .+?\))?$/;
// Pengembalian barang ke gudang (permintaan user): kolom Dibawa (B) perjalanan ini BERKURANG.
const RE_KEMBALI = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}))? mengembalikan barang ke gudang sebanyak (\d+)(?: pcs)?(?: \(dicatat oleh .+?\))?$/;

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
 */
function barisPengambilan({ tanggalPendek: tgl, jam, sumber, kodeSumber, total, petugas }) {
  const nama = String(sumber || '').trim();
  const asal =
    !nama || nama.toLowerCase() === 'gudang'
      ? 'gudang'
      : kodeSumber
        ? `${nama} (${kodeSumber})`
        : nama;
  return `${tgl} ${jam} mengambil barang dari ${asal} sebanyak ${total} pcs${olehDicatat(petugas)}`;
}

/** Baris catatan pada perjalanan sales yang barangnya diambil sales lain. */
function barisDiambil({ tanggalPendek: tgl, jam, oleh, total, petugas }) {
  return `${tgl} ${jam} telah diambil barangnya oleh ${oleh} sebanyak ${total} pcs${olehDicatat(petugas)}`;
}

/**
 * Baris catatan PENGEMBALIAN BARANG KE GUDANG (permintaan user: "buat opsi pengembalian barang ke gudang
 * di surat jalan ongoing … kolom b berkurang karena dikembalikan ke gudang, ada catatan otomatis juga").
 * Berbeda dengan pengambilan: kolom Dibawa (B) perjalanan INI yang berkurang (barangnya turun ke gudang).
 */
function barisPengembalian({ tanggalPendek: tgl, jam, total, petugas }) {
  return `${tgl} ${jam} mengembalikan barang ke gudang sebanyak ${total} pcs${olehDicatat(petugas)}`;
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
  setoranEfektif, statusInfo, duaKolom, BULAN, HARI, namaAdminSesi, urutNama, tanggalLengkap,
  barisPengambilan, barisDiambil, barisPengembalian, barisOtomatis, susunCatatan, pisahCatatan,
  catatanDenganEntri, daftarTambahan, tanpaTanggalSama, kelompokCatatan, RE_TAMBAHAN, RE_AMBIL, RE_DIAMBIL, RE_KEMBALI,
};
