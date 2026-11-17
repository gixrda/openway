import L from 'leaflet';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { inArea } from '../../shared/area.ts';
import { dataLevel, TILE_ZOOM, type OsmIndex } from '../../shared/tiles.ts';

// Tratteggio per livello di dati: [passo in px, opacità delle linee, opacità del velo]. Il passo divide 256,
// così il disegno continua senza salti da una tile all'altra. Fuori dall'Italia: solo un velo uniforme.
const STYLE = { none: [8, 0.34, 0.07], few: [16, 0.22, 0.03], out: [0, 0, 0.22] } as const;

const outside = new Map<string, boolean>();
/** Una cella senza file è "fuori area" se il suo centro non è in Italia (risultato in cache: il confine non cambia). */
function isOutside(x: number, y: number): boolean {
  const key = `${x}/${y}`;
  let out = outside.get(key);
  if (out === undefined) {
    const n = 2 ** TILE_ZOOM;
    const lng = ((x + 0.5) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    out = !inArea(lat, lng);
    outside.set(key, out);
  }
  return out;
}

function hatch(ctx: CanvasRenderingContext2D, step: number, color: string, alpha: number): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = c.height = step;
  const p = c.getContext('2d');
  if (!p) return null;
  p.strokeStyle = color;
  p.globalAlpha = alpha;
  p.lineWidth = 1;
  // Una diagonale più i due angoli: affiancando il riquadro le linee risultano continue.
  for (const o of [-step, 0, step]) { p.beginPath(); p.moveTo(o, step); p.lineTo(o + step, 0); p.stroke(); }
  return ctx.createPattern(c, 'repeat');
}

/**
 * Quanta informazione c'è, zona per zona: tratteggio fitto dove OpenStreetMap non ha dati utili a chi si muove
 * in sedia a rotelle, rado dove ne ha pochi, niente dove ne ha di più. È un disegno, non un colore: si legge anche
 * in bianco e nero. Il testo equivalente è nella striscia sotto la mappa (App.tsx) e nella legenda.
 */
export function CoverageLayer({ index, dark }: { index: OsmIndex; dark: boolean }) {
  const map = useMap();
  useEffect(() => {
    const ink = dark ? '#e2e8f0' : '#1e293b';
    const Layer = L.GridLayer.extend({
      createTile(this: L.GridLayer, coords: L.Coords): HTMLElement {
        const size = this.getTileSize();
        const canvas = document.createElement('canvas');
        const ratio = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = size.x * ratio;
        canvas.height = size.y * ratio;
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas;
        ctx.scale(ratio, ratio);
        // Sopra il livello 14 una tile sta dentro una sola cella; sotto ne contiene 4, 16, 64… per lato.
        // Da lontano (tutta l'Italia in vista) le celle sarebbero più piccole di un pixel: si disegnano blocchi
        // di celle di almeno 4 px, con il livello della media dei loro dati.
        const shift = TILE_ZOOM - coords.z;
        const block = 2 ** Math.max(0, shift - 6); // celle per lato di un blocco
        const per = shift > 0 ? 2 ** shift / block : 1; // blocchi per lato della tile
        const px = size.x / per;
        const patterns = { none: hatch(ctx, STYLE.none[0], ink, STYLE.none[1]), few: hatch(ctx, STYLE.few[0], ink, STYLE.few[1]) };
        for (let i = 0; i < per; i++) {
          for (let j = 0; j < per; j++) {
            const x = shift > 0 ? (coords.x * per + i) * block : coords.x >> -shift;
            const y = shift > 0 ? (coords.y * per + j) * block : coords.y >> -shift;
            let sum = 0, files = 0;
            for (let dx = 0; dx < block; dx++) {
              for (let dy = 0; dy < block; dy++) {
                const count = index.cells[`${x + dx}/${y + dy}`];
                if (count !== undefined) { files++; sum += count; }
              }
            }
            const half = block >> 1;
            const level = !files && isOutside(x + half, y + half) ? 'out' : dataLevel(sum && Math.ceil(sum / (block * block)));
            if (level === 'some') continue;
            ctx.globalAlpha = STYLE[level][2];
            ctx.fillStyle = ink;
            ctx.fillRect(i * px, j * px, px, px);
            if (level === 'out') continue;
            const pattern = patterns[level];
            if (!pattern) continue;
            ctx.globalAlpha = 1;
            ctx.fillStyle = pattern;
            ctx.fillRect(i * px, j * px, px, px);
          }
        }
        return canvas;
      },
    }) as unknown as new (options: L.GridLayerOptions) => L.GridLayer;
    const layer = new Layer({ zIndex: 2, minZoom: 0, maxZoom: 22, updateWhenZooming: false, className: 'coverage' });
    layer.addTo(map);
    return () => { layer.remove(); };
  }, [map, index, dark]);

  return null;
}
