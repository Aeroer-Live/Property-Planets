import { Client } from 'pg';
import type { Env } from './types';

/**
 * Hyperdrive: create a new Client per request (recommended by Cloudflare).
 * Connects, runs fn(client), then closes. Use this for all DB access.
 */
export async function withClient<T>(
  env: Env,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const conn = env.HYPERDRIVE?.connectionString;
  if (!conn) {
    throw new Error('Neon/Hyperdrive not configured. Set HYPERDRIVE binding in wrangler.toml.');
  }
  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
