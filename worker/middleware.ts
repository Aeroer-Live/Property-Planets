import type { Context, Next } from 'hono';
import { verifyJwt } from './lib/auth';
import type { Env, Variables } from './types';

const JWT_SECRET = 'property-planets-jwt-secret-change-in-production';

export async function requireAuth(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  try {
    const auth = c.req.header('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : c.req.cookie('token');
    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const payload = await verifyJwt(token, JWT_SECRET);
    if (!payload || !payload.sub) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    c.set('userId', payload.sub);
    c.set('userRole', payload.role ?? 'Staff');
    await next();
  } catch {
    return c.json({ error: 'Unauthorized' }, 401);
  }
}

export function requireAdmin(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  if (c.get('userRole') !== 'Admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return next();
}

export function getJwtSecret(): string {
  return JWT_SECRET;
}
