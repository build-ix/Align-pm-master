// Cleanup: delete "Page N.pdf" drawings uploaded during the failed test run (last hour)
(async () => {
  const base = 'http://localhost:3002';
  const r = await fetch(base + '/api/auth/signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Alfredo25' })
  });
  const setCookie = r.headers.get('set-cookie') || '';
  const m = setCookie.match(/align-token=([^;]+)/);
  const token = m ? m[1] : null;
  if (!token) { console.log('signin failed — no cookie'); return; }
  const H = { 'Cookie': 'align-token=' + token };

  const pr = await fetch(base + '/api/projects', { headers: H }).then(x => x.json());
  const proj = (pr.projects || pr).find(p => /test project/i.test(p.name));
  console.log('Project:', proj.id, proj.name);

  const fl = await fetch(base + '/api/projects/' + proj.id + '/files', { headers: H }).then(x => x.json());
  const cutoff = Date.now() - 3600 * 1000;
  const junk = (fl.files || []).filter(f =>
    f.type === 'file' && !f.trashed &&
    (/^Page \d+\.pdf$/.test(f.original_name) || /ALIGN TEST TOWER/.test(f.original_name)) &&
    new Date(f.created_at).getTime() > cutoff);
  console.log('Junk files to delete:', junk.map(f => f.original_name + ' @ ' + f.created_at));
  for (const f of junk) {
    const d = await fetch(base + '/api/files/' + f.id, { method: 'DELETE', headers: H }).then(x => x.json());
    console.log('deleted', f.original_name, JSON.stringify(d));
  }
  const after = await fetch(base + '/api/projects/' + proj.id + '/files', { headers: H }).then(x => x.json());
  console.log('Files remaining (untrashed):', (after.files || []).filter(f => f.type === 'file' && !f.trashed).length);
})();
