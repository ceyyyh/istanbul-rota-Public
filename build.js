'use strict';
// core.js ve app.js'yi index.template.html içine gömüp dist/index.html üretir.
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Satır içi <script> içinde "</script" dizisi HTML'i erken kapatır; kaçır.
const safe = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

let html = read('src/index.template.html');
for (const [marker, file] of [['/*__CORE__*/', 'src/core.js'], ['/*__APP__*/', 'src/app.js']]) {
  if (!html.includes(marker)) throw new Error(`Şablonda ${marker} işareti yok`);
  const code = safe(read(file));
  html = html.split(marker).join(code); // replace() özel "$" desenlerinden kaçınmak için split/join
}

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'index.html');
fs.writeFileSync(out, html);
console.log(`dist/index.html yazıldı (${Buffer.byteLength(html)} bayt)`);
