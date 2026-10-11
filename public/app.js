/* Helper UI + penanganan scan barcode (keyboard wedge / kamera) */
(function () {
  const BASE = window.APP_BASE || '';

  const toastBox = document.createElement('div');
  toastBox.id = 'toast';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(toastBox));

  function toast(msg, tipe) {
    const el = document.createElement('div');
    el.className = 'toast ' + (tipe || 'info');
    el.textContent = msg;
    (document.getElementById('toast') || toastBox).appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = '0.25s'; }, 2200);
    setTimeout(() => el.remove(), 2600);
  }

  function flash(tr, ok) {
    if (!tr) return;
    tr.classList.remove('pulse', 'pulse-err');
    void tr.offsetWidth;
    tr.classList.add(ok ? 'pulse' : 'pulse-err');
  }

  /*
   * ---- stepper jumlah (tombol − / +) ----
   * permintaan user: "tombol + saat tidak harus di pencet terus menerus untuk menambah barang, cukup
   * tekan barang akan bertambah perlahan, tombol − juga sebaliknya … bisa juga memencet sekali untuk
   * menambah atau mengurangi 1 angka, namun ketika di tekan angka berubah terus".
   * Jadi: TEKAN (=klik) sekali → 1 angka; TAHAN → angka berubah terus perlahan (mulai setelah
   * `JEDA_AWAL`, lalu tiap `JEDA_ULANG`, makin lama makin cepat sedikit).
   */
  const JEDA_AWAL = 420;    // ms sebelum mulai berulang
  const JEDA_ULANG = 150;   // jeda antar perubahan saat ditahan
  let stepper = null;
  let terakhirTombol = 0;   // penanda bahwa penekanan sudah ditangani (supaya klik tidak dobel)

  function langkahStepper(b, banyak) {
    const target = document.querySelector(b.dataset.target);
    if (!target) return;
    let v = parseInt(target.value || '0', 10) || 0;
    v += (b.hasAttribute('data-plus') ? 1 : -1) * (banyak || 1);
    if (v < 0) v = 0;
    if (String(v) !== String(target.value)) {
      target.value = v;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  function hentikanStepper() {
    if (!stepper) return;
    clearTimeout(stepper.jeda);
    clearInterval(stepper.ulang);
    if (stepper.tombol) stepper.tombol.classList.remove('menekan');
    stepper = null;
  }
  function mulaiStepper(b) {
    hentikanStepper();
    langkahStepper(b, 1);          // perubahan pertama langsung terasa
    b.classList.add('menekan');
    stepper = { tombol: b, jeda: null, ulang: null };
    stepper.jeda = setTimeout(() => {
      if (!stepper) return;
      let n = 0;
      stepper.ulang = setInterval(() => {
        if (!stepper) return;
        n += 1;
        langkahStepper(b, 1);
        // makin lama ditahan makin cepat (sampai batas 45 ms)
        if (n % 8 === 0 && stepper) {
          clearInterval(stepper.ulang);
          const jeda = Math.max(45, JEDA_ULANG - (n / 8) * 25);
          stepper.ulang = setInterval(() => { if (stepper) langkahStepper(b, 1); }, jeda);
        }
      }, JEDA_ULANG);
    }, JEDA_AWAL);
  }
  document.addEventListener('pointerdown', (ev) => {
    const b = ev.target.closest('[data-plus],[data-minus]');
    if (!b || (ev.button !== undefined && ev.button !== 0)) return;
    ev.preventDefault();
    terakhirTombol = Date.now();
    mulaiStepper(b);
  });
  ['pointerup', 'pointercancel', 'blur'].forEach((n) => document.addEventListener(n, hentikanStepper, true));
  document.addEventListener('pointerleave', (ev) => {
    if (stepper && ev.target === stepper.tombol) hentikanStepper();
  }, true);
  document.addEventListener('pointermove', (ev) => {
    if (stepper && !stepper.tombol.contains(ev.target)) hentikanStepper();
  });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-plus],[data-minus]');
    if (b) {
      // sudah ditangani lewat pointerdown (tetikus/sentuhan) — hanya aktivasi KEYBOARD yang di sini
      if (Date.now() - terakhirTombol > 700) {
        terakhirTombol = Date.now();
        langkahStepper(b, 1);
      }
      return;
    }
    const p = ev.target.closest('[data-print]');
    if (p) { window.print(); return; }

    const c = ev.target.closest('[data-konfirmasi]');
    if (c) {
      if (!confirm(c.dataset.konfirmasi)) ev.preventDefault();
      return;
    }

    const s = ev.target.closest('[data-salin]');
    if (s) {
      navigator.clipboard.writeText(s.dataset.salin).then(() => toast('Disalin: ' + s.dataset.salin, 'ok'));
    }
  });

  /* ---- filter tabel ---- */
  document.addEventListener('input', (ev) => {
    const f = ev.target.closest('[data-filter]');
    if (!f) return;
    const kata = f.value.toLowerCase().trim();
    document.querySelectorAll(f.dataset.filter + ' tbody tr').forEach((tr) => {
      const teks = (tr.dataset.cari || tr.textContent).toLowerCase();
      tr.style.display = teks.includes(kata) ? '' : 'none';
    });
  });

  /* ---- scan ---- */
  function pasang(input, opsi) {
    let sibuk = false;
    async function kirim(kode) {
      if (!kode || sibuk) return;
      sibuk = true;
      try {
        const url = BASE + '/api/cari?kode=' + encodeURIComponent(kode) + (opsi.sesi ? '&sesi=' + opsi.sesi : '');
        const r = await fetch(url);
        const d = await r.json();
        if (d.ok) {
          opsi.onMatch(d, kode);
        } else {
          toast('Kode tidak dikenal: ' + kode, 'err');
          if (opsi.onGagal) opsi.onGagal(d, kode);
        }
      } catch (e) {
        toast('Gagal menghubungi server', 'err');
      } finally {
        sibuk = false;
        input.value = '';
        input.focus();
      }
    }
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.keyCode === 13) {
        ev.preventDefault();
        kirim(input.value.trim());
      }
    });
    return { kirim };
  }

  document.querySelectorAll('[data-scan]').forEach((input) => {
    const sesi = input.dataset.sesi || '';
    const fn = input.dataset.onmatch;
    pasang(input, {
      sesi,
      onMatch: (d) => {
        if (typeof window[fn] === 'function') window[fn](d, input);
        else toast(d.item.nama + ' (' + d.item.kode + ')', 'ok');
      },
    });
  });

  /**
   * Popup konfirmasi bertema (menggantikan confirm() bawaan browser).
   * Dipakai layar input: "Hapus <barang> dari daftar?" → Promise<boolean>.
   */
  function konfirmasi(opsi) {
    const o = opsi || {};
    return new Promise((resolve) => {
      const lapis = document.createElement('div');
      lapis.className = 'konfirmasi-lapis';
      const kotak = document.createElement('div');
      kotak.className = 'konfirmasi-kotak card';
      kotak.setAttribute('role', 'dialog');
      kotak.setAttribute('aria-modal', 'true');

      const judul = document.createElement('h2');
      judul.textContent = o.judul || 'Konfirmasi';
      const pesan = document.createElement('p');
      pesan.className = 'card-hint';
      pesan.textContent = o.pesan || '';

      const aksi = document.createElement('div');
      aksi.className = 'konfirmasi-aksi';
      const batal = document.createElement('button');
      batal.type = 'button';
      batal.className = 'btn btn-ghost';
      batal.textContent = o.batal || 'Batal';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn btn-danger';
      ok.textContent = o.ok || 'Hapus';
      aksi.appendChild(batal);
      aksi.appendChild(ok);

      kotak.appendChild(judul);
      kotak.appendChild(pesan);
      kotak.appendChild(aksi);
      lapis.appendChild(kotak);
      document.body.appendChild(lapis);
      setTimeout(() => ok.focus(), 30);

      function tutup(hasil) {
        document.removeEventListener('keydown', onKey, true);
        lapis.remove();
        resolve(hasil);
      }
      function onKey(ev) {
        if (ev.key === 'Escape' || ev.keyCode === 27) { ev.stopPropagation(); tutup(false); }
        if (ev.key === 'Enter' || ev.keyCode === 13) { ev.stopPropagation(); tutup(true); }
      }
      batal.addEventListener('click', () => tutup(false));
      ok.addEventListener('click', () => tutup(true));
      lapis.addEventListener('click', (ev) => { if (ev.target === lapis) tutup(false); });
      document.addEventListener('keydown', onKey, true);
    });
  }

  /*
   * ---- BARIS BERSELANG-SELING (permintaan user) ----
   * Baris pertama yang TERLIHAT selalu putih, kedua abu muda, dan seterusnya. Dihitung di JS (bukan
   * `nth-child` saja) karena banyak daftar menyembunyikan baris (rekap hanya menampilkan barang yang
   * bergerak, layar input menyembunyikan barang "tidak dibawa") — dengan nth-child baris pertama yang
   * terlihat bisa jadi abu. CSS `:where(table.tbl tbody tr.baris-genap)` yang mewarnainya.
   */
  function segarkanBaris(tabel){
    const badan = tabel.tBodies[0];
    if (!badan) return;
    let n = 0;
    Array.from(badan.rows).forEach((tr) => {
      const terlihat = !tr.hidden && tr.style.display !== 'none' && !tr.classList.contains('sembunyi') &&
        (tr.offsetParent !== null || tr.getClientRects().length > 0);
      if (terlihat){
        const genap = n % 2 === 1;
        tr.classList.toggle('baris-genap', genap);
        tr.classList.toggle('baris-ganjil', !genap);
        n += 1;
      } else {
        tr.classList.remove('baris-genap', 'baris-ganjil');
      }
    });
  }
  function segarkanSemuaBaris(){ document.querySelectorAll('table.tbl').forEach(segarkanBaris); }
  window.SC = window.SC || {};
  window.SC.segarkanBaris = segarkanSemuaBaris;
  segarkanSemuaBaris();
  // ikut menyesuaikan saat daftar difilter/diubah (scan, hapus, "bawa lagi", pencarian, dst.)
  document.querySelectorAll('table.tbl tbody').forEach((badan) => {
    let jeda = null;
    new MutationObserver(() => {
      if (jeda) return;
      jeda = window.requestAnimationFrame(() => { jeda = null; segarkanBaris(badan.closest('table')); });
    }).observe(badan, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden', 'style'] });
  });

  /*
   * ---- SARING NAMA SALES di tabel Laporan (permintaan user 2026-10-11) ----
   * "buat filter khusus nama sales di tabel pada halaman laporan yang ketika di klik menampilkan laporan
   *  sales itu saja di tabel".
   *
   * Nama sales di sel `td-sales` adalah `<button data-sales-pilih>` (dibuat `views/laporan.js →
   * tombolSaringSales`). Mengkliknya menyembunyikan baris `#tblLaporan` yang `data-sales`-nya berbeda,
   * lalu menampilkan bilah `[data-saring-sales]` berisi nama terpilih + jumlah baris yang tampil dengan
   * tombol **Semua sales** untuk melepasnya. Mengklik nama sales yang sama (atau tombol pelepas) =
   * kembali menampilkan semua baris. Perbandingan nama tanpa membedakan huruf besar/kecil & spasi tepi.
   *
   * Penyaringan memakai atribut `hidden` (bukan style.display) supaya TIDAK bentrok dengan filter
   * pencarian `[data-filter]` yang menyetel `style.display`, dan `[hidden]{display:none!important}` di
   * CSS membuat baris tersaring tetap tersembunyi walau kotak pencarian diubah. Pewarnaan baris
   * berselang-seling diperbarui lewat `segarkanBaris()` (baris tersembunyi tidak dihitung).
   */
  (function pasangSaringSales() {
    function kunci(nama) {
      return String(nama || '').trim().toLowerCase();
    }
    // Status saringan disimpan LOKAL di sini + dicerminkan ke `<html data-sales-saring>` supaya bisa
    // diperiksa skrip uji. DUA JEBAKAN yang sudah terjadi di sini, jangan diulang:
    //  (1) JANGAN menyimpannya di `window.SC` — objek itu ditimpa ulang di akhir berkas
    //      (`window.SC = { … }`), jadi apa pun yang ditempelkan sebelum itu hilang;
    //  (2) nama atributnya TIDAK boleh sama dengan atribut bilahnya (`data-saring-sales`). Kalau sama,
    //      `document.querySelector('[data-saring-sales]')` menjatuhkan hasilnya ke elemen `<html>`
    //      (atribut penanda ada di sana), lalu `bilah.hidden = …` menyembunyikan SELURUH HALAMAN
    //      (`[hidden]{display:none!important}`) — di browser hal ini terlihat sebagai "semua tombol
    //      tidak bisa diklik". Karena itu penanda state bernama lain dan pencarian bilahnya spesifik.
    let aktif = '';
    function terapkan(saring) {
      aktif = saring || '';
      document.documentElement.dataset.salesSaring = aktif;
      const bilah = document.querySelector('.saring-sales[data-saring-sales]');
      const tabel = document.querySelector((bilah && bilah.dataset.saringTarget) || '#tblLaporan');
      if (!tabel) return;
      const baris = Array.from(tabel.tBodies[0] ? tabel.tBodies[0].rows : []);
      let tampil = 0;
      baris.forEach((tr) => {
        if (!tr.dataset.sales) return;             // baris keterangan "belum ada perjalanan"
        const cocok = !saring || kunci(tr.dataset.sales) === saring;
        if (cocok) tampil += 1;
        if (cocok) tr.removeAttribute('hidden');
        else tr.setAttribute('hidden', '');
      });
      // tandai tombol nama sales yang sedang aktif
      document.querySelectorAll('[data-sales-pilih]').forEach((b) => {
        b.classList.toggle('aktif', !!saring && kunci(b.dataset.salesPilih) === saring);
      });
      if (bilah) {
        bilah.hidden = !saring;
        const nama = bilah.querySelector('[data-saring-nama]');
        const jml = bilah.querySelector('[data-saring-jumlah]');
        // nama yang ditampilkan diambil dari baris yang cocok (bentuk aslinya, bukan versi huruf kecil)
        const contoh = baris.find((tr) => tr.dataset.sales && (!saring || kunci(tr.dataset.sales) === saring));
        if (nama) nama.textContent = saring && contoh ? contoh.dataset.sales : '';
        if (jml) jml.textContent = saring ? `(${tampil} transaksi)` : '';
      }
      segarkanBaris(tabel);
    }
    document.addEventListener('click', (ev) => {
      const batal = ev.target.closest && ev.target.closest('[data-saring-batal]');
      if (batal) {
        terapkan('');
        return;
      }
      const b = ev.target.closest && ev.target.closest('[data-sales-pilih]');
      if (!b) return;
      const nama = kunci(b.dataset.salesPilih);
      // klik nama yang sedang aktif = lepas saringan (biar bisa bolak-balik tanpa cari tombol lain)
      terapkan(aktif === nama ? '' : nama);
    });
  })();

  /*
   * ---- URUT A–Z untuk tabel Inventory (permintaan user 2026-10-11) ----
   * "buat filter khusus short a-z di tabel inventory". Menekan tombol `[data-urut-az]` menyusun ulang
   * baris tabel target berdasarkan NAMA barang (A→Z, memakai `localeCompare` dengan `numeric` supaya
   * angka di nama ikut wajar); menekannya lagi (atau memuat ulang halaman) mengembalikan urutan ASLI
   * (urutan master). Urutan asli diingat dari indeks awal baris (`data-urut-asli`) saat pertama kali
   * diurutkan, jadi tidak perlu menyimpannya di server. Saringan pencarian `[data-filter]` tidak
   * terpengaruh karena baris cukup DIPINDAH, bukan disembunyikan.
   */
  (function pasangUrutAZ() {
    function terapkan(tombol, urut) {
      const tabel = document.querySelector(tombol.dataset.urut || '');
      if (!tabel || !tabel.tBodies[0]) return;
      const badan = tabel.tBodies[0];
      const baris = Array.from(badan.rows).filter((tr) => !tr.classList.contains('kosong-baris') && tr.cells.length > 1);
      if (!baris.length) return;
      if (urut) {
        baris.forEach((tr, i) => { if (tr.dataset.urutAsli === undefined) tr.dataset.urutAsli = String(i); });
        baris
          .slice()
          .sort((a, b) =>
            String(a.dataset.nama || a.textContent).localeCompare(String(b.dataset.nama || b.textContent), 'id', { numeric: true, sensitivity: 'base' })
          )
          .forEach((tr) => badan.appendChild(tr));
      } else {
        baris
          .slice()
          .sort((a, b) => Number(a.dataset.urutAsli || 0) - Number(b.dataset.urutAsli || 0))
          .forEach((tr) => badan.appendChild(tr));
      }
      tombol.setAttribute('aria-pressed', urut ? 'true' : 'false');
      tombol.classList.toggle('aktif', urut);
      tombol.textContent = urut ? 'Urutan asli' : 'Urut A–Z';
      tombol.title = urut ? 'Kembalikan ke urutan asli (kode)' : 'Urutkan nama barang A–Z';
      if (window.SC && SC.segarkanBaris) SC.segarkanBaris();
    }
    document.addEventListener('click', (ev) => {
      const tombol = ev.target.closest && ev.target.closest('[data-urut-az]');
      if (!tombol) return;
      terapkan(tombol, tombol.getAttribute('aria-pressed') !== 'true');
    });
  })();

  /* ---- KUNCI BARIS (permintaan user) ----
   * "Saat pengimputan barang, baik itu tambahan, dan rekap tekan baris barang untuk mengunci jumlah,
   *  ada ikon kunci samar yang menunjukkan bahwa baris itu terkunci, agar saat menggeser tidak terpencet
   *  tombol + atau -, tekan lagi untuk membuka kunci."
   * DIUBAH atas permintaan user: yang mengunci bukan lagi "tekan baris sekali", tetapi
   * TEKAN NAMA BARANG TIGA KALI (3×) — membuka kuncinya juga 3× ketuk pada nama barang yang sama.
   *
   * 3× ketuk pada NAMA BARANG (sel yang memuat `.nm`; sel kolom angka / aksi tidak mengunci apa pun) →
   * baris dapat kelas `.terkunci` + ikon kunci samar di samping namanya. Tiap ketukan yang dihitung
   * menampilkan penanda kecil "1/3" / "2/3" pada nama barang supaya pengguna tahu ketukannya sedang
   * dihitung; ketukan yang jedanya lebih dari JEDA_KETUK (atau pada baris lain) memulai rangkaian baru.
   * Selama terkunci, tombol − / + dan kolom angka baris itu tidak menerima sentuhan (CSS
   * `pointer-events: none`) dan input-nya `readonly` — jadi menggeser/menyentuh baris tidak mengubah
   * jumlah, sedangkan NILAI TETAP IKUT TERKIRIM saat form disimpan (readonly ≠ disabled — jangan
   * diganti ke disabled, nilainya akan hilang dari POST/auto-save rekap).
   */
  (function pasangKunciBaris() {
    const BARIS = '#tblInput tbody tr, #tblRekap tbody tr, #tblRetur tbody tr';
    const KENDALI = 'input, button, a, select, textarea, label, .qty, .ttk, [data-hapus], [data-pulih], .btn-hapus-baris';
    const AMBANG_SENTUH = 9;    // px — lebih dari ini = menggeser/menggulung, bukan mengetuk nama
    const KETUK_KUNCI = 3;      // jumlah ketukan pada NAMA BARANG untuk mengunci / membuka
    const JEDA_KETUK = 1400;    // ms — jeda maksimal antar ketukan supaya dihitung satu rangkaian
    const IKON_KUNCI =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><rect x="4.4" y="10.4" width="15.2" height="9.6" rx="2.6"/>' +
      '<path d="M8.4 10.4V7.6a3.6 3.6 0 0 1 7.2 0v2.8"/></svg>';
    let tekan = null;    // kandidat ketukan (pointerdown yang belum bergerak)
    let rangkai = null;  // rangkaian ketukan: { tr, jumlah, waktu, pil }
    let jamPil = null;   // timer penghapus penanda "1/3"

    /**
     * Hanya SEL NAMA BARANG yang boleh mengunci (satu-satunya sel yang memuat `.nm`), dan sel kendali
     * (kolom angka / aksi / hapus) serta baris TOTAL tidak ikut. Pemeriksaan lewat SEL ini penting:
     * saat baris TERKUNCI tombol & kolom angkanya ber-`pointer-events: none`, sehingga target event-nya
     * jadi `td` — tanpa pemeriksaan ini, menyentuh kolom angka baris terkunci justru membuka kuncinya.
     */
    function selNama(ev) {
      const sel = ev.target.closest('td');
      if (!sel || !sel.querySelector('.nm')) return null;
      if (/(^|\s)(kolom-[a-z-]+|aksi-hapus|btn-hapus)\b/.test(sel.className)) return null;
      if (sel.querySelector('input, button, select, textarea, a, label, .ttk')) return null;
      return sel;
    }

    /** Penanda kecil "1/3" / "2/3" di samping nama barang (umpan balik ketukan yang dihitung). */
    function tandaiKetuk(tr, jumlah) {
      if (jamPil) { clearTimeout(jamPil); jamPil = null; }
      if (!rangkai || rangkai.tr !== tr || rangkai.jumlah !== jumlah) return;
      if (!jumlah) {
        if (rangkai.pil) { rangkai.pil.remove(); rangkai.pil = null; }
        return;
      }
      if (!rangkai.pil) {
        rangkai.pil = document.createElement('span');
        rangkai.pil.className = 'ketuk-pil';
        rangkai.pil.setAttribute('aria-hidden', 'true');
        // ditempel ke SEL nama (bukan ke .nm) + CSS `position: absolute` supaya ketukan tidak
        // menambah baris / mengubah tinggi baris di layar HP
        (tr.querySelector('td.beku') || tr.querySelector('.nm') || tr.cells[0]).appendChild(rangkai.pil);
      }
      rangkai.pil.textContent = jumlah + '/' + KETUK_KUNCI;
      jamPil = setTimeout(() => {
        if (!rangkai) return;
        if (rangkai.pil) { rangkai.pil.remove(); rangkai.pil = null; }
        rangkai.jumlah = 0;
      }, JEDA_KETUK);
    }

    /** Hitung ketukan nama barang; ketukan ke-3 = kunci / buka kunci baris. */
    function hitungKetuk(tr) {
      const kini = Date.now();
      if (!rangkai || rangkai.tr !== tr || kini - rangkai.waktu > JEDA_KETUK) {
        if (rangkai && rangkai.pil) rangkai.pil.remove();
        rangkai = { tr, jumlah: 0, waktu: kini, pil: null };
      }
      rangkai.waktu = kini;
      rangkai.jumlah += 1;
      if (rangkai.jumlah < KETUK_KUNCI) {
        // Umpan balik ketukan yang sedang dihitung = penanda kecil "1/3" di sel nama saja.
        // Permintaan user: "Hapus pop up yang muncul saat mengunci baris" → TIDAK ada toast/popup di
        // sini (dulu muncul "N× lagi untuk MENGUNCI baris"). Jangan dihidupkan lagi.
        tandaiKetuk(tr, rangkai.jumlah);
        return;
      }
      if (rangkai.pil) rangkai.pil.remove();
      rangkai = null;
      kuncikan(tr, !tr.classList.contains('terkunci'));
    }

    function kuncikan(tr, kunci) {
      tr.classList.toggle('terkunci', kunci);
      // readonly (bukan disabled) supaya angkanya tetap ikut terkirim saat form disimpan
      tr.querySelectorAll('input').forEach((i) => {
        if (kunci) i.setAttribute('readonly', 'readonly');
        else i.removeAttribute('readonly');
      });
      tr.querySelectorAll('[data-plus],[data-minus]').forEach((b) => {
        if (kunci) b.setAttribute('tabindex', '-1');
        else b.removeAttribute('tabindex');
      });
      let ikon = tr.querySelector('.kunci-ikon');
      if (kunci) {
        if (!ikon) {
          ikon = document.createElement('span');
          ikon.className = 'kunci-ikon';
          ikon.setAttribute('aria-hidden', 'true');
          ikon.title = 'Baris terkunci — ketuk nama barang 3× untuk membuka';
          ikon.innerHTML = IKON_KUNCI;
          const nm = tr.querySelector('.nm') || tr.cells[0];
          if (nm) nm.appendChild(ikon);
        }
      } else if (ikon) {
        ikon.remove();
      }
      // Permintaan user: "Hapus pop up yang muncul saat mengunci baris" → tanpa toast saat baris
      // dikunci / dibuka. Penanda yang tersisa cukup ikon kunci samar di samping nama barang
      // (muncul saat terkunci, hilang saat dibuka). Jangan pasang toast lagi di sini.
    }

    document.addEventListener('pointerdown', (ev) => {
      tekan = null;
      if (ev.button !== undefined && ev.button !== 0) return;
      const tr = ev.target.closest(BARIS);
      if (!tr || tr.classList.contains('sembunyi') || !tr.querySelector('input')) return;
      // sentuhan di tombol / kolom angka bukan "mengetuk nama barang"
      if (ev.target.closest(KENDALI)) return;
      // hanya SEL NAMA BARANG yang dihitung (lihat komentar selNama)
      if (!selNama(ev)) return;
      tekan = { tr, x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    }, true);

    document.addEventListener('pointerup', (ev) => {
      const t = tekan;
      tekan = null;
      if (!t || (ev.pointerId !== undefined && t.id !== ev.pointerId)) return;
      if (Math.abs(ev.clientX - t.x) > AMBANG_SENTUH || Math.abs(ev.clientY - t.y) > AMBANG_SENTUH) return;
      if (!t.tr.isConnected) return;
      hitungKetuk(t.tr);
    }, true);

    document.addEventListener('pointercancel', () => { tekan = null; }, true);
  })();

  /* ---- PASANG APLIKASI DI HP (PWA) ----
   * permintaan user: "Buat aplikasinya dapat di install di halaman handphone agar tampilannya penuh".
   *  - Android/Chrome (dan Edge): browser mengirim event `beforeinstallprompt`; kita tahan dulu lalu
   *    memicunya saat tombol "Pasang Aplikasi (HP)" ditekan — dialog pemasangan resmi muncul.
   *  - iPhone/iPad (Safari): tidak ada event & tidak ada manifest-install; harus manual lewat
   *    tombol Bagikan → "Tambahkan ke Layar Utama", jadi ditampilkan panduannya.
   *  - Sudah terpasang (dibuka dari layar utama): diberi tahu bahwa aplikasinya sudah terpasang.
   * Tidak ada yang dipaksakan: kalau browser tidak mendukung, pengguna tetap dapat panduan.
   */
  (function pasangAplikasi() {
    let tawaran = null;   // event beforeinstallprompt yang ditahan
    const sudahTerpasang = () =>
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;

    const iPhone = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    window.addEventListener('beforeinstallprompt', (ev) => {
      ev.preventDefault();
      tawaran = ev;
    });
    window.addEventListener('appinstalled', () => {
      tawaran = null;
      toast('Aplikasi berhasil dipasang di layar utama HP', 'ok');
    });

    /** Panduan singkat (dipakai kalau browser tidak bisa membuka dialog pemasangan sendiri). */
    function panduan() {
      const langkah = iPhone
        ? ['Buka aplikasi ini di browser <b>Safari</b> (bukan di dalam aplikasi lain).',
           'Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas) di bagian bawah layar.',
           'Pilih <b>Tambahkan ke Layar Utama</b>, lalu ketuk <b>Tambah</b>.',
           'Buka dari ikon di layar utama — tampilannya penuh tanpa bar browser.']
        : ['Buka menu browser (tombol <b>⋮</b> di kanan atas — Chrome/Edge).',
           'Pilih <b>Instal aplikasi</b> / <b>Tambahkan ke Layar utama</b>.',
           'Ketuk <b>Instal</b> / <b>Tambahkan</b>, lalu buka dari ikon di layar utama.',
           'Tampilannya penuh tanpa bar browser, seperti aplikasi biasa.'];

      const lapis = document.createElement('div');
      lapis.className = 'konfirmasi-lapis';
      lapis.innerHTML =
        '<div class="konfirmasi-kotak card" role="dialog" aria-modal="true">' +
        '<h2>Pasang Aplikasi di HP</h2>' +
        '<p class="card-hint">Supaya tampilannya penuh (tanpa bar browser) dan bisa dibuka langsung dari layar utama:</p>' +
        '<ol class="pasang-langkah">' + langkah.map((x) => '<li>' + x + '</li>').join('') + '</ol>' +
        '<p class="card-hint">Petunjuk ini hanya perlu sekali — sesudah terpasang, bukanya cukup lewat ikon di layar utama.</p>' +
        '</div>';
      const aksi = document.createElement('div');
      aksi.className = 'konfirmasi-aksi';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn btn-primary';
      ok.textContent = 'Mengerti';
      aksi.appendChild(ok);
      lapis.querySelector('.konfirmasi-kotak').appendChild(aksi);
      document.body.appendChild(lapis);

      function tutup() { lapis.remove(); document.removeEventListener('keydown', esc); }
      function esc(ev) { if (ev.key === 'Escape') tutup(); }
      ok.addEventListener('click', tutup);
      lapis.addEventListener('click', (ev) => { if (ev.target === lapis) tutup(); });
      document.addEventListener('keydown', esc);
      setTimeout(() => ok.focus(), 30);
    }

    document.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-pasang-buka]');
      if (!b) return;
      if (sudahTerpasang()) { toast('Aplikasi ini sudah terpasang di layar utama HP', 'ok'); return; }
      if (tawaran) {
        try {
          tawaran.prompt();
          const pilihan = await tawaran.userChoice;
          if (pilihan && pilihan.outcome === 'accepted') toast('Aplikasi dipasang di layar utama', 'ok');
          else toast('Pemasangan dibatalkan — bisa dicoba lagi kapan saja', 'info');
        } catch (e) {
          panduan();
        }
        tawaran = null;
        return;
      }
      panduan();
    });
  })();

  /**
   * Popup PILIHAN BANYAK (tombol menumpuk, tiap tombol satu baris) — pengganti dialog konfirmasi
   * dua tombol kalau pilihannya lebih dari dua. Dipakai popup "geser halaman" (tetap / pindah tanpa
   * simpan / pindah & simpan). Mengembalikan Promise berisi `nilai` pilihan, atau null kalau ditutup
   * (Esc / klik latar) yang artinya "tetap di halaman".
   * `opsi.pilihan` = [{ nilai, label, kelas }]; `kelas` contohnya 'btn-primary' untuk pilihan utama.
   */
  function pilih(opsi) {
    const o = opsi || {};
    return new Promise((resolve) => {
      const lapis = document.createElement('div');
      lapis.className = 'konfirmasi-lapis';
      const kotak = document.createElement('div');
      kotak.className = 'konfirmasi-kotak card';
      kotak.setAttribute('role', 'dialog');
      kotak.setAttribute('aria-modal', 'true');

      const judul = document.createElement('h2');
      judul.textContent = o.judul || 'Pilih tindakan';
      const pesan = document.createElement('p');
      pesan.className = 'card-hint';
      pesan.textContent = o.pesan || '';

      const aksi = document.createElement('div');
      aksi.className = 'konfirmasi-aksi kolom';

      kotak.appendChild(judul);
      kotak.appendChild(pesan);
      kotak.appendChild(aksi);
      lapis.appendChild(kotak);
      document.body.appendChild(lapis);

      function tutup(hasil) {
        document.removeEventListener('keydown', onKey, true);
        lapis.remove();
        resolve(hasil);
      }
      function onKey(ev) {
        if (ev.key === 'Escape' || ev.keyCode === 27) { ev.stopPropagation(); tutup(null); }
      }
      (o.pilihan || []).forEach((p, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (p.kelas || 'btn-ghost');
        b.textContent = p.label;
        b.setAttribute('data-pilih', String(p.nilai));
        b.addEventListener('click', () => tutup(p.nilai));
        aksi.appendChild(b);
        if (i === 0) setTimeout(() => b.focus(), 30);
      });
      lapis.addEventListener('click', (ev) => { if (ev.target === lapis) tutup(null); });
      document.addEventListener('keydown', onKey, true);
    });
  }

  /**
   * GESER KE KANAN = pindah halaman (dengan konfirmasi) — permintaan user: "Saat berada pada halaman
   * pengimputan, tambahan barang, retur, rekap, buat perjalanan baru, ketika menggeser tidak langsung
   * pindah halaman, namun muncul pop up yang menanyakan, tetap di halaman, pindah ke halaman lain dan
   * simpan hasil imput".
   *
   * Halaman yang memakai ini mendaftarkan dirinya lewat `SC.geserHalaman({ tujuan, simpan })`:
   *  - `tujuan`  = URL cadangan kalau riwayat browser kosong (halaman sering dibuka dari tab baru),
   *  - `simpan`  = fungsi yang menyimpan isian halaman lalu pindah (opsional; tanpa ini pilihannya
   *                cukup "tetap di halaman" & "pindah").
   *
   * Umpan baliknya memakai pil `#kbPetunjuk` yang sama seperti mekanisme geser sebelumnya, lalu saat
   * dilepas muncul popup 3 pilihan. Gestur mendatar saja (vertikal = menggulung layar) dan diabaikan
   * kalau dimulai di dalam tabel/kolom isian/tombol/tautan supaya tidak bentrok.
   */
  /*
   * Izin keluar TERKENDALI. Halaman penginputan & rekap memasang `beforeunload` (peringatan "perubahan
   * belum tersimpan") — dialog bawaan itu ikut muncul saat kita berpindah setelah pengguna MEMILIH di
   * popup, dan bisa membatalkan navigasi penyimpanan (data jadi hilang). Jadi begitu pilihan pindah/simpan
   * diambil, tandanya dinyalakan dan `beforeunload` milik aplikasi berhenti menghalangi.
   */
  window.SC = window.SC || {};
  window.SC.izinkanKeluar = false;
  function tandaiKeluar() { window.SC.izinkanKeluar = true; }

  function geserHalaman(opsi) {
    const o = opsi || {};
    const tentu = o.tujuan || '';
    const AMBANG = 110;
    let geser = null;
    let pill = null;

    function pillPasang() {
      if (!pill) {
        pill = document.getElementById('kbPetunjuk');
        if (!pill) {
          pill = document.createElement('div');
          pill.className = 'kb-petunjuk';
          pill.id = 'kbPetunjuk';
          document.body.appendChild(pill);
        }
      }
      return pill;
    }
    function pillTampil(teks, siap) {
      const p = pillPasang();
      p.textContent = teks;
      p.classList.add('tampil');
      p.classList.toggle('siap', !!siap);
    }
    function pillSembunyi() { if (pill) pill.classList.remove('tampil', 'siap'); }

    function pindah(simpan) {
      tandaiKeluar();   // pengguna sudah memilih → jangan dihalangi peringatan "belum tersimpan"
      if (simpan && typeof o.simpan === 'function') { o.simpan(); return; }
      /*
       * "Pindah ke halaman lain" TIDAK selalu bisa memakai riwayat browser: halaman penginputan sering
       * dibuka lewat tautan/tab baru dengan riwayat kosong. Fallback alamatnya (`tujuan`) yang dipakai.
       */
      try {
        if (window.history.length > 1 && document.referrer && document.referrer.indexOf(location.origin) === 0) {
          window.history.back();
          return;
        }
      } catch (e) { /* lanjut ke fallback */ }
      if (tentu) location.href = tentu;
    }

    async function tanya() {
      const pilihan = [
        { nilai: 'tetap', label: o.labelTetap || 'Tetap di halaman', kelas: 'btn-ghost' },
        { nilai: 'pindah', label: o.labelPindah || 'Pindah tanpa menyimpan', kelas: 'btn-ghost' },
      ];
      if (typeof o.simpan === 'function') pilihan.splice(1, 0, { nilai: 'simpan', label: o.labelSimpan || 'Pindah & simpan hasil input', kelas: 'btn-primary' });
      const hasil = await pilih({
        judul: o.judul || 'Pindah halaman?',
        pesan: o.pesan || 'Isian di halaman ini belum tentu tersimpan. Pilih mau tetap di sini atau pindah ke halaman lain.',
        pilihan,
      });
      if (hasil === 'simpan') return pindah(true);
      if (hasil === 'pindah') return pindah(false);
      // 'tetap' / ditutup (Esc / klik latar) = tidak melakukan apa-apa
    }

    document.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const t = ev.target;
      if (!t || typeof t.closest !== 'function') return;   // target bukan elemen (mis. event sintetis)
      /*
       * PENTING (pernah salah): `.tbl-wrap` TIDAK boleh ikut diabaikan. Daftar/daftar tabel justru
       * menempati sebagian besar layar penginputan, jadi kalau gestur diabaikan di situ pengguna
       * menggeser di tempat yang paling wajar dan TIDAK terjadi apa pun (keluhan: "pop up tidak muncul
       * di halaman pengimputan"). Geser ke KIRI tetap milik baris (menandai "tidak dibawa") karena
       * `geserHalaman` hanya bertindak untuk gerakan ke KANAN (dx >= 12 ke kanan).
       */
      if (t.closest('input, textarea, select, button, a, label, .cetak-menu, .nav, .konfirmasi-lapis')) return;
      /*
       * Sisa seleksi teks dari gestur sebelumnya bisa membuat browser memulai drag bawaan lalu
       * mengirim `pointercancel` (geseran ke-2 dst jadi tidak pernah selesai) — lihat jebakan #47.
       */
      try { const s = document.getSelection(); if (s && s.removeAllRanges) s.removeAllRanges(); } catch (e) { /* diamkan */ }
      geser = { x: ev.clientX, y: ev.clientY, dx: 0, jalan: false };
    });
    document.addEventListener('pointermove', (ev) => {
      if (!geser) return;
      const dx = ev.clientX - geser.x;
      const dy = ev.clientY - geser.y;
      if (!geser.jalan) {
        if (dx < 12) return;
        if (Math.abs(dy) > Math.abs(dx)) { geser = null; return; }
        geser.jalan = true;
      }
      geser.dx = dx;
      if (dx >= AMBANG) pillTampil('Lepaskan: pilih pindah halaman', true);
      else pillTampil('Geser ke kanan untuk pindah halaman', false);
    });
    ['pointerup', 'pointercancel'].forEach((namaEv) => {
      document.addEventListener(namaEv, () => {
        if (!geser) return;
        const cukup = geser.dx >= AMBANG;
        geser = null;
        pillSembunyi();
        if (cukup) tanya();
      }, true);
    });
  }

  window.SC = { base: BASE, toast, flash, pasang, konfirmasi, pilih, geserHalaman, segarkanBaris: segarkanSemuaBaris };

  /* ---- menu utama (tiga garis / logo): berisi tautan halaman + tombol login & keluar ---- */
  /* ---- menu tiga garis (pojok kanan): Dasbor + menu kotak + Setting ---- */
  /* ---- logo (kiri): keterangan "Masuk sebagai" + Keluar ---- */
  (function pasangMenu() {
    const nav = document.getElementById('menuUtama');
    const burger = document.getElementById('btnMenu');
    if (!nav) return;

    const navSet = document.getElementById('menuSetting');

    /** Buka/tutup menu pojok kanan atas. `buka=false` menutupnya (submenu Setting ikut direset). */
    function setel(buka) {
      nav.classList.toggle('terbuka', buka);
      if (burger) {
        burger.setAttribute('aria-expanded', buka ? 'true' : 'false');
        burger.setAttribute('aria-label', buka ? 'Tutup menu' : 'Buka menu');
      }
      if (!buka && navSet) {
        navSet.classList.remove('terbuka');
        nav.querySelectorAll('[data-setting-buka]').forEach((t) => t.setAttribute('aria-expanded', 'false'));
      }
    }

    if (burger) {
      burger.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setel(!nav.classList.contains('terbuka'));
      });
    }
    document.addEventListener('click', (ev) => {
      if (!nav.contains(ev.target)) setel(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.keyCode === 27) setel(false);
    });

    /* kotak Setting membuka submenu di bawahnya (Customize Tema · Kelola Nama Sales · Petugas) */
    nav.querySelectorAll('[data-setting-buka]').forEach((t) => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const hidup = navSet && !navSet.classList.contains('terbuka');
        if (navSet) navSet.classList.toggle('terbuka', hidup);
        t.setAttribute('aria-expanded', hidup ? 'true' : 'false');
      });
    });

    setel(false);
  })();

  /* ---- menu baris (garis tiga): opsinya dipindah ke <body> agar SELALU terlihat utuh ---- */
  (function pasangMenuBaris() {
    // daftar menu dikumpulkan sekali (menu-nya dipindah ke <body> saat dibuka)
    const daftar = Array.from(document.querySelectorAll('[data-ttk]'))
      .map((box) => ({ box, tombol: box.querySelector('[data-ttk-buka]'), menu: box.querySelector('[data-ttk-menu]'), induk: null }))
      .filter((x) => x.tombol && x.menu);
    if (!daftar.length) return;

    function tempatkan(x) {
      const r = x.tombol.getBoundingClientRect();
      const batas = 10;
      const lebar = x.menu.offsetWidth || 268;
      const tinggi = Math.min(x.menu.offsetHeight || 280, window.innerHeight - batas * 2);
      let kiri = r.right - lebar;                                  // rata kanan tombol
      if (kiri + lebar > window.innerWidth - batas) kiri = window.innerWidth - batas - lebar;
      if (kiri < batas) kiri = batas;
      let atas = r.bottom + 6;
      if (atas + tinggi > window.innerHeight - batas) {
        const diAtas = r.top - tinggi - 6;
        atas = diAtas >= batas ? diAtas : window.innerHeight - batas - tinggi;
      }
      if (atas < batas) atas = batas;
      x.menu.style.left = Math.round(kiri) + 'px';
      x.menu.style.top = Math.round(atas) + 'px';
      // tinggi mengikuti jumlah opsi, tapi tidak melebihi ruang yang tersisa di layar
      x.menu.style.maxHeight = Math.round(window.innerHeight - atas - batas) + 'px';
    }

    let abaikanScrollSampai = 0;

    function buka(x) {
      if (!x.induk) x.induk = x.menu.parentElement;
      x.menu.classList.add('melayang', 'terbuka');
      document.body.appendChild(x.menu);
      tempatkan(x);
      x.tombol.setAttribute('aria-expanded', 'true');
      // scroll yang dipicu oleh klik itu sendiri (browser menggulir tombol ke tampilan)
      // jangan langsung menutup menu yang baru dibuka
      abaikanScrollSampai = Date.now() + 250;
    }

    function tutup(x) {
      x.menu.classList.remove('terbuka', 'melayang');
      x.menu.style.left = '';
      x.menu.style.top = '';
      x.menu.style.maxHeight = '';
      if (x.induk && x.menu.parentElement !== x.induk) x.induk.appendChild(x.menu);
      x.tombol.setAttribute('aria-expanded', 'false');
    }

    function tutupSemua(kecuali) {
      daftar.forEach((x) => { if (x !== kecuali && x.menu.classList.contains('terbuka')) tutup(x); });
    }

    document.addEventListener('click', (ev) => {
      const tombol = ev.target.closest('[data-ttk-buka]');
      if (tombol) {
        ev.preventDefault();
        ev.stopPropagation();
        const x = daftar.find((d) => d.tombol === tombol);
        if (!x) return;
        const bukaIni = !x.menu.classList.contains('terbuka');
        tutupSemua(x);
        if (bukaIni) buka(x); else tutup(x);
        return;
      }
      if (!ev.target.closest('[data-ttk-menu]')) tutupSemua(null);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.keyCode === 27) tutupSemua(null);
    });
    window.addEventListener('resize', () => tutupSemua(null));
    window.addEventListener('scroll', () => {
      if (Date.now() < abaikanScrollSampai) return;
      tutupSemua(null);
    }, true);

    /*
     * Dipakai handler konfirmasi bertema: menu baris dipindah ke <body> dengan `position: fixed`
     * (z-index 340), jadi kalau tetap terbuka ia MENUTUPI dialog konfirmasi — keluhan user: "saat pilih
     * hapus, pop up persetujuan terhalang". Menu ditutup dulu sebelum dialognya muncul.
     */
    window.SC = window.SC || {};
    window.SC.tutupMenuBaris = () => tutupSemua(null);
  })();

  /* ---- konfirmasi bertema untuk tombol mana pun: [data-konfirmasi-tema] ---- */
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-konfirmasi-tema]');
    if (!b) return;
    ev.preventDefault();
    // tutup menu baris / menu melayang lain dulu supaya dialog konfirmasi TIDAK terhalang
    // (`window.SC.tutupMenuBaris` diekspos pasangMenuBaris; menu lain menutup sendiri lewat klik luar)
    if (window.SC && typeof window.SC.tutupMenuBaris === 'function') window.SC.tutupMenuBaris();
    const form = b.closest('form');
    const jalan = () => {
      if (form) {
        /*
         * Tombol yang memakai `formaction` menuju alamat LAIN, sedangkan `form.submit()` selalu memakai
         * atribut `action` form-nya dan mengabaikan `formaction` (jebakan #27). Jadi alamat tombolnya
         * dipindahkan dulu ke atribut `action` form sebelum dikirim — ini yang membuat tombol
         * "Kunci Rekap & Buat Surat Jalan" (formaction) dan "Simpan Hitungan" (action form) bisa
         * berdampingan di SATU form.
         */
        if (b.hasAttribute('formaction') && b.formAction) form.setAttribute('action', b.formAction);
        // form.submit() tidak mengirim tombol yang diklik → suntikkan name/value-nya sebagai hidden input
        if (b.name && form.querySelector('input[type=hidden][data-dari-tombol]') === null) {
          const h = document.createElement('input');
          h.type = 'hidden';
          h.name = b.name;
          h.value = b.value;
          h.setAttribute('data-dari-tombol', '1');
          form.appendChild(h);
        }
        /*
         * `form.submit()` TIDAK memicu event `submit`, padahal sebagian halaman memakainya untuk
         * menyiapkan data sebelum dikirim (halaman rekap mengosongkan kolom Setoran yang masih dihitung
         * otomatis supaya tersimpan NULL, bukan angka). Karena itu event-nya dijalankan sendiri lebih
         * dulu; kalau ada listener yang menolak (preventDefault), pengiriman dibatalkan.
         */
        if (typeof Event === 'function') {
          const ev = new Event('submit', { cancelable: true, bubbles: true });
          if (!form.dispatchEvent(ev)) return;
        }
        form.submit();
      } else if (b.dataset.href) {
        location.href = b.dataset.href;
      }
    };
    if (typeof window.SC.konfirmasi !== 'function') { jalan(); return; }
    window.SC.konfirmasi({
      judul: b.dataset.judul || 'Konfirmasi',
      pesan: b.dataset.pesan || '',
      ok: b.dataset.ok || 'Lanjutkan',
      batal: b.dataset.batal || 'Batal',
    }).then((ya) => { if (ya) jalan(); });
  });

  /**
   * Letakkan panel melayang (filter tanggal / filter laporan) supaya SELALU masuk layar.
   * Desktop: diposisikan fixed di bawah tombol, digeser (clamp) agar tidak keluar ke samping.
   * ≤760px: biarkan CSS (sheet bawah) yang mengatur.
   */
  window.SC.letakkanPanel = function (panel, tombol) {
    if (!panel) return;
    const bersihkan = () => {
      panel.style.position = '';
      panel.style.left = '';
      panel.style.top = '';
      panel.style.right = '';
      panel.style.bottom = '';
      panel.style.width = '';
      panel.style.maxHeight = '';
      panel.style.overflowY = '';
    };
    // Panel dipindah ke <body>: kartu punya `backdrop-filter` sehingga `position: fixed` di dalamnya
    // mengikuti kartu (bukan layar) → posisi panel jadi ngawur. Di <body> fixed kembali ke viewport.
    if (!panel.__induk) panel.__induk = panel.parentElement;
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
    // selalu jadi dropdown yang menempel tombol (bukan sheet bawah), lalu dijepit agar masuk layar
    panel.style.position = 'fixed';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = '';
    const lebar = Math.min(panel.offsetWidth || 340, window.innerWidth - 16);
    panel.style.width = lebar + 'px';
    panel.style.maxHeight = '';
    const a = tombol.getBoundingClientRect();
    let kiri = a.right - lebar;
    kiri = Math.max(8, Math.min(kiri, window.innerWidth - lebar - 8));
    let atas = a.bottom + 8;
    const tinggi = panel.offsetHeight;
    if (atas + tinggi > window.innerHeight - 8) {
      const diAtas = a.top - tinggi - 8;
      atas = diAtas >= 8 ? diAtas : Math.max(8, window.innerHeight - 8 - tinggi);
    }
    panel.style.left = Math.round(kiri) + 'px';
    panel.style.top = Math.round(atas) + 'px';
    panel.style.maxHeight = Math.max(140, window.innerHeight - atas - 8) + 'px';
    panel.style.overflowY = 'auto';
  };

  /** Kembalikan panel ke tempat asalnya + bersihkan gaya inline (saat panel ditutup). */
  window.SC.sembunyikanPanel = function (panel) {
    if (!panel) return;
    ['position', 'left', 'top', 'right', 'bottom', 'width', 'maxHeight', 'overflowY'].forEach((k) => { panel.style[k] = ''; });
    if (panel.__induk && panel.parentElement !== panel.__induk) panel.__induk.appendChild(panel);
  };

  /* ---- filter tanggal: tombol kalender, panel muncul setelah diklik ---- */
  (function pasangKalender() {
    const daftar = Array.from(document.querySelectorAll('[data-kalender]')).map((box) => ({
      box, tombol: box.querySelector('[data-kalender-buka]'), panel: box.querySelector('[data-kalender-panel]'),
    })).filter((x) => x.tombol && x.panel);
    if (!daftar.length) return;

    function tutupSatu(x) {
      if (!x || x.panel.hidden) return;
      x.panel.hidden = true;
      window.SC.sembunyikanPanel(x.panel);
      x.tombol.setAttribute('aria-expanded', 'false');
      x.tombol.classList.remove('aktif');
      const kartu = x.box.closest('.card');
      if (kartu) kartu.classList.remove('kartu-atas');
    }
    function tutupSemua() { daftar.forEach(tutupSatu); }

    document.addEventListener('click', (ev) => {
      const tombol = ev.target.closest('[data-kalender-buka]');
      if (tombol) {
        ev.preventDefault();
        const x = daftar.find((d) => d.tombol === tombol);
        if (!x) return;
        const buka = x.panel.hidden;
        tutupSemua();
        if (!buka) return;
        x.panel.hidden = false;
        window.SC.letakkanPanel(x.panel, x.tombol);
        x.tombol.setAttribute('aria-expanded', 'true');
        x.tombol.classList.add('aktif');
        const kartu = x.box.closest('.card');
        if (kartu) kartu.classList.add('kartu-atas');
        const inp = x.panel.querySelector('input[type=date]');
        if (inp && !inp.value && window.innerWidth > 760) setTimeout(() => inp.focus(), 40);
        return;
      }
      // klik di dalam panel jangan menutup panel
      if (ev.target.closest('[data-kalender-panel]')) return;
      tutupSemua();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.keyCode === 27) tutupSemua();
    });
  })();

  /* ---- SEMUA CETAK = PDF: buka berkas PDF di TAB BARU (dengan cadangan) ----
   * Permintaan user: "Semua cetak dokumen laporan digabung ke cetak PDF, langsung cetak PDF saja,
   * 1 ikon" + pilihan user "PDF-nya terbuka di tab baru untuk dilihat/dicetak dari penampil PDF".
   *
   * Setiap tautan/opsi cetak PDF diberi penanda `data-pdf-buka` (lihat views/cetak.js & views/*.js).
   * Kenapa lewat JavaScript, bukan sekadar `target="_blank"`: di mode aplikasi terpasang (PWA) dan
   * WebView di dalam aplikasi chat, tab baru DIBLOKIR diam-diam sehingga tombolnya terlihat rusak
   * (jebakan nyata revisi ke-81/ke-82). Kalau tab baru tidak bisa dibuka, berkas PDF-nya dibuka di tab
   * yang sedang dipakai — pengguna tetap melihat dokumennya dan bisa kembali dengan tombol Back.
   */
  (function pasangPdfBuka() {
    document.addEventListener('click', (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest('[data-pdf-buka]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href) return;
      ev.preventDefault();
      let jendela = null;
      try { jendela = window.open(href, '_blank'); } catch (e) { jendela = null; }
      if (!jendela) window.location.href = href;      // tab baru diblokir → buka di tab ini
    });
  })();

  /* ---- KLIK BARIS DASBOR & LAPORAN = BUKA LAPORAN PERJALANAN ----
   * Permintaan user: "Tombol overview di dasbor dan laporan hapus, fungsinya pindah ke klik baris
   * laporannya". Baris tabel dasbor (`#tblPerjalanan`) & laporan (`#tblLaporan`) membawa atribut
   * `data-baris-open` (lihat `attrBarisKlik()` di views/menu-baris.js); klik di baris itu membuka
   * alamatnya — laporan perjalanan (`/sesi/:id/overview`), atau halaman perjalanannya untuk surat jalan
   * yang masih draft (`/sesi/:id`).
   *
   * Yang harus dijaga (kalau tidak, menu baris & tombol lain jadi mati):
   *  - klik pada elemen yang punya aksi sendiri DIIABAIKAN (tombol menu garis tiga, tautan, input,
   *    tombol cetak, tombol hapus, dsb.);
   *  - klik setelah MENGGESER (memilih teks / menggeser daftar) tidak dihitung sebagai klik baris —
   *    posisi pointer saat menekan dibandingkan dengan posisi saat klik (selisih > 8 px = geser);
   *  - hanya klik KIRI tanpa tombol pengubah (Ctrl/Cmd/Shift/Alt) yang membuka halaman;
   *  - Enter/Spasi pada baris yang sedang fokus juga membuka (barisnya `tabindex="0"`), supaya
   *    fungsinya tetap terjangkau tanpa tetikus.
   */
  (function pasangKlikBaris() {
    const ABAIKAN =
      'a, button, input, select, textarea, label, summary, [data-ttk], [data-ttk-menu], [data-cetak], [data-cetak-menu], .ttk-menu, .cetak-menu, [data-audit-baris]';
    let turun = null;

    function alamatBaris(ev) {
      if (ev.defaultPrevented) return '';
      if (ev.button !== 0) return '';                                        // klik kiri saja
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return '';   // jangan bajak Ctrl+klik
      const el = ev.target;
      if (!el || !el.closest) return '';
      const tr = el.closest('[data-baris-open]');
      if (!tr) return '';
      if (el.closest(ABAIKAN)) return '';
      if (turun && (Math.abs(ev.clientX - turun.x) > 8 || Math.abs(ev.clientY - turun.y) > 8)) return '';
      return tr.getAttribute('data-baris-open') || '';
    }

    document.addEventListener('pointerdown', (ev) => { turun = { x: ev.clientX, y: ev.clientY }; }, true);
    document.addEventListener('click', (ev) => {
      const url = alamatBaris(ev);
      if (url) window.location.href = url;
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const tr = ev.target && ev.target.closest ? ev.target.closest('[data-baris-open]') : null;
      if (!tr || ev.target !== tr) return;   // hanya saat BARIS-nya sendiri yang sedang fokus
      ev.preventDefault();
      window.location.href = tr.getAttribute('data-baris-open');
    });
  })();

  /* ---- RIWAYAT PERUBAHAN (halaman audit): klik baris = buka/tutup rinciannya ----
   * Permintaan user: "di kolom riwayat cukup tampilkan waktu, petugas dan aksi, untuk rinciannya bisa
   * muncul dibawahnya jika di klik baris info perubahan, di klik lagi untuk meng hide". Rinciannya ada
   * di `<tr class="audit-rinci" hidden>` tepat di bawah barisnya; klik baris = tampil, klik lagi =
   * tersembunyi. Tidak ada teks "klik untuk lihat" — penandanya cuma panah kecil di kolom Aksi (CSS).
   */
  /*
   * ---- POPUP "SELESAI — KUNCI & SIMPAN" di halaman BARANG TAMBAHAN (permintaan user revisi ke-156) ----
   * Permintaan user: "Pindah tombol simpan dan koreksi di kanan, dan ubah namanya ke selesai, dan fungsinya
   * berubah, tidak langsung mengunci imputan, hanya menampilkan pop up, tombol kunci dan simpan berada di
   * pop up, jadi yang tampil di pop up masih bisa di ubah".
   *
   * Jadi tombol kanan **Selesai** tidak mengirim formulir — ia hanya membuka popup `#popupKunci` yang
   * isinya dibangun dari nilai yang SEDANG terisi (daftar barang + kolom JUMLAH yang masih bisa diubah +
   * baris Total). Penginputan baru dibuat & dikunci setelah tombol **Kunci & Simpan** di dalam popup
   * dikirim (formulir `#formKunci`, `_aksi=kunci`, kolom `kunci_<itemId>`). Popup bisa ditutup lewat
   * "Kembali ubah", tombol ×, klik latar, atau `Esc` — tanpa mengubah apa pun.
   */
  (function pasangPopupKunci() {
    const lapis = document.getElementById('popupKunci');
    const btn = document.getElementById('btnSelesai');
    if (!lapis || !btn) return;
    const body = document.getElementById('bodyKunci');
    const total = document.getElementById('totalKunci');
    const sumber = document.getElementById('sumberKunci');

    const nilai = (inp) => parseInt(inp && inp.value, 10) || 0;
    const esc = (v) =>
      String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const namaBaris = (tr) => {
      const nm = tr.querySelector('.nm');
      return nm ? nm.textContent.trim() : String(tr.getAttribute('data-kode') || '');
    };
    const hitungTotal = () => {
      let t = 0;
      body.querySelectorAll('input[data-kunci-qty]').forEach((i) => { t += nilai(i); });
      if (total) total.textContent = String(t);
      return t;
    };
    const isi = () => {
      const pilih = document.getElementById('sumberAmbil');
      if (sumber && pilih) sumber.value = pilih.value;   // sumber yang dipilih ikut terkirim
      const dipakai = Array.from(document.querySelectorAll('#bodyBarang tr.barang')).filter((tr) => {
        if (tr.classList.contains('dibuang')) return false;
        return nilai(tr.querySelector('[data-qty]')) > 0;
      });
      body.innerHTML = dipakai.length
        ? dipakai
            .map((tr, n) => {
              const q = nilai(tr.querySelector('[data-qty]'));
              const nm = namaBaris(tr);
              return '<tr><td class="num-no">' + (n + 1) + '</td><td>' + esc(nm) + '</td>' +
                '<td class="num-jml num"><input type="number" min="0" inputmode="numeric" name="kunci_' + esc(tr.getAttribute('data-id')) +
                '" value="' + q + '" data-kunci-qty aria-label="Jumlah ' + esc(nm) + '"></td></tr>';
            })
            .join('')
        : '<tr><td colspan="3" class="kosong">Belum ada jumlah barang yang diisi.</td></tr>';
      hitungTotal();
    };
    const buka = (ya) => {
      if (ya) isi();
      lapis.hidden = !ya;
      btn.setAttribute('aria-expanded', ya ? 'true' : 'false');
    };
    btn.addEventListener('click', () => buka(true));
    lapis.addEventListener('input', (ev) => {
      if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-kunci-qty')) hitungTotal();
    });
    lapis.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t === lapis) { buka(false); return; }          // klik latar = kembali mengubah
      if (t && t.closest && t.closest('[data-popup-tutup]')) buka(false);
    });
    document.addEventListener('keydown', (ev) => {
      if (!lapis.hidden && (ev.key === 'Escape' || ev.keyCode === 27)) buka(false);
    });
  })();

  /*
   * ---- REKAP STOK: pilih barang + hitung Selisih (permintaan user) ----
   * Permintaan user (revisi ke-160): "Pindah aksinya ke garis 3, rekap stok, jangan langsung tampilkan
   * semua stok, tapi stok yang dipilih, ada ikon pilih barang".
   *
   * Halaman `/rekap-stok` karena itu menampilkan **satu barang** (yang dipilih) dan punya panel
   * "Pilih barang". Panelnya elemen `<details>` (sudah bisa dibuka TANPA JavaScript) — di sini hanya
   * ditambah: kotak cari yang menyaring daftar, menutup saat klik di luar / `Esc`, dan menggulung daftar
   * ke barang yang sedang dipilih supaya langsung terlihat.
   *
   * Kolom **Selisih** = **Stok di Sales + Stok Fisik - Stok Kledo** (permintaan user revisi ke-161),
   * di mana "Stok di Sales" = jumlah seluruh kolom sales baris itu (atribut `data-total-sales` dari
   * server). Dihitung ulang setiap kali kotak isian berubah dan
   * **TIDAK disimpan** (permintaan user: cukup diisi & dilihat di layar) — jadi tidak ada satu pun
   * permintaan ke server. Selisih yang bukan 0 diberi tanda merah, sel yang masih kosong ditulis garis
   * datar supaya jelas belum dihitung.
   */
  (function pasangRekapStok() {
    const tabel = document.getElementById('tblStok');
    const panel = document.querySelector('[data-pilih-panel]');
    const detail = document.getElementById('pilihBarang');
    const cari = document.querySelector('[data-pilih-cari]');

    /* ---- kolom Selisih (hanya ada kalau ada barang yang dipilih) ---- */
    if (tabel) {
      const angkaIsian = (inp) => {
        const v = parseInt(inp && inp.value, 10);
        return isNaN(v) ? null : v;
      };
      function segarkanSelisih(tr) {
        const sel = tr.querySelector('[data-selisih]');
        if (!sel) return;
        const sales = parseInt(tr.getAttribute('data-total-sales'), 10) || 0;
        const fisik = angkaIsian(tr.querySelector('[data-fisik]'));
        const kledo = angkaIsian(tr.querySelector('[data-kledo]'));
        if (fisik === null && kledo === null) {
          sel.textContent = '\u2014';
          sel.classList.remove('ada-selisih');
          return;
        }
        // Selisih = Stok di Sales + Stok Fisik - Stok Kledo (permintaan user)
        // Selisih = Stok di Sales + Stok Fisik - Stok Kledo (permintaan user)
        const beda = sales + (fisik || 0) - (kledo || 0);
        sel.textContent = String(beda);
        sel.classList.toggle('ada-selisih', beda !== 0);
      }
      tabel.addEventListener('input', (ev) => {
        const inp = ev.target;
        if (!inp || !inp.hasAttribute) return;
        if (!inp.hasAttribute('data-fisik') && !inp.hasAttribute('data-kledo')) return;
        const tr = inp.closest('tr');
        if (tr) segarkanSelisih(tr);
      });
      /*
       * Tombol **Fix** (permintaan user revisi ke-162) mengirim formulir `#formFix` berisi Stok Fisik &
       * Stok Kledo yang sedang diisi; server menghitung ulang Stok di Sales & Selisih lalu menyimpannya
       * sebagai hasil rekap. Tombolnya dinonaktifkan selama salah satu kolom isian masih kosong supaya
       * petugas tahu harus mengisi dulu — pesannya sama dengan yang diperiksa server.
       */
      const btnFix = document.getElementById('btnFix');
      if (btnFix) {
        const adaIsi = () => {
          const f = tabel.querySelector('[data-fisik]');
          const k = tabel.querySelector('[data-kledo]');
          const isi = (i) => String((i && i.value) || '').trim() !== '';
          return isi(f) || isi(k);
        };
        const jaga = () => {
          btnFix.disabled = !adaIsi();
          btnFix.title = btnFix.disabled ? 'Isi Stok Fisik atau Stok Kledo dulu' : 'Simpan hasil rekap ini';
        };
        jaga();
        tabel.addEventListener('input', jaga);
      }
      /*
       * Kepala tabelnya DUA baris (kelompok kolom di atas, nama sales di bawah) dan keduanya `sticky`.
       * Dua baris sticky butuh posisi `top` yang berbeda — nilai baris pertama diukur di sini supaya baris
       * kedua menempel TEPAT di bawahnya (tanpa pengukuran, keduanya menempel di 0 dan saling menumpuk).
       * Diukur ulang saat ukuran jendela berubah karena tinggi baris ikut ukuran huruf (Customize Tema).
       */
      function aturKepala() {
        const barisKepala = tabel.tHead && tabel.tHead.rows[0];
        if (!barisKepala || !barisKepala.cells.length) return;
        const tinggi = Math.ceil(barisKepala.getBoundingClientRect().height);
        if (tinggi > 0) tabel.style.setProperty('--tbl-stok-kepala', tinggi + 'px');
      }
      aturKepala();
      window.addEventListener('resize', aturKepala);
    }

    /* ---- panel "Pilih barang" ---- */
    if (!panel || !detail) return;
    const item = () => Array.from(panel.querySelectorAll('[data-pilih-item]'));
    const info = document.getElementById('infoPilihBarang');

    /** Saring daftar barang dengan kata kunci (nama + kode). */
    function saring() {
      const kata = ((cari && cari.value) || '').trim().toLowerCase();
      let tampil = 0;
      item().forEach((a) => {
        const cocok = !kata || String(a.dataset.cari || '').indexOf(kata) >= 0;
        a.hidden = !cocok;
        if (cocok) tampil += 1;
      });
      if (info) info.textContent = kata ? `${tampil} barang cocok` : `${tampil} barang`;
    }
    if (cari) {
      cari.addEventListener('input', saring);
      /*
       * Enter di kotak cari = memilih hasil PERTAMA (perilaku yang sama dengan kotak cari layar input).
       * Tanpa ini Enter mengirim formulir/me-reload halaman dan pilihan pengguna hilang.
       */
      cari.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' && ev.keyCode !== 13) return;
        ev.preventDefault();
        const pertama = item().find((a) => !a.hidden);
        if (pertama) location.href = pertama.getAttribute('href');
      });
    }
    // nyalakan pencarian saat panel dibuka (tanpa harus mengklik kotaknya dulu)
    detail.addEventListener('toggle', () => {
      if (!detail.open) return;
      if (cari) { cari.value = ''; saring(); cari.focus(); }
      const aktif = panel.querySelector('[data-pilih-item].aktif');
      if (aktif && aktif.scrollIntoView) aktif.scrollIntoView({ block: 'center' });
    });
    // tutup: tombol × atau klik di luar panel
    panel.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('[data-pilih-tutup]')) detail.open = false;
    });
    document.addEventListener('click', (ev) => {
      if (!detail.open) return;
      if (ev.target.closest && ev.target.closest('#pilihBarang')) return;
      detail.open = false;
    });
    document.addEventListener('keydown', (ev) => {
      if (detail.open && (ev.key === 'Escape' || ev.keyCode === 27)) detail.open = false;
    });
  })();

  /*
   * ---- RINCIAN BARIS DIKELUARKAN DENGAN KLIK BARIS (permintaan user revisi ke-152) ----
   * "lihat rincian hapus, cukup klik baris untuk memunculkan rincian, tidak usah keterangan klik baris
   *  untuk melihat rincian" → di kartu Ekspedisi Barang, baris penginputan (`[data-rinci-baris]`) melepas
   * baris rincian (`[data-rinci-detail]`, `hidden` sejak dirender) saat DIKLIK; diklik lagi = tertutup.
   * Tidak ada tulisan petunjuk apa pun di layar — penandanya hanya panah kecil di kolom angka (CSS).
   * Polanya sama dengan baris riwayat di halaman Audit (`data-audit-baris`), termasuk dukungan keyboard
   * (barisnya `tabindex="0"` + `role="button"`).
   */
  (function pasangRinciBaris() {
    const ABAIKAN = 'a, button, input, select, textarea, label, summary, [data-ttk], [data-cetak]';
    function tukar(tr) {
      const id = tr.getAttribute('data-rinci-baris');
      const rinci = id ? document.getElementById(id) : null;
      if (!rinci) return;
      const buka = rinci.hidden;
      rinci.hidden = !buka;
      tr.classList.toggle('terbuka', buka);
      tr.setAttribute('aria-expanded', buka ? 'true' : 'false');
    }
    document.addEventListener('click', (ev) => {
      const el = ev.target;
      if (!el || !el.closest) return;
      if (el.closest(ABAIKAN)) return;                                  // tautan/tombol tetap bekerja sendiri
      const tr = el.closest('[data-rinci-baris]');
      if (tr) tukar(tr);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.keyCode !== 13) return;
      const tr = ev.target && ev.target.closest ? ev.target.closest('[data-rinci-baris]') : null;
      if (!tr) return;
      ev.preventDefault();
      tukar(tr);
    });
  })();

  (function pasangAudit() {
    function tukar(tr) {
      const id = tr.getAttribute('data-audit-baris');
      const rinci = id ? document.getElementById(id) : null;
      if (!rinci) return;
      const buka = rinci.hidden;      // baris tertutup → dibuka
      rinci.hidden = !buka;
      tr.classList.toggle('terbuka', buka);
      tr.setAttribute('aria-expanded', buka ? 'true' : 'false');
    }
    document.addEventListener('click', (ev) => {
      const tr = ev.target.closest ? ev.target.closest('[data-audit-baris]') : null;
      if (tr) tukar(tr);
    });
    // bisa juga lewat keyboard (barisnya fokusabel) supaya tetap ramah aksesibilitas
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ' && ev.keyCode !== 13) return;
      const tr = ev.target && ev.target.closest ? ev.target.closest('[data-audit-baris]') : null;
      if (!tr) return;
      ev.preventDefault();
      tukar(tr);
    });
  })();

  /* ---- geser ke kanan = kembali (permintaan user: pengganti tombol "Kembali") ---- */
  (function pasangGeserKembali() {
    const penanda = document.querySelector('[data-geser-kembali]');
    if (!penanda) return;
    const tujuan = penanda.getAttribute('data-geser-kembali') || '';
    const AMBANG = 110;
    let geser = null;
    let pill = null;

    function pillTampil(teks, siap) {
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'kb-petunjuk';
        pill.id = 'kbKembali';
        document.body.appendChild(pill);
      }
      pill.textContent = teks;
      pill.classList.add('tampil');
      pill.classList.toggle('siap', !!siap);
    }
    function pillSembunyi() { if (pill) pill.classList.remove('tampil', 'siap'); }

    function kembali() {
      pillTampil('Kembali…', true);
      if (window.history.length > 1) window.history.back();
      else if (tujuan) location.href = tujuan;
    }

    document.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      // jangan bentrok dengan tabel yang bisa digeser / kontrol lain
      if (ev.target.closest('input, textarea, select, button, a, label, .tbl-wrap, .cetak-menu, .nav')) return;
      geser = { x: ev.clientX, y: ev.clientY, dx: 0, jalan: false };
    });
    document.addEventListener('pointermove', (ev) => {
      if (!geser) return;
      const dx = ev.clientX - geser.x;
      const dy = ev.clientY - geser.y;
      if (!geser.jalan) {
        if (dx < 12) return;
        if (Math.abs(dy) > Math.abs(dx)) { geser = null; return; }
        geser.jalan = true;
      }
      geser.dx = dx;
      if (dx >= AMBANG) pillTampil('Lepaskan: kembali', true);
      else pillTampil('Geser ke kanan untuk kembali', false);
    });
    ['pointerup', 'pointercancel'].forEach((namaEv) => {
      document.addEventListener(namaEv, () => {
        if (!geser) return;
        const cukup = geser.dx >= AMBANG;
        geser = null;
        pillSembunyi();
        if (cukup) kembali();
      }, true);
    });
  })();

  /* ---- opsi cetak: menu muncul setelah tombol logo printer diklik ---- */
  (function pasangMenuCetak() {
    // menu dipindah ke <body> saat dibuka → simpan referensinya (jangan dicari lewat induk)
    const daftar = Array.from(document.querySelectorAll('[data-cetak]')).map((box) => ({
      box, tombol: box.querySelector('[data-cetak-buka]'), menu: box.querySelector('[data-cetak-menu]'),
    })).filter((x) => x.tombol && x.menu);
    if (!daftar.length) return;

    function tutup(x) {
      if (!x.menu.classList.contains('terbuka')) return;
      x.menu.classList.remove('terbuka');
      window.SC.sembunyikanPanel(x.menu);
      x.tombol.setAttribute('aria-expanded', 'false');
    }
    function tutupSemua(kecuali) {
      daftar.forEach((x) => { if (x !== kecuali) tutup(x); });
    }

    document.addEventListener('click', (ev) => {
      const tombol = ev.target.closest('[data-cetak-buka]');
      if (tombol) {
        ev.preventDefault();
        ev.stopPropagation();
        const x = daftar.find((d) => d.tombol === tombol);
        if (!x) return;
        const buka = !x.menu.classList.contains('terbuka');
        tutupSemua(x);
        if (buka) {
          x.menu.classList.add('terbuka');
          window.SC.letakkanPanel(x.menu, x.tombol);
          x.tombol.setAttribute('aria-expanded', 'true');
        } else {
          tutup(x);
        }
        return;
      }
      if (!ev.target.closest('[data-cetak-menu]')) tutupSemua(null);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' || ev.keyCode === 27) tutupSemua(null);
    });
    window.addEventListener('resize', () => tutupSemua(null));
  })();

  /* ---- pilih nama sales: opsi "nama baru" membuka kolom ketik ---- */
  document.querySelectorAll('[data-pilih-sales]').forEach((sel) => {
    const box = document.querySelector(sel.dataset.pilihSales);
    if (!box) return;
    const inp = box.querySelector('input[type=text]');
    function terapkan(fokus) {
      const baru = sel.value === '__baru__';
      box.hidden = !baru;
      if (inp) {
        inp.required = baru;
        if (baru && fokus) setTimeout(() => inp.focus(), 30);
      }
    }
    sel.addEventListener('change', () => terapkan(true));
    terapkan(false);
  });

  /* ---- pemilih metode penginputan: 1 ikon garis tiga → panel berisi 2 ikon (daftar / scan) ---- */
  function pasangMode(box) {
    const areaSel = box.dataset.modeSwitch;
    const area = areaSel ? document.querySelector(areaSel) : null;
    const elDaftar = box.dataset.fokusDaftar ? document.querySelector(box.dataset.fokusDaftar) : null;
    const elScan = box.dataset.fokusScan ? document.querySelector(box.dataset.fokusScan) : null;
    const wadah = box.closest('[data-mode-pilih]') || box.parentElement;

    /* panel opsi (dibuka oleh ikon garis tiga) — permintaan user: "ikon opsi scan dan mode daftar …
       dikumpulkan ke ikon garis tiga, setelah di klik baru muncul mau pakek scan atau daftar" */
    const tombol = wadah ? wadah.querySelector('[data-mode-buka]') : null;
    const panel = wadah ? wadah.querySelector('[data-mode-panel]') : null;
    function bukaPanel(ke) {
      if (!panel) return;
      const mauBuka = ke === undefined ? panel.hidden : !!ke;
      panel.hidden = !mauBuka;
      if (wadah) wadah.classList.toggle('terbuka', mauBuka);
      if (tombol) tombol.setAttribute('aria-expanded', mauBuka ? 'true' : 'false');
      if (mauBuka && elDaftar) setTimeout(() => elDaftar.focus(), 30);
    }
    window.SC = window.SC || {};
    window.SC.tutupModePanel = function () { bukaPanel(false); };
    if (tombol) {
      tombol.addEventListener('click', (ev) => { ev.stopPropagation(); bukaPanel(); });
      document.addEventListener('click', (ev) => {
        if (panel && !panel.hidden && !ev.target.closest('[data-mode-pilih]')) bukaPanel(false);
      });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && panel && !panel.hidden) bukaPanel(false); });
    }

    function terapkan(nilai, fokuskan) {
      box.querySelectorAll('.mode-opsi').forEach((l) => {
        const r = l.querySelector('input[type=radio]');
        l.classList.toggle('aktif', r && r.value === nilai);
      });
      const target = area || document.body;
      target.classList.toggle('mode-scan', nilai === 'scan');
      target.classList.toggle('mode-daftar', nilai !== 'scan');
      if (fokuskan) {
        const t = nilai === 'scan' ? elScan : elDaftar;
        if (t) setTimeout(() => { t.focus(); if (t.select && nilai === 'scan') t.select(); }, 40);
      }
    }

    box.querySelectorAll('input[type=radio]').forEach((r) =>
      r.addEventListener('change', () => {
        terapkan(r.value, true);
        bukaPanel(false);   // pilihan sudah ditentukan → panel ditutup lagi
        if (r.value === 'scan') toast('Mode scan aktif — arahkan scanner ke barcode barang', 'info');
      })
    );
    const awal = box.querySelector('input[type=radio]:checked');
    // mode default (input biasa) langsung fokus ke kotak cari daftar supaya bisa langsung mengetik nama barang
    terapkan(awal ? awal.value : 'daftar', true);
  }
  document.querySelectorAll('[data-mode-switch]').forEach(pasangMode);

  /* ---- kotak filter/cari: Enter tidak mengirim form, tapi memilih satu baris ---- */
  document.addEventListener('keydown', (ev) => {
    const f = ev.target.closest && ev.target.closest('[data-filter]');
    if (!f || ev.key !== 'Enter') return;
    ev.preventDefault();
    const tabel = document.querySelector(f.dataset.filter);
    if (!tabel) return;
    const terlihat = Array.from(tabel.querySelectorAll('tbody tr')).filter((tr) => tr.style.display !== 'none');
    const kata = f.value.trim().toLowerCase();
    const cocokPersis = terlihat.filter((tr) => (tr.dataset.kode || '').toLowerCase() === kata);
    const kandidat = cocokPersis.length ? cocokPersis : terlihat;
    if (terlihat.length === 1 || kandidat.length === 1) {
      const inp = kandidat[0].querySelector('input[type=number]');
      if (inp) {
        inp.focus();
        inp.select();
        return;
      }
    }
    toast(terlihat.length === 1 || kandidat.length === 1
      ? 'Baris dipilih'
      : 'Untuk menembak barcode, pilih mode "Scan Barcode"', 'info');
  });

  /* ---- scan kamera (kalau browser mendukung BarcodeDetector) ---- */
  window.SC.scanKamera = async function (onKode, tombolId) {
    const tombol = document.getElementById(tombolId);
    if (!('BarcodeDetector' in window)) {
      toast('Browser ini belum mendukung scan kamera. Pakai scanner USB/Bluetooth atau ketik kode manual.', 'err');
      return;
    }
    if (tombol) tombol.disabled = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) {
      toast('Tidak bisa membuka kamera. Pastikan izin kamera diberikan.', 'err');
      if (tombol) tombol.disabled = false;
      return;
    }
    const video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.style.cssText = 'width:100%;max-width:420px;border-radius:14px;margin-top:12px';
    const wrap = document.getElementById('kameraWrap');
    wrap.innerHTML = '';
    wrap.appendChild(video);
    video.srcObject = stream;
    await video.play();
    const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'ean_13', 'code_39'] });
    const timer = setInterval(async () => {
      if (video.readyState < 2) return;
      try {
        const hasil = await det.detect(video);
        if (hasil && hasil.length) {
          onKode(hasil[0].rawValue);
          clearInterval(timer);
          stream.getTracks().forEach((t) => t.stop());
          wrap.innerHTML = '';
          if (tombol) tombol.disabled = false;
        }
      } catch (e) { /* abaikan frame gagal */ }
    }, 400);
  };

  /* ---- Customize Tema: pilihan disimpan di browser ini saja (localStorage) ---- */
  (function pasangTema() {
    const KUNCI = 'sc_tema';
    const AKSEN = [
      { id: 'indigo', label: 'Indigo', c1: '#4f46e5', c2: '#8b5cf6' },
      { id: 'hijau', label: 'Hijau', c1: '#059669', c2: '#10b981' },
      { id: 'biru', label: 'Biru', c1: '#0284c7', c2: '#38bdf8' },
      { id: 'oranye', label: 'Oranye', c1: '#ea580c', c2: '#f59e0b' },
      { id: 'ungu', label: 'Ungu', c1: '#7c3aed', c2: '#a855f7' },
      // permintaan user: "selain warna yang ada buat opsi pilihan warna lain yang cocok dengan logo" —
      // dua warna ini diambil langsung dari logo toko (teal & emas pada logo-mark/logo).
      { id: 'tosca', label: 'Tosca', c1: '#0f7181', c2: '#1fa8bd' },
      { id: 'emas', label: 'Emas', c1: '#9c6d19', c2: '#d6a45e' },
    ];
    // permintaan user: ukuran huruf ada 5 pilihan, yang dipakai sekarang (Normal) di URUTAN TENGAH
    const UKURAN = [
      { id: 'sangat-kecil', label: 'Sangat kecil', p: 0.86 },
      { id: 'kecil', label: 'Kecil', p: 0.93 },
      { id: 'normal', label: 'Normal', p: 1 },
      { id: 'besar', label: 'Besar', p: 1.16 },
      { id: 'sangat-besar', label: 'Sangat besar', p: 1.3 },
    ];
    const BAWAAN = { mode: 'terang', aksen: 'indigo', ukuran: 'normal' };
    let tema = Object.assign({}, BAWAAN);

    /* ---- Customize Tampilan: pilih bagian halaman mana yang tampil & urutannya ---- */
    const KUNCI_TAMPILAN = 'sc_tampilan';
    const HALAMAN = Array.from(document.querySelectorAll('[data-blok-halaman]'));
    let tampilan = {};
    try { tampilan = JSON.parse(localStorage.getItem(KUNCI_TAMPILAN) || '{}') || {}; } catch (e) { /* abaikan */ }

    const blokHalaman = (hal) => Array.from(hal.querySelectorAll('[data-blok]'));
    const setelanHal = (kunci) => tampilan[kunci] || (tampilan[kunci] = { sembunyi: [], urut: [] });
    const simpanTampilan = () => { try { localStorage.setItem(KUNCI_TAMPILAN, JSON.stringify(tampilan)); } catch (e) { /* abaikan */ } };

    /** Urutan blok yang sedang dipakai (blok yang belum pernah diatur mengikuti urutan asli DOM). */
    function blokTerurut(hal) {
      const semua = blokHalaman(hal);
      const nomor = setelanHal(hal.dataset.blokHalaman).urut || [];
      const posisi = (b) => {
        const i = nomor.indexOf(b.dataset.blok);
        return i >= 0 ? i : 1000 + semua.indexOf(b);
      };
      return semua.slice().sort((a, b) => posisi(a) - posisi(b));
    }

    /** Terapkan: sembunyikan blok yang dimatikan + urutkan tiap wadah sesuai setelan. */
    function terapkanTampilan() {
      HALAMAN.forEach((hal) => {
        const set = setelanHal(hal.dataset.blokHalaman);
        blokHalaman(hal).forEach((b) => { b.hidden = (set.sembunyi || []).includes(b.dataset.blok); });
        const urut = set.urut || [];
        Array.from(hal.querySelectorAll('[data-blok-wadah]')).forEach((w) => {
          const anak = Array.from(w.querySelectorAll(':scope > [data-blok]'));
          if (anak.length < 2) return;
          const posisi = (b) => { const i = urut.indexOf(b.dataset.blok); return i >= 0 ? i : 1000 + blokHalaman(hal).indexOf(b); };
          const gaya = getComputedStyle(w).display;
          if (gaya === 'grid' || gaya === 'flex') anak.forEach((b) => { b.style.order = String(posisi(b)); });
          else anak.slice().sort((a, b) => posisi(a) - posisi(b)).forEach((b) => w.appendChild(b));
        });
      });
    }
    terapkanTampilan();

    try { tema = Object.assign(tema, JSON.parse(localStorage.getItem(KUNCI) || '{}') || {}); } catch (e) { /* localStorage bisa diblokir */ }
    if (!AKSEN.some((a) => a.id === tema.aksen)) tema.aksen = BAWAAN.aksen;
    if (tema.mode !== 'gelap') tema.mode = 'terang';
    if (!UKURAN.some((u) => u.id === tema.ukuran)) tema.ukuran = BAWAAN.ukuran;

    function terapkan() {
      const r = document.documentElement;
      r.setAttribute('data-tema', tema.mode === 'gelap' ? 'gelap' : 'terang');
      r.setAttribute('data-aksen', tema.aksen);
      r.setAttribute('data-ukuran', tema.ukuran);
    }
    terapkan();

    function simpan() {
      terapkan();
      try { localStorage.setItem(KUNCI, JSON.stringify(tema)); } catch (e) { /* abaikan */ }
    }

    let lapis = null;
    function pastikan() {
      if (lapis) return lapis;
      lapis = document.createElement('div');
      lapis.className = 'tema-lapis';
      lapis.id = 'temaLapis';
      lapis.hidden = true;
      lapis.innerHTML = `
        <div class="tema-kotak card" role="dialog" aria-modal="true" aria-labelledby="temaJudul">
          <div class="tema-head">
            <h2 id="temaJudul">Customize Tema</h2>
            <button class="tema-tutup" type="button" data-tema-tutup aria-label="Tutup">&times;</button>
          </div>
          <div class="tema-blok">
            <div class="tema-label">Mode tampilan</div>
            <div class="tema-pil">
              <button type="button" data-tema-mode="terang">Terang</button>
              <button type="button" data-tema-mode="gelap">Gelap</button>
            </div>
          </div>
          <div class="tema-blok">
            <div class="tema-label">Warna aksen</div>
            <div class="tema-warna">
              ${AKSEN.map((a) => `<button type="button" data-tema-aksen="${a.id}"><span class="contoh" style="--c1:${a.c1};--c2:${a.c2}"></span>${a.label}</button>`).join('')}
            </div>
          </div>
          <div class="tema-blok">
            <div class="tema-label">Ukuran huruf</div>
            <div class="tema-pil tema-pil-5">
              ${UKURAN.map(
                (u) =>
                  `<button type="button" data-tema-ukuran="${u.id}" aria-label="${u.label}" title="${u.label}"><span class="cth" style="--p:${u.p}">Aa</span><small>${u.label}</small></button>`
              ).join('')}
            </div>
          </div>
          <div class="tema-blok" data-blok-daerah hidden>
            <div class="tema-label">Bagian yang ditampilkan</div>
            <p class="card-hint" style="margin-bottom:8px">Centang bagian yang mau ditampilkan, pakai ↑ ↓ untuk memindahkannya ke atas/bawah.</p>
            <div class="blok-daftar" data-blok-daftar></div>
          </div>
          <div class="tema-aksi">
            <button class="btn btn-ghost btn-sm" type="button" data-tema-reset>Kembalikan bawaan</button>
            <button class="btn btn-primary btn-sm" type="button" data-tema-tutup>Selesai</button>
          </div>
        </div>`;
      document.body.appendChild(lapis);

      lapis.addEventListener('click', (ev) => {
        if (ev.target === lapis || ev.target.closest('[data-tema-tutup]')) return tutup();
        const m = ev.target.closest('[data-tema-mode]');
        if (m) { tema.mode = m.dataset.temaMode; simpan(); return sinkron(); }
        const a = ev.target.closest('[data-tema-aksen]');
        if (a) { tema.aksen = a.dataset.temaAksen; simpan(); return sinkron(); }
        const u = ev.target.closest('[data-tema-ukuran]');
        if (u) { tema.ukuran = u.dataset.temaUkuran; simpan(); return sinkron(); }
        if (ev.target.closest('[data-tema-reset]')) { tema = Object.assign({}, BAWAAN); simpan(); return sinkron(); }
        const naik = ev.target.closest('[data-blok-naik]');
        if (naik) return geserBlok(naik.dataset.blokNaik, 'naik');
        const turun = ev.target.closest('[data-blok-turun]');
        if (turun) return geserBlok(turun.dataset.blokTurun, 'turun');
      });
      lapis.addEventListener('change', (ev) => {
        const c = ev.target.closest('[data-blok-tampil]');
        if (!c || !HALAMAN[0]) return;
        const set = setelanHal(HALAMAN[0].dataset.blokHalaman);
        const sembunyi = new Set(set.sembunyi || []);
        if (c.checked) sembunyi.delete(c.dataset.blokTampil);
        else sembunyi.add(c.dataset.blokTampil);
        set.sembunyi = Array.from(sembunyi);
        simpanTampilan();
        terapkanTampilan();
      });
      return lapis;
    }

    function sinkron() {
      if (!lapis) return;
      lapis.querySelectorAll('[data-tema-mode]').forEach((b) => b.classList.toggle('aktif', b.dataset.temaMode === tema.mode));
      lapis.querySelectorAll('[data-tema-aksen]').forEach((b) => b.classList.toggle('aktif', b.dataset.temaAksen === tema.aksen));
      lapis.querySelectorAll('[data-tema-ukuran]').forEach((b) => b.classList.toggle('aktif', b.dataset.temaUkuran === tema.ukuran));
    }

    /** Isi daftar "Bagian yang ditampilkan" dari blok yang ada di halaman ini. */
    function gambarDaftarBlok() {
      if (!lapis) return;
      const daerah = lapis.querySelector('[data-blok-daerah]');
      const daftar = lapis.querySelector('[data-blok-daftar]');
      const hal = HALAMAN[0];
      if (!daerah || !daftar) return;
      if (!hal) { daerah.hidden = true; return; }
      const set = setelanHal(hal.dataset.blokHalaman);
      const blok = blokTerurut(hal);
      daerah.hidden = false;
      daftar.innerHTML = blok
        .map((b) => {
          const samaInduk = blok.filter((x) => x.parentElement === b.parentElement);
          const urutanInduk = samaInduk.map((x) => blok.indexOf(x));
          const posisi = blok.indexOf(b);
          const bisaNaik = posisi > urutanInduk[0];
          const bisaTurun = posisi < urutanInduk[urutanInduk.length - 1];
          return `<div class="blok-item">
            <label><input type="checkbox" data-blok-tampil="${b.dataset.blok}" ${(set.sembunyi || []).includes(b.dataset.blok) ? '' : 'checked'}>
              <span class="blok-urutan">${blok.indexOf(b) + 1}.</span>
              <span class="blok-nama">${b.dataset.blokNama || b.dataset.blok}</span></label>
            <div class="blok-urut">
              <button type="button" data-blok-naik="${b.dataset.blok}" ${bisaNaik ? '' : 'disabled'} aria-label="Naikkan">↑</button>
              <button type="button" data-blok-turun="${b.dataset.blok}" ${bisaTurun ? '' : 'disabled'} aria-label="Turunkan">↓</button>
            </div>
          </div>`;
        })
        .join('');
    }

    /** Pindahkan satu blok naik/turun (hanya bisa bertukar dengan blok di wadah yang sama). */
    function geserBlok(id, arah) {
      const hal = HALAMAN[0];
      if (!hal) return;
      const set = setelanHal(hal.dataset.blokHalaman);
      const blok = blokTerurut(hal);
      const target = blok.find((b) => b.dataset.blok === id);
      if (!target) return;
      const seinduk = blok.filter((x) => x.parentElement === target.parentElement);
      const i = seinduk.indexOf(target);
      const tukar = seinduk[arah === 'naik' ? i - 1 : i + 1];
      if (!tukar) return;
      const urut = blok.map((b) => b.dataset.blok);
      const a = urut.indexOf(id);
      const b = urut.indexOf(tukar.dataset.blok);
      urut[a] = tukar.dataset.blok;
      urut[b] = id;
      set.urut = urut;
      simpanTampilan();
      terapkanTampilan();
      gambarDaftarBlok();
    }

    function tutupMenuAtas() {
      const nav = document.getElementById('menuUtama');
      if (nav) nav.classList.remove('terbuka');
      const b = document.getElementById('btnMenu');
      if (b) b.setAttribute('aria-expanded', 'false');
      document.querySelectorAll('[data-ttk-menu].terbuka').forEach((m) => m.classList.remove('terbuka'));
      document.querySelectorAll('[data-ttk-buka]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }

    function buka() {
      pastikan().hidden = false;
      sinkron();
      gambarDaftarBlok();
      tutupMenuAtas();
    }
    function tutup() { if (lapis) lapis.hidden = true; }

    document.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-tema-buka]')) { ev.preventDefault(); buka(); }
    });
    document.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Escape' || ev.keyCode === 27) && lapis && !lapis.hidden) tutup();
    });

    window.SC.tema = { kini: () => Object.assign({}, tema), terapkan, buka, tutup };
    window.SC.tampilan = { kini: () => JSON.parse(JSON.stringify(tampilan)), terapkan: terapkanTampilan, reset: () => { tampilan = {}; simpanTampilan(); terapkanTampilan(); } };
  })();

  /* ---- Grafik penjualan per sales (data dari /api/grafik) ---- */
  /*
   * ---- GRAFIK PENJUALAN (dasbor & laporan) ----
   * permintaan user: "grafik tidak usah keterangan, di atas ada total barang terjual secara keseluruhan
   * selama ikut filter, ada grafik penjualan perhari juga, grafik juga ada di laporan, customize bisa
   * memilih memunculkan grafik atau tidak, tombol filter berada di pojok kanan atas kotak lurus dengan
   * judul, grafik penjualan sales memiliki warna yang identik setiap sales".
   *
   * Satu handler memasang SEMUA kartu `[data-grafik]` (dasbor `#grafikPenjualan`, laporan `#grafikLaporan`).
   * Warna batang per sales = `warnaSales(nama)` (hash nama → palet tetap), jadi sales yang sama selalu
   * berwarna sama di grafik per sales MAUPUN di batang harian (yang ditumpuk per sales), di halaman mana pun.
   */
  /* 12 warna tetap (permintaan user: "setidaknya ada 12 warna yang identik") */
  const PALET_SALES = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16', '#6366f1', '#f97316', '#0891b2'];
  /** Escape teks (nama sales berasal dari database) sebelum disisipkan sebagai HTML. */
  function escTeks(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /*
   * Warna tiap sales bisa DIUBAH dari pengaturan grafik (ikon roda gigi) dan disimpan di
   * `localStorage['sc_grafik_warna']` = { "<nama sales>": "#rrggbb" }. Selama belum diubah, warnanya
   * ditentukan otomatis dari hash nama (tetap & sama di semua grafik/halaman).
   */
  let warnaKustom = {};
  try {
    warnaKustom = JSON.parse(localStorage.getItem('sc_grafik_warna') || '{}') || {};
  } catch (e) { warnaKustom = {}; }
  function simpanWarnaKustom() {
    try { localStorage.setItem('sc_grafik_warna', JSON.stringify(warnaKustom)); } catch (e) { /* diabaikan */ }
  }
  function warnaSales(nama) {
    const kunci = String(nama || '').trim();
    if (warnaKustom[kunci]) return warnaKustom[kunci];
    const t = kunci.toLowerCase();
    let h = 0;
    for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) % 100000;
    return PALET_SALES[h % PALET_SALES.length];
  }
  window.SC = window.SC || {};
  window.SC.warnaSales = warnaSales;
  window.SC.paletGrafik = PALET_SALES;

  function pasangGrafik(box) {
    const elList = box.querySelector('[data-grafik-list]');
    const elTotal = box.querySelector('[data-grafik-total]');
    const elHarian = box.querySelector('[data-grafik-harian]');
    const elBarang = box.querySelector('[data-grafik-barang]');
    const elKaki = box.querySelector('[data-grafik-kaki]');
    const elCustom = box.querySelector('[data-grafik-custom]');
    const inDari = box.querySelector('[data-grafik-dari]');
    const inSampai = box.querySelector('[data-grafik-sampai]');
    const elWarna = box.querySelector('[data-grafik-warna]');
    const chips = Array.from(box.querySelectorAll('[data-periode]'));
    const tombolFilter = box.querySelector('[data-grafik-filter]');
    const tombolSetting = box.querySelector('[data-grafik-setting]');
    const panelFilter = box.querySelector('.grafik-panel:not([data-grafik-panel-setelan])');
    const panelSetelan = box.querySelector('[data-grafik-panel-setelan]');
    const pandangan = {};
    Array.from(box.querySelectorAll('[data-grafik-view]')).forEach((v) => { pandangan[v.dataset.grafikView] = v; });
    let mode = 'bulan';   // permintaan user: grafik dasbor otomatis difilter satu bulan
    let dataTerakhir = null;
    let tabAktif = '';    // semua tampilan tersembunyi dulu (permintaan user) sampai kartunya diklik

    const p2 = (n) => String(n).padStart(2, '0');
    const iso = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const angka = (n) => Number(n || 0).toLocaleString('id-ID');
    const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    function tglPendek(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : v || '';
    }
    /** Tanggal saja (dua digit) untuk label sumbu bawah grafik harian, mis. 2026-10-07 → "07". */
    function tglHari(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || ''));
      return m ? m[3] : v || '';
    }
    /** Tulisan periode di bawah grafik: "Grafik bulan Oktober 2026" atau rentang tanggal. */
    function teksPeriode(d) {
      const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.dari || ''));
      const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.sampai || ''));
      if (a && b && a[1] === b[1] && a[2] === b[2]) return 'Grafik bulan ' + BULAN[Number(a[2]) - 1] + ' ' + a[1];
      return 'Grafik periode ' + tglPendek(d.dari) + ' – ' + tglPendek(d.sampai);
    }
    function rentang() {
      const kini = new Date();
      if (mode === 'bulan') return { dari: iso(new Date(kini.getFullYear(), kini.getMonth(), 1)), sampai: iso(kini) };
      if (mode === 'tahun') return { dari: iso(new Date(kini.getFullYear(), 0, 1)), sampai: iso(kini) };
      if (mode === 'custom') {
        const awal = iso(new Date(kini.getFullYear(), kini.getMonth(), 1));
        return { dari: inDari.value || awal, sampai: inSampai.value || iso(kini) };
      }
      return { dari: iso(kini), sampai: iso(kini) };
    }
    /** Batas atas sumbu yang "bulat" supaya gridline enak dibaca. */
    function sumbuBulat(n) {
      const x = Math.max(1, Number(n) || 1);
      const p = Math.pow(10, Math.floor(Math.log10(x)));
      const k = x / p;
      const f = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((v) => v >= k - 1e-9) || 10;
      return f * p;
    }

    /*
     * ---- 1. TABEL JENIS BARANG TERJUAL (permintaan user) ----
     * "saat grafik terjual di klik, menampilkan jenis barang dari yang paling banyak terjual hingga paling
     * sedikit, formatnya no, nama barang, jumlah terjual".
     */
    function gambarBarang(barang) {
      if (!elBarang) return;
      const urut = (barang || []).slice().sort((a, b) => b.qty - a.qty || String(a.nama).localeCompare(String(b.nama)));
      if (!urut.length) {
        elBarang.innerHTML = '<div class="kosong">Belum ada barang terjual pada periode ini.</div>';
        return;
      }
      /*
       * Judul kolom angka = **"pcs"** (permintaan user: "jumlah terjual di grafik ganti ke pcs").
       * Ditulis huruf kecil di sini, tetapi gaya kepala tabel aplikasi (`table.tbl thead th`) memakai
       * `text-transform: uppercase` sehingga tampil sebagai **PCS** — sama seperti kepala lain
       * (NO, NAMA BARANG). Judul pendek ini sekaligus membuat kolomnya makin ramping.
       */
      elBarang.innerHTML = `<table class="tbl tbl-pekat" id="tblBarangTerjual">
        <thead><tr><th class="num-no">NO</th><th>Nama Barang</th><th class="num num-jml">pcs</th></tr></thead>
        <tbody>${urut
          .map(
            (b, i) => `<tr><td class="num-no">${i + 1}</td><td>${escTeks(b.nama)}</td><td class="num num-jml">${angka(b.qty)}</td></tr>`
          )
          .join('')}</tbody>
        <tfoot><tr><td class="num-no"></td><td><b>TOTAL</b></td><td class="num num-jml"><b>${angka(
          urut.reduce((a, b) => a + (Number(b.qty) || 0), 0)
        )}</b></td></tr></tfoot>
      </table>`;
    }

    /** ---- 2. GRAFIK PER SALES: batang mendatar (semua grafik BATANG — pengaturan bentuk dihapus) ---- */
    function gambarSales(daftar, maks, totalSemua) {
      if (!elList) return;
      if (!daftar.length) {
        elList.innerHTML = '<div class="kosong">Belum ada penjualan pada periode ini.</div>';
        return;
      }
      elList.innerHTML = daftar
        .map((s, i) => {
          const porsi = totalSemua > 0 ? Math.round((s.s / totalSemua) * 100) : 0;
          return `<div class="grafik-baris${i < 3 ? ' grafik-top' + (i + 1) : ''}">
          <span class="grafik-urut">${i + 1}</span>
          <span class="grafik-nama" title="${escTeks(s.nama)}">${escTeks(s.nama)}</span>
          <span class="grafik-track">
            <span class="grafik-bar" style="width:${Math.max(2, Math.round((s.s / maks) * 100))}%;background-color:${warnaSales(s.nama)}"></span>
          </span>
          <span class="grafik-nilai">${angka(s.s)}<small>${angka(porsi)}% · ${angka(s.perjalanan)} perjalanan</small></span>
        </div>`;
        })
        .join('');
    }

    /** ---- 3. GRAFIK PER HARI: batang tegak bertumpuk per sales ---- */
    function gambarHarian(hari, skala) {
      if (!elHarian) return;
      if (!hari.length) {
        elHarian.innerHTML = '<div class="kosong">Belum ada penjualan pada periode ini.</div>';
        return;
      }
      const garis = [1, 0.75, 0.5, 0.25, 0].map((p) => `<span class="harian-garis" style="bottom:${p * 100}%"></span>`).join('');
      const label = [1, 0.5, 0].map((p) => `<span class="harian-label" style="bottom:${p * 100}%">${angka(Math.round(skala * p))}</span>`).join('');
      const kolom = hari
        .map(([tgl, v]) => {
          const tng = Math.max(2, Math.round((v.total / (skala || 1)) * 100));
          const rinci = v.bagian
            .slice()
            .sort((a, b) => b.s - a.s)
            .map((b) => `<span class="tip-baris"><i style="background:${warnaSales(b.nama)}"></i>${escTeks(b.nama)}<b>${angka(b.s)}</b></span>`)
            .join('');
          return `<div class="harian-kolom" tabindex="0">
            <div class="harian-slot">
              <div class="harian-batang" style="height:${tng}%">
                ${v.bagian
                  .map((b) => `<span class="harian-bagian" style="flex:${b.s};background-color:${warnaSales(b.nama)}" title="${escTeks(b.nama)}: ${angka(b.s)}"></span>`)
                  .join('')}
              </div>
            </div>
            <span class="harian-tip"><b>${tglPendek(tgl)}</b><span class="tip-total">${angka(v.total)} barang</span>${rinci}</span>
          </div>`;
        })
        .join('');
      const labelTgl = hari.map(([tgl]) => `<span class="harian-tgl-sel">${tglHari(tgl)}</span>`).join('');
      elHarian.innerHTML = `<div class="harian-kisi">
        <div class="harian-sumbu">${label}</div>
        <div class="harian-area">
          <div class="harian-latar">${garis}</div>
          <div class="harian-scroll"><div class="harian-kanvas">
            <div class="harian-batang-baris">${kolom}</div>
            <div class="harian-tgl-baris">${labelTgl}</div>
          </div></div>
        </div>
      </div>`;
    }

    /**
     * Daftar warna per sales di panel pengaturan (permintaan user): nama sales + 12 pilihan warna.
     * Menekan salah satu warna langsung menyimpan & menggambar ulang grafik.
     */
    function gambarPilihanWarna(daftar) {
      if (!elWarna) return;
      if (!daftar.length) {
        elWarna.innerHTML = '<div class="kosong">Belum ada sales pada periode ini.</div>';
        return;
      }
      elWarna.innerHTML = daftar
        .map(
          (s) => `<div class="warna-baris" data-warna-sales="${escTeks(s.nama)}">
        <span class="warna-nama" title="${escTeks(s.nama)}">${escTeks(s.nama)}</span>
        <span class="warna-pil">${PALET_SALES.map(
          (c) =>
            `<button type="button" class="warna-pilir${warnaSales(s.nama).toLowerCase() === c ? ' aktif' : ''}" data-warna="${c}" style="background:${c}" aria-label="Warna ${c} untuk ${escTeks(s.nama)}" title="${c}"></button>`
        ).join('')}</span>
      </div>`
        )
        .join('');
    }

    /** Buka satu tampilan (barang · sales · hari); klik kartu yang sama menutupnya lagi. */
    function bukaTab(nama) {
      const berikut = tabAktif === nama ? '' : nama;
      tabAktif = berikut;
      Object.keys(pandangan).forEach((k) => { pandangan[k].hidden = k !== berikut; });
      Array.from(box.querySelectorAll('[data-grafik-tab]')).forEach((c) => {
        const aktif = c.dataset.grafikTab === berikut;
        c.classList.toggle('aktif', aktif);
        c.setAttribute('aria-expanded', aktif ? 'true' : 'false');
      });
    }

    /*
     * Gambar grafik. Ringkasan angka di ATAS — kartu **Terjual/Sales/Hari** bisa diklik untuk membuka
     * tampilannya (semua tampilan tersembunyi dulu), lalu tulisan periode di dasar kartu.
     */
    function gambar(d) {
      dataTerakhir = d;
      const daftar = (d.sales || []).slice().sort((a, b) => b.s - a.s);
      const maks = Math.max(1, daftar.map((x) => x.s).reduce((a, b) => Math.max(a, b), 0));
      const totalSemua = Number(d.total.s) || 0;
      const barang = d.barang || [];

      const perHari = new Map();
      (d.harian || []).forEach((r) => {
        if (!perHari.has(r.tanggal)) perHari.set(r.tanggal, { total: 0, bagian: [] });
        const h = perHari.get(r.tanggal);
        h.total += Number(r.s) || 0;
        h.bagian.push({ nama: r.nama, s: Number(r.s) || 0 });
      });
      const hari = Array.from(perHari.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const maksHari = hari.map(([, h]) => h.total).reduce((a, b) => Math.max(a, b), 0);
      const skala = sumbuBulat(maksHari);
      const hariAdaJual = hari.filter(([, h]) => h.total > 0).length;
      const rata = hariAdaJual ? Math.round(totalSemua / hariAdaJual) : 0;

      /* kartu ringkasan: Terjual / Sales / Hari bisa diklik (tombol), Rata-rata hanya angka */
      const kartu = (nama, label, nilai, ket, bisaKlik) =>
        bisaKlik
          ? `<button type="button" class="gs-item${nama === 'barang' ? ' gs-utama' : ''}" data-grafik-tab="${nama}" aria-expanded="false" aria-controls="${escTeks(box.id + '-' + nama)}" title="${label}">
        <span class="gs-label">${label}</span><b class="gs-angka">${nilai}</b><span class="gs-ket">${ket}</span>
      </button>`
          : `<span class="gs-item">
        <span class="gs-label">${label}</span><b class="gs-angka">${nilai}</b><span class="gs-ket">${ket}</span>
      </span>`;
      elTotal.innerHTML =
        kartu('barang', 'Terjual', angka(totalSemua), `${angka(d.total.perjalanan)} perjalanan`, true) +
        kartu('sales', 'Sales', angka(daftar.length), 'ada penjualan', true) +
        kartu('hari', 'Hari', angka(hariAdaJual), 'hari ada penjualan', true) +
        kartu('rata', 'Rata-rata', angka(rata), 'barang / hari', false);

      gambarBarang(barang);
      gambarSales(daftar, maks, totalSemua);
      gambarHarian(hari, skala);
      gambarPilihanWarna(daftar);
      if (elKaki) elKaki.textContent = teksPeriode(d);
      bukaTab(tabAktif);   // pertahankan pilihan tab saat data dimuat ulang
    }

    async function muat() {
      const r = rentang();
      elTotal.innerHTML = 'Memuat data…';
      try {
        const res = await fetch(BASE + '/api/grafik?dari=' + encodeURIComponent(r.dari) + '&sampai=' + encodeURIComponent(r.sampai));
        const d = await res.json();
        if (!d.ok) throw new Error('gagal');
        gambar(d);
      } catch (e) {
        if (window.console && console.warn) console.warn('grafik gagal:', e && e.message);
        elTotal.textContent = 'Gagal memuat data grafik. Coba muat ulang halaman.';
        elList.innerHTML = '';
        if (elHarian) elHarian.innerHTML = '';
        if (elBarang) elBarang.innerHTML = '';
        if (elKaki) elKaki.textContent = '';
      }
    }

    /* kartu ringkasan diklik → buka tampilannya (permintaan user) */
    elTotal.addEventListener('click', (ev) => {
      const c = ev.target.closest('[data-grafik-tab]');
      if (!c) return;
      bukaTab(c.dataset.grafikTab);
    });

    /* pilih warna satu sales dari 12 warna yang tersedia (permintaan user) */
    if (elWarna) {
      elWarna.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-warna]');
        if (!b) return;
        const baris = b.closest('[data-warna-sales]');
        if (!baris) return;
        warnaKustom[baris.dataset.warnaSales] = b.dataset.warna;
        simpanWarnaKustom();
        if (dataTerakhir) gambar(dataTerakhir);
      });
    }

    chips.forEach((c) =>
      c.addEventListener('click', () => {
        mode = c.dataset.periode;
        chips.forEach((x) => x.classList.toggle('aktif', x === c));
        elCustom.hidden = mode !== 'custom';
        if (mode === 'custom') {
          const kini = new Date();
          if (!inDari.value) inDari.value = iso(new Date(kini.getFullYear(), kini.getMonth(), 1));
          if (!inSampai.value) inSampai.value = iso(kini);
        }
        muat();
      })
    );
    if (elCustom) {
      elCustom.addEventListener('submit', (ev) => {
        ev.preventDefault();
        mode = 'custom';
        chips.forEach((x) => x.classList.toggle('aktif', x.dataset.periode === 'custom'));
        elCustom.hidden = false;
        muat();
      });
    }

    /* dua panel di pojok kanan: kalender (periode) & roda gigi (warna sales) */
    function setelPanel(panel, tombol, buka) {
      if (!panel || !tombol) return;
      panel.hidden = !buka;
      tombol.setAttribute('aria-expanded', buka ? 'true' : 'false');
    }
    if (tombolFilter && panelFilter) {
      tombolFilter.addEventListener('click', () => {
        const buka = panelFilter.hidden;
        setelPanel(panelSetelan, tombolSetting, false);
        setelPanel(panelFilter, tombolFilter, buka);
      });
    }
    if (tombolSetting && panelSetelan) {
      tombolSetting.addEventListener('click', () => {
        const buka = panelSetelan.hidden;
        setelPanel(panelFilter, tombolFilter, false);
        setelPanel(panelSetelan, tombolSetting, buka);
      });
    }
    // klik di luar kartu / Esc menutup kedua panel
    document.addEventListener('click', (ev) => {
      if (ev.target.closest && ev.target.closest('.kartu-grafik')) return;
      setelPanel(panelFilter, tombolFilter, false);
      setelPanel(panelSetelan, tombolSetting, false);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape' && ev.keyCode !== 27) return;
      setelPanel(panelFilter, tombolFilter, false);
      setelPanel(panelSetelan, tombolSetting, false);
    });

    const awal = chips.find((c) => c.dataset.periode === 'bulan') || chips[0];
    chips.forEach((x) => x.classList.toggle('aktif', x === awal));
    if (elCustom) elCustom.hidden = true;
    muat();
  }
  document.querySelectorAll('[data-grafik]').forEach(pasangGrafik);
})();
