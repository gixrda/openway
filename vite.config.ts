import react from '@vitejs/plugin-react';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import { createApi } from './server/api.ts';
import { ensureTiles, writeLandingTiles } from './server/tiles.ts';
import { cellsAlongLine } from './shared/tiles.ts';
import { it as landingCopy } from './src/landing/copy.it.ts';
import { DEMO_URL } from './src/landing/env.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const osmDir = `${root}server/data/osm-tiles`;
// Griglia dei dati OSM: quella regionale se è stata scaricata o costruita, altrimenti creata dallo snapshot demo di Pisa.
const osmReady = () => ensureTiles(osmDir, `${root}server/data/osm-pisa.json`);

// Versione statica della landing per GitHub Pages: `vite build --mode static`.
// Pages non permette header HTTP, quindi la Content Security Policy viaggia come <meta>.
const PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // stili inline di Leaflet e delle animazioni
  "font-src 'self'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  // Nominatim per la ricerca; stile, tile, caratteri e icone della mappa vettoriale da OpenFreeMap;
  // la demo pubblica, che la landing sveglia in anticipo con una richiesta (src/landing/prewarm.ts).
  `connect-src 'self' https://nominatim.openstreetmap.org https://tiles.openfreemap.org${DEMO_URL ? ` ${new URL(DEMO_URL).origin}` : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  'upgrade-insecure-requests',
].join('; ');

function pagesBuild(): Plugin {
  return {
    name: 'openway-pages',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${PAGES_CSP}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
    async closeBundle() {
      // Dati serviti come file (al posto delle API) e landing come pagina iniziale del sito.
      const out = `${root}dist-pages/`;
      await mkdir(`${out}data`, { recursive: true });
      const osm = await osmReady();
      if (osm.scope === 'demo') console.warn('\nDati OSM: solo lo snapshot demo di Pisa (npm run osm:download per tutta l\'Italia).');
      // Celle ridotte agli ostacoli noti, complete solo attorno ai tragitti demo (300 m di margine): vedi writeLandingTiles.
      const demoCells = new Set(landingCopy.demo.scenarios.flatMap((s) => cellsAlongLine([s.from, s.to], 300)));
      const copied = await writeLandingTiles(osmDir, `${out}data/osm`, demoCells);
      console.log(`\nDati OSM per la landing: ${copied.cells} celle, ${(copied.bytes / 1e6).toFixed(1)} MB`);
      await copyFile(`${root}server/data/routes-recorded.json`, `${out}data/routes-recorded.json`);
      await copyFile(`${out}landing/index.html`, `${out}index.html`);
      await copyFile(`${out}index.html`, `${out}404.html`);
    },
  };
}

// Il worker di MapLibre è un file .mjs: lo si pubblica come .js, perché non tutti i server statici
// (compreso server/index.ts) associano a .mjs il tipo JavaScript, e un worker a moduli con il tipo sbagliato non parte.
const output = {
  assetFileNames: (asset: { names?: string[] }) =>
    asset.names?.[0]?.endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
};

export default defineConfig(({ mode }): UserConfig => {
  if (mode === 'static') {
    process.env.VITE_STATIC = '1';
    return {
      base: '/openway/',
      build: { outDir: 'dist-pages', rollupOptions: { input: { landing: `${root}landing/index.html` }, output } },
      plugins: [react(), pagesBuild()],
    };
  }
  return {
    // Due pagine: l'app su / (link demo ?from=&to=) e la landing su /landing/.
    build: { rollupOptions: { input: { app: `${root}index.html`, landing: `${root}landing/index.html` }, output } },
    plugins: [
      react(),
      {
        // Le API girano nello stesso processo di Vite: un solo comando (npm run dev) per la demo.
        name: 'openway-api',
        async configureServer(server) {
          await osmReady();
          const api = createApi({
            env: { ...process.env, ...loadEnv(mode, root, '') }, // le chiavi restano lato server, senza prefisso VITE_
            reportsFile: `${root}server/data/reports.json`,
            osmDir,
          });
          server.middlewares.use((req, res, next) => { api(req, res).then((handled) => handled || next(), next); });
        },
      },
    ],
  };
});
