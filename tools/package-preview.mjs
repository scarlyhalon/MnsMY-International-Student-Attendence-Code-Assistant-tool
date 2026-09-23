import fs from 'node:fs';
import path from 'node:path';

const folder = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(folder, name), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
if (manifest.manifest_version !== 3 || manifest.version !== '0.3.2') throw new Error('Unexpected manifest');
for (const file of ['background.js', 'app.html', 'app.css', 'app.js', 'browser.js', 'page.js', 'weeks.js', 'store.js', 'demo.js']) {
  if (!fs.existsSync(path.join(folder, file))) throw new Error(`Missing ${file}`);
}
const model = read('weeks.js').replace(/^export /gm, '');
const store = read('store.js').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const demo = read('demo.js').replace(/^export /gm, '');
const app = read('app.js').replace(/^import .*;\r?\n/gm, '')
  .replace('const demo = location.protocol !== "chrome-extension:";', 'const demo = true;')
  .replace('const adapter = demo ? createDemoAdapter() : createBrowserAdapter();', 'const adapter = createDemoAdapter();');
const code = `(async () => {\n${model}\n${store}\n${demo}\n${app}\n})().catch(error => { document.getElementById('status-title').textContent = '预览加载失败'; document.getElementById('status-text').textContent = error.message; });`;
const html = read('app.html')
  .replace('<link rel="stylesheet" href="app.css">', `<style>\n${read('app.css')}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', '')
  .replace('</body>', `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>\n</body>`);
const output = path.join(folder, 'preview.html');
fs.writeFileSync(output, html);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(html), extensionVersion: manifest.version }));
