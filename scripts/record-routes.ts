// Registra i percorsi dei tragitti demo per la landing statica (GitHub Pages), dove non c'è un server.
// Uso: npm run record:routes  (ogni tragitto in ogni lingua, una richiesta alla volta ai servizi pubblici di routing)
// Il file salvato è quello che il server restituisce davvero: se Valhalla non risponde, il ripiego a piedi resta dichiarato.
// Si registra una volta per lingua perché il percorso contiene testi del server (motivo della scelta, indicazioni di svolta).
import { writeFile } from 'node:fs/promises';
import { LANGS, type Lang } from '../shared/lang.ts';
import type { RouteResult } from '../shared/types.ts';
import { withLang } from '../server/messages.ts';
import { getRoute } from '../server/routing.ts';
import { SCENARIOS } from '../src/landing/copy.ts';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const routes = {} as Record<Lang, Record<string, RouteResult>>;
for (const lang of LANGS) {
  routes[lang] = {};
  for (const s of SCENARIOS) {
    const route = await withLang(lang, () => getRoute({ lat: s.from[0], lng: s.from[1] }, { lat: s.to[0], lng: s.to[1] }, {}));
    routes[lang][`${s.from.join(',')}|${s.to.join(',')}`] = route;
    console.log(`${lang} · ${s.name}: ${route.mode} (${route.provider}), ${Math.round(route.distanceM)} m`);
    await pause(1500); // istanze pubbliche gratuite: niente raffiche
  }
}
await writeFile(new URL('../server/data/routes-recorded.json', import.meta.url), JSON.stringify({ recordedAt: new Date().toISOString(), routes }));
