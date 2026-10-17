'use strict';
process.env.TZ = process.env.SC_TZ || 'Asia/Makassar';
const path = require('path');
const { chromium } = require('playwright');
const { mulaiServer, petugasPertama, minta } = require('../uji-login');
(async () => {
  const app = path.join(__dirname);
  const db = '/tmp/pdf3.sqlite';
  const { srv, url } = await mulaiServer({ app, db });
  const U = url, form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  try {
    const admin = await petugasPertama(U, 'ADMIN UJI');
    for (const n of ['YSL 8410', 'Beta Lensa', 'Gamma Frame', 'Delta Kaca']) await minta(admin, U, '/barang/simpan', { method: 'POST', headers: form, body: new URLSearchParams({ nama: n }), redirect: 'manual' });
    await minta(admin, U, '/sesi', { method: 'POST', headers: form, body: new URLSearchParams({ sales_nama: 'Percobaan' }), redirect: 'manual' });
    const hal = await (await minta(admin, U, '/sesi/1/ambil')).text();
    const ids = Array.from(hal.matchAll(/name="b_(\d+)"/g)).map((m) => m[1]);
    const isi = {}; ids.forEach((id, i) => { isi['b_' + id] = ['1', '4', '5', '3'][i]; });
    await minta(admin, U, '/sesi/1/ambil', { method: 'POST', headers: form, body: new URLSearchParams({ ...isi, _aksi: 'tetap' }), redirect: 'manual' });
    await minta(admin, U, '/sesi/1/kunci', { method: 'POST', headers: form, body: new URLSearchParams({}), redirect: 'manual' });
    await minta(admin, U, '/sesi/1/jual', { method: 'POST', headers: form, body: new URLSearchParams({ ['p_' + ids[0]]: '0', ['p_' + ids[1]]: '5', ['p_' + ids[2]]: '5', ['p_' + ids[3]]: '3' }), redirect: 'manual' });
    await minta(admin, U, '/sesi/1/rekap/mulai', { method: 'POST', headers: form, body: new URLSearchParams({}), redirect: 'manual' });
    const token = (admin.match(/sc_login=([^;]+)/) || [, ''])[1];
    const b = await chromium.launch();
    const ctx = await b.newContext();
    await ctx.addCookies([{ name: 'sc_login', value: token, url: U }]);
    const pg = await ctx.newPage();
    await pg.goto(U + '/cetak/surat-jalan/1', { waitUntil: 'load' });
    await pg.pdf({ path: '/tmp/vikon.pdf', preferCSSPageSize: true, printBackground: true });
    await b.close();
    srv.kill('SIGKILL');
  } catch (e) { console.error('ERROR', e); srv.kill('SIGKILL'); process.exit(1); }
  process.exit(0);
})();
