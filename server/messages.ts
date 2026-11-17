// Testi che il server manda all'interfaccia (errori, avvisi sul percorso, domande dell'assistente), per lingua.
// La lingua è quella della richiesta in corso: la fissa server/api.ts con withLang() leggendo Accept-Language,
// e chi lancia un errore la ritrova con m() senza doverla ricevere come parametro.
// Fuori da una richiesta (test, script) vale l'italiano, la lingua di riferimento.
import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_LANG, type Lang } from '../shared/lang.ts';

const requestLang = new AsyncLocalStorage<Lang>();

export const withLang = <T>(lang: Lang, fn: () => T): T => requestLang.run(lang, fn);
export const currentLang = (): Lang => requestLang.getStore() ?? DEFAULT_LANG;

/** Distanza arrotondata ai 10 m, come nell'interfaccia. */
const rounded = (meters: number) => `${Math.round(meters / 10) * 10 || Math.round(meters)} m`;

const it = {
  // api.ts
  generic: 'Qualcosa non ha funzionato. Riprova tra poco.',
  notFound: 'Risorsa non trovata.',
  tooLarge: 'Richiesta troppo grande.',
  badJson: 'JSON non valido.',
  geocodeShort: 'Scrivi almeno 3 lettere per cercare.',
  geocodeDown: 'La ricerca degli indirizzi non funziona in questo momento. Scegli il punto sulla mappa.',
  statusDisabled: 'Modifica degli stati non abilitata su questo server.',
  badModeratorCode: 'Codice moderatore non valido.',
  routeOutside: 'Partenza e arrivo devono essere in Italia.',
  routeTooLong: (km: number) => `Partenza e arrivo sono troppo lontani: calcoliamo percorsi fino a ${km} km in linea d'aria.`,
  badProfile: 'Profilo di percorso non valido.',
  // reports.ts
  descShort: 'Descrivi il problema con almeno 10 caratteri.',
  descLong: 'La descrizione può avere al massimo 1000 caratteri.',
  photoUnusable: "Questa foto non si può usare. Prova con un'altra.",
  photoTooLarge: "La foto è troppo grande. Prova con un'altra.",
  reportOutside: 'Il punto scelto non è in Italia. Scegli il punto sulla mappa.',
  badCategory: 'Categoria non valida.',
  duplicate: 'Hai appena inviato questa segnalazione: non serve inviarla di nuovo.',
  badAnswer: 'La risposta scelta non è valida. Scegline una tra quelle proposte.',
  photoNotFound: 'Foto non trovata.',
  badStatus: 'Stato non valido.',
  reportNotFound: 'Segnalazione non trovata.',
  // ai.ts
  aiOff: "L'intelligenza artificiale non è attiva.",
  aiPhotoFailed: "L'intelligenza artificiale non è riuscita a leggere la foto.",
  aiUnusable: "L'intelligenza artificiale ha dato una risposta non utilizzabile.",
  aiNoAnswer: "L'intelligenza artificiale non ha risposto.",
  photoNotRead: ' La foto non è stata letta.',
  missingHeight: "Altezza dell'ostacolo",
  missingDuration: "Se l'ostacolo è temporaneo o permanente",
  missingAlternative: 'Se esiste un passaggio alternativo vicino',
  askHeight: { text: 'Quanto è alto, più o meno?', options: ['Meno di 3 cm', 'Tra 3 e 10 cm', 'Più di 10 cm'] },
  askDuration: { text: "C'è sempre o solo per un periodo?", options: ['Solo per un periodo', "C'è sempre"] },
  // routing.ts
  noWheelchairRoute: "Non abbiamo trovato un percorso per la sedia a rotelle tra questi due punti. Prova a spostare la partenza o l'arrivo.",
  noRoute: "Non abbiamo trovato un percorso tra questi due punti. Prova a spostare la partenza o l'arrivo.",
  wheelchairDown: 'Il servizio dei percorsi per sedia a rotelle non risponde.',
  footShown: (reason: string) => `${reason} Ti mostriamo un normale percorso a piedi.`,
  orsMisconfigured: 'OpenRouteService non è configurato correttamente.',
  orsBusy: 'OpenRouteService ha ricevuto troppe richieste.',
  orsProblem: 'OpenRouteService ha avuto un problema.',
  wheelchairBusy: 'Il servizio dei percorsi per sedia a rotelle è molto usato in questo momento.',
  wheelchairProblem: 'Il servizio dei percorsi per sedia a rotelle ha avuto un problema.',
  routeOffline: 'Non riusciamo a calcolare il percorso. Controlla la connessione e riprova.',
  routeBusy: 'Il servizio dei percorsi è molto usato in questo momento. Riprova tra poco.',
  routeProblem: 'Il servizio dei percorsi ha avuto un problema. Riprova tra poco.',
  // safety.ts
  notVerifiable: 'Non è stato possibile trovare un percorso sufficientemente verificabile. Controlla la mappa prima di proseguire.',
  allRejected: (wheelchair: boolean) => `Tutti i percorsi trovati passano da strade trafficate senza marciapiede${wheelchair ? ' o da scale' : ''}.`,
  /** Perché è stato scelto un percorso diverso dal più breve. extraM: metri in più; avoidedM: carreggiata evitata. */
  choiceRejected: (extraM: number, mainRoad: boolean) =>
    `Abbiamo scelto ${extraM > 10 ? `un percorso più lungo di ${rounded(extraM)}` : 'un percorso diverso'} perché il più breve passa ${mainRoad ? 'in una strada trafficata senza marciapiede' : 'da scale'}.`,
  choiceAvoids: (extraM: number, avoidedM: number) =>
    `Abbiamo scelto ${extraM > 10 ? `un percorso più lungo di ${rounded(extraM)}` : 'un percorso diverso'} per evitare ${rounded(avoidedM)} di strada senza marciapiede.`,
  // voice.ts
  voiceUnavailable: 'Servizio vocale ElevenLabs temporaneamente non disponibile. Riprova più tardi.',
  voiceNotConfigured: 'ElevenLabs non è configurato sul server.',
  voiceAuth: 'ElevenLabs non è disponibile: controlla la configurazione e i permessi della chiave sul server.',
  voiceBusy: 'Servizio vocale momentaneamente occupato. Attendi qualche secondo e riprova.',
  voiceLimit: 'Limite temporaneo delle richieste vocali raggiunto. Attendi un minuto e riprova.',
  needMultipart: 'Invia una registrazione audio in formato multipart.',
  audioTooLarge: 'Audio troppo grande: massimo 2 MB.',
  badRecording: 'Registrazione audio non valida.',
  oneFile: 'Invia un solo file audio e, se necessario, la modalità lingua; altri campi non sono accettati.',
  badLanguage: 'Modalità lingua non valida: usa it, en oppure auto.',
  emptyRecording: 'La registrazione è vuota.',
  badFormat: 'Formato audio non supportato o file non valido. Registra di nuovo.',
  speakEmpty: 'Scrivi il testo da leggere.',
  speakTooLong: 'La lettura vocale può avere al massimo 500 caratteri.',
  voiceTimeout: 'ElevenLabs ha impiegato troppo tempo. Riprova.',
  badVoiceResponse: 'Risposta vocale non valida.',
  noWords: 'Nessuna parola riconosciuta. Registra di nuovo oppure scrivi il testo.',
  transcriptTooLong: 'Trascrizione troppo lunga. Registra un messaggio più breve.',
  badAudio: 'Audio ElevenLabs non valido.',
  audioTooBig: 'Audio ElevenLabs troppo grande.',
};

