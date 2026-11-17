import type { FeatureKind, ReportCategory } from '../../shared/types.ts';

// I testi delle etichette (categorie, stati, livelli di certezza) stanno nei dizionari in src/i18n:
// qui resta solo ciò che non dipende dalla lingua.
export const CATEGORY_ICON: Record<ReportCategory, FeatureKind | 'other'> = {
  steps: 'steps', kerb: 'kerb', obstructed_sidewalk: 'barrier', uneven_surface: 'surface',
  slope: 'incline', crossing: 'crossing', other: 'other',
};
