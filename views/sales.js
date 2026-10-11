'use strict';
const { esc } = require('../lib/util');

/**
 * HALAMAN "KELOLA NAMA SALES" (Setting).
 *
 * Permintaan user:
 *  - "di setting nama sales ada selain opsi hapus, berikan opsi edit"  → tiap baris punya tombol **Edit**
 *    di samping Hapus, dan Edit membuka halaman biodata sales;
 *  - "bisa mengisi biodata sales beserta fotonya" → halaman edit memuat **Foto**, **Nama**, **Alamat**,
 *    **Telepon/HP**, **Email**, dan **Catatan**, semuanya boleh dikosongkan kecuali Nama.
 *
 * Foto diunggah dari sisi SERVER ke penyimpanan media platform (rutenya ada di `server.js`), jadi yang
 * disimpan di database hanya URL-nya — sama seperti logo aplikasi. Di daftar, fotonya ditampilkan sebagai
 * bulatan kecil (`img.foto-sales`); kalau belum ada foto, ditampilkan inisial namanya.
 */

/** Inisial nama untuk pengganti foto (mis. "Zainal Ardi" → "ZA"). */
function inisial(nama) {
  return String(nama || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k[0] || '')
    .join('')
    .toUpperCase() || '?';
}

/** Bulatan foto sales (atau inisial kalau belum ada foto). */
function avatar(s, ukuran = '') {
  const kelas = `avatar-sales${ukuran ? ' ' + ukuran : ''}`;
  if (s.foto) return `<img class="${kelas} foto" src="${esc(s.foto)}" alt="Foto ${esc(s.nama)}" loading="lazy">`;
  return `<span class="${kelas}">${esc(inisial(s.nama))}</span>`;
}
exports.avatar = avatar;

exports.render = function ({ daftar, base, pesan, bolehUbah = true }) {
  const baris = daftar
    .map(
      (s) => `<tr data-sales="${s.id}">
        <td class="td-foto">${avatar(s)}</td>
        <td>
          <span class="nm">${esc(s.nama)}</span>
          ${s.telepon ? `<span class="kd">${esc(s.telepon)}</span>` : ''}
        </td>
        <td class="aksi-sel">
          ${
            bolehUbah
              ? `<a class="btn btn-ghost btn-sm" href="${base}/sales/${s.id}" title="Ubah biodata & foto ${esc(s.nama)}">✎ Edit</a>
          <form method="post" action="${base}/sales/${s.id}/hapus" style="display:inline">
            <button class="btn btn-danger btn-sm" data-konfirmasi="Hapus nama sales ${esc(s.nama)}?">Hapus</button>
          </form>`
              : `<span class="kode">hanya-baca</span>`
          }
        </td>
      </tr>`
    )
    .join('');

  return `
<div class="page-head">
  <div>
    <h1>Nama Sales</h1>
    <div class="sub">Dipakai saat membuat perjalanan baru. Nama baru otomatis tersimpan saat dipakai. Klik <b>Edit</b> untuk melengkapi biodata &amp; foto sales.</div>
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
<div class="grid grid-2">
  ${
    bolehUbah
      ? `<div class="card">
    <h2 class="card-title">Tambah Sales</h2>
    <form method="post" action="${base}/sales/tambah" class="stack" style="gap:12px">
      <div>
        <label class="f">Nama sales</label>
        <input type="text" name="nama" placeholder="mis. ZAIN" required>
      </div>
      <div><button class="btn btn-primary" type="submit">Tambah</button></div>
    </form>
    <p class="card-hint">Biodata &amp; foto dilengkapi lewat tombol <b>Edit</b> pada daftar di samping.</p>
  </div>`
      : `<div class="card">
    <h2 class="card-title">Peran kamu hanya melihat</h2>
    <p class="card-hint">Menambah, mengubah, atau menghapus nama sales dilakukan oleh petugas dengan peran Administrator.</p>
  </div>`
  }
  <div class="card">
    <h2 class="card-title">Daftar Sales</h2>
    <div class="tbl-wrap">
      <table class="tbl"><thead><tr><th class="td-foto">Foto</th><th>Nama</th><th class="aksi-sel">Aksi</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="3" class="kosong">Belum ada nama sales.</td></tr>'}</tbody></table>
    </div>
  </div>
</div>`;
};

