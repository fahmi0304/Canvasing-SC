'use strict';
const { esc } = require('../lib/util');
const { UKURAN, judulBawaanSurat, logoDokumen } = require('../lib/setelan');

/**
 * Halaman Setting → "Edit Logo & Layout Surat" (permintaan user):
 *   "di setting ada pilihan edit logo, dan bisa upload logo jpg/png … ada opsi edit layout surat,
 *    entah itu surat jalan atau memo, logo yang di upload sebagai logo dasbor otomatis terpakai di
 *    logo surat".
 *
 * HANYA administrator (penjagaannya di server.js). Isinya tiga kartu:
 *   1. Logo aplikasi   — unggah / ganti / kembalikan bawaan.
 *   2. Layout surat    — logo tampil & ukurannya, judul + tulisan kop, garis kop, tanda tangan.
 *   3. Pratinjau       — iframe dokumen contoh (route /cetak/contoh) memakai setelan yang tersimpan,
 *                        jadi hasil pengaturannya langsung terlihat sebelum dicetak.
 */
exports.render = function ({ base, setelan, pesan, galat, bolehUbah }) {
  const judul = setelan.kop_judul || judulBawaanSurat;
  const logoAktif = logoDokumen(setelan, base);
  const unggahan = !!setelan.logo_url;

  const opsiUkuran = Object.keys(UKURAN)
    .map(
      (k) => `<label class="logo-opsi">
        <input type="radio" name="logo_ukuran" value="${k}"${setelan.logo_ukuran === k ? ' checked' : ''}>
        <span>${esc(UKURAN[k].label)}</span>
      </label>`
    )
    .join('');

  return `
<div class="stack">
  ${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
  ${galat ? `<div class="alert alert-warn">${esc(galat)}</div>` : ''}

  <div class="card">
    <h2 class="card-title-heading">Logo Aplikasi</h2>
    <p class="card-hint">Unggah logo sendiri (JPG/PNG, maksimal 5 MB). Logo ini otomatis dipakai di <b>topbar dasbor</b>,
    <b>kepala surat jalan &amp; laporan F4</b>, dan <b>ikon aplikasi di layar utama HP</b> — tidak perlu diatur dua kali.</p>
    <div class="logo-baris">
      <span class="logo-pratinjau"><img src="${esc(logoAktif)}" alt="Logo saat ini"></span>
      <div class="logo-ket">
        <b>${unggahan ? 'Logo unggahan' : 'Logo bawaan aplikasi'}</b>
        <span class="hint">${unggahan ? 'Tersimpan dan dipakai di seluruh halaman.' : 'Masih memakai logo bawaan (bisa diunggah kapan saja).'}</span>
        ${unggahan && bolehUbah
          ? `<form method="post" action="${base}/setting/logo/hapus">
              <button class="btn" type="submit">Kembalikan logo bawaan</button>
            </form>`
          : ''}
      </div>
    </div>
    ${bolehUbah
      ? `<form method="post" action="${base}/setting/logo/unggah" enctype="multipart/form-data" class="stack" style="gap:14px;margin-top:18px">
          <div>
            <label class="f" for="berkasLogo">Berkas logo baru</label>
            <input type="file" id="berkasLogo" name="logo" accept="image/png,image/jpeg" required>
            <span class="hint">Gunakan gambar berformat persegi (mis. 512×512) supaya tidak gepeng di kop surat
              maupun di ikon aplikasi.</span>
          </div>
          <button class="btn btn-primary" type="submit">Unggah &amp; Pakai Logo</button>
        </form>`
      : `<div class="alert alert-warn">Peran kamu hanya melihat data — unggah logo tidak tersedia.</div>`}
  </div>

  <div class="card">
    <h2 class="card-title-heading">Layout Surat Jalan &amp; Laporan</h2>
    <p class="card-hint">Berlaku untuk surat jalan, laporan F4, dan memo penginputan. Perubahan langsung
    dipakai pada dokumen yang dicetak berikutnya.</p>
    ${
      bolehUbah
        ? `<form method="post" action="${base}/setting/logo/simpan" class="stack" style="gap:18px">
          <div>
            <label class="f">Tampilkan logo di kop surat</label>
            <label class="logo-opsi"><input type="checkbox" name="logo_tampil" value="1"${setelan.logo_tampil === '1' ? ' checked' : ''}><span>Logo tampil di kepala surat jalan, laporan, dan memo</span></label>
          </div>
          <div>
            <label class="f">Ukuran logo</label>
            <div class="logo-ukuran">${opsiUkuran}</div>
          </div>
          <div>
            <label class="f" for="kopJudul">Judul surat</label>
            <input type="text" id="kopJudul" name="kop_judul" maxlength="70" value="${esc(setelan.kop_judul)}" placeholder="${esc(judulBawaanSurat)}">
            <span class="hint">Kosongkan untuk memakai judul bawaan: <b>${esc(judulBawaanSurat)}</b>. Berlaku untuk surat jalan &
            laporan lengkapnya — judul lembar <b>laporan per sales</b> tidak ikut berubah.</span>
          </div>
          <div>
            <label class="f" for="kopSub">Tulisan kop (nama toko)</label>
            <input type="text" id="kopSub" name="kop_sub" maxlength="70" value="${esc(setelan.kop_sub)}" placeholder="SC SUNGLASSES STORE">
            <span class="hint">Baris kecil di bawah judul surat.</span>
          </div>
          <div>
            <label class="f">Garis kop</label>
            <label class="logo-opsi"><input type="checkbox" name="kop_garis" value="1"${setelan.kop_garis === '1' ? ' checked' : ''}><span>Tampilkan garis pemisah di bawah kop surat</span></label>
          </div>
          <!--
            Kotak "Tanda tangan" DIHAPUS: blok tanda tangan tidak lagi dicetak di dokumen mana pun
            (permintaan user: *"hapus kolom tanda tangan di cetak laporan"*, pilihan pemilik aplikasi:
            semua dokumen & setelan tanda tangan tidak berpengaruh lagi). Kunci ttd_tampil sengaja
            dibiarkan ada di database (tidak dibaca lagi) supaya tidak perlu migrasi.
          -->
          <div class="aksi-row aksi-dua">
            <button class="btn btn-primary" type="submit">Simpan Pengaturan</button>
            <a class="btn" href="${base}/cetak/contoh" target="_blank" rel="noopener">Buka Contoh Surat</a>
          </div>
        </form>`
        : ''
    }
  </div>

  <div class="card">
    <h2 class="card-title-heading">Pratinjau Contoh Surat</h2>
    <p class="card-hint">Contoh dengan data karangan (bukan data perjalanan asli) memakai logo &amp; layout
    yang sedang dipakai sekarang.</p>
    <div class="pratinjau" id="pratinjau">
      <iframe id="pratinjauSurat" src="${base}/cetak/contoh" title="Pratinjau surat jalan" loading="lazy"></iframe>
    </div>
    <p class="hint" id="pratinjauHint">Ukuran kertas dokumen: F4 (215 × 330 mm), margin 10 mm.</p>
  </div>
</div>`;
};

/** Skrip pratinjau: iframe dokumen diperkecil agar muat lebar kartu di desktop maupun HP. */
exports.script = `
<script>(function(){
  var kotak = document.getElementById('pratinjau');
  var fr = document.getElementById('pratinjauSurat');
  if (!kotak || !fr) return;
  var LEBAR_DOK_MM = 215, TINGGI_DOK_MM = 330, TINGGI_MAKS = 620;
  function px(mm){ return (mm / 25.4) * 96; }
  function atur(){
    var lebar = kotak.clientWidth || 640;
    var skala = Math.min(1, lebar / px(LEBAR_DOK_MM));
    fr.style.transform = 'scale(' + skala + ')';
    fr.style.transformOrigin = 'top left';
    fr.style.width = px(LEBAR_DOK_MM) + 'px';
    fr.style.height = px(TINGGI_DOK_MM) + 'px';
    // tinggi pratinjau dibatasi supaya kartunya tidak memanjang ke bawah; sisanya bisa digeser di dalam
    kotak.style.height = Math.min(TINGGI_MAKS, Math.round(px(TINGGI_DOK_MM) * skala)) + 'px';
  }
  atur();
  window.addEventListener('resize', atur);
  fr.addEventListener('load', atur);
})();</script>`;
