// The in-page persona badge and the page-title marker, driven in a real Chrome.
//
// THE COMPLAINTS THIS EXISTS FOR: the badge sat fixed top-right — exactly where apps put
// header buttons — and covered a real control ("how am I supposed to click this
// button"), with no way to move or hide it; and nothing outside the page said which
// persona a tab was ("in page title can we show the color").
//
// Asserts:
//   1. a persona tab shows the badge in the DEFAULT corner, bottom-left, with its name
//   2. a click shrinks it to a dot, and the click does not reach the page's handlers
//   3. dragging moves it, and the spot survives a reload (stored per site)
//   4. double-clicking puts it back in the corner
//   5. the page title carries the persona's coloured marker, and keeps it when the app
//      changes its own title
//   6. recolouring the persona updates the open tab's badge and title marker at once
//   7. switching title marking off restores the app's own title
//   8. the corner setting moves it; switching the badge off removes it
//   9. control: a plain, unbound tab never shows a badge or a marker

import { attach, claimNewTab, pageIds, report, requireGrant, sleep, startChrome, waitFor } from './lib/harness.mjs';

const ORIGIN = 'http://localhost:8787';
const HOST = new URL(ORIGIN).host;
/** Distance from the viewport edge that still counts as "in that corner". */
const CORNER_SLACK_PX = 40;
/** How close a restored position must be to where it was dropped. */
const POSITION_SLACK_PX = 4;
const DROP_AT = { x: 420, y: 300 };
const CHIP = `document.getElementById('__tabsona_chip__')`;
const RECT = `(() => { const c = ${CHIP}; if (!c) return null; const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, right: innerWidth - r.right, bottom: innerHeight - r.bottom, w: r.width, h: r.height,
    text: c.textContent, bg: getComputedStyle(c).backgroundColor }; })()`;

const chrome = await startChrome(9887);
await requireGrant(chrome, ORIGIN);

const persona = await chrome.op('newPersona("Badge check")');
const before = await pageIds(chrome);
await chrome.op(`addSite(${JSON.stringify(persona)}, ${JSON.stringify(`${ORIGIN}/`)})`);
const page = await attach(await claimNewTab(chrome, before, HOST));
await waitFor(page, `!!${CHIP}`, 'badge drawn', 20000);

const mouse = async (type, x, y, clickCount = 1) => page.send('Input.dispatchMouseEvent', {
  type, x, y, clickCount, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0,
});
const centre = (r) => ({ x: r.left + r.w / 2, y: r.top + r.h / 2 });

// --- 1. default corner ----------------------------------------------------------
const initial = await page.eval(RECT);

// --- 2. click shrinks it, and the page's handlers do not see the click ----------
// Bubble phase on purpose: that is where page click handling lives (delegated handlers,
// React's root listener). A CAPTURE-phase listener on document runs before the badge's
// own handler, so nothing on the badge can hide a click from it — and it does not need
// to, because the event's target is the badge, never the page control underneath.
await page.eval(`window.__pageClicks = 0; document.addEventListener('click', () => { window.__pageClicks++; })`);
let c = centre(initial);
await mouse('mousePressed', c.x, c.y);
await mouse('mouseReleased', c.x, c.y);
await sleep(700); // a single tap acts after the double-click window closes
const shrunk = await page.eval(RECT);
const pageClicks = await page.eval('window.__pageClicks');

// --- 3. drag it, then reload ------------------------------------------------------
c = centre(shrunk);
await mouse('mousePressed', c.x, c.y);
for (let i = 1; i <= 8; i++) await mouse('mouseMoved', c.x + ((DROP_AT.x - c.x) * i) / 8, c.y + ((DROP_AT.y - c.y) * i) / 8);
await mouse('mouseReleased', DROP_AT.x, DROP_AT.y);
await sleep(300);
const dropped = await page.eval(RECT);
const stillShrunk = dropped?.w <= 16; // a drag is not a click: it must not toggle the size
const storedOk = await (async () => {
  for (let i = 0; i < 20; i++) {
    const stored = await chrome.json(`chrome.storage.local.get('badgePlacements').then(g => g.badgePlacements ?? {})`);
    if (stored[ORIGIN]) return true;
    await sleep(250);
  }
  return false;
})();
await page.send('Page.reload');
await sleep(800);
await waitFor(page, `!!${CHIP}`, 'badge redrawn after reload', 15000);
await sleep(300);
const afterReload = await page.eval(RECT);
// After a reload the badge is full-size again (shrinking is per page), so compare
// centres rather than corners: the stored spot is a fraction of the free space.
const droppedCentre = centre(dropped);
const reloadCentre = centre(afterReload);

// --- 4. double-click puts it back -------------------------------------------------
c = centre(afterReload);
await mouse('mousePressed', c.x, c.y, 1);
await mouse('mouseReleased', c.x, c.y, 1);
await mouse('mousePressed', c.x, c.y, 2);
await mouse('mouseReleased', c.x, c.y, 2);
await waitFor(page, `(() => { const r = ${RECT}; return !!r && r.left < ${CORNER_SLACK_PX} && r.bottom < ${CORNER_SLACK_PX}; })()`, 'badge back in its corner', 10000);
const resetRect = await page.eval(RECT);

