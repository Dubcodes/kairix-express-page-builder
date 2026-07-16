import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, ROLES } from "../db.js";
import { config } from "../config.js";

const ROLE_PERMISSIONS = {
  Admin: ["*"],
  Publisher: ["read", "write", "files", "publish"],
  Editor: ["read", "write"],
  "File Manager": ["read", "files"],
  "Analytics Viewer": ["read", "analytics"],
  "Read Only": ["read"]
};

function hashToken(token) {
  return crypto.createHmac("sha256", config.sessionSecret).update(token).digest("hex");
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(token) {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 12
  };
}

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function authMiddleware(req, _res, next) {
  const token = req.cookies?.kairix_session;
  if (!token) return next();
  const session = db.prepare(`
    SELECT sessions.*, users.id, users.username, users.email, users.role, users.status,
      users.support_access_expires_at, users.password_reset_required
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND julianday(sessions.expires_at) > julianday('now')
  `).get(hashToken(token));
  if (session) {
    const expiredSupport = session.support_access_expires_at && new Date(session.support_access_expires_at) <= new Date();
    if (session.status !== "active" || expiredSupport) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
      return next();
    }
    req.user = {
      id: session.user_id,
      username: session.username,
      email: session.email,
      role: session.role,
      status: session.status,
      supportAccessExpiresAt: session.support_access_expires_at,
      passwordResetRequired: Boolean(session.password_reset_required)
    };
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

export function can(user, permission) {
  if (!user) return false;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!can(req.user, permission)) return res.status(403).json({ error: "Not allowed for this role" });
    next();
  };
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

export function createOneTimeToken() {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashInviteToken(token) {
  return hashToken(token);
}

export function hashResetToken(token) {
  return hashToken(token);
}

export function destroyUserSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