export type Messages = typeof it;

const en: Messages = {
  generic: 'Something went wrong. Try again in a moment.',
  notFound: 'Resource not found.',
  tooLarge: 'The request is too large.',
  badJson: 'Invalid JSON.',
  geocodeShort: 'Type at least 3 letters to search.',
  geocodeDown: 'Address search is not working right now. Choose the point on the map.',
  statusDisabled: 'Changing statuses is not enabled on this server.',
  badModeratorCode: 'Invalid moderator code.',
  routeOutside: 'The start and the destination must be in Italy.',
  routeTooLong: (km: number) => `The start and the destination are too far apart: we calculate routes up to ${km} km as the crow flies.`,
  badProfile: 'Invalid route profile.',
  descShort: 'Describe the problem in at least 10 characters.',
  descLong: 'The description can be at most 1000 characters long.',
  photoUnusable: 'This photo cannot be used. Try another one.',
  photoTooLarge: 'The photo is too large. Try another one.',
  reportOutside: 'The chosen point is not in Italy. Choose the point on the map.',
  badCategory: 'Invalid category.',
  duplicate: 'You have just sent this report: there is no need to send it again.',
  badAnswer: 'The chosen answer is not valid. Pick one of those offered.',
  photoNotFound: 'Photo not found.',
  badStatus: 'Invalid status.',
  reportNotFound: 'Report not found.',
  aiOff: 'Artificial intelligence is not active.',
  aiPhotoFailed: 'The artificial intelligence could not read the photo.',
  aiUnusable: 'The artificial intelligence gave an answer that could not be used.',
  aiNoAnswer: 'The artificial intelligence did not answer.',
  photoNotRead: ' The photo was not read.',
  missingHeight: 'Height of the obstacle',
  missingDuration: 'Whether the obstacle is temporary or permanent',
  missingAlternative: 'Whether there is another way through nearby',
  askHeight: { text: 'Roughly how high is it?', options: ['Less than 3 cm', 'Between 3 and 10 cm', 'More than 10 cm'] },
  askDuration: { text: 'Is it always there or only for a while?', options: ['Only for a while', 'Always there'] },
  noWheelchairRoute: 'We could not find a wheelchair route between these two points. Try moving the start or the destination.',
  noRoute: 'We could not find a route between these two points. Try moving the start or the destination.',
  wheelchairDown: 'The wheelchair routing service is not responding.',
  footShown: (reason: string) => `${reason} We are showing you an ordinary walking route.`,
  orsMisconfigured: 'OpenRouteService is not configured correctly.',
  orsBusy: 'OpenRouteService received too many requests.',
  orsProblem: 'OpenRouteService had a problem.',
  wheelchairBusy: 'The wheelchair routing service is very busy right now.',
  wheelchairProblem: 'The wheelchair routing service had a problem.',
  routeOffline: 'We cannot calculate the route. Check your connection and try again.',
  routeBusy: 'The routing service is very busy right now. Try again in a moment.',
  routeProblem: 'The routing service had a problem. Try again in a moment.',
  notVerifiable: 'We could not find a route that can be checked well enough. Look at the map before you set off.',
  allRejected: (wheelchair: boolean) => `Every route found goes along busy roads without a sidewalk${wheelchair ? ' or over steps' : ''}.`,
  choiceRejected: (extraM: number, mainRoad: boolean) =>
    `We chose ${extraM > 10 ? `a route ${rounded(extraM)} longer` : 'a different route'} because the shortest one goes ${mainRoad ? 'along a busy road without a sidewalk' : 'over steps'}.`,
  choiceAvoids: (extraM: number, avoidedM: number) =>
    `We chose ${extraM > 10 ? `a route ${rounded(extraM)} longer` : 'a different route'} to avoid ${rounded(avoidedM)} of street without a sidewalk.`,
  voiceUnavailable: 'The ElevenLabs voice service is temporarily unavailable. Try again later.',
  voiceNotConfigured: 'ElevenLabs is not configured on the server.',
  voiceAuth: 'ElevenLabs is not available: check the configuration and the key permissions on the server.',
  voiceBusy: 'The voice service is busy at the moment. Wait a few seconds and try again.',
  voiceLimit: 'Temporary limit on voice requests reached. Wait a minute and try again.',
  needMultipart: 'Send an audio recording in multipart format.',
  audioTooLarge: 'Audio too large: 2 MB at most.',
  badRecording: 'Invalid audio recording.',
  oneFile: 'Send a single audio file and, if needed, the language mode; other fields are not accepted.',
  badLanguage: 'Invalid language mode: use it, en or auto.',
  emptyRecording: 'The recording is empty.',
  badFormat: 'Audio format not supported or file not valid. Record again.',
  speakEmpty: 'Write the text to read aloud.',
  speakTooLong: 'Text to read aloud can be at most 500 characters long.',
  voiceTimeout: 'ElevenLabs took too long. Try again.',
  badVoiceResponse: 'Invalid voice response.',
  noWords: 'No words recognised. Record again or type the text.',
  transcriptTooLong: 'The transcript is too long. Record a shorter message.',
  badAudio: 'Invalid ElevenLabs audio.',
  audioTooBig: 'ElevenLabs audio too large.',
};

export const MESSAGES: Record<Lang, Messages> = { it, en };

/** Testi nella lingua della richiesta in corso. Va chiamata al momento dell'uso, non a livello di modulo. */
export const m = (): Messages => MESSAGES[currentLang()];
