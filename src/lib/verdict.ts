import type { RouteResult } from '../../shared/types.ts';
import { t } from '../i18n/index.ts';
import type { RouteAlert } from './alerts.ts';

/** Sotto questa quota di percorso con dati sul fondo, "nessun ostacolo noto" va accompagnato da un avviso: i dati sono pochi. */
export const LOW_COVERAGE = 0.25;

/** Esito in una frase: cosa deve sapere chi parte. Non dice mai "sicuro" o "accessibile". */
export function verdictOf(route: RouteResult, alerts: RouteAlert[], coverage = 1): { tone: 'warn' | 'calm'; title: string; text: string } {
  const v = t().verdict;
  if (route.mode === 'foot_fallback') {
    return { tone: 'warn', title: v.footOnlyTitle, text: `${route.notice ?? ''} ${v.footOnlyWarning}`.trim() };
  }
  const unverifiable = !route.safety?.checked || !route.safety.verifiable;
  // Fuori dalle zone ben mappate "nessun ostacolo noto" vuol dire soprattutto "nessun dato": lo si dice.
  const sparse = coverage < LOW_COVERAGE ? v.fewData(Math.round(coverage * 100)) : null;
  if (alerts.length) {
    return { tone: 'warn', title: v.points(alerts.length), text: unverifiable ? v.notVerifiable : sparse ? `${v.listedBelow} ${sparse}` : v.listedBelow };
  }
  if (unverifiable) return { tone: 'warn', title: v.noKnown, text: sparse ? `${v.notVerifiable} ${sparse}` : v.notVerifiable };
  if (sparse) return { tone: 'warn', title: v.noKnown, text: sparse };
  return { tone: 'calm', title: v.noKnown, text: v.onlySidewalks };
}