// --- 5. title marker, including the app changing its title -------------------------
await waitFor(page, `document.title.startsWith('💙 ')`, 'title marked', 10000);
const markedTitle = await page.eval('document.title');
await page.eval(`document.title = 'Route two'`);
await waitFor(page, `document.title === '💙 Route two'`, 'title re-marked after the app changed it', 5000);
const remarked = await page.eval('document.title');

// --- 6. recolour the persona -----------------------------------------------------
await chrome.op(`updatePersona(${JSON.stringify(persona)}, { color: '#ef4444' })`);
await waitFor(page, `document.title === '❤️ Route two'`, 'title marker recoloured', 10000);
const recolouredTitle = await page.eval('document.title');
const recolouredBadge = await page.eval(RECT);

// --- 7. title marking off ---------------------------------------------------------
await chrome.op(`updateSettings({ markPageTitles: false })`);
await chrome.op('renderAllBadges()');
await waitFor(page, `document.title === 'Route two'`, 'title restored', 10000);
const unmarked = await page.eval('document.title');

// --- 8. corner setting, then off ----------------------------------------------------
await chrome.op(`updateSettings({ badgePosition: 'top-right' })`);
await chrome.op('renderAllBadges()');
await waitFor(page, `(() => { const r = ${RECT}; return !!r && r.right < ${CORNER_SLACK_PX} && r.top < ${CORNER_SLACK_PX}; })()`, 'badge moved top-right', 10000);
const moved = await page.eval(RECT);
await chrome.op(`updateSettings({ showPageBadge: false })`);
await chrome.op('renderAllBadges()');
await waitFor(page, `!${CHIP}`, 'badge removed', 10000);
const afterOff = await page.eval(RECT);

// --- 9. control: a plain tab ------------------------------------------------------
await chrome.op(`updateSettings({ showPageBadge: true, markPageTitles: true })`);
const beforePlain = await pageIds(chrome);
await chrome.newTab(`${ORIGIN}/`);
const plain = await attach(await claimNewTab(chrome, beforePlain, HOST));
await waitFor(plain, `document.readyState === 'complete'`, 'plain tab loaded');
await sleep(1500);
const plainChip = await plain.eval(RECT);
const plainTitle = await plain.eval('document.title');

// --- 10. recolouring reaches the Chrome tab group ----------------------------------
await chrome.op(`openPersona(${JSON.stringify(persona)})`);
await sleep(2000);
await chrome.op(`updatePersona(${JSON.stringify(persona)}, { color: '#10b981' })`);
await sleep(800);
const groupColours = await chrome.json(`chrome.tabGroups.query({ title: 'Badge check' }).then(gs => gs.map(g => g.color))`);

page.close();
plain.close();
await chrome.kill();

const near = (a, b) => Math.abs(a.x - b.x) <= POSITION_SLACK_PX && Math.abs(a.y - b.y) <= POSITION_SLACK_PX + 4;
const pass = report('in-page persona badge and title marker', [
  ['shown in the default corner, bottom-left', !!initial && initial.left < CORNER_SLACK_PX && initial.bottom < CORNER_SLACK_PX, JSON.stringify(initial)],
  ['shows the persona name', initial?.text?.includes('Badge check') === true, String(initial?.text)],
  ['a click shrinks it to a dot', !!shrunk && shrunk.w <= 16 && shrunk.text === '', JSON.stringify(shrunk)],
  ['the click does not reach the page\'s click handlers', pageClicks === 0, String(pageClicks)],
  ['dragging moves it where it was dropped', !!dropped && near(centre(dropped), DROP_AT), JSON.stringify(dropped)],
  ['a drag is not a click — the size stays as it was', stillShrunk === true, JSON.stringify(dropped)],
  ['the dragged spot is stored for the site', storedOk],
  ['…and the badge comes back there after a reload', !!afterReload && Math.abs(droppedCentre.y - reloadCentre.y) < 30 && reloadCentre.x > CORNER_SLACK_PX * 3,
    `dropped ${JSON.stringify(droppedCentre)} reloaded ${JSON.stringify(reloadCentre)}`],
  ['double-click puts it back in the corner', !!resetRect && resetRect.left < CORNER_SLACK_PX && resetRect.bottom < CORNER_SLACK_PX, JSON.stringify(resetRect)],
  ['the page title carries the persona colour marker', markedTitle.startsWith('💙 '), markedTitle],
  ['the marker comes back when the app changes its title', remarked === '💙 Route two', remarked],
  ['recolouring the persona updates the open tab\'s title marker', recolouredTitle === '❤️ Route two', recolouredTitle],
  ['…and its badge colour', recolouredBadge?.bg === 'rgb(239, 68, 68)', String(recolouredBadge?.bg)],
  ['switching title marking off restores the app\'s own title', unmarked === 'Route two', unmarked],
  ['the corner setting moves it in an open tab', !!moved && moved.right < CORNER_SLACK_PX && moved.top < CORNER_SLACK_PX, JSON.stringify(moved)],
  ['switching the badge off removes it from an open tab', afterOff === null, JSON.stringify(afterOff)],
  ['control: a plain tab shows no badge', plainChip === null, JSON.stringify(plainChip)],
  ['recolouring the persona recolours its Chrome tab group', groupColours.length > 0 && groupColours.every((g) => g === 'green'), JSON.stringify(groupColours)],
  ['control: a plain tab\'s title is left alone', !/^\p{Extended_Pictographic}/u.test(plainTitle), plainTitle],
]);
process.exit(pass ? 0 : 1);
