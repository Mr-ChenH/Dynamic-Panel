import { readFile } from 'node:fs/promises';

const ASSETS = Object.freeze({
  '/console/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/console/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' }
});
const indexUrl = new URL('../console/index.html', import.meta.url);

export async function consoleRoutes(app) {
  const index = await readFile(indexUrl);
  const assets = new Map(await Promise.all(Object.entries(ASSETS).map(async ([route, asset]) => [route, { ...asset, body: await readFile(new URL(`../console/${asset.file}`, import.meta.url)) }])));

  app.get('/console/styles.css', async (_request, reply) => reply.type(assets.get('/console/styles.css').type).header('cache-control', 'public, max-age=3600').send(assets.get('/console/styles.css').body));
  app.get('/console/app.js', async (_request, reply) => reply.type(assets.get('/console/app.js').type).header('cache-control', 'public, max-age=3600').send(assets.get('/console/app.js').body));
  const shell = async (_request, reply) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(index);
  app.get('/console', shell);
  app.get('/console/', shell);
  app.get('/console/*', shell);
  app.get('/', async (_request, reply) => reply.redirect('/console/'));
}
