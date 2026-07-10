/* routes/auth.js — Authentication routes for Align PM
 * =================================================================
 * Depends on server.js for: dbGet, dbRun, dbAll, nowISO, safeUser,
 * setAuthCookie, logSecurity, sessions, invites, bcrypt, crypto,
 * signinLimiter, setupLimiter, inviteLimiter, recordInviteFailure,
 * DEV_MODE, requireAuth, requireAdmin
 */

module.exports = function(app, deps) {
  var dbGet = deps.dbGet, dbRun = deps.dbRun, dbAll = deps.dbAll;
  var nowISO = deps.nowISO, safeUser = deps.safeUser;
  var setAuthCookie = deps.setAuthCookie, logSecurity = deps.logSecurity;
  var sessions = deps.sessions, invites = deps.invites;
  var bcrypt = deps.bcrypt, crypto = deps.crypto;
  var signinLimiter = deps.signinLimiter, setupLimiter = deps.setupLimiter;
  var inviteLimiter = deps.inviteLimiter;
  var recordInviteFailure = deps.recordInviteFailure;
  var DEV_MODE = deps.DEV_MODE;
  var requireAuth = deps.requireAuth, requireAdmin = deps.requireAdmin;

  // Public user list — minimal info for the sign-in screen (no auth needed)
  app.get('/api/auth/who', (_req, res) => {
    // Only expose names — no emails or IDs to unauthenticated users
    var users = dbAll('SELECT id, name, role FROM users ORDER BY name');
    res.json({ users: users.map(function(u) { return { name: u.name, role: u.role }; }) });
  });

  app.post('/api/auth/signin', signinLimiter, function(req, res) {
    var body = req.body || {};
    var username = body.username, email = body.email, pin = body.pin, password = body.password;
    var pass = password || pin;
    var identifier = (username || email || '').toLowerCase().trim();

    // DEV MODE: admin signs in without password
    if (DEV_MODE && identifier && !pass) {
      var devUser = dbGet("SELECT * FROM users WHERE (username = ? OR email = ?) AND role = 'admin'", identifier, identifier);
      if (devUser) {
        var session = sessions.createSession(dbRun, devUser.id);
        res.cookie('align-token', session.id, {
          httpOnly: true, secure: true, sameSite: 'lax',
          maxAge: sessions.SESSION_DAYS * 24 * 60 * 60 * 1000, path: '/'
        });
        return res.json({ user: safeUser(devUser), devMode: true });
      }
    }

    if (!identifier || !pass) return res.status(400).json({ error: 'Username and password required' });

    var user = dbGet('SELECT * FROM users WHERE username = ? OR email = ?', identifier, identifier);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    // Lockout check
    if (user.locked_until && user.locked_until > nowISO()) {
      var minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        error: 'Account locked. Too many failed attempts.',
        detail: 'Try again in ' + minsLeft + ' minute' + (minsLeft !== 1 ? 's' : '') + ' or contact your administrator.',
        locked_until: user.locked_until
      });
    }

    if (!bcrypt.compareSync(pass, user.pin_hash)) {
      var newCount = (user.failed_attempts || 0) + 1;
      var MAX_ATTEMPTS = 10;
      if (newCount >= MAX_ATTEMPTS) {
        var lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        dbRun('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', newCount, lockUntil, user.id);
        return res.status(423).json({
          error: 'Account locked. Too many failed attempts.',
          detail: 'Try again in 30 minutes or contact your administrator.',
          locked_until: lockUntil
        });
      }
      dbRun('UPDATE users SET failed_attempts = ? WHERE id = ?', newCount, user.id);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Success — reset failed attempts and clear lockout
    if (user.failed_attempts > 0 || user.locked_until) {
      dbRun('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', user.id);
    }

    var session = sessions.createSession(dbRun, user.id);
    var freshUser = dbGet('SELECT * FROM users WHERE id = ?', user.id);
    res.cookie('align-token', session.id, {
      httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: sessions.SESSION_DAYS * 24 * 60 * 60 * 1000, path: '/'
    });
    res.json({ user: safeUser(freshUser) });
  });

  // ── Token-based login (for SPA router + Capacitor) ──
  app.post('/api/auth/login', signinLimiter, function(req, res) {
    var body = req.body || {};
    var email = (body.email || body.username || '').toLowerCase().trim();
    var password = body.password || '';

    if (!email || !password) return res.status(400).json({ error: 'Username and password required', field: !email ? 'email' : 'password' });

    var user = dbGet('SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?', email, email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // Lockout check
    if (user.locked_until && user.locked_until > nowISO()) {
      var minsLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({ error: 'Account locked. Try again in ' + minsLeft + ' min.', locked_until: user.locked_until });
    }

    if (!bcrypt.compareSync(password, user.pin_hash)) {
      var newCount = (user.failed_attempts || 0) + 1;
      var MAX = 10;
      if (newCount >= MAX) {
        var lockUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        dbRun('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', newCount, lockUntil, user.id);
        return res.status(423).json({ error: 'Account locked. Too many failed attempts.', locked_until: lockUntil });
      }
      dbRun('UPDATE users SET failed_attempts = ? WHERE id = ?', newCount, user.id);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Success — reset lockout
    if (user.failed_attempts > 0 || user.locked_until) {
      dbRun('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', user.id);
    }

    // Generate bearer token
    var rawToken = crypto.randomBytes(32).toString('base64url');
    var expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    var hash = crypto.createHash('sha256').update(rawToken).digest('hex');
    dbRun('INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      user.id, hash, expiresAt);

    // Backward compat: set cookie too
    res.cookie('align-token', rawToken, {
      httpOnly: true, secure: true, sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, path: '/'
    });

    // Build bootstrap response
    var freshUser = dbGet('SELECT * FROM users WHERE id = ?', user.id);
    var projects = [];
    if (freshUser.role === 'admin') {
      projects = dbAll('SELECT p.* FROM projects p ORDER BY p.created_at DESC');
    } else {
      projects = dbAll(
        'SELECT p.*, up.role AS project_role FROM projects p JOIN user_projects up ON up.project_id = p.id WHERE up.user_id = ?',
        freshUser.id
      );
    }
    projects = projects.map(function (p) {
      var count = dbGet('SELECT COUNT(*) AS n FROM user_projects WHERE project_id = ?', p.id);
      return { id: p.id, name: p.name, address: p.address || '', role: p.project_role || (freshUser.role === 'admin' ? 'super_admin' : 'user'), memberCount: count ? count.n : 0 };
    });

    var allTiles = ['daily-logs','punchlist','drawings','files','photos','tasks','contacts','schedule','budget','specs','procurement','rfis'];
    var tiles = allTiles.slice();
    if (freshUser.role === 'admin') tiles = tiles.concat(['settings','members','dev']);

    res.json({ token: rawToken, user: safeUser(freshUser), projects: projects, tiles: tiles });
  });

  // ── Token-based logout ──
  app.post('/api/auth/logout', requireAuth, function(req, res) {
    // Revoke bearer token
    dbRun('DELETE FROM auth_tokens WHERE token_hash = ?', crypto.createHash('sha256').update(req.token).digest('hex'));
    // Also try old sessions table
    try { sessions.revokeSession(dbRun, req.token); } catch (_) {}
    res.clearCookie('align-token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });

  app.post('/api/auth/signout', requireAuth, function(req, res) {
    sessions.revokeSession(dbRun, req.token);
    res.clearCookie('align-token', { httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  app.post('/api/auth/signout-all', requireAuth, function(req, res) {
    sessions.revokeAllSessions(dbRun, req.user.id, req.token);
    logSecurity('signout_all', { actor: req.user.username, msg: req.user.username + ' signed out all other devices' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, function(req, res) {
    res.json({ user: safeUser(req.user) });
  });

  // ACCOUNT SETUP: invited user chooses username and sets password
  app.post('/api/auth/setup-account', setupLimiter, function(req, res) {
    var body = req.body || {};
    var token = body.token, code = body.code, username = body.username;
    var pin = body.pin, password = body.password;
    var inviteKey = code || token;
    var pass = password || pin;
    if (!inviteKey || !username || !pass) return res.status(400).json({ error: 'invite code, username, and password required' });
    if (pass.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    var usernameClean = username.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (usernameClean.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });

    if (dbGet('SELECT id FROM users WHERE username = ?', usernameClean))
      return res.status(409).json({ error: 'Username already taken' });

    // Try legacy invite_token
    var legacyUser = dbGet("SELECT * FROM users WHERE invite_token = ? AND status = 'invited'", inviteKey);
    if (legacyUser) {
      if (dbGet('SELECT id FROM users WHERE username = ? AND id != ?', usernameClean, legacyUser.id))
        return res.status(409).json({ error: 'Username already taken' });

      var pin_hash = bcrypt.hashSync(pass, 10);
      dbRun('UPDATE users SET username = ?, pin_hash = ?, status = ?, invite_token = NULL, updated_at = ? WHERE id = ?',
        usernameClean, pin_hash, 'active', nowISO(), legacyUser.id);

      var session = sessions.createSession(dbRun, legacyUser.id);
      var updated = dbGet('SELECT * FROM users WHERE id = ?', legacyUser.id);
      setAuthCookie(res, session.id);
      return res.json({ user: safeUser(updated) });
    }

    // Try new invite code (invites table)
    var invite = invites.redeemInvite(dbGet, dbRun, inviteKey);
    if (invite.error) return res.status(404).json({ error: invite.error });

    if (invite.revoked_at) return res.status(410).json({ error: 'This invite is no longer valid.' });

    // Check for existing pending user from People API
    var pendingUser = dbGet("SELECT * FROM users WHERE email = ? AND status = 'pending'", invite.email);
    if (pendingUser) {
      if (dbGet('SELECT id FROM users WHERE username = ? AND id != ?', usernameClean, pendingUser.id)) {
        recordInviteFailure(invite);
        return res.status(409).json({ error: 'Username already taken' });
      }

      var pin_hash = bcrypt.hashSync(pass, 10);
      dbRun('UPDATE users SET username = ?, pin_hash = ?, password_hash = ?, status = ?, invite_status = ?, active_project_id = ?, updated_at = ? WHERE id = ?',
        usernameClean, pin_hash, pin_hash, 'active', 'accepted', invite.project_id || null, nowISO(), pendingUser.id);

      if (invite.project_id) {
        dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, ?, ?)',
          pendingUser.id, invite.project_id, '{}', invite.project_role || 'member');
      }

      invites.markRedeemed(dbRun, invite.id, pendingUser.id);
      var session = sessions.createSession(dbRun, pendingUser.id);
      var updated = dbGet('SELECT * FROM users WHERE id = ?', pendingUser.id);
      setAuthCookie(res, session.id);
      return res.json({ user: safeUser(updated) });
    }

    // No existing user — create one from invite
    var userId = deps.uid();
    var pin_hash = bcrypt.hashSync(pass, 10);
    var ts = nowISO();
    dbRun(
      'INSERT INTO users (id, username, email, name, pin_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      userId, usernameClean, invite.email, invite.name, pin_hash, invite.role || 'user', 'active', ts, ts
    );

    if (invite.project_id) {
      dbRun('INSERT OR IGNORE INTO user_projects (user_id, project_id, permissions, role) VALUES (?, ?, ?, ?)',
        userId, invite.project_id, '{}', invite.project_role || 'member');
    }

    invites.markRedeemed(dbRun, invite.id, userId);

    var session = sessions.createSession(dbRun, userId);
    var newUser = dbGet('SELECT * FROM users WHERE id = ?', userId);
    setAuthCookie(res, session.id);
    res.json({ user: safeUser(newUser) });
  });

  // Legacy accept-invite (fallback for old invite links without setup flow)
  app.post('/api/auth/accept-invite', inviteLimiter, function(req, res) {
    var body = req.body || {};
    var token = body.token, pin = body.pin;
    if (!token || !pin) return res.status(400).json({ error: 'token and pin required' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be exactly 4 digits' });

    var user = dbGet('SELECT * FROM users WHERE invite_token = ? AND status = ?', token, 'invited');
    if (!user) return res.status(404).json({ error: 'Invalid or expired invite link' });

    var pin_hash = bcrypt.hashSync(pin, 10);
    dbRun('UPDATE users SET pin_hash = ?, status = ?, invite_token = NULL, updated_at = ? WHERE id = ?',
      pin_hash, 'active', nowISO(), user.id);

    var session = sessions.createSession(dbRun, user.id);
    var updated = dbGet('SELECT * FROM users WHERE id = ?', user.id);
    setAuthCookie(res, session.id);
    res.json({ user: safeUser(updated) });
  });

  // Project-scoped user list
  app.get('/api/auth/user-list', requireAuth, function(req, res) {
    if (req.user.role === 'admin') {
      var users = dbAll('SELECT id, email, name, role, status FROM users ORDER BY created_at');
      return res.json({ users: users });
    }
    var users = dbAll(
      'SELECT DISTINCT u.id, u.email, u.name, u.role, u.status ' +
      'FROM users u ' +
      'JOIN user_projects up ON u.id = up.user_id ' +
      'WHERE up.project_id IN (SELECT project_id FROM user_projects WHERE user_id = ?) ' +
      'ORDER BY u.name',
      req.user.id
    );
    res.json({ users: users });
  });

};
