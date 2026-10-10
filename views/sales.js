'use strict';
const { esc } = require('../lib/util');

exports.render = function ({ daftar, base, pesan, bolehUbah = true }) {
  const baris = daftar
    .map(
      (s) => `<tr>
        <td>${esc(s.nama)}</td>
        <td class="num">${bolehUbah ? `<form method="post" action="${base}/sales/${s.id}/hapus" style="display:inline">
          <button class="btn btn-danger btn-sm" data-konfirmasi="Hapus nama sales ${esc(s.nama)}?">Hapus</button>
        </form>` : ''}</td>
      </tr>`
    )
    .join('');

  return `
<div class="page-head">
  <div>
    <h1>Nama Sales</h1>
    <div class="sub">Dipakai saat membuat perjalanan baru. Nama baru otomatis tersimpan saat dipakai.</div>
  </div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}
<div class="grid grid-2">
  ${bolehUbah ? `<div class="card">
    <h2 class="card-title">Tambah Sales</h2>
    <form method="post" action="${base}/sales/tambah" class="stack" style="gap:12px">
      <div>
        <label class="f">Nama sales</label>
        <input type="text" name="nama" placeholder="mis. ZAIN" required>
      </div>
      <div><button class="btn btn-primary" type="submit">Tambah</button></div>
    </form>
  </div>` : `<div class="card">
    <h2 class="card-title">Peran kamu hanya melihat</h2>
    <p class="card-hint">Menambah atau menghapus nama sales dilakukan oleh petugas dengan peran Administrator atau Admin Gudang.</p>
  </div>`}
  <div class="card">
    <h2 class="card-title">Daftar Sales</h2>
    <div class="tbl-wrap">
      <table class="tbl"><thead><tr><th>Nama</th><th class="num">Aksi</th></tr></thead>
      <tbody>${baris || '<tr><td colspan="2" class="kosong">Belum ada nama sales.</td></tr>'}</tbody></table>
    </div>
  </div>
</div>`;
};
