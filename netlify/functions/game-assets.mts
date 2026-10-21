import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import catalog from '../../hosting/game-assets.json' with { type: 'json' };
import { serveGameAsset } from '../../hosting/serve-game-assets.mjs';

export default async (request: Request) => {
  return serveGameAsset(request, getStore(catalog.store), catalog);
};

export const config: Config = {
  path: ['/b/*', '/data/*', '/__chunks/*', '/api/game-status'],
};
