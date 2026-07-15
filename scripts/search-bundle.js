import fs from 'fs';
import path from 'path';

const assetsDir = '/var/www/vantage/apps/web/dist/assets';
const files = fs.readdirSync(assetsDir);
const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'));
if (!jsFile) {
  console.log('No js file found!');
  process.exit(1);
}

const content = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
console.log('JS File checked:', jsFile);
console.log('Finding:', content.toLowerCase().includes('finding:'));
console.log('buyer:', content.toLowerCase().includes('buyer'));
console.log('outsource:', content.toLowerCase().includes('outsource'));
