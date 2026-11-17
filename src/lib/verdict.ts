import type { RouteResult } from '../../shared/types.ts';
import { t } from '../i18n/index.ts';
import type { RouteAlert } from './alerts.ts';

/** Esito in una frase: cosa deve sapere chi parte. Non dice mai "sicuro" o "accessibile". */
export function verdictOf(route: RouteResult, alerts: RouteAlert[]): { tone: 'warn' | 'calm'; title: string; text: string } {
  const v = t().verdict;
  if (route.mode === 'foot_fallback') {
    return { tone: 'warn', title: v.footOnlyTitle, text: `${route.notice ?? ''} ${v.footOnlyWarning}`.trim() };
  }
  const unverifiable = !route.safety?.checked || !route.safety.verifiable;
  if (alerts.length) {
    return { tone: 'warn', title: v.points(alerts.length), text: unverifiable ? v.notVerifiable : v.listedBelow };
  }
  if (unverifiable) return { tone: 'warn', title: v.noKnown, text: v.notVerifiable };
  return { tone: 'calm', title: v.noKnown, text: v.onlySidewalks };
}