/**
 * HALAMAN EDIT BIODATA SALES (`GET /sales/:id`) — permintaan user: "opsi edit, dan bisa mengisi biodata
 * sales beserta fotonya". Formnya `multipart/form-data` karena ada unggah foto.
 */
exports.form = function ({ sales: s, base, pesan, galat = '' }) {
  const urlHapusFoto = `${base}/sales/${s.id}/foto/hapus`;
  return `
<div class="page-head">
  <div>
    <h1>Edit Sales</h1>
    <div class="sub">Lengkapi biodata &amp; foto <b>${esc(s.nama)}</b>. Kolom boleh dikosongkan kecuali nama.</div>
  </div>
  <div class="aksi">
    <a class="btn btn-ghost" href="${base}/sales">← Kembali ke daftar sales</a>
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
${galat ? `<div class="alert alert-warn">${esc(galat)}</div>` : ''}

<form method="post" action="${base}/sales/${s.id}/simpan" enctype="multipart/form-data" class="card sales-form">
  <h2 class="card-title-heading">Biodata Sales</h2>
  <div class="biodata">
    <div class="biodata-foto">
      ${s.foto ? `<img class="foto-besar" src="${esc(s.foto)}" alt="Foto ${esc(s.nama)}">` : '<span class="avatar-sales besar">' + esc(inisial(s.nama)) + '</span>'}
      <label class="f" for="fotoSales">Foto sales</label>
      <input type="file" id="fotoSales" name="foto" accept="image/png,image/jpeg,image/webp">
      <p class="hint">PNG / JPG / WEBP, maksimal 5 MB. Foto disimpan di penyimpanan media aplikasi.</p>
      ${s.foto ? `<label class="hapus-foto"><input type="checkbox" name="hapus_foto" value="1"> Hapus foto</label>` : ''}
    </div>
    <div class="biodata-isi">
      <div class="field"><label class="f" for="namaSales">Nama sales *</label>
        <input type="text" id="namaSales" name="nama" value="${esc(s.nama)}" required></div>
      <div class="field"><label class="f" for="teleponSales">Telepon / HP</label>
        <input type="text" id="teleponSales" name="telepon" value="${esc(s.telepon || '')}" placeholder="mis. 0812-3456-7890"></div>
      <div class="field"><label class="f" for="emailSales">Email</label>
        <input type="email" id="emailSales" name="email" value="${esc(s.email || '')}" placeholder="mis. nama@email.com"></div>
      <div class="field field-lebar"><label class="f" for="alamatSales">Alamat</label>
        <input type="text" id="alamatSales" name="alamat" value="${esc(s.alamat || '')}" placeholder="mis. Jl. Pasar Baru No. 12, Makassar"></div>
      <div class="field field-lebar"><label class="f" for="catatanSales">Catatan</label>
        <textarea id="catatanSales" name="catatan" rows="3" placeholder="mis. area canvasing, tanggal bergabung, catatan lain">${esc(s.catatan || '')}</textarea></div>
    </div>
  </div>
  <div class="aksi-row aksi-dua">
    <button class="btn btn-primary" type="submit">Simpan Biodata</button>
    <a class="btn btn-ghost" href="${base}/sales">Batal</a>
  </div>
</form>

${
  s.foto
    ? `<form method="post" action="${urlHapusFoto}" class="card" style="margin-top:22px;max-width:680px">
  <h2 class="card-title">Hapus foto</h2>
  <p class="card-hint">Foto akan dilepas dari sales ini (biodatanya tetap tersimpan).</p>
  <button class="btn btn-danger btn-sm" type="submit" data-konfirmasi="Hapus foto ${esc(s.nama)}?">Hapus foto</button>
</form>`
    : ''
}`;
};
