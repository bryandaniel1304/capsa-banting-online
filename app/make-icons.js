// Renders the app icon (casino style: two cards on green felt with a gold ring) into assets/ for @capacitor/assets.
const sharp = require('sharp');
const fs = require('fs');
const S = 1024;
const card = (x, y, rot, rank, suit, color) => `
  <g transform="rotate(${rot} ${x + 150} ${y + 210})">
    <rect x="${x + 6}" y="${y + 14}" width="300" height="420" rx="34" fill="#000" opacity=".35"/>
    <rect x="${x}" y="${y}" width="300" height="420" rx="34" fill="#fffdf6" stroke="#d8b45a" stroke-width="6"/>
    <text x="${x + 34}" y="${y + 104}" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="100" fill="${color}">${rank}</text>
    <text x="${x + 150}" y="${y + 320}" text-anchor="middle" font-family="'Segoe UI Symbol', 'DejaVu Sans', sans-serif" font-size="210" fill="${color}">${suit}</text>
  </g>`;
const cards = card(250, 270, -14, 'A', '♥', '#c8202f') + card(470, 300, 12, '2', '♠', '#14130f');
const ring = `<circle cx="512" cy="512" r="470" fill="none" stroke="url(#gold)" stroke-width="22"/>
  <circle cx="512" cy="512" r="440" fill="none" stroke="#d8b45a" stroke-opacity=".35" stroke-width="4" stroke-dasharray="18 22"/>`;
const defs = `<defs>
  <radialGradient id="felt" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#1c6b47"/><stop offset=".65" stop-color="#0d3a26"/><stop offset="1" stop-color="#06170f"/></radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#d8b45a"/><stop offset="1" stop-color="#9c7a2c"/></linearGradient>
</defs>`;
const svg = (body, bg = true) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${defs}${bg ? `<rect width="${S}" height="${S}" fill="url(#felt)"/>` : ''}${body}</svg>`);
// adaptive icons crop to the middle ~66%: shrink the foreground into that safe zone
const safe = (body) => `<g transform="translate(512 512) scale(.62) translate(-512 -512)">${body}</g>`;
(async () => {
  fs.mkdirSync('assets', { recursive: true });
  await sharp(svg(ring + cards)).png().toFile('assets/icon-only.png');
  await sharp(svg(safe(ring + cards), false)).png().toFile('assets/icon-foreground.png');
  await sharp(svg('')).png().toFile('assets/icon-background.png');
  // splash: felt + centered icon art
  const sp = 2732;
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" width="${sp}" height="${sp}" viewBox="0 0 ${sp} ${sp}">${defs}<rect width="${sp}" height="${sp}" fill="#07110d"/>
    <g transform="translate(${sp / 2 - 400} ${sp / 2 - 400}) scale(${800 / S})"><rect width="${S}" height="${S}" rx="200" fill="url(#felt)"/>${ring}${cards}</g></svg>`;
  await sharp(Buffer.from(splash)).png().toFile('assets/splash.png');
  await sharp(Buffer.from(splash)).png().toFile('assets/splash-dark.png');
  console.log('icons written');
})();
