'use strict';
const { esc, angka, setoranEfektif, tanggalPendek } = require('../lib/util');
const { modePilih } = require('./mode');
const { opsiCetak } = require('./cetak');
const { kepalaPerjalanan } = require('./sesi');
const { noSurat } = require('../lib/kode');
const { VERSI_DOKUMEN } = require('../lib/versiDokumen');

/*
 * CATATAN kolom **P** (dulu berlabel "Jual (P)", sekarang cukup "P" — permintaan user "semua keterangan
 * jual (p) ubah ke p saja"): berisi jumlah barang yang dilaporkan TERJUAL oleh sales (diisi di halaman
 * `/sesi/:id/jual`). Hanya-baca di halaman ini, letaknya tepat di samping kolom Setoran (S) dan keduanya
 * memakai kelas `pasangan-sp` (latar tipis yang sama + celah) supaya tampak sebagai pasangan pembanding;
 * selnya ditandai warna oleh skrip di bawah begitu angka S berbeda dengan P.
 *
 * Penjelasan ini SENGAJA ditulis sebagai komentar JS (bukan komentar HTML di dalam baris tabel) karena
 * komentar HTML ikut terkirim ke browser dan bisa menggagalkan pemeriksaan "label lama sudah hilang"
 * (jebakan #30).
 */
