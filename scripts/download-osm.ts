// Scarica la griglia dei dati OSM di tutta l'Italia già pronta (server/data/osm-tiles/), senza bisogno di osmium.
// Uso: npm run osm:download
// L'archivio è l'allegato della release "osm-data" del repository, rigenerato ogni settimana dal workflow
// .github/workflows/osm-data.yml con `npm run osm:build`. Senza questi dati l'app usa lo snapshot demo di Pisa.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { decodeIndex, type OsmIndexFile } from '../shared/tiles.ts';

const ARCHIVE_URL = process.env.OSM_TILES_URL ?? 'https://github.com/gixrda/openway/releases/download/osm-data/osm-tiles.tar.gz';
const root = fileURLToPath(new URL('..', import.meta.url));
const cache = `${root}.cache/osm/`;
const archive = `${cache}osm-tiles.tar.gz`;
const unpacked = `${cache}unpacked`;
const target = `${root}server/data/osm-tiles`;

await mkdir(cache, { recursive: true });
const res = await fetch(ARCHIVE_URL, { headers: { 'User-Agent': 'OpenWay-hackathon/0.1' } });
if (!res.ok || !res.body) throw new Error(`Dati non disponibili (${ARCHIVE_URL}: HTTP ${res.status}). I dati esistenti non sono stati modificati.`);
await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(archive));

// L'archivio contiene una sola cartella "osm-tiles": si estrae a parte e si controlla prima di sostituire i dati in uso.
await rm(unpacked, { recursive: true, force: true });
await mkdir(unpacked, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', unpacked], { stdio: 'inherit' });
const index = decodeIndex(JSON.parse(await readFile(`${unpacked}/osm-tiles/index.json`, 'utf8')) as OsmIndexFile);
if (index.scope !== 'full' || !Object.keys(index.cells ?? {}).length) throw new Error('Archivio non valido: i dati esistenti non sono stati modificati.');
await rm(target, { recursive: true, force: true });
await rename(`${unpacked}/osm-tiles`, target);
await rm(unpacked, { recursive: true, force: true });
await rm(archive, { force: true }); // l'archivio non serve più: 125 MB in meno su disco
console.log(`Dati OSM del ${index.fetchedAt}: ${Object.keys(index.cells).length} celle in server/data/osm-tiles/`);
