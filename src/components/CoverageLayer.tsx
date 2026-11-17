import L from 'leaflet';
import { useEffect } from 'react';
import { Polyline, useMap } from 'react-leaflet';
import { inTuscany, REGION_RINGS } from '../../shared/area.ts';
import { dataLevel, TILE_ZOOM, type OsmIndex } from '../../shared/tiles.ts';

// Tratteggio per livello di dati: [passo in px, opacità delle linee, opacità del velo]. Il passo divide 256,
// così il disegno continua senza salti da una tile all'altra. Fuori regione: solo un velo uniforme.
const STYLE = { none: [8, 0.34, 0.07], few: [16, 0.22, 0.03], out: [0, 0, 0.22] } as const;

const outside = new Map<string, boolean>();
/** Una cella senza file è "fuori regione" se il suo centro non è in Toscana (risultato in cache: il confine non cambia). */
function isOutside(x: number, y: number): boolean {
  const key = `${x}/${y}`;
  let out = outside.get(key);
  if (out === undefined) {
    const n = 2 ** TILE_ZOOM;
    const lng = ((x + 0.5) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    out = !inTuscany(lat, lng);
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
        const shift = TILE_ZOOM - coords.z;
        const per = shift > 0 ? 2 ** shift : 1;
        const px = size.x / per;
        const patterns = { none: hatch(ctx, STYLE.none[0], ink, STYLE.none[1]), few: hatch(ctx, STYLE.few[0], ink, STYLE.few[1]) };
        for (let i = 0; i < per; i++) {
          for (let j = 0; j < per; j++) {
            const x = shift > 0 ? coords.x * per + i : coords.x >> -shift;
            const y = shift > 0 ? coords.y * per + j : coords.y >> -shift;
            const count = index.cells[`${x}/${y}`];
            const level = count === undefined && isOutside(x, y) ? 'out' : dataLevel(count);
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

  // Confine della regione: l'area in cui OpenWay calcola percorsi e accetta segnalazioni.
  return (
    <>
      {REGION_RINGS.map((ring, i) => (
        <Polyline key={i} positions={[...ring, ring[0]]} interactive={false}
          pathOptions={{ color: dark ? '#94a3b8' : '#475569', weight: 1.5, dashArray: '6 6', opacity: 0.6, fill: false }} />
      ))}
    </>
  );
}
