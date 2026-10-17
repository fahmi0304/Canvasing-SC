'use strict';
process.env.TZ = process.env.SC_TZ || 'Asia/Makassar';
const path = require('path');
const { chromium } = require('playwright');
const { mulaiServer, petugasPertama, minta, pasangCookiePlaywright } = require('../uji-login');
(async () => {
  const app = path.join(__dirname);
  const db = '/tmp/cek-visual.sqlite';
  const { srv, url } = await mulaiServer({ app, db });
  const U = url, form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    const admin = await petugasPertama(U, 'ADMIN UJI');
    const tokenAdmin = (admin.match(/sc_login=([^;]+)/) || [, ''])[1];
    for (const n of ['Kacamata Alpha Panjang Sekali', 'Kacamata Beta', 'Kacamata Gamma']) {
      await minta(admin, U, '/barang/simpan', { method: 'POST', headers: form, body: new URLSearchParams({ nama: n }), redirect: 'manual' });
    }
    await minta(admin, U, '/sesi', { method: 'POST', headers: form, body: new URLSearchParams({ sales_nama: 'Ahmad Zaki' }), redirect: 'manual' });
    const hal = await (await minta(admin, U, '/sesi/1/ambil')).text();
    const ids = Array.from(hal.matchAll(/name="b_(\d+)"/g)).map((m) => m[1]);
    const isi = {}; ids.forEach((id, i) => { isi['b_' + id] = String(3 + i); });
    await minta(admin, U, '/sesi/1/ambil', { method: 'POST', headers: form, body: new URLSearchParams({ ...isi, _aksi: 'tetap' }), redirect: 'manual' });
    await minta(admin, U, '/sesi/1/kunci', { method: 'POST', headers: form, body: new URLSearchParams({}), redirect: 'manual' });
    await minta(admin, U, '/sesi/1/jual', { method: 'POST', headers: form, body: new URLSearchParams({ ['p_' + ids[0]]: '2', ['p_' + ids[1]]: '1' }), redirect: 'manual' });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 390, height: 780 } });
    await ctx.addCookies([{ name: 'sc_login', value: tokenAdmin, url: U }]);
    let pg = await ctx.newPage();
    await pg.goto(U + '/sesi/1/jual', { waitUntil: 'load' });
    const ukur = await pg.evaluate(() => {
      const wrap = document.querySelector('#tblJual').closest('.tbl-wrap');
      const kotak = Array.from(document.querySelectorAll('.info-kotak .kotak-info'));
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        geserTabel: wrap.scrollWidth - wrap.clientWidth,
        kolom: Array.from(document.querySelectorAll('#tblJual thead th')).map((x) => x.textContent.trim()),
        kotak: kotak.map((k) => k.querySelector('.label').textContent.trim()),
        tombol: (document.getElementById('btnSimpanJual') || {}).textContent,
        tombolLebar: Math.round((document.getElementById('btnSimpanJual') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
      };
    });
    console.log('HALAMAN PENJUALAN 390px:', JSON.stringify(ukur));
    await pg.screenshot({ path: '/tmp/jual-390.png', fullPage: true });
    await pg.close();

    pg = await ctx.newPage();
    await pg.goto(U + '/sesi/1', { waitUntil: 'load' });
    const kotakPerj = await pg.evaluate(() => {
      const k = Array.from(document.querySelectorAll('.info-kotak .kotak-info'));
      const r = k.map((x) => x.getBoundingClientRect());
      return {
        label: k.map((x) => x.querySelector('.label').textContent.trim()),
        note: k.map((x) => (x.querySelector('.note') || {}).textContent || ''),
        satuBaris: Math.max(...r.map((x) => x.top)) - Math.min(...r.map((x) => x.top)) < 3,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    console.log('HALAMAN PERJALANAN 390px:', JSON.stringify(kotakPerj));
    await pg.screenshot({ path: '/tmp/perj-390.png', fullPage: true });
    await pg.close();
    await browser.close();
    srv.kill('SIGKILL');
  } catch (e) { console.error('ERROR', e); srv.kill('SIGKILL'); process.exit(1); }
  process.exit(0);
})();
