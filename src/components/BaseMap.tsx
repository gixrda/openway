import type L from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { TileLayer, useMap } from 'react-leaflet';

// Mappa di base vettoriale: stile "Liberty" di OpenFreeMap, disegnato nel browser da MapLibre GL.
// Dati OpenStreetMap, nessuna chiave e nessuna registrazione. È un servizio pubblico senza garanzie:
// se non risponde, o se il browser non ha WebGL, si torna alle tile raster di OpenStreetMap usate prima.
// Per il tema scuro non si usa lo stile "Dark" di OpenFreeMap (strade e fiumi quasi invisibili):
// si inverte lo stesso stile via CSS, come già si faceva con le tile raster.
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
/** Tempo concesso allo stile per caricarsi prima di ripiegare sulle tile raster. */
const STYLE_TIMEOUT_MS = 8000;

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Va messa dentro una MapContainer al posto di una TileLayer.
 * `className` va sul canvas della mappa vettoriale, `rasterClassName` sulle tile di ripiego:
 * i filtri (tema scuro, desaturazione) sono nei fogli di stile.
 */
export function BaseMap({ className, rasterClassName }: { className: string; rasterClassName: string }) {
  const map = useMap();
  const [raster, setRaster] = useState(() => !hasWebGL());
  const classNow = useRef(className);
  classNow.current = className;

  useEffect(() => {
    if (raster) return;
    let live = true;
    let timer = 0;
    let created: L.MaplibreGL | null = null;
    const fallBack = (reason: unknown) => {
      if (!live) return;
      console.warn('Mappa vettoriale non disponibile, si usano le tile OpenStreetMap:', reason);
      setRaster(true);
    };
    // MapLibre pesa più del resto dell'app: si scarica a parte, solo quando serve una mappa.
    // Il suo worker è un file separato: gli si dà l'indirizzo che il bundler assegna al file (stessa origine della pagina).
    Promise.all([
      import('@maplibre/maplibre-gl-leaflet'),
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ])
      .then(([{ maplibreGL }, { setWorkerUrl }, worker]) => {
        if (!live) return;
        setWorkerUrl(worker.default);
        // `className` è un'opzione del plugin (la mette sul canvas), non di MapLibre.
        created = maplibreGL({ style: STYLE, className: classNow.current } as L.LeafletMaplibreGLOptions);
        created.addTo(map);
        const gl = created.getMaplibreMap();
        // "Pronta" = stile arrivato (evento style.load). Non si aspetta il primo disegno: in una scheda in secondo piano
        // il browser non disegna, e la mappa sembrerebbe guasta. Fino ad allora un errore o un'attesa troppo lunga
        // fanno ripiegare; dopo, un errore è una singola tile mancata e si ignora. Il worker che non parte è sempre fatale.
        let ready = false;
        timer = window.setTimeout(() => { if (!ready) fallBack(`stile non arrivato dopo ${STYLE_TIMEOUT_MS / 1000} s`); }, STYLE_TIMEOUT_MS);
        gl.once('style.load', () => { ready = true; window.clearTimeout(timer); });
        gl.on('error', (e) => {
          const message = e.error?.message ?? '';
          if (!ready || message.includes('Worker')) fallBack(message || e);
        });
      })
      .catch(fallBack);
    return () => {
      live = false;
      window.clearTimeout(timer);
      created?.remove();
    };
  }, [map, raster]);

  if (!raster) return null;
  return (
    <TileLayer
      className={rasterClassName}
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      maxZoom={19}
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    />
  );
}
