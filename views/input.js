'use strict';
const { esc, angka, tanggalPendek } = require('../lib/util');
const { modePilih } = require('./mode');
const { noSurat } = require('../lib/kode');
const { VERSI_MEMO } = require('../lib/memoEntri');

/** Label sumber pengambilan barang untuk daftar penginputan sebelumnya. */
function labelEntri(b) {
  const sumber = String(b.sumber || '').toLowerCase();
  // Entri PENGEMBALIAN KE GUDANG (permintaan user) — barangnya keluar dari kolom Dibawa.
  if (sumber === 'kembali-gudang') return 'Dikembalikan ke Gudang';
  if (!sumber || sumber === 'gudang') return 'Gudang';
  return b.kode_sumber ? `${b.kode_sumber} · ${b.sumber}` : `Sales ${b.sumber}`;
}

/**
 * Kepala layar penginputan tambahan: keterangan penginputan yang sedang dibuka + daftar penginputan
 * sebelumnya (yang sudah TERKUNCI) lengkap dengan tombol View Memo (PDF).
 * Permintaan user: "setiap penginputan tambahan jika jamnya berbeda maka masuk penginputan baru, saat
 * penginputan baru dilakukan penginputan sebelumnya sudah terkunci, data diulangi ke 0, jumlah
 * penginputan sebelumnya berada di sampingnya".
 */
function kepalaEntri({ base, sesi, entri, daftarSumber = [], petugas = '' }) {
  if (!entri) return '';
  const { kini, daftar, nomor } = entri;

  // Permintaan user: "keterangan penginputan tambahan pindah ke bawah, keterangan daftar barang tambahan
  // tidak usah — hanya barang diambil dari, dan pada keterangan penginputan tambah catatan ditambah oleh
  // (nama admin yang menambah)". Kartu ini karena itu ditaruh di BAWAH form dan cukup memuat dua
  // keterangan: barang diambil dari + nama petugas yang menambah.
  // Dibungkus <details> yang tertutup secara bawaan supaya daftar barang + tombol simpan muat 1 layar.
  const barisSebelum = daftar
    .map(
      (b, n) => `<tr data-batch="${b.id}">
        <td>ke-${n + 1}</td>
        <td>${esc(tanggalPendek(b.tanggal))} · ${esc(b.jam_mulai)} WITA</td>
        <td>${esc(labelEntri(b))}</td>
        <td class="num">${angka(b.total)}</td>
        <td>${esc(String(b.petugas || '').trim() || '—')}</td>
        <td><span class="badge b-abu">Terkunci</span></td>
        <td class="tengah"><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${base}/cetak/memo-tambahan/${sesi.id}/${b.id}?tampil=1&v=${VERSI_MEMO}">📄 View Memo</a></td>
      </tr>`
    )
    .join('');

  return `
<details class="card entri-kepala mepet" id="kepalaEntri">
  <summary class="entri-sum">
    <span class="entri-sum-judul">Penginputan Tambahan ke-<b>${nomor}</b></span>
    <span class="entri-sum-meta">${esc(tanggalPendek(kini.tanggal))} · ${esc(kini.jam)} WITA</span>
    <span class="badge b-hijau">Mulai dari 0</span>
    <span class="entri-sum-toggle">Detail</span>
  </summary>
  <div class="entri-isi">
    <div class="entri-info">
      <div><span class="label">Barang diambil dari</span><b id="sumberEntriInfo">Gudang</b></div>
      <div><span class="label">Ditambah oleh</span><b>${esc(String(petugas || '').trim() || '—')}</b></div>
    </div>
    ${
      barisSebelum
        ? `<div class="tbl-wrap" style="max-height:200px;overflow:auto">
      <table class="tbl rapat tbl-pekat" id="tblEntriSebelum">
        <thead><tr><th>Penginputan</th><th>Tanggal &amp; jam</th><th>Diambil dari</th><th class="num">Jumlah</th><th>Ditambah oleh</th><th>Status</th><th class="tengah">Memo</th></tr></thead>
        <tbody>${barisSebelum}</tbody>
      </table>
    </div>`
        : ''
    }
  </div>
</details>`;
}
exports.kepalaEntri = kepalaEntri;

/**
 * Layar input transaksi (barang dibawa / tambahan).
 * Permintaan user: daftar menampilkan SELURUH barang seperti semula (tanpa kolom NO & Kode,
 * kepala tabel pekat), barang yang TIDAK dibawa ditandai cukup dengan menggeser barisnya
 * (finger-follow animation) lalu muncul popup konfirmasi. Barang yang sudah ditandai
 * "tidak dibawa" tetap bisa dikembalikan lewat kotak filter.
 * Permintaan user terbaru: **kode SKU TIDAK ditampilkan lagi di bawah nama barang** (halaman ini satu-satunya
 * layar yang masih menampilkannya; Inventaris menampilkan SKU sebagai kolomnya sendiri dan tetap).
 * Pencarian & scan tetap bisa memakai kode karena `data-cari` masih memuat nama + kode.
 *
 * Khusus TAMBAHAN (kolom T): nilai yang diisi = angka PENGINPUTAN yang sedang terbuka (mulai dari 0 untuk
 * penginputan baru), sedangkan jumlah penginputan sebelumnya ditampilkan di kolom "Sbl" di
 * sampingnya (permintaan user). `entri` = { kini, batch, daftar, nilai, sebelum, nomor }.
 */
