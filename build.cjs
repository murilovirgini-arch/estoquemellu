const fs = require('node:fs');
const zlib = require('node:zlib');
fs.mkdirSync('public/data', { recursive: true });
fs.copyFileSync('index.html', 'public/index.html');
const catalog = zlib.gunzipSync(Buffer.from(fs.readFileSync('data/products.json.gz.b64', 'utf8').trim(), 'base64'));
JSON.parse(catalog.toString('utf8'));
fs.writeFileSync('public/data/products.json', catalog);
console.log('MelLu application and product catalog ready');
