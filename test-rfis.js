/* test-rfis.js — end-to-end test of the RFI module v2 (create → view → edit status) */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  let pass = 0, fail = 0;
  const check = (label, cond) => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
    cond ? pass++ : fail++;
  };

  // Sign in
  await page.goto('http://localhost:3002/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('#auth-login-username', 'admin');
  await page.fill('#auth-login-password', 'Alfredo25');
  await page.click('.auth-signin-btn');
  await page.waitForTimeout(3000);

  // Select a project
  const cards = await page.$$('.ps-card');
  console.log(`Projects: ${cards.length}`);
  if (cards.length) {
    const pid = await cards[0].getAttribute('data-pid');
    await page.evaluate((projectId) => {
      return new Promise((resolve) => {
        var switcher = window.AlignStorage.switchProject || window.AlignStorage.setActiveProject;
        var p = switcher.call(window.AlignStorage, projectId);
        (p && p.then) ? p.then(resolve) : resolve();
      });
    }, pid);
    await page.evaluate(() => { location.hash = ''; });
    await page.waitForTimeout(2000);
  }

  // Open RFIs tile
  for (const tile of await page.$$('.tile')) {
    const label = await tile.$eval('.tile-label', el => el.textContent).catch(() => '');
    if (label === 'RFIs') { await tile.click(); break; }
  }
  await page.waitForTimeout(1500);

  check('RFI list view renders (.rf-wrap)', !!(await page.$('.rf-wrap')));
  check('Stats bar renders with 5 chips', (await page.$$('.rf-stat-btn')).length === 5);

  // ── CREATE ──
  await page.click('#rf-new-btn');
  await page.waitForTimeout(600);
  check('Form view opens (.rf-form-wrap)', !!(await page.$('.rf-form-wrap')));
  check('Description is a textarea', !!(await page.$('textarea#rf-desc')));
  const statusOpts = await page.$$eval('#rf-status option', os => os.map(o => o.value));
  check('Status dropdown = draft/submitted/answered/closed', JSON.stringify(statusOpts) === JSON.stringify(['draft', 'submitted', 'answered', 'closed']));
  await page.waitForTimeout(800); // let people load
  const assignOpts = await page.$$eval('#rf-assigned option', os => os.map(o => o.textContent));
  console.log(`  assigned-to options: ${assignOpts.join(' | ')}`);
  check('Assigned-to populated from Directory (>1 option)', assignOpts.length > 1);

  const SUBJ = 'E2E Test RFI ' + Date.now();
  await page.fill('#rf-subject', SUBJ);
  await page.fill('#rf-desc', 'Automated test: verify slab edge detail at grid line C.\nSecond line of the description.');
  await page.selectOption('#rf-status', 'submitted');
  if (assignOpts.length > 1) await page.selectOption('#rf-assigned', { index: 1 });
  await page.fill('#rf-due', '2026-07-20');
  await page.click('#rf-form-save');
  await page.waitForTimeout(1200);

  // ── VIEW ──
  check('Back on list after save', !!(await page.$('.rf-list')));
  const cardText = await page.evaluate((s) => {
    const card = [...document.querySelectorAll('.rf-card')].find(c => c.textContent.includes(s));
    return card ? card.textContent : '';
  }, SUBJ);
  check('New RFI card appears in list', cardText.length > 0);
  check('Card shows Submitted pill', cardText.includes('Submitted'));
  check('Card shows due date', cardText.includes('Jul 20'));
  check('Card shows RFI number', /RFI-\d{3}/.test(cardText));

  // ── EDIT STATUS ──
  await page.evaluate((s) => {
    const card = [...document.querySelectorAll('.rf-card')].find(c => c.textContent.includes(s));
    if (card) card.click();
  }, SUBJ);
  await page.waitForTimeout(800);
  check('Edit form opens with subject preserved', (await page.inputValue('#rf-subject')) === SUBJ);
  check('Answer textarea present when editing', !!(await page.$('#rf-answer')));

  await page.selectOption('#rf-status', 'answered');
  await page.waitForTimeout(300);
  const answeredVal = await page.inputValue('#rf-answered');
  check('Answered date auto-filled on status change', /^\d{4}-\d{2}-\d{2}$/.test(answeredVal));
  await page.fill('#rf-answer', 'Detail 5/A-501 governs. Proceed as drawn.');
  await page.click('#rf-form-save');
  await page.waitForTimeout(1200);

  const cardText2 = await page.evaluate((s) => {
    const card = [...document.querySelectorAll('.rf-card')].find(c => c.textContent.includes(s));
    return card ? card.textContent : '';
  }, SUBJ);
  check('Card now shows Answered pill', cardText2.includes('Answered'));

  // Filter chip check
  await page.evaluate(() => {
    [...document.querySelectorAll('.rf-stat-btn')].find(b => b.dataset.rfFilter === 'answered').click();
  });
  await page.waitForTimeout(500);
  const answeredVisible = await page.evaluate((s) => {
    return [...document.querySelectorAll('.rf-card')].some(c => c.textContent.includes(s));
  }, SUBJ);
  check('Answered filter shows the RFI', answeredVisible);

  // Server persistence
  const persisted = await page.evaluate(async (s) => {
    const token = localStorage.getItem('align-token') || '';
    const pid = window.AlignStorage.getActiveProject().id;
    const r = await fetch('/api/projects/' + pid + '/rfis', { headers: { 'Authorization': 'Bearer ' + token }, credentials: 'include' });
    const d = await r.json();
    const rec = (d.records || []).map(x => x.data).find(x => x && x.subject === s);
    return rec ? { status: rec.status, assignedTo: rec.assignedTo, answeredDate: rec.answeredDate, answer: rec.answer } : null;
  }, SUBJ);
  console.log(`  persisted: ${JSON.stringify(persisted)}`);
  check('RFI persisted on server with answered status', !!persisted && persisted.status === 'answered');
  check('Answered date persisted', !!persisted && /^\d{4}-\d{2}-\d{2}$/.test(persisted.answeredDate || ''));

  // ── CLEANUP: delete the test RFI ──
  await page.evaluate((s) => {
    [...document.querySelectorAll('.rf-card')].find(c => c.textContent.includes(s)).click();
  }, SUBJ);
  await page.waitForTimeout(600);
  page.once('dialog', d => d.accept());
  await page.click('#rf-form-delete');
  await page.waitForTimeout(1000);
  const stillThere = await page.evaluate((s) => {
    return [...document.querySelectorAll('.rf-card')].some(c => c.textContent.includes(s));
  }, SUBJ);
  check('Test RFI deleted (cleanup)', !stillThere);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  console.log(`=== JS errors (${errors.length}) ===`);
  errors.slice(0, 10).forEach(e => console.log('  ' + e.substring(0, 160)));

  await browser.close();
  process.exit(fail > 0 ? 1 : 0);
})();