/**
 * POPUP "SELESAI — KUNCI & SIMPAN" DI HALAMAN BARANG TAMBAHAN (permintaan user revisi ke-156).
 *
 * Permintaan user: "Pindah tombol simpan dan koreksi di kanan, dan ubah namanya ke selesai, dan fungsinya
 * berubah, tidak langsung mengunci imputan, hanya menampilkan pop up, tombol kunci dan simpan berada di
 * pop up, jadi yang tampil di pop up masih bisa di ubah".
 *
 * Jadi tombol kanan berlabel **Selesai** dan TIDAK mengirim formulir (`type="button"`) — ia hanya membuka
 * popup ini (penginputan BELUM dibuat/dikunci). Isi popup: daftar barang yang akan ditambahkan dengan
 * kolom **JUMLAH yang masih bisa diubah** + baris Total, dan tombol **Kunci & Simpan** yang baru MENGIRIM
 * nilainya ke server (`_aksi=kunci`; kolomnya `kunci_<itemId>`) lalu mengunci penginputan & kembali ke
 * halaman perjalanan. Popup bisa ditutup ("Kembali ubah" / klik latar / Esc) tanpa mengubah apa pun.
 *
 * Isinya dibangun di browser dari nilai yang sedang terisi (`public/app.js → pasangPopupKunci`), jadi
 * markup ini hanya kerangka kosong.
 */
function popupKunci({ base, sesi }) {
  return `
<div class="konfirmasi-lapis" id="popupKunci" hidden>
  <div class="konfirmasi-kotak card popup-baru popup-kunci" role="dialog" aria-modal="true" aria-labelledby="popupKunciJudul">
    <div class="popup-kunci-kepala">
      <h2 id="popupKunciJudul">Selesai — Kunci &amp; Simpan</h2>
      <button class="popup-kunci-tutup" type="button" data-popup-tutup aria-label="Tutup popup">&times;</button>
    </div>
    <p class="card-hint">Angka di bawah <b>masih bisa diubah</b>. Kalau sudah benar tekan <b>Kunci &amp; Simpan</b> — penginputan ini akan tersimpan &amp; terkunci.</p>
    <form method="post" action="${base}/sesi/${sesi.id}/tambahan" id="formKunci">
      <input type="hidden" name="_aksi" value="kunci">
      <input type="hidden" name="sumber" id="sumberKunci" value="gudang">
      <div class="tbl-wrap">
        <table class="tbl rapat tbl-pekat" id="tblBarangBaru">
          <thead><tr><th class="num-no">NO</th><th>NAMA BARANG</th><th class="num-jml num">JUMLAH</th></tr></thead>
          <tbody id="bodyKunci"></tbody>
          <tfoot><tr><td colspan="2"><b>Total</b></td><td class="num-jml num"><b id="totalKunci">0</b></td></tr></tfoot>
        </table>
      </div>
      <div class="konfirmasi-aksi">
        <button class="btn btn-ghost" type="button" data-popup-tutup>Kembali ubah</button>
        <button class="btn btn-primary" type="submit" data-popup-kunci>Kunci &amp; Simpan</button>
      </div>
    </form>
  </div>
</div>`;
}

