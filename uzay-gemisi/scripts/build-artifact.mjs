#!/usr/bin/env node
/**
 * Tek dosyalık derlemeyi (dist-single/index.html) claude.ai Artifact sayfasına uyarlar:
 * yayın sırasında sayfa zaten bir <!doctype>/<html>/<head>/<body> iskeletine sarıldığı için
 * bu etiketler ve görünüm (viewport) meta'sı çıkarılır; geri kalan her şey (stil, betik) gömülü kalır.
 *
 *   npm run build:single && node scripts/build-artifact.mjs   →  dist-artifact/azim.html
 */
import fs from 'node:fs';

const src = fs.readFileSync('dist-single/index.html', 'utf8');
const head = src.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '';
const body = src.match(/<body>([\s\S]*?)<\/body>/i)?.[1] ?? '';
const keepHead = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(/<link rel="icon"[^>]*>/i, '');
const title = keepHead.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>AZİM Uzay Gemisi</title>';
const rest = keepHead.replace(title, '');
// Oyun bilinçli olarak tek (koyu) görünümdedir
const extraStyle = '<style>:root{color-scheme:dark;background:#000}html,body{background:#000}</style>';
const out = `${title}\n${extraStyle}\n${rest.trim()}\n${body.trim()}\n`;
fs.mkdirSync('dist-artifact', { recursive: true });
fs.writeFileSync('dist-artifact/azim.html', out);
console.log(`dist-artifact/azim.html (${(out.length / 1024).toFixed(0)} KB)`);
