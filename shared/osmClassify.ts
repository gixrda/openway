// Regole che trasformano i tag OpenStreetMap in un'informazione leggibile (tipo, livello di certezza, etichetta).
// Stanno in shared/ perché l'etichetta dipende dalla lingua: il server le usa per creare lo snapshot,
// l'interfaccia per rigenerare l'etichetta nella lingua scelta a partire dai tag conservati.
import { DEFAULT_LANG, type Lang } from './lang.ts';
import type { Certainty, FeatureKind, OsmFeature } from './types.ts';

const ROUGH_SURFACES = new Set([
  'sett', 'cobblestone', 'unhewn_cobblestone', 'pebblestone', 'gravel', 'dirt', 'grass',
  'sand', 'ground', 'mud', 'earth', 'woodchips', 'rock', 'stepping_stones',
]);
const BAD_SMOOTHNESS = new Set(['bad', 'very_bad', 'horrible', 'very_horrible']);
const BLOCKING_BARRIERS = new Set(['stile', 'turnstile', 'kissing_gate', 'full-height_turnstile']);
const PASSAGE_BARRIERS = new Set([
  'bollard', 'gate', 'lift_gate', 'block', 'cycle_barrier', 'chain', 'swing_gate', 'sliding_gate', 'kerb',
]);

interface OsmText {
  surface: Record<string, string>;
  barrier: Record<string, string>;
  steps: (count: string | undefined, ramp: boolean) => string;
  notSuitable: string;
  impassable: string;
  kerbRaised: string;
  veryNarrow: (cm: string) => string;
  kerbRolled: string;
  kerbUnknown: string;
  inclineUnknown: string;
  inclineSteep: (percent: number) => string;
  rough: string;
  narrow: (cm: string) => string;
  limited: string;
  kerbLowered: string;
  suitable: string;
  crossing: string;
  surfaceInfo: string;
  placeNo: string;
  placeLimited: string;
  placeYes: string;
}