exports.render = function ({ sesi, items, base, tahap, pesan, entri = null, daftarSumber = [], petugas = '' }) {
  const ambil = tahap === 'ambil';
  const kolom = ambil ? 'b' : 't';
  const judul = ambil ? `Tambah Transaksi · ${noSurat(sesi)}` : `Barang Tambahan · ${noSurat(sesi)}`;
  // Permintaan user: "saat masuk form penambahan bahan, tampilan se mepet mungkin agar satu halaman,
  // font header dibuat lebih kecil" → kelas .mepet hanya dipakai layar tambahan.
  const mepet = ambil ? '' : ' mepet';

  /*
   * Kepala kolom layar TAMBAHAN (permintaan user): "kolom dibawa ubah ke B", "kolom sebelumnya buat
   * singkatan agar lebar kolom sama dengan B" → header-nya "B" dan "Sblm", keduanya kelas `.kolom-b`
   * supaya lebarnya sama (lihat app.css). Layar "ambil" tidak memakai kolom ini.
   */
  const kolomDibawa = ambil ? '' : '<th class="num kolom-b">B</th>';
  const kolomSebelum = ambil ? '' : '<th class="num kolom-b">Sbl</th>';
  const nilaiSebelum = (i) => (entri && entri.sebelum[i.produk_id]) || 0;
  const nilaiEntri = (i) => (entri ? (entri.nilai[i.produk_id] || 0) : i.t);

  /*
   * Permintaan user: "saat masuk halaman tambah barang, barang yang muncul di kolom hanya barang yang
   * di bawa, jika barang yang tidak dibawa ada ikon tambah barang untuk menambah barang yang tidak di
   * daftar bawaan dan memasukkan jumlahnya".
   *
   * Jadi di layar TAMBAHAN (kolom T) yang tampil hanya barang yang **ikut perjalanan ini**:
   * dibawa (B > 0) atau sudah punya angka tambahan (T > 0). Barang master yang belum dibawa tetap
   * dirender di DOM (nilai 0-nya tetap terkirim seperti semula, jadi tidak ada perubahan di server),
   * tetapi barisnya `hidden` + berkelas `luar-bawaan` — dimunculkan lewat ikon **+ Tambah barang**
   * (atau dengan men-scan barcode barangnya) lalu jumlahnya diisi; angkanya masuk kolom T.
   * Di layar "barang dibawa" (`/sesi/:id/ambil`) TIDAK ada baris yang disembunyikan.
   */
  const ikutPerjalanan = (i) => (Number(i.b) || 0) > 0 || (Number(i.t) || 0) > 0;
  const baris = items
    .map((i) => {
      const luar = !ambil && !ikutPerjalanan(i);
      return `<tr class="barang${luar ? ' luar-bawaan' : ''}" id="row_${i.id}" data-id="${i.id}"${luar ? ' hidden' : ''} data-baru="${
        Number(i.baru) === 1 ? 1 : 0
      }" data-b="${Number(i.b) || 0}" data-t="${Number(i.t) || 0}" data-kode="${esc(i.kode)}" data-cari="${esc((i.kode + ' ' + i.nama).toLowerCase())}">
        <td class="beku"><span class="nm">${esc(i.nama)}</span></td>
        ${ambil ? '' : `<td class="num dibawa" data-b="${i.b}">${angka(i.b)}</td>`}
        ${ambil ? '' : `<td class="num sebelumnya" data-sebelumnya="${nilaiSebelum(i)}">${angka(nilaiSebelum(i))}</td>`}
        <td class="tengah">
          <span class="qty">
            <button type="button" data-minus data-target="#in_${i.id}">−</button>
            <input type="number" min="0" name="${kolom}_${i.id}" id="in_${i.id}" value="${ambil ? i.b : nilaiEntri(i)}" data-qty>
            <button type="button" data-plus data-target="#in_${i.id}">+</button>
          </span>
        </td>
        <td class="tengah aksi-hapus">
          <button type="button" class="btn-hapus" data-hapus="${i.id}" aria-label="Tandai ${esc(i.nama)} tidak dibawa">
            <span class="ikon-hapus">🗑</span><span class="label-hapus">Tidak dibawa</span>
          </button>
          <button type="button" class="btn-pulih" data-pulih="${i.id}" hidden>
            <span class="ikon-hapus">↺</span><span class="label-hapus">Bawa lagi</span>
          </button>
        </td>
      </tr>`;
    })
    .join('');

  const script = `
<script>
(function(){
  const base = window.APP_BASE || '';
  const modus = ${JSON.stringify(tahap)};
  const sesiId = ${sesi.id};
  const kataAksi = modus === 'ambil' ? 'tidak dibawa' : 'tidak ditambahkan';
  const body = document.getElementById('bodyBarang');
  const elBuang = document.getElementById('buangId');
  const elCari = document.getElementById('cariDaftar');
  const elPulih = document.getElementById('btnPulihkan');
  let tampilDibuang = false;

  function nilai(inp){ return parseInt(inp && inp.value, 10) || 0; }
  function barisSemua(){ return Array.from(body.querySelectorAll('tr.barang')); }
  function barisDibuang(){ return barisSemua().filter(function(tr){ return tr.classList.contains('dibuang'); }); }

  /** Sinkronkan daftar "tidak dibawa" + ringkasan angka. */
  function segarkan(){
    jadwalkanSimpan();   // dipanggil setiap jumlah berubah / scan / tandai "tidak dibawa" (lihat akhir fungsi)
    const buang = barisDibuang().map(function(tr){ return tr.dataset.id; });
    elBuang.value = buang.join(',');
    let barisIsi = 0, qty = 0;
    barisSemua().forEach(function(tr){
      if (tr.classList.contains('dibuang')) return;
      const v = nilai(tr.querySelector('[data-qty]'));
      if (v > 0){ barisIsi++; qty += v; }
    });
    // Ringkasan angka hanya ada di layar "barang dibawa" — di layar TAMBAHAN elemennya sengaja tidak
    // dirender (permintaan user), jadi WAJIB dicek dulu sebelum diisi (kalau tidak, script error).
    const nb = document.getElementById('netBaris'), nq = document.getElementById('netQty'), nbg = document.getElementById('netBuang');
    if (nb) nb.textContent = barisIsi;
    if (nq) nq.textContent = qty;
    if (nbg) nbg.textContent = buang.length;
    const sb = document.getElementById('netBarisScan'), sq = document.getElementById('netQtyScan');
    if (sb) sb.textContent = barisIsi;
    if (sq) sq.textContent = qty;
    if (elPulih){
      elPulih.hidden = buang.length === 0;
      elPulih.textContent = (tampilDibuang ? 'Sembunyikan' : 'Tampilkan') + ' barang ' + kataAksi + ' (' + buang.length + ')';
      elPulih.classList.toggle('aktif', tampilDibuang);
    }
  }

  /**
   * Saring daftar: cocokkan kata kunci; baris "tidak dibawa" hanya tampil kalau diminta.
   *
   * Di layar TAMBAHAN, baris yang belum dibawa (class "luar-bawaan") SELALU disembunyikan kecuali sudah
   * dipilih untuk penginputan ini (class "ditambahkan") — permintaan user: daftar cukup memuat barang
   * yang dibawa, sisanya dimunculkan lewat ikon "+ Tambah barang" / scan.
   */
  function saring(){
    const kata = (elCari.value || '').trim().toLowerCase();
    let cocokDibuang = 0, cocokLuar = 0;
    barisSemua().forEach(function(tr){
      const cocok = !kata || (tr.dataset.cari || '').indexOf(kata) !== -1;
      const dibuang = tr.classList.contains('dibuang');
      const luar = tr.classList.contains('luar-bawaan') && !tr.classList.contains('ditambahkan');
      if (dibuang && cocok && !tampilDibuang) cocokDibuang++;
      if (luar && cocok) cocokLuar++;
      tr.hidden = !cocok || (dibuang && !tampilDibuang) || luar;
    });
    const petunjuk = document.getElementById('petunjukCari');
    let isi = '';
    if (cocokDibuang) {
      // Permintaan user (layar tambahan): keterangan "N barang yang ditandai tidak ditambahkan …"
      // TIDAK ditampilkan — cukup tombolnya.
      isi +=
        modus === 'tambahan'
          ? '<button type="button" class="tautan" id="btnPulihCari">Tampilkan &amp; bawa lagi</button>'
          : '<b>' + cocokDibuang + '</b> barang yang ditandai ' + kataAksi + ' cocok dengan pencarian. ' +
            '<button type="button" class="tautan" id="btnPulihCari">Tampilkan &amp; bawa lagi</button>';
    }
    // barang yang tidak dibawa tapi cocok dengan pencarian → bisa langsung dimasukkan ke penginputan ini
    if (cocokLuar) {
      if (isi) isi += ' &middot; ';
      isi += '<button type="button" class="tautan" id="btnTambahCari">Tambah ' + cocokLuar + ' barang tidak dibawa</button>';
    }
    petunjuk.innerHTML = isi;
    petunjuk.hidden = !isi;
  }

  function tandaiDibuang(id){
    const tr = document.getElementById('row_' + id);
    if (!tr || tr.classList.contains('dibuang')) return;
    tr.classList.add('keluar');
    setTimeout(function(){
      tr.classList.remove('keluar');
      tr.classList.add('dibuang');
      tr.hidden = true;
      const hapus = tr.querySelector('[data-hapus]');
      const pulih = tr.querySelector('[data-pulih]');
      if (hapus) hapus.hidden = true;
      if (pulih) pulih.hidden = false;
      segarkan();
      saring();
    }, 200);
  }

  function kembalikan(id){
    const tr = document.getElementById('row_' + id);
    if (!tr) return;
    tr.classList.remove('dibuang');
    tr.hidden = false;
    const hapus = tr.querySelector('[data-hapus]');
    const pulih = tr.querySelector('[data-pulih]');
    if (hapus) hapus.hidden = false;
    if (pulih) pulih.hidden = true;
    segarkan();
    saring();
    SC.toast((tr.querySelector('.nm') ? tr.querySelector('.nm').textContent : 'Barang') + ' dikembalikan ke daftar', 'ok');
  }

  /* ---------- geser baris (pointer = jari / tetikus) + popup konfirmasi ---------- */
  let geser = null;
  const AMBANG = 88;

  /* Buang seleksi teks yang mungkin masih ada dari gestur sebelumnya. Kalau teks di halaman masih
     terseleksi, drag berikutnya dianggap drag bawaan browser (event pointercancel) dan geseran itu
     dibatalkan — gejala nyata: geseran kedua tidak berfungsi. Dipanggil di awal setiap gestur geser. */
  function lupakanSeleksi(){
    try { const s = document.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e) {}
  }

  function selesaiGeser(batal){
    if (!geser) return;
    const tr = geser.tr;
    const jauh = geser.dx <= -AMBANG;
    tr.style.transform = '';
    tr.classList.remove('geser-aktif', 'siap-buang');
    const info = geser;
    geser = null;
    if (batal || !jauh) return;
    tanyaHapus(info.id, info.nama);
  }

  async function tanyaHapus(id, nama){
    const tr = document.getElementById('row_' + id);
    const ya = await SC.konfirmasi({
      judul: 'Hapus ' + nama + ' dari daftar?',
      pesan: 'Barang ini akan ditandai ' + kataAksi + '. Kalau berubah pikiran, cari namanya di kotak pencarian untuk dibawa lagi.',
      ok: 'Ya, hapus',
      batal: 'Batal',
    });
    if (!ya) return;
    // mundur dulu sebentar supaya animasi terlihat, lalu tandai
    if (tr){
      tr.style.transform = 'translateX(-16%)';
      setTimeout(function(){ tr.style.transform = ''; }, 120);
    }
    setTimeout(function(){
      tandaiDibuang(id);
      SC.toast(nama + ' ditandai ' + kataAksi, 'info');
    }, 130);
  }

  body.addEventListener('pointerdown', function(ev){
    const tr = ev.target.closest('tr.barang');
    if (!tr || ev.button !== 0) return;
    if (ev.target.closest('input, button')) return;
    lupakanSeleksi();
    geser = { tr: tr, id: tr.dataset.id, nama: tr.querySelector('.nm') ? tr.querySelector('.nm').textContent : 'Barang', x: ev.clientX, y: ev.clientY, dx: 0 };
  });
  body.addEventListener('pointermove', function(ev){
    if (!geser || geser.tr !== ev.target.closest('tr.barang')) return;
    const dx = ev.clientX - geser.x;
    const dy = ev.clientY - geser.y;
    if (!geser.jalan){
      if (Math.abs(dx) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) { geser = null; return; }   // geser vertikal = scroll halaman
      geser.jalan = true;
      geser.tr.classList.add('geser-aktif');
      if (geser.tr.setPointerCapture) { try { geser.tr.setPointerCapture(ev.pointerId); } catch (e) {} }
    }
    geser.dx = Math.min(0, dx);
    geser.tr.style.transform = 'translateX(' + geser.dx + 'px)';
    geser.tr.classList.toggle('siap-buang', geser.dx <= -AMBANG);
  });
  ['pointerup', 'pointercancel'].forEach(function(namaEv){
    document.addEventListener(namaEv, function(){
      if (!geser) return;
      if (geser.jalan) selesaiGeser(false); else geser = null;
    }, true);
  });
  document.addEventListener('keydown', function(ev){ if (ev.key === 'Escape' && geser) { selesaiGeser(true); } });

  /* ---------- tombol 🗑 / ↺ ---------- */
  body.addEventListener('click', function(ev){
    const h = ev.target.closest('[data-hapus]');
    if (h){
      const tr = h.closest('tr.barang');
      tanyaHapus(h.dataset.hapus, tr && tr.querySelector('.nm') ? tr.querySelector('.nm').textContent : 'Barang');
      return;
    }
    const p = ev.target.closest('[data-pulih]');
    if (p) kembalikan(p.dataset.pulih);
  });

  /* ---------- kotak cari (filter) & tombol tampilkan barang yang tidak dibawa ---------- */
  elCari.addEventListener('input', saring);
  elCari.addEventListener('keydown', function(ev){
    if (ev.key !== 'Enter') return;
    ev.preventDefault();       // jangan sampai menyimpan form
    const terlihat = barisSemua().filter(function(tr){ return !tr.hidden; });
    if (terlihat.length === 1){
      const inp = terlihat[0].querySelector('[data-qty]');
      if (inp){ inp.focus(); inp.select(); }
      return;
    }
    saring();
  });
  if (elPulih) elPulih.addEventListener('click', function(){ tampilDibuang = !tampilDibuang; segarkan(); saring(); });
  document.getElementById('petunjukCari').addEventListener('click', function(ev){
    // "Tampilkan & bawa lagi" = membatalkan tanda "tidak dibawa/ditambahkan" pada sesi ini
    if (ev.target.closest('#btnPulihCari')){
      tampilDibuang = true;
      segarkan();
      saring();
      return;
    }
    // "Tambah barang tidak dibawa" = memasukkan semua baris tersembunyi yang cocok dengan pencarian
    // ke penginputan ini (angka kolom T-nya lalu diisi pengguna)
    if (ev.target.closest('#btnTambahCari')){
      const kata = (elCari.value || '').trim().toLowerCase();
      barisSemua().forEach(function(tr){
        if (!tr.classList.contains('luar-bawaan') || tr.classList.contains('ditambahkan')) return;
        if (kata && (tr.dataset.cari || '').indexOf(kata) === -1) return;
        pakaiBaris(tr.dataset.id, false);
      });
      elCari.value = '';
      isiPanelTambah();
      saring();
      segarkan();
      const baru = barisSemua().filter(function(tr){ return tr.classList.contains('ditambahkan') && !tr.hidden; })[0];
      const inp = baru ? baru.querySelector('[data-qty]') : null;
      if (inp){ inp.focus(); inp.select(); }
    }
  });

  /*
   * ---------- ikon "+ TAMBAH BARANG" (hanya layar TAMBAHAN) ----------
   * Permintaan user: daftar cukup memuat barang yang DIBAWA; barang master yang belum dibawa bisa
   * dimasukkan lewat ikon ini lalu jumlahnya diisi — angka itu masuk kolom T (barang tambahan).
   * Panel-nya memuat pencarian sendiri + daftar barang yang belum dibawa (barang yang sudah punya angka
   * tambahan tidak ditawarkan lagi karena barisnya sudah tampil di daftar).
   */
  const btnTambah = document.getElementById('btnTambahBarang');
  const panelTambah = document.getElementById('panelTambahBarang');
  const cariTambah = document.getElementById('cariTambah');
  const daftarTambah = document.getElementById('daftarTambah');
  const infoTambah = document.getElementById('infoTambah');
  const labelTambah = document.getElementById('labelTambah');
  const KELAS_LUAR = 'luar-bawaan';
  const KELAS_PILIH = 'ditambahkan';

  function escHtml(v){
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /** Nama barang pada satu baris daftar. */
  function namaBaris(tr){
    const nm = tr.querySelector('.nm');
    return nm ? nm.textContent.trim() : String(tr.dataset.kode || '');
  }
  /** Baris yang belum dibawa dan belum dipilih untuk penginputan ini → jadi isi panel Tambah. */
  function kandidatTambah(){
    return barisSemua().filter(function(tr){
      return tr.classList.contains(KELAS_LUAR) && !tr.classList.contains(KELAS_PILIH) && tr.dataset.baru !== '1';
    });
  }
  /** Munculkan satu baris yang belum dibawa supaya jumlah kolom T-nya bisa diisi. */
  function pakaiBaris(id, fokus){
    const tr = document.getElementById('row_' + id);
    if (!tr) return null;
    tr.classList.add(KELAS_PILIH);
    tr.hidden = false;
    if (fokus !== false){
      const inp = tr.querySelector('[data-qty]');
      if (inp){ inp.focus(); inp.select(); }
      if (window.SC && window.SC.flash) window.SC.flash(tr, true);
    }
    return tr;
  }
  function isiPanelTambah(){
    if (!daftarTambah) return;
    const semua = kandidatTambah();
    const kata = (cariTambah.value || '').trim().toLowerCase();
    const tampil = semua.filter(function(tr){ return !kata || (tr.dataset.cari || '').indexOf(kata) !== -1; });
    daftarTambah.innerHTML = tampil.length
      ? tampil
          .map(function(tr){
            return '<button type="button" class="tambah-item" data-tambah-item="' + escHtml(tr.dataset.id) + '">' +
              '<span class="nm">' + escHtml(namaBaris(tr)) + '</span><span class="plus">+</span></button>';
          })
          .join('')
      : '<div class="tambah-kosong">' +
        (semua.length ? 'Tidak ada barang yang cocok dengan pencarian.' : 'Semua barang master sudah ada di daftar penginputan ini.') +
        '</div>';
    infoTambah.textContent = tampil.length + ' dari ' + semua.length + ' barang belum dibawa';
    if (labelTambah) labelTambah.textContent = 'Tambah barang (' + semua.length + ')';
    if (btnTambah) btnTambah.classList.toggle('kosong', semua.length === 0);
  }
  function bukaPanelTambah(ya){
    if (!panelTambah) return;
    panelTambah.hidden = !ya;
    btnTambah.classList.toggle('aktif', !!ya);
    btnTambah.setAttribute('aria-expanded', ya ? 'true' : 'false');
    if (ya){
      cariTambah.value = '';
      isiPanelTambah();
      cariTambah.focus();
    }
  }
  if (btnTambah){
    btnTambah.addEventListener('click', function(){ bukaPanelTambah(panelTambah.hidden); });
    document.getElementById('btnTutupTambah').addEventListener('click', function(){ bukaPanelTambah(false); });
    cariTambah.addEventListener('input', isiPanelTambah);
    cariTambah.addEventListener('keydown', function(ev){
      if (ev.key !== 'Enter') return;
      ev.preventDefault();     // jangan sampai menyimpan form
      const pertama = daftarTambah.querySelector('[data-tambah-item]');
      if (pertama) pertama.click();
    });
    daftarTambah.addEventListener('click', function(ev){
      const b = ev.target.closest('[data-tambah-item]');
      if (!b) return;
      pakaiBaris(b.dataset.tambahItem);
      // kata kunci kotak cari dikosongkan supaya baris yang baru dimunculkan pasti terlihat
      if (elCari.value) elCari.value = '';
      bukaPanelTambah(false);
      segarkan();
      saring();
      isiPanelTambah();
    });
    document.addEventListener('click', function(ev){
      if (panelTambah.hidden) return;
      if (ev.target.closest('#panelTambahBarang') || ev.target.closest('#btnTambahBarang')) return;
      bukaPanelTambah(false);
    });
    document.addEventListener('keydown', function(ev){
      if (!panelTambah.hidden && (ev.key === 'Escape' || ev.keyCode === 27)) bukaPanelTambah(false);
    });
  }

  document.addEventListener('input', function(ev){
    if (ev.target.dataset && ev.target.dataset.qty !== undefined) segarkan();
  });

  /* ---------- scan barcode ---------- */
  window.onScanMasuk = async function(d){
    let id = d.id;
    let tr = id ? document.getElementById('row_' + id) : null;
    if (!tr){
      try {
        const r = await fetch(base + '/api/sesi/' + sesiId + '/tambah-item', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ produk_id: d.item.produk_id })
        });
        const j = await r.json();
        if (j.ok && j.id){ id = j.id; location.reload(); return; }
      } catch (e) { /* biarkan pesan di bawah */ }
      SC.toast('Barang ini belum ada di daftar perjalanan — muat ulang halaman', 'err');
      return;
    }
    if (tr.classList.contains('dibuang')) kembalikan(id);
    // barang yang belum dibawa (barisnya disembunyikan) otomatis dimunculkan lewat scan — angkanya
    // langsung masuk kolom tambahan penginputan ini
    if (tr.classList.contains('luar-bawaan') && !tr.classList.contains('ditambahkan')) pakaiBaris(id, false);
    const inp = document.getElementById('in_' + id);
    /*
     * Baris TERKUNCI (permintaan user: "tekan baris barang untuk mengunci jumlah", diubah menjadi
     * "ketuk nama barang 3×") TIDAK diubah oleh scan — supaya angka yang sudah dikunci tidak berubah
     * tanpa sengaja. Diberi tahu supaya tidak terasa rusak. Ketuk namanya 3× untuk membuka kunci.
     */
    if (tr.classList.contains('terkunci')) {
      const nm = tr.querySelector('.nm');
      SC.toast((nm ? nm.childNodes[0].textContent.trim() : 'Baris ini') + ' TERKUNCI — ketuk nama barangnya 3× untuk membuka', 'info');
      document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> — baris ini TERKUNCI, ketuk nama barangnya 3× untuk membuka';
      return;
    }
    inp.value = nilai(inp) + 1;
    SC.flash(tr, true);
    document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> · ' + d.item.kode +
      ' — tercatat ' + nilai(inp) + ' ' + (modus === 'ambil' ? 'dibawa' : 'tambahan');
    segarkan();
    saring();
  };

  /*
   * ---------- geser ke KANAN = PINDAH HALAMAN dengan konfirmasi ----------
   * permintaan user: "Saat berada pada halaman pengimputan, tambahan barang, retur, rekap, buat perjalanan
   * baru, ketika menggeser tidak langsung pindah halaman, namun muncul pop up yang menanyakan, tetap di
   * halaman, pindah ke halaman lain dan simpan hasil imput".
   * Mekanismenya dipusatkan di public/app.js (SC.geserHalaman) supaya kelima halaman itu berperilaku
   * persis sama; di sini hanya didaftarkan: tujuannya halaman perjalanan, dan "simpan" = kirim form ini
   * dengan nilai _aksi yang sama dengan tombol simpan halaman ini — layar "barang dibawa" memakai
   * _aksi=simpan (menyimpan jumlah dibawa lalu masuk perjalanan), sedangkan layar TAMBAHAN memakai
   * _aksi=kunci (jalur yang sama dengan tombol "Kunci & Simpan" di popup "Selesai": penginputannya
   * dibuat, dikunci, lalu kembali ke halaman perjalanan).
   */
  if (window.SC && typeof window.SC.geserHalaman === 'function') {
    window.SC.geserHalaman({
      tujuan: base + '/sesi/${sesi.id}',
      simpan: function(){
        const form = document.getElementById('formInput');
        if (!form) return;
        pillSimpanStatus();
        // hidden input disuntikkan sesaat: form yang sama sudah punya tombol ber-name "_aksi", dan
        // mengirim DUA nilai "_aksi" membuat pilihan aksi di server gagal (req.body._aksi jadi array)
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = '_aksi';
        inp.value = '${ambil ? 'simpan' : 'kunci'}';
        form.appendChild(inp);
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.submit();
      },
    });
  }
  function pillSimpanStatus(){
    let p = document.getElementById('kbPetunjuk');
    if (!p) { p = document.createElement('div'); p.className = 'kb-petunjuk'; p.id = 'kbPetunjuk'; document.body.appendChild(p); }
    p.textContent = 'Menyimpan…';
    p.classList.add('tampil', 'siap');
  }

  const bk = document.getElementById('btnKamera');
  if (bk) bk.addEventListener('click', function(){
    SC.scanKamera(function(kode){
      const inp = document.querySelector('[data-scan]');
      inp.value = kode;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, 'btnKamera');
  });
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'F2'){ ev.preventDefault(); elCari.focus(); elCari.select(); }
  });

  /* ---------- sumber barang: gudang atau sales lain ---------- */
  const pilihSumber = document.getElementById('sumberAmbil');
  const infoEntriSumber = document.getElementById('sumberEntriInfo');
  /* "Barang diambil dari" di kartu detail ikut berubah saat sumbernya dipilih.
     Permintaan user: keterangan kecil di layar tambahan dibersihkan — hanya nilai sumber ini yang tampil. */
  function labelSumberDipilih(){
    // pemilih sumber hanya berisi Gudang + surat jalan sales lain; PENGEMBALIAN ke gudang punya
    // halaman sendiri (ikon Retur) — opsi "Kembalikan ke Gudang" sudah DIHAPUS dari pemilih ini
    // (permintaan user: "Pada halaman tambahan barang, saat mengambil barang dari mana, masih muncul
    // kembalikan ke gudang"), jadi tidak ada lagi cabang 'kembali-gudang' di sini.
    if (!pilihSumber) return 'Gudang';
    const pilihan = pilihSumber.value;
    if (!pilihan || pilihan === 'gudang') return 'Gudang';
    const opsi = pilihSumber.options[pilihSumber.selectedIndex];
    const sales = opsi && opsi.dataset ? opsi.dataset.sales : '';
    return 'Surat jalan ' + pilihan + (sales ? ' · sales ' + sales : '');
  }
  if (infoEntriSumber) infoEntriSumber.textContent = labelSumberDipilih();
  if (pilihSumber && infoEntriSumber){
    pilihSumber.addEventListener('change', function(){
      infoEntriSumber.textContent = labelSumberDipilih();
    });
  }

  /* ---------- form tambahan HARUS muat 1 layar (permintaan user) ----------
     Tinggi daftar barang dihitung dari sisa ruang yang benar-benar tersedia (bukan angka tetap),
     jadi tetap pas walau ukuran huruf diubah ke "Besar" atau layarnya sempit. */
  if (modus === 'tambahan'){
    const wrap = document.querySelector('#areaInput .tbl-wrap');
    const aksi = document.querySelector('#areaInput .aksi-row');
    function aturTinggi(){
      if (!wrap || !aksi) return;
      const sisa = window.innerHeight - wrap.getBoundingClientRect().top - aksi.getBoundingClientRect().height - 26;
      wrap.style.maxHeight = Math.max(150, Math.round(sisa)) + 'px';
    }
    aturTinggi();
    window.addEventListener('resize', aturTinggi);
    window.addEventListener('beforeprint', aturTinggi);
  }

  /* ---------- SIMPAN OTOMATIS (permintaan user) ----------
   * "saat transaksi dibuat dan tergeser, apa yang diinput otomatis tersimpan": setiap perubahan jumlah
   * (ketik, tombol − / +, scan, tandai/batalkan "tidak dibawa") dijadwalkan tersimpan sendiri ke server
   * (debounce 700 ms) — jadi tidak ada input yang hilang walau halaman ditinggalkan tanpa menekan Simpan.
   * HANYA di layar "barang dibawa": di layar TAMBAHAN setiap penyimpanan membuat ENTRI terkunci baru
   * (berikut memonya), jadi tidak boleh disimpan otomatis.
   */
  const BOLEH_SIMPAN = ${ambil ? 'true' : 'false'};
  const formSimpan = document.getElementById('formInput');
  const statusSimpan = document.getElementById('statusSimpan');
  let timerSimpan = null, sedangSimpan = false, antreSimpan = false, sentuhSejakSimpan = false, mulaiSimpan = false;

  function tampilStatus(teks, galat){
    if (!statusSimpan) return;
    statusSimpan.hidden = !teks;
    statusSimpan.textContent = teks || '';
    statusSimpan.classList.toggle('galat', !!galat);
  }
  function jamSekarang(){
    const d = new Date();
    const p = function(n){ return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  async function simpanOtomatis(){
    if (!formSimpan || !BOLEH_SIMPAN) return;
    if (sedangSimpan){ antreSimpan = true; return; }
    sedangSimpan = true;
    tampilStatus('Menyimpan…', false);
    try {
      const data = new URLSearchParams();
      new FormData(formSimpan).forEach(function(v, k){ data.append(k, v); });
      data.set('_aksi', 'tetap');   // tetap di layar ini (tidak pindah halaman)
      const r = await fetch(formSimpan.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data,
        redirect: 'follow',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      sentuhSejakSimpan = false;
      tampilStatus('Tersimpan ' + jamSekarang(), false);
    } catch (e) {
      tampilStatus('Gagal menyimpan otomatis — tekan Simpan', true);
    }
    sedangSimpan = false;
    if (antreSimpan || sentuhSejakSimpan){ antreSimpan = false; simpanOtomatis(); }
  }
  function jadwalkanSimpan(){
    if (!BOLEH_SIMPAN || !mulaiSimpan) return;
    sentuhSejakSimpan = true;
    if (timerSimpan) clearTimeout(timerSimpan);
    timerSimpan = setTimeout(function(){ timerSimpan = null; simpanOtomatis(); }, 700);
  }
  window.addEventListener('beforeunload', function(ev){
    if (!sentuhSejakSimpan) return;
    // pengguna sudah memilih di popup "pindah halaman" (atau kita sedang menyimpan & berpindah) →
    // dialog bawaan browser tidak boleh menyaingi popup aplikasi / membatalkan navigasinya
    if (window.SC && window.SC.izinkanKeluar) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  segarkan();
  saring();
  // isi panel "+ Tambah barang" sekali di awal supaya jumlah barang yang belum dibawa sudah tertera
  // pada tombolnya (layar tambahan) — daftar baris yang disembunyikan baru terlihat saat panel dibuka.
  if (btnTambah) isiPanelTambah();
  mulaiSimpan = true;   // jangan menyimpan otomatis hanya karena pemuatan halaman
})();
</script>`;

  const isi = `
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<form method="post" action="${base}/sesi/${sesi.id}/${ambil ? 'ambil' : 'tambahan'}" id="formInput" class="${mepet.trim()}">
<input type="hidden" name="_buang" id="buangId" value="">
<div class="mode-area mode-daftar" id="areaInput">
  <div class="card">
    ${
      ambil
        ? /* Layar barang dibawa: judul + ringkasan angka + ikon cara input (permintaan user). */
          `<div class="input-kepala">
      <h2 class="input-judul">Daftar barang</h2>
      <div class="input-baris-alat">
        <div class="input-net">
          <div>Baris terisi<b id="netBaris">0</b></div>
          <div>Total qty<b id="netQty">0</b></div>
          <div>Tidak dibawa<b id="netBuang">0</b></div>
        </div>
        <div class="input-alat">
          ${modePilih({ area: '#areaInput', fokusDaftar: '#cariDaftar', fokusScan: '#scanInput' })}
        </div>
      </div>
    </div>`
        : /* Layar TAMBAHAN (permintaan user): judul "Daftar barang tambahan (T)" dan ringkasan
             Baris terisi / Total qty / Tidak dibawa DIHAPUS, dan ikon cara penginputan diletakkan
             SEBARIS dengan pemilih "Barang diambil dari" (tingginya sama — lihat app.css). */
          ''
    }

    ${
      ambil
        ? ''
        : `<div class="sumber-baris">
      <label for="sumberAmbil">Barang diambil dari</label>
      <select name="sumber" id="sumberAmbil">
        <option value="gudang">Gudang (menambah barang)</option>
        ${(() => {
          // dikelompokkan per sales; nilai opsi = KODE UNIK surat jalan (permintaan user)
          const per = new Map();
          daftarSumber.forEach((x) => {
            const k = x.sales || '-';
            if (!per.has(k)) per.set(k, []);
            per.get(k).push(x);
          });
          return Array.from(per.entries())
            .map(
              ([sales, daftar]) =>
                `<optgroup label="Sales ${esc(sales)}">${daftar
                  .map(
                    (x) =>
                      `<option value="${esc(x.kode)}" data-sales="${esc(x.sales)}">${esc(x.kode)} · ${esc(tanggalPendek(x.tanggal))} · B ${angka(x.b)}</option>`
                  )
                  .join('')}</optgroup>`
            )
            .join('');
        })()}
      </select>
      <div class="input-alat">
        ${modePilih({ area: '#areaInput', fokusDaftar: '#cariDaftar', fokusScan: '#scanInput' })}
      </div>
    </div>`
    }

    <div class="cari-box"${ambil ? '' : ' style="position:relative"'}>
      <input type="search" id="cariDaftar" placeholder="Cari nama / kode barang… (F2)">
      ${
        ambil
          ? ''
          : /* Ikon "+ Tambah barang" (permintaan user): memasukkan barang master yang TIDAK dibawa ke
               daftar penginputan ini supaya jumlah tambahannya (kolom T) bisa diisi. */
            `<button type="button" class="btn-tambah-barang" id="btnTambahBarang" aria-expanded="false" aria-controls="panelTambahBarang"
        title="Tambah barang yang tidak dibawa ke penginputan ini"><span class="plus">+</span><span id="labelTambah">Tambah barang</span></button>`
      }
      <button type="button" class="btn btn-ghost btn-sm" id="btnPulihkan" hidden>Tampilkan barang tidak dibawa (0)</button>
      ${
        ambil
          ? ''
          : `<div class="tambah-panel" id="panelTambahBarang" hidden>
        <div class="tambah-kepala">Barang yang tidak dibawa
          <button type="button" class="tambah-tutup" id="btnTutupTambah" aria-label="Tutup">&times;</button>
        </div>
        <input type="search" id="cariTambah" placeholder="Cari nama / kode barang…" autocomplete="off">
        <div class="tambah-daftar" id="daftarTambah"></div>
        <div class="tambah-kaki" id="infoTambah"></div>
      </div>`
      }
    </div>
    <div class="petunjuk-cari" id="petunjukCari" hidden></div>

    <div class="tbl-wrap"${ambil ? ' style="max-height:62vh;overflow:auto"' : ''}>
      <table class="tbl rapat tbl-pekat kolom-beku" id="tblInput">
        <thead>
          <tr><th class="beku">Nama Barang</th>${kolomDibawa}${kolomSebelum}<th class="tengah">${ambil ? 'Jumlah Dibawa' : 'Penginputan Ini (T)'}</th><th class="tengah">Aksi</th></tr>
        </thead>
        <tbody id="bodyBarang">${baris || '<tr><td colspan="5" class="kosong">Belum ada barang di master. <a href="' + base + '/impor">Impor Excel</a> dulu.</td></tr>'}</tbody>
      </table>
    </div>
    ${
      ambil
        ? '<div class="status-simpan" id="statusSimpan" hidden aria-live="polite"></div>'
        : ''
    }
    <div class="aksi-row aksi-dua${ambil ? '' : ' aksi-satu'}" style="margin-top:${ambil ? '18px' : '10px'}">
      ${
        ambil
          ? `<button class="btn btn-primary btn-lg" type="submit" name="_aksi" value="simpan">Simpan &amp; Buka Perjalanan</button>
      <button class="btn btn-ghost btn-lg" type="submit" name="_aksi" value="tetap">Simpan &amp; Tetap di Sini</button>`
          : /* Layar TAMBAHAN (permintaan user revisi ke-158): tombol **"Simpan &amp; Tetap di Sini"
               DIHAPUS** — di halaman ini hanya ada satu tombol, **"Selesai"** (`type="button"`, jadi tidak
               mengirim formulir) yang membuka popup Kunci &amp; Simpan. Jalur simpan &amp; mengunci
               ada di dalam popup itu (`Kunci &amp; Simpan`) dan lewat geser-ke-kanan "Pindah &amp; simpan
               hasil input". Menyimpan lalu tetap di halaman ini juga masih dikerjakan server kalau ada
               kiriman tanpa `_aksi=kunci` (lihat `POST /sesi/:id/tambahan`), tetapi tidak ada lagi
               tombolnya di layar.
               Kelas `aksi-satu` = satu tombol: di layar lebar lebarnya secukupnya & tetap di KANAN,
               di HP melebar penuh (lihat app.css). */
            `<button class="btn btn-primary btn-lg" type="button" id="btnSelesai" aria-haspopup="dialog" aria-expanded="false" aria-controls="popupKunci">Selesai</button>`
      }
    </div>
  </div>

  <div class="card scan-card panel-scan">
    <h2 class="card-title">Scan Barcode</h2>
    ${ambil ? '<p class="card-hint">Scan tiap barang yang keluar dari gudang — jumlahnya langsung bertambah.</p>' : ''}
    <input class="scan-input" id="scanInput" data-scan data-sesi="${sesi.id}" data-onmatch="onScanMasuk" placeholder="SCAN / KETIK KODE" autocomplete="off">
    <div class="scan-info" id="scanInfo">Menunggu scan…</div>
    <div class="scan-net">
      <div>Baris terisi<b id="netBarisScan">0</b></div>
      <div>Total qty<b id="netQtyScan">0</b></div>
      <div>Hasil scan<b id="netKedua">0</b></div>
    </div>
    <div id="kameraWrap"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px" id="btnKamera" type="button">Scan pakai Kamera HP</button>
    ${ambil ? '<div class="hint">Scanner barcode USB/Bluetooth langsung terbaca di kolom ini.</div>' : ''}
  </div>
</div>
</form>
${ambil ? '' : kepalaEntri({ base, sesi, entri, daftarSumber, petugas })}
${ambil ? '' : popupKunci({ base, sesi })}`;

  return { isi, script };
};
