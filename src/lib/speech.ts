import type { Lang } from '../../shared/lang.ts';
import { getLang } from '../i18n/index.ts';

/**
 * Da una frase detta a voce ("Portami in Piazza dei Cavalieri.", "Take me to Piazza dei Cavalieri.") ricava
 * il luogo da cercare ("Piazza dei Cavalieri"). Solo regole, nella lingua dell'interfaccia: nessuna coordinata
 * viene inventata, il risultato va comunque scelto dall'elenco.
 */
export function spokenPlaceQuery(text: string, lang: Lang = getLang()): string {
  const said = text.trim().replace(/[.!?]+$/g, '');
  if (lang === 'en') {
    return said
      .replace(/^(?:hey|ok|okay|so|please)[,\s]+/i, '')
      .replace(/^(?:take me|bring me|let's go|go|i want to go|i'd like to go|i would like to go|i need to go|navigate|search for|search|find me|find|look for|show me|route|directions|destination|arrival|start|starting)\b[,\s]*/i, '')
      .replace(/^(?:the route|a route|the way)\s+/i, '')
      .replace(/^(?:to|towards|toward|at|in|from)\s+/i, '')
      .replace(/[,\s]+please$/i, '')
      .trim();
  }
  return said
    .replace(/^(?:ehi|ok|allora|per favore|per piacere)[,\s]+/i, '')
    .replace(/^(?:portami|accompagnami|vai|andiamo|voglio andare|vorrei andare|devo andare|cerca|trova|cercami|trovami|mostrami|percorso|itinerario|destinazione|arrivo|partenza|parto|parti)\b[,\s]*/i, '')
    .replace(/^(?:il percorso|un percorso|la strada)\s+/i, '')
    .replace(/^(?:per|verso|fino a|fino in|a|in|al|allo|alla|ai|agli|alle|da|dal|dallo|dalla|dai|dagli|dalle)\s+/i, '')
    .replace(/[,\s]+per favore$/i, '')
    .trim();
}
