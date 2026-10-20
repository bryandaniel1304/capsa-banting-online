// Play Store listing images -> ../store/: 512px icon, 1024x500 feature graphic and 1920x1080 phone screenshots
// (a local server with bots, played in headless Edge/Chrome). Usage: node store-assets.js [browserPath]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', 'store');
const PORT = 3985, url = 'http://localhost:' + PORT;
const BROWSER = process.argv[2] || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphics() {
  await sharp(path.join(__dirname, 'assets', 'icon-only.png')).resize(512, 512).png().toFile(path.join(OUT, 'icon-512.png'));
  const icon = (await sharp(path.join(__dirname, 'assets', 'icon-only.png')).resize(380, 380).png().toBuffer()).toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
    <defs>
      <radialGradient id="felt" cx="35%" cy="45%" r="80%"><stop offset="0" stop-color="#1c6b47"/><stop offset=".6" stop-color="#0d3a26"/><stop offset="1" stop-color="#06170f"/></radialGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".55" stop-color="#d8b45a"/><stop offset="1" stop-color="#a8822f"/></linearGradient>
      <clipPath id="r"><rect x="584" y="60" width="380" height="380" rx="80"/></clipPath>
    </defs>
    <rect width="1024" height="500" fill="url(#felt)"/>
    <rect x="14" y="14" width="996" height="472" rx="26" fill="none" stroke="url(#gold)" stroke-width="4" opacity=".8"/>
    <text x="70" y="190" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="54" letter-spacing="6" fill="url(#gold)">CAPSA</text>
    <text x="66" y="276" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="92" letter-spacing="4" fill="url(#gold)">BANTING</text>
    <text x="72" y="318" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" font-size="22" letter-spacing="10" fill="#f3ead4" opacity=".85">ONLINE</text>
    <text x="72" y="380" font-family="'Segoe UI', Arial, sans-serif" font-weight="600" font-size="26" fill="#f3ead4">Main kartu bareng teman · voice chat</text>
    <text x="72" y="416" font-family="'Segoe UI', Arial, sans-serif" font-size="22" fill="#f3ead4" opacity=".75">Gratis · tanpa koin · poin hanya untuk hiburan</text>
    <image x="584" y="60" width="380" height="380" clip-path="url(#r)" href="data:image/png;base64,${icon}"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, 'feature-graphic-1024x500.png'));
}

async function screenshots() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT, PGLITE_DIR: path.join(os.tmpdir(), 'capsa-store-' + Date.now()), DATABASE_URL: '' }, stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(url + '/healthz'); break; } catch { await sleep(200); } }
    const pw = Math.random().toString(36).slice(2) + 'Aa1';
    const { token } = await (await fetch(url + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'andi', password: pw, name: 'Andi', avatar: '🦁' }) })).json();
    const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 15; SM-S931B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 CapsaBantingApp/1.0');
    await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
    await page.goto(url);
    await page.evaluate((t) => { localStorage.setItem('capsa.auth', JSON.stringify(t)); localStorage.setItem('capsa.muted', 'true'); }, token);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const shot = async (name) => { await sleep(900); await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.style.display = 'none'; }); await page.screenshot({ path: path.join(OUT, name) }); console.log('  ' + name); };
    const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);

    // table with three bots
    await click('#tiers > *');
    await sleep(1200);
    for (let i = 0; i < 3; i++) { await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /\+ ?Bot/.test(x.textContent) && x.offsetParent); if (b) b.click(); }); await sleep(500); }
    await click('#startBtn');
    await sleep(2500);

    // my turn: pick the first suggestion and play it; pass when there is none
    const myMove = () => page.evaluate(() => {
      const act = document.getElementById('actions');
      if (!act || act.classList.contains('hidden')) return 'wait';
      const h = document.querySelector('#hints .hint');
      if (h) { if (!h.classList.contains('on')) { h.click(); return 'picked'; } document.getElementById('playBtn').click(); return 'played'; }
      const pass = document.getElementById('passBtn');
      if (pass && !pass.disabled) { pass.click(); return 'passed'; }
      return 'wait';
    });
    const state = () => page.evaluate(() => ({ result: !document.getElementById('result').classList.contains('hidden'), hand: document.querySelectorAll('#hand .card').length, turn: !document.getElementById('actions').classList.contains('hidden') }));
    let tableShot = false;
    for (let i = 0; i < 1500; i++) {
      const st = await state();
      if (st.result) break;
      if (!tableShot && st.turn && st.hand <= 10) {
        await sleep(700);
        await page.evaluate(() => { const h = document.querySelector('#hints .hint'); if (h && !h.classList.contains('on')) h.click(); });
        await shot('screenshot-2-meja.png');
        tableShot = true;
      }
      await sleep(250);
      if ((await myMove()) === 'picked') await sleep(500);
    }
    await sleep(1500);
    await shot('screenshot-3-hasil-game.png');

    // end the session -> final points
    await click('#endBtn'); await sleep(600); await click('#askOk'); await sleep(1500);
    await shot('screenshot-4-skor-akhir.png');

    // rules overview
    await click('#rulesBtn'); await sleep(800);
    await shot('screenshot-5-aturan.png');
    await page.evaluate(() => document.getElementById('rules').classList.add('hidden'));

    // home with stats
    await click('#finLeave'); await sleep(800); await click('#askOk'); await sleep(1500);
    await page.goto(url, { waitUntil: 'networkidle0' }); await sleep(2000);
    const resume = await page.evaluate(() => !document.getElementById('ask').classList.contains('hidden'));
    if (resume) await click('#askNo');
    await shot('screenshot-1-beranda.png');
    await browser.close();
  } finally { srv.kill(); }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await graphics();
  console.log('graphics ok');
  if (!BROWSER) return console.log('no Edge/Chrome found: skipped screenshots');
  await screenshots();
  console.log('screenshots ok');
})().catch((e) => { console.error(e); process.exit(1); });
