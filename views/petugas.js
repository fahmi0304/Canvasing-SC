'use strict';
const { esc, tanggalPendek } = require('../lib/util');

/**
 * Kelola petugas & peran.
 * Menambah & menghapus petugas (dan mengubah peran) hanya boleh administrator —
 * untuk petugas lain halaman ini hanya menampilkan daftar (read-only).
 */
exports.render = function ({ daftar, base, pesan, petugas, bolehKelola = false, peranInfo }) {
  const info = (peran) => (peranInfo ? peranInfo(peran) : { label: peran, warna: 'abu' });

  const baris = daftar
    .map((p) => {
      const pi = info(p.peran);
      const sendiri = petugas && petugas.id === p.id;
      return `<div class="petugas-item">
        <div class="petugas-nama">
          <b>${esc(p.nama)}</b>
          <span class="badge b-${pi.warna}">${esc(pi.label)}</span>
          ${sendiri ? '<span class="badge b-ungu">sedang login</span>' : ''}
          <span class="kode">dibuat ${esc(tanggalPendek(String(p.created_at || '').slice(0, 10)))}</span>
        </div>
        <div class="petugas-aksi">
          ${
            bolehKelola
              ? `<form method="post" action="${base}/petugas/${p.id}/peran" class="petugas-form">
            <select name="peran" aria-label="Peran ${esc(p.nama)}">
              ${['administrator', 'admin_gudang', 'sales']
                .map((v) => `<option value="${v}"${p.peran === v ? ' selected' : ''}>${esc(info(v).label)}</option>`)
                .join('')}
            </select>
            <button class="btn btn-ghost btn-sm" type="submit">Simpan Peran</button>
          </form>`
              : ''
          }
          <form method="post" action="${base}/petugas/${p.id}/pin" class="petugas-form">
            <input type="password" name="pin" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" placeholder="PIN baru" required>
            <button class="btn btn-ghost btn-sm" type="submit">${sendiri ? 'Ganti PIN saya' : 'Ganti PIN'}</button>
          </form>
          ${
            bolehKelola
              ? `<form method="post" action="${base}/petugas/${p.id}/hapus">
            <button class="btn btn-danger btn-sm" data-konfirmasi="Hapus petugas ${esc(p.nama)} (${esc(pi.label)})? PIN-nya tidak bisa dipakai login lagi.">Hapus</button>
          </form>`
              : ''
          }
        </div>
      </div>`;
    })
    .join('');

  const formTambah = bolehKelola
    ? `<div class="card">
    <h2 class="card-title">Tambah Petugas</h2>
    <p class="card-hint">PIN wajib angka 4–8 digit. Peran menentukan apa yang boleh dilakukan petugas.</p>
    <form method="post" action="${base}/petugas/tambah" class="stack" style="gap:12px">
      <div>
        <label class="f">Nama petugas</label>
        <input type="text" name="nama" placeholder="mis. ZAINAL ARDI" required autocomplete="off">
      </div>
      <div>
        <label class="f">Peran</label>
        <select name="peran">
          <option value="administrator">Administrator — semua hak, termasuk hapus &amp; kelola petugas</option>
          <option value="admin_gudang" selected>Admin Gudang — jalankan canvasing &amp; input data</option>
          <option value="sales">Sales — hanya bisa melihat data</option>
        </select>
      </div>
      <div>
        <label class="f">PIN (angka, 4–8 digit)</label>
        <input type="password" name="pin" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="8" required autocomplete="new-password">
      </div>
      <div><button class="btn btn-primary" type="submit">Tambah Petugas</button></div>
    </form>
  </div>`
    : `<div class="card">
    <h2 class="card-title">Peran &amp; Hak</h2>
    <p class="card-hint">Kamu masuk sebagai <b>${esc(petugas ? info(petugas.peran).label : '-')}</b>.
      Menambah petugas, menghapus petugas, dan mengubah peran hanya boleh <b>Administrator</b>.
      Kalau perlu petugas baru atau peran diubah, hubungi administrator.</p>
    <div class="peran-info">
      <div><span class="badge b-ungu">Administrator</span><small>Semua hak: jalankan canvasing, hapus perjalanan (termasuk yang terkunci), kelola petugas &amp; peran.</small></div>
      <div><span class="badge b-biru">Admin Gudang</span><small>Jalankan canvasing &amp; input data; tidak bisa menghapus perjalanan terkunci dan tidak bisa kelola petugas.</small></div>
      <div><span class="badge b-abu">Sales</span><small>Hanya bisa melihat data &amp; mencetak dokumen.</small></div>
    </div>
  </div>`;

  return `
<div class="page-head">
  <div>
    <h1>Petugas</h1>
    <div class="sub">Nama petugas yang bisa login. Nama petugas yang merekap otomatis tercetak pada tanda tangan dokumen.</div>
  </div>
  <div class="aksi"><a class="btn btn-ghost" href="${base}/">Kembali ke Dasbor</a></div>
</div>
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="grid grid-2">
  ${formTambah}
  <div class="card">
    <h2 class="card-title">Daftar Petugas</h2>
    <p class="card-hint">${bolehKelola ? 'Administrator terakhir tidak bisa dihapus atau diturunkan perannya.' : 'Daftar ini hanya bisa dilihat. Perubahan peran &amp; penambahan petugas dilakukan administrator.'}</p>
    <div class="petugas-list">${baris || '<div class="kosong">Belum ada petugas.</div>'}</div>
  </div>
</div>`;
};