exports.render = function ({ sesi, items, base, pesan, scan, hariIni = '', bolehTambah = false, daftarMaster = [] }) {
  const relevan = items.filter((i) => i.b + i.t > 0);
  const totB = relevan.reduce((a, i) => a + i.b, 0);
  const totT = relevan.reduce((a, i) => a + i.t, 0);
  // total kolom P = akumulasi laporan penjualan sales (dipakai baris TOTAL tabel)
  const totP = items.reduce((a, i) => a + (Number(i.p) || 0), 0);
  // total kolom "B Berikutnya": kalau 0, tombol Kunci Rekap TIDAK membuat surat jalan baru (ada peringatan)
  const totNbAwal = items.reduce((a, i) => a + (Number(i.nb) || 0), 0);

  /*
   * permintaan user: "tambahan barang pada rekap penjualan BUKAN untuk membuat barang baru, tapi memilih
   * di master data; barang yang sudah di bawa pada perjalanan yang di rekap tidak muncul lagi".
   * Jadi pilihannya = barang master (belum diarsip) yang BELUM bergerak di perjalanan ini dan belum
   * pernah ditambahkan sebagai barang baru di rekap ini.
   */
  const sudahDipakai = new Set(
    items.filter((i) => Number(i.b) + Number(i.t) + Number(i.k) > 0 || Number(i.baru) === 1).map((i) => Number(i.produk_id))
  );
  const pilihanMaster = daftarMaster.filter((p) => !sudahDipakai.has(Number(p.id)));

  // permintaan user: kolom NO & Kode tidak ditampilkan di form rekap (nama barang dibekukan/di-freeze).
  // Barang yang BARU ditambahkan dari halaman ini (`i.baru`) tetap tampil, tetapi kolom B/T/K/S-nya
  // TERKUNCI (tidak ikut perjalanan yang sedang direkap) — hanya kolom "B Berikutnya" yang bisa diisi.
  const baris = items
    .map((i) => {
      const baru = !!i.baru;
      const ada = i.b + i.t > 0;
      const autoS = i.s === null || i.s === undefined;
      return `<tr id="row_${i.id}" data-id="${i.id}" data-kode="${esc(i.kode)}" data-baru="${baru ? 1 : 0}" data-cari="${esc((i.kode + ' ' + i.nama).toLowerCase())}" class="${ada || baru ? '' : 'sembunyi'}${baru ? ' baris-baru' : ''}">
        <td class="beku"><span class="nm">${esc(i.nama)}</span>${baru ? '<span class="badge b-ungu badge-baru">baru</span>' : ''}</td>
        <td class="num tengah kolom-bt" data-b="${i.b}">${baru ? '&mdash;' : i.b || ''}</td>
        <td class="num tengah kolom-bt" data-t="${i.t}">${baru ? '&mdash;' : i.t || ''}</td>
        <td class="tengah kolom-k">${
          baru
            ? '<span class="kunci-nilai" title="Barang baru — belum ikut perjalanan ini">&mdash;</span>'
            : `<span class="qty">
          <button type="button" data-minus data-target="#k_${i.id}">−</button>
          <input type="number" min="0" name="k_${i.id}" id="k_${i.id}" value="${i.k}" data-k data-b="${i.b}" data-t="${i.t}">
          <button type="button" data-plus data-target="#k_${i.id}">+</button>
        </span>`
        }</td>
        <td class="tengah kolom-s pasangan-sp">${
          baru
            ? '<span class="kunci-nilai">&mdash;</span>'
            : `<input type="number" name="s_${i.id}" id="s_${i.id}" value="${autoS ? '' : i.s}" placeholder="${setoranEfektif(i)}" data-s ${autoS ? 'data-otomatis="1"' : ''}>`
        }</td>
        <td class="tengah kolom-p pasangan-sp" data-p="${Number(i.p) || 0}">${baru ? '&mdash;' : angka(Number(i.p) || 0)}</td>
        <td class="tengah kolom-nb"><span class="qty qty-mini">
          <button type="button" data-minus data-target="#nb_${i.id}">−</button>
          <input type="number" min="0" name="nb_${i.id}" id="nb_${i.id}" value="${i.nb ? i.nb : ''}" data-nb placeholder="0" title="Jumlah barang yang akan dibawa pada surat jalan berikutnya">
          <button type="button" data-plus data-target="#nb_${i.id}">+</button>
        </span></td>
        <td class="num tengah kolom-scan"><span class="badge b-abu" id="scan_${i.id}">0</span></td>
        <td class="tengah kolom-hapus">${
          baru
            ? `<button type="button" class="btn-hapus-baris" data-hapus-baru="${i.id}" title="Hapus ${esc(i.nama)} dari daftar rekap (salah memasukkan)" aria-label="Hapus ${esc(i.nama)} dari daftar rekap"><span class="ikon-hapus">🗑</span></button>`
            : ''
        }</td>
      </tr>`;
    })
    .join('');

  const log = (scan || [])
    .map((s) => `<tr><td class="kode">${esc(s.waktu)}</td><td>${esc(s.hasil)}</td></tr>`)
    .join('');

  /*
   * permintaan user (halaman rekap):
   *  - "jumlah setoran langsung terhitung saat itu juga ketika kolom k di isi" → kolom Setoran (S) ikut
   *    terisi otomatis (B + T − K) setiap kolom K berubah, selama angkanya belum diisi manual.
   *  - "jika k nya lebih banyak dari b ditambah t maka kolomnya akan berwarna merah dan muncul - di depan
   *    angka yang muncul" → kolom K diberi kelas `lebih` (merah) dan kolom Setoran menampilkan angka
   *    negatif (mis. "-2").
   * Nilai setoran yang masih OTOMATIS dikosongkan lagi saat form dikirim, supaya di database tetap
   * tersimpan sebagai NULL (dihitung otomatis) seperti sebelumnya.
   */
  const script = `
<script>
(function(){
  const base = window.APP_BASE || '';
  const salesNama = ${JSON.stringify(String(sesi.sales_nama || ''))};
  // peran read-only (sales) tidak boleh menyimpan → simpan otomatis dimatikan supaya tidak ada status palsu
  const BOLEH_SIMPAN = ${bolehTambah ? 'true' : 'false'};
  /*
   * Penanda merah "S ≠ P" (permintaan user: *"jika kolom s tidak sama dengan p maka kolomnya merah"*)
   * hanya dijalankan kalau perjalanan ini MEMANG punya laporan penjualan (total P > 0). Kalau seluruh P
   * masih 0 (surat jalan lama / sales belum mengisi), setiap baris akan berwarna tanpa guna — sama dengan
   * alasan di views/print.js → bolehBandingP().
   * Warnanya mengikuti ARAH: setoran kurang = MERAH, setoran lebih = HIJAU (keduanya dihitung hidup tiap
   * kolom K diisi, karena mengubah K mengubah setorannya).
   */
  const ADA_PENJUALAN = ${totP > 0 ? 'true' : 'false'};
  function angkainp(inp){ return parseInt(inp && inp.value, 10) || 0; }
  /** Satu baris: hitung setoran otomatis / tandai kelebihan K. */
  function bariskan(tr){
    // barang yang BARU ditambahkan: kolom B/T/K/S-nya terkunci (hanya kolom B Berikutnya yang bisa diisi)
    if (tr.classList.contains('baris-baru')) return { kb: 0, kt: 0, kv: 0, sv: 0, lebih: false };
    const selB = tr.querySelector('td[data-b]');
    const selT = tr.querySelector('td[data-t]');
    const kb = parseInt(selB && selB.dataset.b, 10) || 0;
    const kt = parseInt(selT && selT.dataset.t, 10) || 0;
    const kInp = tr.querySelector('[data-k]');
    const sInp = tr.querySelector('[data-s]');
    const kv = angkainp(kInp);
    const lebih = kv > kb + kt;
    const auto = sInp.hasAttribute('data-otomatis');
    const otomatis = kb + kt - kv;
    if (auto){
      sInp.value = String(otomatis);
      sInp.placeholder = String(Math.max(0, otomatis));
      sInp.classList.add('setoran-auto');
    } else {
      sInp.classList.remove('setoran-auto');
    }
    const tampil = auto ? otomatis : angkainp(sInp);
    kInp.classList.toggle('lebih', lebih);
    sInp.classList.toggle('setoran-negatif', tampil < 0);
    tr.classList.toggle('k-lebih', lebih);
    // kolom P = laporan sales, hanya dibaca (tidak diubah di halaman ini)
    const selP = tr.querySelector('td[data-p]');
    const kp = parseInt(selP && selP.dataset.p, 10) || 0;
    const sv = auto ? Math.max(0, otomatis) : angkainp(sInp);
    /*
     * PENANDA MERAH (permintaan user: *"jika kolom s tidak sama dengan p maka kolomnya merah"*):
     * sel P dan sel Setoran (S) ditandai kelas beda-sp begitu angka S tidak sama dengan P.
     * Dihitung ulang setiap kolom K/S berubah karena fungsi ini dipanggil dari hitung().
     */
    /*
     * Warna sel S & P menurut ARAH selisih (permintaan user: *"jika kolom s tidak sama dengan p maka
     * kolomnya merah"* + *"Jika barang setoran lebih, maka tulisan nya Hijau"*):
     *   - setoran KURANG dari penjualan (sv < kp) → kelas kurang (MERAH);
     *   - setoran LEBIH dari penjualan (sv > kp) → kelas lebih (HIJAU);
     *   - sama → tidak ada penanda.
     * Kelas beda-sp tetap dipasang sebagai penanda umum "S ≠ P" (dipakai skrip uji & CSS dasar).
     */
    const beda = ADA_PENJUALAN && Number(sv) !== Number(kp);
    const arah = beda ? (Number(sv) > Number(kp) ? 'lebih' : 'kurang') : '';
    const selS = sInp.closest('td');
    [selP, selS].forEach(function (td) {
      if (!td) return;
      td.classList.toggle('beda-sp', beda);
      td.classList.toggle('lebih', arah === 'lebih');
      td.classList.toggle('kurang', arah === 'kurang');
    });
    return { kb, kt, kv, kp, sv, lebih, beda, arah };
  }
  function hitung(){
    let b=0,t=0,k=0,s=0,p=0,nb=0, terhitung=0, barisScan=0, kelebihan=0;
    document.querySelectorAll('tr[data-id]').forEach(function(tr){
      if (tr.classList.contains('sembunyi')) return;
      const r = bariskan(tr);
      b += r.kb; t += r.kt; k += r.kv; s += r.sv; p += r.kp;
      const nbInp = tr.querySelector('[data-nb]');
      if (nbInp) nb += parseInt(nbInp.value, 10) || 0;
      if (r.kv > 0) terhitung++;
      if (r.lebih) kelebihan++;
      if (tr.querySelector('.kolom-scan .badge').textContent !== '0') barisScan++;
    });
    /*
     * SELISIH = **S − P** (permintaan user: "selisih di hitung dari s dikurangi p"): beda antara hasil
     * rekap (Setoran) dengan jumlah yang dilaporkan terjual oleh sales (kolom P).
     * Selisih LAMA (B + T − K − S) tetap ditampilkan sebagai keterangan kecil di bawah angkanya.
     */
    const selisih = s - p;
    const selisihBarang = b + t - k - s;
    document.getElementById('tK').textContent = k;
    document.getElementById('tS').textContent = s;
    document.getElementById('tK2').textContent = k;
    document.getElementById('tS2').textContent = s;
    const elP = document.getElementById('tP');
    if (elP) elP.textContent = p;
    const el = document.getElementById('tSel');
    el.textContent = selisih === 0 ? '0 (cocok)' : String(selisih);
    el.style.color = selisih === 0 ? '#047857' : '#b91c1c';
    const elNote = document.getElementById('tSelNote');
    if (elNote) elNote.textContent = selisihBarang === 0 ? '' : 'selisih barang ' + selisihBarang;
    const kotakSel = document.getElementById('kotakSel');
    if (kotakSel) kotakSel.classList.toggle('kotak-waspada', selisih !== 0 || selisihBarang !== 0);
    const cat = document.getElementById('catRekap');
    if (cat){
      cat.hidden = kelebihan === 0;
      cat.textContent = kelebihan
        ? kelebihan + ' barang: jumlah KEMBALI (K) lebih banyak daripada Dibawa + Tambahan (B + T) — angka setorannya negatif dan ditandai merah.'
        : '';
    }
    // kolom "B Berikutnya": angka untuk surat jalan berikutnya (tidak ikut total rekap)
    const elNb = document.getElementById('tNb');
    if (elNb) elNb.textContent = nb;
    /*
     * POPUP TOMBOL "Kunci Rekap & Buat Surat Jalan" mengikuti isi kolom B Berikutnya (permintaan user:
     * *"Rekap tetap bisa dilakukan meski berikutnya tidak di isi dengan peringatan dan konfirmasi"*):
     * kalau kolomnya kosong → judul & pesannya jadi PERINGATAN bahwa rekap dikunci TANPA surat jalan baru.
     * Diperbarui di sini (bukan hanya saat halaman dirender) supaya cocok dengan angka yang sedang diisi.
     */
    /*
     * Tombolnya hanya ada untuk peran yang boleh mengubah; pada peran read-only elemennya tidak dirender
     * sehingga blok ini dilewati (jangan menambah markup tombol di sisi klien).
     */
    const btnLanjut = document.getElementById('btnKunciLanjut');
    if (btnLanjut) {
      /*
       * Sejak revisi ke-185, rekap yang dikunci TANPA penjualan (P) tidak berstatus "Selesai" melainkan
       * kembali "Ongoing" (menunggu data penjualan) supaya tetap tampil di dasbor — jadi peringatannya
       * ikut menyebutkan itu, jangan sampai pengguna mengira laporannya sudah final.
       */
      const catatanP = ADA_PENJUALAN ? '' : ' CATATAN: penjualan (P) masih KOSONG, jadi status surat jalan ini TIDAK menjadi "Selesai" melainkan kembali "Ongoing" (menunggu data penjualan) dan tetap tampil di dasbor — angka rekap tersimpan, jalankan rekap lagi setelah penjualan diisi untuk menyelesaikannya.';
      if (nb > 0) {
        btnLanjut.dataset.judul = 'Kunci rekap & buat surat jalan baru?';
        btnLanjut.dataset.pesan = 'Rekap akan DIKUNCI — angka tidak bisa diubah lagi — dan surat jalan baru langsung dibuat untuk Sales ' + (salesNama || '-') + ' hari ini, berisi barang dari kolom B Berikutnya (total ' + nb + ' barang).' + catatanP;
        btnLanjut.dataset.ok = 'Ya, kunci & buat';
      } else {
        btnLanjut.dataset.judul = 'Kunci rekap TANPA surat jalan berikutnya?';
        btnLanjut.dataset.pesan = 'PERINGATAN: kolom "B Berikutnya" masih KOSONG, jadi rekap ini akan DIKUNCI TANPA membuat surat jalan baru (tidak ada barang yang diteruskan). Angka rekap tidak bisa diubah lagi setelah dikunci.' + catatanP;
        btnLanjut.dataset.ok = 'Ya, kunci';
      }
    }
    const elNetNb = document.getElementById('netLanjut');
    if (elNetNb) elNetNb.textContent = nb;
    document.getElementById('netBaris').textContent = terhitung + ' / ' + document.querySelectorAll('tr[data-id]:not(.sembunyi)').length;
    document.getElementById('netQty').textContent = k;
    document.getElementById('netKedua').textContent = barisScan;
  }
  /*
   * permintaan user: "hitungan tersimpan otomatis saat dimasukkan".
   * Setiap perubahan kolom K / Setoran / B Berikutnya dijadwalkan tersimpan (debounce ~700 ms) lewat
   * fetch ke POST /sesi/:id/rekap; satu simpanan berjalan pada satu waktu dan yang tertunda diantre.
   * Nilai setoran yang masih OTOMATIS dikirim kosong supaya server menyimpannya NULL (dihitung otomatis).
   */
  const formSimpan = document.getElementById('formRekap');
  const statusSimpan = document.getElementById('statusSimpan');
  /*
   * ALAMAT SIMPAN diambil SEKALI saat halaman dimuat — jangan dibaca ulang dari atribut action.
   * Alasannya bug nyata: menekan tombol ber-formaction (mis. "Kunci Rekap & Buat Surat Jalan")
   * membuat public/app.js MEMINDAHKAN alamat tombol itu ke atribut action form (supaya form.submit()
   * menghormatinya). Kalau simpan-otomatis membaca atribut itu lagi, simpanan yang sedang tertunda
   * ikut menuju /kunci-lanjut — pengiriman KEDUA yang ditolak dengan pesan "Kunci rekap & surat jalan
   * berikutnya hanya bisa dari halaman rekap" padahal rekapnya sudah terkunci (gejala: pesan galat
   * muncul padahal berhasil, muncul-tenggelam tergantung urutan permintaan).
   */
  const simpanUrl = formSimpan ? formSimpan.getAttribute('action') : '';
  let timerSimpan = null, sedangSimpan = false, antreSimpan = false, sentuhSejakSimpan = false;

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
      formSimpan.querySelectorAll('[data-s][data-otomatis]').forEach(function(inp){ data.set(inp.name, ''); });
      const r = await fetch(simpanUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: data,
        redirect: 'follow',
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      sentuhSejakSimpan = false;
      tampilStatus('Tersimpan ' + jamSekarang(), false);
    } catch (e) {
      tampilStatus('Gagal menyimpan otomatis — tekan "Simpan Hitungan"', true);
    }
    sedangSimpan = false;
    if (antreSimpan || sentuhSejakSimpan){ antreSimpan = false; simpanOtomatis(); }
  }
  function jadwalkanSimpan(){
    if (!BOLEH_SIMPAN) return;
    sentuhSejakSimpan = true;
    if (timerSimpan) clearTimeout(timerSimpan);
    timerSimpan = setTimeout(function(){ timerSimpan = null; simpanOtomatis(); }, 700);
  }
  window.addEventListener('beforeunload', function(ev){
    if (!sentuhSejakSimpan) return;
    // pengguna sudah memilih di popup "pindah halaman" → jangan dihalangi dialog bawaan browser
    if (window.SC && window.SC.izinkanKeluar) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  document.addEventListener('input', function(ev){
    const t = ev.target;
    if (!t.dataset) return;
    if (t.dataset.s !== undefined && ev.isTrusted) t.removeAttribute('data-otomatis');
    if (t.dataset.k !== undefined || t.dataset.s !== undefined || t.dataset.nb !== undefined){ hitung(); jadwalkanSimpan(); }
  });
  // nilai setoran yang masih otomatis dikosongkan lagi supaya tetap dihitung server (NULL)
  const formRekap = document.getElementById('formRekap');
  if (formRekap) formRekap.addEventListener('submit', function(){
    formRekap.querySelectorAll('[data-s][data-otomatis]').forEach(function(i){ i.value = ''; });
  });
  hitung();

  /*
   * ---------- geser ke KANAN = PINDAH HALAMAN dengan konfirmasi ----------
   * permintaan user: "Saat berada pada halaman pengimputan, tambahan barang, retur, rekap, buat perjalanan
   * baru, ketika menggeser tidak langsung pindah halaman, namun muncul pop up yang menanyakan, tetap di
   * halaman, pindah ke halaman lain dan simpan hasil imput" — mekanismenya di public/app.js
   * (SC.geserHalaman). "Simpan" di sini = kirim form rekap (angka K/S & kolom B Berikutnya).
   * Hanya untuk peran yang boleh mengubah; peran read-only tidak diberi pilihan menyimpan.
   */
  if (window.SC && typeof window.SC.geserHalaman === 'function') {
    // nilai sesi.id diselesaikan SERVER saat halaman dirender (skrip klien tidak punya variabel sesi)
    const tujuan = base + '/sesi/${sesi.id}';
    window.SC.geserHalaman({
      tujuan: tujuan,
      /*
       * "Pindah & simpan hasil input" di halaman rekap DISIMPAN LEWAT FETCH lalu berpindah sendiri —
       * kalau memakai submit form, formulir ini mengarah kembali ke halaman rekap (tombol "Simpan
       * Hitungan"), jadi pengguna tidak akan pernah pindah. Cara di bawah sama dengan simpan otomatis:
       * kolom Setoran yang masih dihitung otomatis dikirim kosong supaya tetap tersimpan NULL.
       */
      simpan: BOLEH_SIMPAN ? function(){
        const f = document.getElementById('formRekap');
        if (!f){ location.href = tujuan; return; }
        const data = new URLSearchParams();
        new FormData(f).forEach(function(v, k){ data.append(k, v); });
        f.querySelectorAll('[data-s][data-otomatis]').forEach(function(i){ data.set(i.name, ''); });
        tampilStatus('Menyimpan…', false);
        fetch(simpanUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: data,
          redirect: 'follow',
        })
          .then(function(){ location.href = tujuan; })
          .catch(function(){ tampilStatus('Gagal menyimpan — coba lagi', true); });
      } : undefined,
    });
  }

  window.onScanKembali = function(d){
    if (!d.adaDiSesi){ SC.toast('Barang ini tidak ada di perjalanan ini', 'err'); return; }
    const tr = document.getElementById('row_' + d.id);
    const inp = document.getElementById('k_' + d.id);
    if (!tr || !inp){ SC.toast('Barang di luar daftar perjalanan', 'err'); return; }
    // baris TERKUNCI (ketuk nama barang 3× untuk mengunci jumlah) tidak diubah oleh scan
    if (tr.classList.contains('terkunci')){
      const nm = tr.querySelector('.nm');
      SC.toast((nm ? nm.textContent.trim() : 'Baris ini') + ' TERKUNCI — ketuk nama barangnya 3× untuk membuka', 'info');
      document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> — baris ini TERKUNCI, ketuk nama barangnya 3× untuk membuka';
      return;
    }
    tr.classList.remove('sembunyi');
    inp.value = (parseInt(inp.value,10)||0) + 1;
    const badge = document.getElementById('scan_' + d.id);
    badge.textContent = (parseInt(badge.textContent,10)||0) + 1;
    SC.flash(tr, true);
    document.getElementById('scanInfo').innerHTML = '<b>' + d.item.nama + '</b> · ' + d.item.kode + ' — kembali: ' + inp.value;
    hitung();
    jadwalkanSimpan();
  };
  /*
   * Hapus barang yang salah ditambahkan dari master (hanya baris ber-tanda "baru").
   * permintaan user: "opsi hapus pada rekap bergambar sampah, setelah di pencet tidak langsung di hapus,
   * muncul pop up untuk meyakinkan akan di hapus atau tidak".
   */
  document.addEventListener('click', async function(ev){
    const b = ev.target.closest('[data-hapus-baru]');
    if (!b) return;
    const tr = b.closest('tr');
    const form = document.getElementById('formHapusBaru');
    if (!tr || !form) return;
    const nama = tr.querySelector('.nm') ? tr.querySelector('.nm').textContent.trim() : 'Barang';
    const ya = await SC.konfirmasi({
      judul: 'Hapus ' + nama + ' dari daftar?',
      pesan: 'Barang ini akan dikeluarkan dari daftar rekap ini. Barangnya tetap ada di master data dan bisa dipilih lagi di "Tambah barang".',
      ok: 'Ya, hapus',
      batal: 'Batal',
    });
    if (!ya) return;
    form.querySelector('[name="item_id"]').value = b.dataset.hapusBaru;
    form.submit();
  });

  const bk = document.getElementById('btnKamera');
  if (bk) bk.addEventListener('click', function(){
    SC.scanKamera(function(kode){
      const inp = document.querySelector('[data-scan]');
      inp.value = kode;
      inp.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
    }, 'btnKamera');
  });
})();
</script>`;

  // permintaan user: opsi "Ke Halaman Perjalanan" di pojok kanan TIDAK dipakai (judul sudah di topbar)
  const isi = `
${kepalaPerjalanan(sesi, `<span class="pjl-extra">Rekap barang kembali</span>`)}
${pesan ? `<div class="alert alert-info">${esc(pesan)}</div>` : ''}

<div class="mode-area mode-daftar" id="areaRekap">
  <div class="card">
    <div class="input-kepala">
      <h2 class="input-judul">Daftar barang kembali</h2>
      <div class="input-baris-alat">
        <div class="input-alat">
        ${opsiCetak({
          base,
          kecil: true,
          judul: 'Cetak PDF',
          opsi: [
            // Permintaan user: semua cetak dokumen laporan = PDF (tanpa halaman cetak HTML lagi)
            { href: `/cetak/surat-jalan-pdf/${sesi.id}?v=${VERSI_DOKUMEN}`, label: 'PDF Surat Jalan & Setoran (F4)', ket: 'terbuka di penampil PDF · kertas F4' },
            /*
             * permintaan user terbaru: "cetak memo di logo print tidak usah" → opsi PDF Memo Pengambilan
             * DIHAPUS dari menu logo printer (halaman perjalanan & halaman rekap ini). Memonya tetap ada
             * di kolom Memo kartu "Catatan Pengambilan Barang" dan di menu baris halaman Laporan.
             */
            { href: `/cetak/label-pdf?sesi=${sesi.id}`, label: 'PDF Barcode Barang', ket: 'terbuka di penampil PDF · label QR gulungan 58 mm' },
          ],
        })}
        ${modePilih({
          area: '#areaRekap',
          fokusDaftar: '#cariRekap',
          fokusScan: '#scanRekap',
          judulDaftar: 'Input biasa (pilih dari daftar)',
          judulScan: 'Scan barcode / QR code barang kembali',
        })}
        </div>
      </div>
    </div>
    ${
      bolehTambah
        ? `<div class="baris-tambah">
      <div class="bt-judul"><b>Tambah barang</b></div>
      ${
        pilihanMaster.length
          ? `<form method="post" action="${base}/sesi/${sesi.id}/tambah-barang" class="bt-form">
        <select name="produk_id" id="pilihBarangBaru" required aria-label="Pilih barang dari master data">
          <option value="">— pilih barang dari master —</option>
          ${pilihanMaster
            .map((p) => `<option value="${p.id}" data-cari="${esc((p.kode + ' ' + p.nama).toLowerCase())}">${esc(p.kode)} · ${esc(p.nama)}</option>`)
            .join('')}
        </select>
        <button class="btn btn-primary" type="submit">＋ Tambah Barang</button>
        <span class="bt-jumlah" id="jmlPilihanBaru">${angka(pilihanMaster.length)} barang bisa dipilih</span>
      </form>`
          : '<span class="hint"><b>Semua barang master sudah ada di perjalanan ini.</b></span>'
      }
    </div>`
        : ''
    }
    <form method="post" action="${base}/sesi/${sesi.id}/hapus-barang" id="formHapusBaru" hidden>
      <input type="hidden" name="item_id" value="">
    </form>
    <div class="cari-box">
      <input type="search" id="cariRekap" data-filter="#tblRekap" placeholder="Cari nama / kode barang di daftar…">
    </div>
    <form method="post" action="${base}/sesi/${sesi.id}/rekap" id="formRekap">
      <div class="tbl-wrap" style="max-height:66vh;overflow:auto">
        <table class="tbl rapat tbl-pekat kolom-beku" id="tblRekap">
          <thead><tr>
            <th class="beku">Nama Barang</th>
            <th class="num tengah kolom-bt">B</th><th class="num tengah kolom-bt">T</th>
            <th class="tengah kolom-k">Kembali (K)</th>
            <th class="tengah kolom-s pasangan-sp" title="Jumlah barang yang disetor / terjual menurut hitungan rekap">Setoran (S)</th>
            <th class="tengah kolom-p pasangan-sp" title="Jumlah barang yang dilaporkan TERJUAL oleh sales (diisi di halaman Penjualan) — pasangan pembanding kolom Setoran (S)">P</th>
            <th class="tengah kolom-nb" title="Angka di kolom ini menjadi kolom Dibawa (B) surat jalan berikutnya">B Berikutnya</th>
            <th class="num tengah kolom-scan">Scan</th><th class="tengah kolom-hapus"></th>
          </tr></thead>
          <tbody>${baris}</tbody>
          <tfoot>
            <tr>
              <td class="beku">TOTAL</td>
              <td class="num tengah kolom-bt">${angka(totB)}</td>
              <td class="num tengah kolom-bt">${angka(totT)}</td>
              <td class="tengah kolom-k" id="tK">0</td>
              <td class="tengah kolom-s pasangan-sp" id="tS">0</td>
              <td class="tengah kolom-p pasangan-sp" id="tP">${angka(totP)}</td>
              <td class="tengah kolom-nb" id="tNb">0</td>
              <td class="num tengah kolom-scan"></td><td class="tengah kolom-hapus"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="alert alert-warn" id="catRekap" hidden></div>
      <div class="info-kotak tiga tiga-ringkas" style="margin-top:16px">
        <div class="kotak-info"><div class="label">Kembali (K)</div><div class="value" id="tK2">0</div></div>
        <div class="kotak-info"><div class="label">Setoran (S)</div><div class="value" id="tS2">0</div></div>
        <div class="kotak-info" id="kotakSel">
          <div class="label">Selisih (S − P)</div><div class="value" id="tSel">0 (cocok)</div>
          <div class="note" id="tSelNote"></div>
        </div>
      </div>
      ${
        bolehTambah
          ? `<div class="baris-lanjut">
        <div class="bl-alat">
          <span class="bl-info">Surat jalan berikutnya · Sales <b>${esc(sesi.sales_nama || '-')}</b> · Tanggal <b>${esc(tanggalPendek(hariIni))}</b></span>
        </div>
      </div>`
          : ''
      }
      <div class="aksi-row aksi-sejajar" style="margin-top:18px">
        <span class="status-simpan" id="statusSimpan" hidden aria-live="polite"></span>
        <button class="btn btn-primary" type="submit">Simpan Hitungan</button>
        ${
          bolehTambah
            ? `<button class="btn btn-sukses" type="submit" formaction="${base}/sesi/${sesi.id}/kunci-lanjut" id="btnKunciLanjut"
            data-konfirmasi-tema data-judul="${totNbAwal > 0 ? 'Kunci rekap &amp; buat surat jalan baru?' : 'Kunci rekap TANPA surat jalan berikutnya?'}"
            data-pesan="${totNbAwal > 0
              ? `Rekap ${esc(noSurat(sesi))} akan DIKUNCI — angka tidak bisa diubah lagi — dan surat jalan baru langsung dibuat untuk Sales ${esc(sesi.sales_nama || '-')} hari ini, berisi barang dari kolom B Berikutnya.`
              : `PERINGATAN: kolom "B Berikutnya" masih KOSONG, jadi rekap ${esc(noSurat(sesi))} akan DIKUNCI TANPA membuat surat jalan baru (tidak ada barang yang diteruskan). Angka rekap tidak bisa diubah lagi setelah dikunci.`}"
            data-ok="${totNbAwal > 0 ? 'Ya, kunci &amp; buat' : 'Ya, kunci'}">Kunci Rekap &amp; Buat Surat Jalan</button>`
            : ''
        }
      </div>
    </form>
  </div>

  <div class="card scan-card panel-scan">
    <h2 class="card-title">Hitung dengan Barcode</h2>
    <p class="card-hint">Tembak barcode tiap barang yang kembali. Salah scan? Ubah angka di kolom K, atau pakai tombol −.</p>
    <input class="scan-input" id="scanRekap" data-scan data-sesi="${sesi.id}" data-onmatch="onScanKembali" placeholder="SCAN / KETIK KODE" autocomplete="off">
    <div class="scan-info" id="scanInfo">Menunggu scan…</div>
    <div class="scan-net">
      <div>Barang terhitung<b id="netBaris">0</b></div>
      <div>Total kembali<b id="netQty">0</b></div>
      <div>Baris kena scan<b id="netKedua">0</b></div>
    </div>
    <div id="kameraWrap"></div>
    <div class="scan-aksi">
      <button class="btn btn-ghost btn-sm" id="btnKamera" type="button">Scan pakai Kamera HP</button>
    </div>
  </div>
</div>

<div class="card" style="margin-top:22px">
  <h2 class="card-title">Riwayat Scan</h2>
  <div class="tbl-wrap" style="max-height:260px;overflow:auto">
    <table class="tbl rapat"><tbody>${log || '<tr><td class="kosong">Belum ada scan.</td></tr>'}</tbody></table>
  </div>
</div>
<style>.sembunyi{display:none}</style>`;

  return { isi, script };
};
