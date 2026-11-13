// Headless browser check of the upload screen (public/js/upload.js). Not part of `npm test` (needs Playwright):
// run the editor with ENABLE_UPLOAD=true and an empty MUSIC_DIR, then
//   cd test/ui && npm i playwright && BASE=http://127.0.0.1:3000 FIX=../fixtures node upload-ui.test.mjs
// It uploads into that music folder; use a throwaway one.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:3999';
const FIX = process.env.FIX;                      // the repo's test/fixtures
const SHOTS = process.env.SHOTS || './shots';
mkdirSync(SHOTS, { recursive: true });
const mp3 = readFileSync(`${FIX}/silence.mp3`), flac = readFileSync(`${FIX}/silence.flac`);
let fails = 0;
const check = (ok, what, got) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok ? '' : `  (got: ${JSON.stringify(got)})`}`); if (!ok) fails++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/status of 415/.test(m.text())) errors.push(m.text()); });   // the fake mp3's 415 is expected

await page.goto(BASE);
await page.waitForSelector('#uploadBtn', { timeout: 10000 });
check(await page.isVisible('#uploadBtn'), 'Upload button shown (upload on)');
const order = await page.$$eval('.selection-controls > *', els => els.map(e => e.id).filter(Boolean));
check(order.indexOf('uploadBtn') === order.indexOf('importBtn') + 1, 'Upload sits right after Import', order);
await page.screenshot({ path: `${SHOTS}/1-start.png` });

// 1: the picker, a mixed bag: 2 good, 1 renamed text file (server 415), cover.jpg + a zip (skipped in the browser)
await page.setInputFiles('input[type=file]', [
    { name: '01 - Track One.mp3', mimeType: 'audio/mpeg', buffer: mp3 },
    { name: '02 - Track Two.flac', mimeType: 'audio/flac', buffer: flac },
    { name: 'notes.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('this is not audio') },
    { name: 'cover.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
    { name: 'Album.zip', mimeType: 'application/zip', buffer: Buffer.from('PK\u0003\u0004') },
]);
await page.waitForSelector('.upload-panel:not([hidden]) .upload-close', { timeout: 15000 });
await page.waitForFunction(() => window.metadataEditor.currentPath === 'import' && document.querySelectorAll('.file-item.multi-selected').length > 0, null, { timeout: 10000 }).catch(() => {});
const summary = await page.textContent('.upload-panel');
check(/Uploaded 2 files into import\//.test(summary), 'summary: 2 uploaded', summary);
check(/1 failed/.test(summary) && /2 skipped/.test(summary), 'summary: 1 failed, 2 skipped', summary);
check(/notes\.mp3: Not a readable audio file/.test(summary), 'the fake mp3 is named with the server reason', summary);
check(/Album\.zip: a zip: unzip it first/.test(summary), 'the zip gets the unzip hint', summary);
check(/cover\.jpg: not an audio file/.test(summary), 'cover.jpg skipped', summary);
check((await page.getAttribute('.upload-panel', 'class')).includes('error'), 'panel marked error (one failed)');
const sel = await page.evaluate(() => [...window.metadataEditor.selectedItems].sort());
check(JSON.stringify(sel) === JSON.stringify(['file:import/01 - Track One.mp3', 'file:import/02 - Track Two.flac']), 'import folder open, the 2 new files selected', sel);
check(await page.evaluate(() => window.metadataEditor.currentPath) === 'import', 'current folder is import');
await page.screenshot({ path: `${SHOTS}/2-after-picker.png` });

// 2: same name again → saved as "(2)", the note says nothing was overwritten
await page.click('.upload-close');
await page.setInputFiles('input[type=file]', [{ name: '01 - Track One.mp3', mimeType: 'audio/mpeg', buffer: mp3 }]);
await page.waitForSelector('.upload-panel:not([hidden]) .upload-close', { timeout: 15000 });
await page.waitForTimeout(500);
const s2 = await page.textContent('.upload-panel');
check(/Uploaded 1 file into/.test(s2) && /nothing was overwritten/.test(s2), 'duplicate name: kept both, said so', s2);
check(!/null/.test(s2), 'no stray "null" in the panel', s2);
check((await page.getAttribute('.upload-panel', 'class')).includes('success'), 'panel marked success');
const sel2 = await page.evaluate(() => [...window.metadataEditor.selectedItems]);
check(JSON.stringify(sel2) === JSON.stringify(['file:import/01 - Track One (2).mp3']), 'only the new copy selected', sel2);

// 3: a synthetic drop of two files on the file list (the drop-area path; folders need a real drag)
await page.click('.upload-close');
await page.evaluate(async ([a, b]) => {
    const zone = document.querySelector('.browser-panel');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(a)], '03 - Dropped.mp3', { type: 'audio/mpeg' }));
    dt.items.add(new File([new Uint8Array(b)], '04 - Dropped.flac', { type: 'audio/flac' }));
    zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__dropActive = zone.classList.contains('drop-active');
    zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, [[...mp3], [...flac]]);
check(await page.evaluate(() => window.__dropActive), 'drag over the list shows the drop hint');
await page.waitForSelector('.upload-panel:not([hidden]) .upload-close', { timeout: 15000 });
await page.waitForTimeout(500);
const s3 = await page.textContent('.upload-panel');
check(/Uploaded 2 files/.test(s3), 'drop: 2 uploaded', s3);
check(!/null/.test(s3), 'no stray "null" after a clean upload', s3);
check(!(await page.evaluate(() => document.querySelector('.browser-panel').classList.contains('drop-active'))), 'drop hint gone after the drop');
const sel3 = await page.evaluate(() => [...window.metadataEditor.selectedItems].sort());
check(sel3.length === 2 && sel3.every(k => /Dropped/.test(k)), 'dropped files selected', sel3);
await page.screenshot({ path: `${SHOTS}/3-after-drop.png` });

// 4: the drop hint itself (screenshot), light theme
await page.evaluate(() => document.querySelector('.browser-panel').classList.add('drop-active'));
await page.screenshot({ path: `${SHOTS}/4-drop-hint-dark.png` });
await page.click('#themeToggle');
await page.waitForTimeout(600);   // theme colors animate 0.3 s
await page.screenshot({ path: `${SHOTS}/5-drop-hint-light.png` });
await page.evaluate(() => document.querySelector('.browser-panel').classList.remove('drop-active'));

check(errors.length === 0, 'no page errors', errors);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