// Etichette in parole di tutti i giorni: le leggono anche persone che non conoscono i termini tecnici.
const TEXT: Record<Lang, OsmText> = {
  it: {
    surface: {
      sett: 'Lastricato in pietra', cobblestone: 'Acciottolato', unhewn_cobblestone: 'Acciottolato',
      pebblestone: 'Ciottoli', gravel: 'Ghiaia', dirt: 'Sterrato', grass: 'Prato', sand: 'Sabbia',
      ground: 'Terra battuta', mud: 'Fango', earth: 'Terra battuta', woodchips: 'Trucioli di legno', rock: 'Roccia',
      stepping_stones: 'Pietre a passo',
    },
    barrier: {
      bollard: 'Paletti in mezzo al passaggio', gate: 'Cancello', lift_gate: 'Sbarra', block: 'Blocchi in mezzo al passaggio',
      cycle_barrier: 'Barriera anti-bici', chain: 'Catena', swing_gate: 'Cancello', sliding_gate: 'Cancello scorrevole',
      stile: 'Scaletta', turnstile: 'Tornello', kissing_gate: 'Cancelletto a zig-zag', 'full-height_turnstile': 'Tornello',
    },
    steps: (count, ramp) => `${ramp ? 'Scale con rampa' : 'Scale'}${count ? ` (${count} gradini)` : ''}`,
    notSuitable: 'Passaggio non adatto alla sedia a rotelle',
    impassable: 'Fondo impraticabile',
    kerbRaised: 'Marciapiede senza scivolo',
    veryNarrow: (cm) => `Passaggio molto stretto (${cm})`,
    kerbRolled: 'Gradino del marciapiede smussato',
    kerbUnknown: 'Gradino del marciapiede (altezza sconosciuta)',
    inclineUnknown: 'Salita o discesa (pendenza sconosciuta)',
    inclineSteep: (p) => `Salita o discesa ripida (${p}%)`,
    rough: 'Fondo irregolare',
    narrow: (cm) => `Passaggio stretto (${cm})`,
    limited: 'Adatto solo in parte alla sedia a rotelle',
    kerbLowered: 'Scivolo del marciapiede',
    suitable: 'Adatto alla sedia a rotelle',
    crossing: 'Attraversamento: scivolo non indicato',
    surfaceInfo: 'Tratto con informazioni sul fondo',
    placeNo: 'Luogo non accessibile in sedia a rotelle',
    placeLimited: 'Luogo accessibile solo in parte',
    placeYes: 'Luogo accessibile in sedia a rotelle',
  },
  // In inglese le etichette positive dicono "marked": riportano il tag di OpenStreetMap, non una verifica.
  en: {
    surface: {
      sett: 'Stone setts', cobblestone: 'Cobblestones', unhewn_cobblestone: 'Cobblestones',
      pebblestone: 'Pebbles', gravel: 'Gravel', dirt: 'Dirt track', grass: 'Grass', sand: 'Sand',
      ground: 'Bare ground', mud: 'Mud', earth: 'Bare ground', woodchips: 'Wood chips', rock: 'Rock',
      stepping_stones: 'Stepping stones',
    },
    barrier: {
      bollard: 'Bollards in the way', gate: 'Gate', lift_gate: 'Barrier arm', block: 'Blocks in the way',
      cycle_barrier: 'Cycle barrier', chain: 'Chain', swing_gate: 'Gate', sliding_gate: 'Sliding gate',
      stile: 'Stile', turnstile: 'Turnstile', kissing_gate: 'Kissing gate', 'full-height_turnstile': 'Turnstile',
    },
    steps: (count, ramp) => `${ramp ? 'Steps with ramp' : 'Steps'}${count ? ` (${count} steps)` : ''}`,
    notSuitable: 'Passage not suitable for wheelchairs',
    impassable: 'Impassable surface',
    kerbRaised: 'Raised kerb, no ramp',
    veryNarrow: (cm) => `Very narrow passage (${cm})`,
    kerbRolled: 'Rounded kerb step',
    kerbUnknown: 'Kerb step (height unknown)',
    inclineUnknown: 'Slope (gradient unknown)',
    inclineSteep: (p) => `Steep slope (${p}%)`,
    rough: 'Uneven surface',
    narrow: (cm) => `Narrow passage (${cm})`,
    limited: 'Only partly suitable for wheelchairs',
    kerbLowered: 'Dropped kerb',
    suitable: 'Marked suitable for wheelchairs',
    crossing: 'Crossing: no dropped-kerb information',
    surfaceInfo: 'Stretch with surface information',
    placeNo: 'Place marked not wheelchair accessible',
    placeLimited: 'Place marked only partly accessible',
    placeYes: 'Place marked wheelchair accessible',
  },
};

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** Pendenza in % se numerica ("8%", "-5%"), null se non numerica ("up", "down", "yes"). */
function inclinePercent(v: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*%$/.exec(v.trim());
  return m ? Math.abs(Number(m[1])) : null;
}

/** Larghezza in metri se espressa in metri (es. "1.2", "1.2 m"), altrimenti null. */
function widthMeters(v: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*m?$/.exec(v.trim());
  return m ? Number(m[1].replace(',', '.')) : null;
}

export type Classified = { kind: FeatureKind; certainty: Certainty; label: string };

