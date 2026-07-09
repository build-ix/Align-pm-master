/*
 * align-auth.js — Server-side authorization middleware for Align PM
 * ===================================================================
 * Provides role-based access control for project-scoped routes.
 * Dependency-injected: every factory takes `dbGet` as first argument,
 * matching the pattern used by align-sessions.js.
 *
 * Role hierarchy:  member < admin (server admins bypass all checks via users.role)
 * Server admins (users.role === 'admin') always pass — no project-level superadmin.
 *
 * USAGE:
 *   const auth = require('./align-auth');
 *   app.get('/api/projects/:id/data', requireAuth,
 *     auth.requireProjectMember(dbGet), handler);
 *   app.delete('/api/projects/:id', requireAuth,
 *     auth.requireProjectRole(dbGet, 'admin'), handler);
 */

const ROLES = ['member', 'admin'];

/* ═══════════════════════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * Extract project ID from request. Checks params, body, and query
 * in the order the existing routes use.
 */
function extractProjectId(req) {
  return req.params.id
      || req.params.pid
      || (req.body && req.body.project_id)
      || (req.query && req.query.project_id);
}

/**
 * Check if a user is a server-level admin (superadmin).
 */
function isServerAdmin(user) {
  return user && user.role === 'admin';
}

/* ═══════════════════════════════════════════════════════════════════
 * MIDDLEWARE FACTORIES
 * ═══════════════════════════════════════════════════════════════════ */

/**
 * requireProjectRole(dbGet, role) → Express middleware
 *
 * Checks that the authenticated user has at least `role` in the
 * target project. Server admins always pass.
 *
 * @param {Function} dbGet — server's dbGet wrapper
 * @param {string}    role  — 'member' | 'admin' | 'superadmin'
 */
function requireProjectRole(dbGet, role) {
  const requiredLevel = ROLES.indexOf(role);
  if (requiredLevel === -1) throw new Error('Invalid role: ' + role);

  return function projectRoleMiddleware(req, res, next) {
    // Server admins bypass all project checks
    if (isServerAdmin(req.user)) return next();

    const pid = extractProjectId(req);
    if (!pid) {
      return res.status(400).json({ error: 'Project ID required' });
    }

    const membership = dbGet(
      'SELECT role FROM user_projects WHERE user_id = ? AND project_id = ?',
      req.user.id, pid
    );

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this project' });
    }

    const userLevel = ROLES.indexOf(membership.role);
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: 'Requires ' + role + ' role or higher in this project'
      });
    }

    // Attach project context for downstream handlers
    req.projectId = pid;
    req.projectRole = membership.role;

    next();
  };
}

/**
 * requireProjectMember(dbGet) → Express middleware
 *
 * Shorthand: user must be at least a member of the target project.
 */
function requireProjectMember(dbGet) {
  return requireProjectRole(dbGet, 'member');
}

/**
 * requireProjectAdmin(dbGet) → Express middleware
 *
 * Shorthand: user must be an admin of the target project.
 * Replaces the inline requireProjectAdmin in server.js.
 */
function requireProjectAdmin(dbGet) {
  return requireProjectRole(dbGet, 'admin');
}

/**
 * requireRoom(dbGet, room, level) → Express middleware
 *
 * Room-level access control. Checks the `permissions` JSON on the
 * user's project membership.  Levels: 'r' (read) | 'rw' (read-write).
 *
 * Bypass: server admins + project admins always have full access.
 * Missing key in permissions = default 'rw' (member sees everything).
 * 'none' = 404 (don't leak room existence).
 * level 'rw' for a member with only 'r' = 403.
 */
const ROOMS = ['drawings','daily-logs','specs','rfis','punchlist','schedule','budget','contacts','photos','tasks','procurement','files','settings'];

function requireRoom(dbGet, room, level) {
  level = level || 'r';

  return function roomMiddleware(req, res, next) {
    // Landlord bypass
    if (isServerAdmin(req.user)) return next();

    const pid = extractProjectId(req);
    if (!pid) return res.status(400).json({ error: 'Project ID required' });

    const membership = dbGet(
      'SELECT role, permissions FROM user_projects WHERE user_id = ? AND project_id = ?',
      req.user.id, pid
    );

    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });

    // House owner bypass
    if (membership.role === 'admin') return next();

    // Parse permissions JSON
    var perms = {};
    try { perms = JSON.parse(membership.permissions || '{}'); } catch(e) {}

    var perm = perms[room] || 'rw'; // default: full access

    if (perm === 'none') return res.status(404).json({ error: 'Not found' });
    if (level === 'rw' && perm !== 'rw') {
      return res.status(403).json({ error: 'Read-only access for ' + room });
    }

    next();
  };
}

/**
 * requireRoomFromParams(dbGet, level) → Express middleware
 *
 * Like requireRoom but reads the room name from req.params.cat
 * (for generic /api/projects/:pid/:cat routes).  Also checks
 * req.params.room as a fallback.
 */
function requireRoomFromParams(dbGet, level) {
  level = level || 'r';

  return function roomMiddleware(req, res, next) {
    if (isServerAdmin(req.user)) return next();

    const pid = extractProjectId(req);
    if (!pid) return res.status(400).json({ error: 'Project ID required' });

    const room = req.params.cat || req.params.room;
    if (!room) return next(); // no room in URL, skip check

    const membership = dbGet(
      'SELECT role, permissions FROM user_projects WHERE user_id = ? AND project_id = ?',
      req.user.id, pid
    );

    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
    if (membership.role === 'admin') return next();

    var perms = {};
    try { perms = JSON.parse(membership.permissions || '{}'); } catch(e) {}

    var perm = perms[room] || 'rw';

    if (perm === 'none') return res.status(404).json({ error: 'Not found' });
    if (level === 'rw' && perm !== 'rw') {
      return res.status(403).json({ error: 'Read-only access for ' + room });
    }

    next();
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════ */

module.exports = {
  requireProjectRole,
  requireProjectMember,
  requireProjectAdmin,
  requireRoom,
  requireRoomFromParams,
  // Helpers exported for use in routes that need manual checks
  extractProjectId,
  isServerAdmin,
  ROLES,
  ROOMS,
};
