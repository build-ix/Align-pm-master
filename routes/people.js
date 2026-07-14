/* routes/people.js — People API for Align PM */

module.exports = function(app, deps) {
  var dbGet = deps.dbGet, dbRun = deps.dbRun, dbAll = deps.dbAll;
  var uid = deps.uid, nowISO = deps.nowISO, safeUser = deps.safeUser;
  var sendInviteEmail = deps.sendInviteEmail;
  var sendProjectWelcomeEmail = deps.sendProjectWelcomeEmail;
  var crypto = deps.crypto;
  var requireAuth = deps.requireAuth, requireAdmin = deps.requireAdmin;
  var normalizePermissions = deps.normalizePermissions || function(p) { return p || {}; };

  // List people (filterable)
  app.get('/api/people', requireAuth, requireAdmin, function(req, res) {
    var status = req.query.status || '';
    var sql = 'SELECT u.id, u.email, u.name, u.role, u.status, u.invite_status, u.invite_code, u.invited_by, u.invited_at, u.invite_expires_at, u.created_at, up.company_id, up.role AS project_role, up.permissions FROM users u LEFT JOIN user_projects up ON up.user_id = u.id WHERE 1=1';
    var params = [];
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY u.created_at DESC';
    var rows = dbAll(sql, ...params);
    rows.forEach(function(u) { u = safeUser(u); });
    res.json({ people: rows });
  });

  // Get single person
  app.get('/api/people/:id', requireAuth, requireAdmin, function(req, res) {
    var user = dbGet('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found' });
    var projects = dbAll(
      'SELECT p.id, p.name, up.role, up.permissions FROM user_projects up JOIN projects p ON p.id = up.project_id WHERE up.user_id = ?',
      req.params.id
    );
    res.json({ person: safeUser(user), projects: projects });
  });

  // Create person + assign projects + send invite
  app.post('/api/people', requireAuth, requireAdmin, function(req, res) {
    var body = req.body || {};
    var email = body.email, name = body.name, role = body.role, projects = body.projects;
    if (!email || !name) return res.status(400).json({ error: 'Email and name required' });
    email = email.toLowerCase().trim();
    name = name.trim();

    var existing = dbGet('SELECT * FROM users WHERE lower(email) = lower(?)', email);

    // ── Existing deactivated user → reactivate, add to project(s), send welcome email
    if (existing && existing.status === 'deactivated') {
      if (Array.isArray(projects)) {
        projects.forEach(function(p) {
          if (p.id) {
            dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role, company_id) VALUES (?, ?, ?, ?, ?)',
              existing.id, p.id, JSON.stringify(p.permissions || {}), p.role || 'member', body.company_id || null);
          }
        });
      }
      // Reactivate
      dbRun("UPDATE users SET status = 'active', invite_status = 'accepted', updated_at = ? WHERE id = ?",
        nowISO(), existing.id);
      // Gather project names for the welcome email
      var projectNames = [];
      if (Array.isArray(projects)) {
        projects.forEach(function(p) {
          if (p.id) {
            var prj = dbGet('SELECT name FROM projects WHERE id = ?', p.id);
            if (prj) projectNames.push(prj.name);
          }
        });
      }
      if (projectNames.length > 0 && sendProjectWelcomeEmail) {
        try { sendProjectWelcomeEmail(email, existing.name || name, projectNames); } catch(e) {}
      }
      var updated = dbGet('SELECT * FROM users WHERE id = ?', existing.id);
      return res.status(200).json({ person: safeUser(updated), reactivated: true });
    }
    if (existing && existing.status === 'active') {
      if (Array.isArray(projects)) {
        projects.forEach(function(p) {
          if (p.id) {
            dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role, company_id) VALUES (?, ?, ?, ?, ?)',
              existing.id, p.id, JSON.stringify(p.permissions || {}), p.role || 'member', body.company_id || null);
          }
        });
      }

      // Gather project names for the welcome email
      var projectNames = [];
      if (Array.isArray(projects)) {
        projects.forEach(function(p) {
          if (p.id) {
            var prj = dbGet('SELECT name FROM projects WHERE id = ?', p.id);
            if (prj) projectNames.push(prj.name);
          }
        });
      }
      if (projectNames.length > 0 && sendProjectWelcomeEmail) {
        try { sendProjectWelcomeEmail(email, existing.name || name, projectNames); } catch(e) {}
      }

      var updated = dbGet('SELECT * FROM users WHERE id = ?', existing.id);
      return res.status(200).json({ person: safeUser(updated), added: true });
    }

    // ── Existing pending user → add to project(s), no new email (they already have an invite)
    if (existing && existing.status === 'pending') {
      if (Array.isArray(projects)) {
        projects.forEach(function(p) {
          if (p.id) {
            dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role, company_id) VALUES (?, ?, ?, ?, ?)',
              existing.id, p.id, JSON.stringify(p.permissions || {}), p.role || 'member', body.company_id || null);
          }
        });
      }
      // Update name if the pending user was created without one
      if (!existing.name || existing.name === '') {
        dbRun('UPDATE users SET name = ? WHERE id = ?', name, existing.id);
      }
      var updated = dbGet('SELECT * FROM users WHERE id = ?', existing.id);
      return res.status(200).json({ person: safeUser(updated), pending: true });
    }

    // ── New user → create pending account + invite code (existing flow)
    var id = uid();
    var code = crypto.generateInviteCode();
    var ts = nowISO();
    var expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);
    var expires = expiryDate.toISOString();

    dbRun(
      'INSERT INTO users (id, email, name, pin_hash, role, status, invite_code, invite_status, invited_by, invited_at, invite_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, email, name, '', role || 'user', 'pending', code, 'pending', req.user.id, ts, expires, ts, ts
    );

    if (Array.isArray(projects)) {
      projects.forEach(function(p) {
        if (p.id) {
          dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role, company_id) VALUES (?, ?, ?, ?, ?)',
            id, p.id, JSON.stringify(p.permissions || {}), p.role || 'member', body.company_id || null);
        }
      });
    }

    var firstProject = (Array.isArray(projects) && projects[0]) ? projects[0] : null;
    dbRun('INSERT INTO invites (id, code, email, name, role, project_id, project_role, created_by, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uid(), code, email, name, role || 'user',
      firstProject ? firstProject.id : null,
      firstProject ? (firstProject.role || 'member') : 'member',
      req.user.id, 'pending', ts, expires
    );

    try { sendInviteEmail(email, name, code, expires); } catch(e) {}

    var person = dbGet('SELECT * FROM users WHERE id = ?', id);
    res.status(201).json({ person: safeUser(person) });
  });

  // Resend invite
  app.post('/api/people/:id/resend', requireAuth, requireAdmin, function(req, res) {
    var user = dbGet('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found' });
    if (user.status !== 'pending') return res.status(400).json({ error: 'User is already active' });

    var code = crypto.generateInviteCode();
    var expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);
    var expires = expiryDate.toISOString();
    var ts = nowISO();

    dbRun('UPDATE users SET invite_code = ?, invite_expires_at = ?, last_invite_sent_at = ? WHERE id = ?',
      code, expires, ts, req.params.id);
    dbRun('UPDATE invites SET code = ?, expires_at = ?, status = ? WHERE email = ? AND status = ?',
      code, expires, 'pending', user.email, 'pending');

    try { sendInviteEmail(user.email, user.name, code, expires); } catch(e) {}
    res.json({ ok: true, code: code });
  });

  // Update person details (name, role, company assignment)
  app.put('/api/people/:id', requireAuth, requireAdmin, function(req, res) {
    var user = dbGet('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found' });
    var name = req.body.name || user.name;
    var role = req.body.role || user.role;
    var ts = nowISO();
    dbRun('UPDATE users SET name = ?, role = ?, updated_at = ? WHERE id = ?', name, role, ts, req.params.id);
    // Update company_id in user_projects if provided
    if (req.body.company_id !== undefined) {
      dbRun('UPDATE user_projects SET company_id = ? WHERE user_id = ?', req.body.company_id || null, req.params.id);
    }
    // Update permissions in user_projects if provided
    if (req.body.permissions !== undefined) {
      var cleanPerms = normalizePermissions(req.body.permissions || {});
      dbRun('UPDATE user_projects SET permissions = ? WHERE user_id = ?', JSON.stringify(cleanPerms), req.params.id);
    }
    var updated = dbGet('SELECT u.*, up.company_id, up.role AS project_role FROM users u LEFT JOIN user_projects up ON up.user_id = u.id WHERE u.id = ?', req.params.id);
    res.json({ person: safeUser(updated) });
  });

  // Revoke invite / deactivate user
  app.delete('/api/people/:id', requireAuth, requireAdmin, function(req, res) {
    var user = dbGet('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found' });
    if (user.role === 'admin') return res.status(403).json({ error: 'Cannot delete admin users' });

    if (user.status === 'pending') {
      dbRun('DELETE FROM user_projects WHERE user_id = ?', req.params.id);
      dbRun('DELETE FROM users WHERE id = ?', req.params.id);
      dbRun('UPDATE invites SET status = ? WHERE email = ? AND status = ?', 'revoked', user.email, 'pending');
      res.json({ ok: true, revoked: true });
    } else {
      // Remove from all projects first, then deactivate
      dbRun('DELETE FROM user_projects WHERE user_id = ?', req.params.id);
      dbRun('UPDATE users SET status = ?, invite_status = ? WHERE id = ?', 'deactivated', 'revoked', req.params.id);
      dbRun('DELETE FROM auth_tokens WHERE user_id = ?', req.params.id);
      dbRun('UPDATE invites SET status = ? WHERE email = ? AND status = ?', 'revoked', user.email, 'pending');
      res.json({ ok: true, deactivated: true });
    }
  });

  // Edit project assignments
  app.put('/api/people/:id/projects', requireAuth, requireAdmin, function(req, res) {
    var user = dbGet('SELECT id FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).json({ error: 'Person not found' });

    var projects = req.body.projects;
    if (!Array.isArray(projects)) return res.status(400).json({ error: 'projects array required' });

    dbRun('DELETE FROM user_projects WHERE user_id = ?', req.params.id);
    projects.forEach(function(p) {
      if (p.id) {
        dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, ?, ?)',
          req.params.id, p.id, JSON.stringify(p.permissions || {}), p.role || 'member');
      }
    });

    var updated = dbGet('SELECT * FROM users WHERE id = ?', req.params.id);
    res.json({ person: safeUser(updated) });
  });
};
