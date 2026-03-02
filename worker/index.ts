import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { authRoutes } from './auth';
import { userRoutes } from './users';
import { propertyRoutes } from './properties';
import type { Env, Variables } from './types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return null;
    if (origin === 'http://localhost:8787' || origin === 'http://127.0.0.1:8787') return origin;
    if (origin.endsWith('.workers.dev') || origin.endsWith('.wealthbeegroup.workers.dev')) return origin;
    return null;
  },
  credentials: true,
}));

app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/properties', propertyRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

// Serve static assets for non-API routes
app.get('*', async (c) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) return c.notFound();
  const asset = c.env.ASSETS;
  if (asset) {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const res = await asset.fetch(new URL(path, c.req.url));
    if (res.status !== 404) return res;
  }
  return c.redirect('/index.html');
});

export default app;