/** Regole in ordine di gravità: vince la prima che corrisponde. Restituisce null se non c'è nulla di rilevante. */
export function classifyPath(t: Record<string, string>, lang: Lang = DEFAULT_LANG): Classified | null {
  const x = TEXT[lang];
  if (t.highway === 'steps') {
    const ramp = t['ramp:wheelchair'] === 'yes';
    return { kind: 'steps', certainty: ramp ? 'possible_issue' : 'known_obstacle', label: x.steps(t.step_count, ramp) };
  }
  if (t.wheelchair === 'no') return { kind: 'wheelchair', certainty: 'known_obstacle', label: x.notSuitable };
  if (t.smoothness === 'impassable') return { kind: 'smoothness', certainty: 'known_obstacle', label: x.impassable };
  if (t.barrier && BLOCKING_BARRIERS.has(t.barrier)) return { kind: 'barrier', certainty: 'known_obstacle', label: x.barrier[t.barrier] };

  const kerbHeight = t['kerb:height'] ? Number.parseFloat(t['kerb:height']) : NaN;
  if (t.kerb === 'raised' || kerbHeight > 0.03) return { kind: 'kerb', certainty: 'known_obstacle', label: x.kerbRaised };

  const width = t.width ? widthMeters(t.width) : null;
  if (width !== null && width < 0.9) return { kind: 'width', certainty: 'known_obstacle', label: x.veryNarrow(cm(width)) };

  if (t.kerb === 'rolled') return { kind: 'kerb', certainty: 'possible_issue', label: x.kerbRolled };
  if (t.barrier && PASSAGE_BARRIERS.has(t.barrier) && !t.kerb) {
    return t.barrier === 'kerb'
      ? { kind: 'kerb', certainty: 'possible_issue', label: x.kerbUnknown }
      : { kind: 'barrier', certainty: 'possible_issue', label: x.barrier[t.barrier] };
  }
  if (t.incline) {
    const p = inclinePercent(t.incline);
    if (p === null && t.incline !== '0') return { kind: 'incline', certainty: 'possible_issue', label: x.inclineUnknown };
    if (p !== null && p > 6) return { kind: 'incline', certainty: 'possible_issue', label: x.inclineSteep(p) };
  }
  if (t.smoothness && BAD_SMOOTHNESS.has(t.smoothness)) return { kind: 'smoothness', certainty: 'possible_issue', label: x.rough };
  if (t.surface && ROUGH_SURFACES.has(t.surface)) return { kind: 'surface', certainty: 'possible_issue', label: x.surface[t.surface] };
  if (width !== null && width < 1.2) return { kind: 'width', certainty: 'possible_issue', label: x.narrow(cm(width)) };
  if (t.wheelchair === 'limited') return { kind: 'wheelchair', certainty: 'possible_issue', label: x.limited };

  if (t.kerb === 'lowered' || t.kerb === 'flush' || t.kerb === 'no') return { kind: 'kerb', certainty: 'positive_info', label: x.kerbLowered };
  if (t.wheelchair === 'yes' || t.wheelchair === 'designated') return { kind: 'wheelchair', certainty: 'positive_info', label: x.suitable };

  if (t.highway === 'crossing') return { kind: 'crossing', certainty: 'info', label: x.crossing };
  if (t.surface || t.smoothness || t.incline || t.width) return { kind: 'surface', certainty: 'info', label: x.surfaceInfo };
  return null;
}

export function classifyPlace(t: Record<string, string>, lang: Lang = DEFAULT_LANG): Classified | null {
  const x = TEXT[lang];
  if (t.wheelchair === 'no') return { kind: 'wheelchair', certainty: 'known_obstacle', label: x.placeNo };
  if (t.wheelchair === 'limited') return { kind: 'wheelchair', certainty: 'possible_issue', label: x.placeLimited };
  if (t.wheelchair === 'yes' || t.wheelchair === 'designated') return { kind: 'wheelchair', certainty: 'positive_info', label: x.placeYes };
  return null;
}

/**
 * Etichetta di un elemento OSM nella lingua richiesta, ricalcolata dai tag conservati nello snapshot.
 * Se i tag non bastano (snapshot di un'altra versione) resta l'etichetta salvata.
 */
export function featureLabel(f: Pick<OsmFeature, 'scope' | 'tags' | 'label'>, lang: Lang): string {
  return (f.scope === 'path' ? classifyPath(f.tags, lang) : classifyPlace(f.tags, lang))?.label ?? f.label;
}
