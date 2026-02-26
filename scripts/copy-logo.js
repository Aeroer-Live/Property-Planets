const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'Logo', 'Property Planets.png');
const dest = path.join(root, 'public', 'images', 'logo.png');

if (!fs.existsSync(src)) {
  console.warn('Logo not found at:', src);
  process.exit(0);
}

const dir = path.dirname(dest);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('Logo copied to public/images/logo.png');
