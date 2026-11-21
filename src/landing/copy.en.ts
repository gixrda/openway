// Landing page copy in English. Same keys as copy.it.ts (the reference language): the compiler checks it.
// Project rule, in English too: a route is never called "accessible" or "safe", only what the data lets us check.

import type { Copy } from './copy.it.ts';
import { it } from './copy.it.ts';
import { HAS_APP, STATIC } from './env.ts';

// Street names stay as they are; only the short description of each demo trip is translated.
const SCENARIO_HINTS: Record<string, string> = {
  roma: 'All pedestrian, with raised kerbs and no ramps',
  mediceo: 'On foot you take a staircase; in a wheelchair you avoid it',
  santamaria: 'A stretch on the roadway with no mapped sidewalk',
  galloro: 'Raised kerbs without ramps and a stretch on the roadway',
  antonio: 'A longer alternative to stay off the roadway',
};

export const en: Copy = {
  locale: 'en-GB',
  meta: {
    payoff: 'Freedom to move.',
    description: 'OpenWay, freedom to move: wheelchair routes in Italy compared with OpenStreetMap data and with user reports.',
  },
  nav: {
    label: 'Main navigation',
    logo: 'OpenWay, top of the page',
    skip: 'Skip to content',
    rail: 'Page sections',
    links: [
      { href: '#come-funziona', label: 'How it works' },
      { href: '#demo', label: 'Try a route' },
      { href: '#progetto', label: 'The project' },
    ],
    cta: HAS_APP ? 'Open OpenWay' : 'How to try it',
    menu: 'Menu',
  },
  hero: {
    title: 'The city is yours to explore.',
    lead: 'Discover routes, check what is known about barriers and help make getting around the city better informed.',
    searchLabel: 'Where do you want to go in Italy?',
    searchPlaceholder: 'Street, square or place',
    searchButton: 'Search',
    searching: 'Searching…',
    tooShort: 'Type at least 3 letters to search.',
    noResults: (q: string) => `No place found in Italy for “${q}”. Try the name of the street and the town.`,
    resultsLabel: 'Places found',
    openRoute: 'Calculate the route to here',
    primary: 'Explore the map',
    secondary: 'See how it works',
    exploring: 'Drag the map, or use the mouse wheel or the arrow keys to move around.',
    exitExplore: 'Back to the presentation',
    mapLabel: 'Interactive map of Italy, opened on the centre of Pisa',
  },
  routeCard: {
    title: 'Example route',
    place: 'Via Roma, university area',
    loading: 'Calculating the example route…',
    error: 'The routing service is not responding right now. The known obstacles stay on the map.',
    note: 'Calculated just now for a wheelchair and compared with OpenStreetMap. No stretch has been checked in person.',
    noteRecorded: 'Wheelchair route compared with OpenStreetMap. No stretch has been checked in person.',
    recorded: (date: string) => `Demo version: route recorded on ${date}, with no live calculation on this page.`,
    recordedFoot: 'The wheelchair routing service was not responding when this route was recorded. We are showing you an ordinary walking route.',
    notRecorded: 'This trip has not been recorded.',
    dataUnavailable: 'Data not available right now. Reload the page in a moment.',
    searchDown: 'Address search is not working right now. Try again in a moment.',
    knownObstacle: (label: string) => `Known obstacle: ${label}`,
    branchesNote: 'The pale lines that open up halfway are nearby streets: they are part of the animation, not calculated routes.',
    replay: 'Replay the animation',
    legend: {
      route: 'Wheelchair route',
      footRoute: 'Walking route, not assessed for wheelchairs',
      obstacle: 'Known obstacle in OpenStreetMap',
      report: 'Report to be checked',
      alert: 'Point to watch, in order',
    },
  },
  controls: {
    label: 'Map controls',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    recenter: 'Centre the route',
  },
  rail: [
    { id: 'problema', label: 'The problem' },
    { id: 'come-funziona', label: 'How it works' },
    { id: 'demo', label: 'Try a route' },
    { id: 'benefici', label: 'Benefits' },
    { id: 'progetto', label: 'The project' },
    { id: 'domande', label: 'Questions' },
  ],
  intro: { word: 'OpenWay', payoff: 'Freedom to move.' },
  statements: {
    title: 'In short',
    items: [
      { icon: 'route', text: ['The route,', 'before you set off.'] },
      { icon: 'warning', text: ['The obstacles, in the order', 'you meet them.'] },
      { icon: 'report', text: ['Reports from', 'people who pass by.'] },
      { icon: 'mic', text: ['Voice, to dictate', 'and be guided.'] },
    ],
  },
  problem: {
    title: 'Not every street {pin} is the same for everyone.',
    statement: 'A kerb with no ramp, a sidewalk that stops, roadworks that appeared yesterday. For someone in a wheelchair a few centimetres are enough to change a trip, and almost no map shows them.',
    points: [
      {
        title: 'Barriers are small',
        text: 'Steps, high kerbs, narrow passages, uneven paving. They do not matter to people on foot, so ordinary maps ignore them.',
      },
      {
        title: 'The data is only half there',
        text: 'In Italy, OpenStreetMap records about 159,000 known obstacles and 541,000 possible difficulties, nearly all of them in town centres. Elsewhere many sidewalks are not mapped, and for many crossings nobody knows whether there is a dropped kerb.',
      },
      {
        title: 'Every new trip is a test',
        text: 'Without reliable information you only find out about a street by travelling along it, often with someone beside you.',
      },
    ],
    source: 'Source: OpenStreetMap data of 16 November 2026, 2,078,357 features across Italy.',
  },
  features: {
    title: 'How it works',
    lead: 'Four things the prototype does today, in Italy.',
    uiNote: 'Elements rebuilt from the app interface, with its own wording and states. The example route is Via Roma, with OpenStreetMap data of 24 October 2026.',
    ui: {
      layers: [
        { mark: 'known', label: 'Known obstacles' },
        { mark: 'report', label: 'User reports' },
        { mark: 'possible', label: 'Possible difficulties' },
        { mark: 'positive', label: 'Helpful features' },
        { mark: 'info', label: 'Crossings with no information' },
        { mark: 'place', label: 'Shops and places marked accessible' },
      ],
      report: {
        text: '“Roadworks barriers on the sidewalk: I cannot get past”',
        understood: 'This is what we understood',
        category: 'Blocked sidewalk',
        question: 'Can you get past in a wheelchair?',
        yes: 'Yes',
        no: 'No',
        status: 'To be checked',
      },
      route: {
        verdict: '3 points to watch',
        alerts: ['Raised kerb, no ramp', 'Raised kerb, no ramp', 'Raised kerb, no ramp'],
        note: 'Based on the free OpenStreetMap map: nobody has checked this route in person.',
      },
      voice: {
        button: 'Dictate destination',
        said: '“Take me to Piazza dei Cavalieri”',
        searched: 'Searching: Piazza dei Cavalieri',
      },
    },
    items: [
      {
        id: 'esplora',
        title: 'See what is along the way',
        text: 'Known obstacles from OpenStreetMap and user reports, each with its own shape, icon and text. From far away you only see the ones that matter; zoom in and the other details appear.',
      },
      {
        id: 'segnala',
        title: 'Report an obstacle in a minute',
        text: 'Tap the spot on the map, describe what you found and, if you like, add a photo. Gemma suggests the type of obstacle and asks one question; you confirm or correct it. The report stays “to be checked” until a moderator verifies it.',
      },
      {
        id: 'naviga',
        title: 'Calculate a route and read its limits',
        text: 'The wheelchair route comes from Valhalla, with up to three alternatives checked stretch by stretch. The points to watch are numbered in the order you meet them. If a report blocks the way on your route, OpenWay recalculates it.',
      },
      {
        id: 'voce',
        title: 'Dictate, listen, carry on',
        text: 'You can dictate the start, the destination and the description of a report. Voice guidance reads the turn directions aloud and follows your GPS position. It only works over HTTPS and needs the ElevenLabs key on the server; full voice commands are not there yet.',
      },
    ],
  },
  demo: {
    title: 'Try a real {pin} route',
    lead: 'Five trips in the university area, the same ones used for the project demo. Pick one: the route is calculated now, the obstacles are those mapped in OpenStreetMap and none has been checked on site.',
    pick: 'Choose a trip',
    loading: 'Calculating the route…',
    error: 'The routing service is not responding. Try again in a moment or open the trip directly in the app.',
    retry: 'Try again',
    open: 'Open this route in OpenWay',
    alertsTitle: 'Along the route',
    noAlerts: 'No known obstacles along this route, in the available data.',
    more: (n: number) => `and ${n} more in the app`,
    at: (d: string) => `at ${d}`,
    mapLabel: 'Map of the chosen trip',
    scenarios: it.demo.scenarios.map((s) => ({ ...s, hint: SCENARIO_HINTS[s.id] ?? s.hint })),
  },
  benefits: {
    title: 'More information. Less uncertainty.',
    lead: 'OpenWay does not promise perfect streets. It tells you what is there, what is missing and who has seen it, before you leave home.',
    items: [
      { id: 'lungo', title: 'You know what you will find along the way', text: 'Before you set off you see the known obstacles and reports on the route, in order, with the distance from the start.' },
      { id: 'manca', title: 'You also know what is missing', text: 'When the data is not enough OpenWay says so: stretches with no mapped sidewalk, crossings with no dropped-kerb information.' },
      { id: 'aiuta', title: 'Your report helps whoever comes next', text: 'A reported obstacle appears on the map for everyone. If it blocks the way, routes avoid it until it is marked as resolved.' },
      { id: 'modi', title: 'Choose how to interact', text: 'Map, touch, text or voice: use whichever suits you best, and no important action ever starts by itself.' },
    ],
    visual: {
      stops: ['Raised kerb, no ramp', 'Report to be checked', 'Stretch on the roadway, no sidewalk'],
      start: 'Start',
      end: 'Destination',
      missing: [
        { kind: 'road', label: 'Stretch on the roadway with no mapped sidewalk' },
        { kind: 'info', label: 'Crossing with no dropped-kerb information' },
      ],
      statuses: ['To be checked', 'Checked on site', 'Resolved'],
      statusNote: 'Only a moderator changes the status.',
      modes: [
        { icon: 'pin', label: 'Map' },
        { icon: 'start', label: 'Touch' },
        { icon: 'search', label: 'Text' },
        { icon: 'mic', label: 'Voice' },
      ],
    },
  },
  project: {
    title: 'The project',
    text: [
      'OpenWay is a prototype born at the GDG Pisa Hacktoberfest in October 2026, where it came second as best open-source project. At first it was called AccessGo.',
      'The idea is simple: a map for people who get around in a wheelchair that says what it knows, what is only likely and what is missing. That is why it never calls a route “accessible” or “safe”, and says so every time it falls back on a second-best solution.',
    ],
    card: {
      label: 'Project card',
      name: 'OpenWay',
      kind: 'Prototype · Italy',
      rows: [
        { label: 'Born at', value: 'GDG Pisa Hacktoberfest, 2026' },
        { label: 'Result', value: '2nd best open-source project' },
        { label: 'Former name', value: 'AccessGo' },
        { label: 'Coverage', value: 'Italy, with uneven data' },
        { label: 'Route status', value: 'Not checked on site' },
      ],
      repo: 'Code on GitHub',
    },
    figuresTitle: 'The data for Italy',
    figuresNote: 'OpenStreetMap data of 16 November 2026. These are mapped features, not an on-site check.',
    figures: [
      { value: 2078357, label: 'OpenStreetMap features analysed' },
      { value: 158993, label: 'known obstacles' },
      { value: 540616, label: 'possible difficulties' },
      { value: 129844, label: 'helpful features, such as dropped kerbs' },
    ],
    stackTitle: 'Data and technology',
    stack: [
      { icon: 'layers', name: 'OpenStreetMap', role: 'Obstacles and sidewalks, Geofabrik extract of 16 November 2026' },
      { icon: 'route', name: 'Valhalla and OSRM', role: 'Routes and turn directions, FOSSGIS instances' },
      { icon: 'search', name: 'Nominatim', role: 'Address search in Italy' },
      { icon: 'report', name: 'Gemma 4', role: 'Reading of reports, with server-side checks' },
      { icon: 'mic', name: 'ElevenLabs', role: 'Dictation and voice guidance' },
      { icon: 'pin', name: 'React and Leaflet', role: 'Interface and map' },
    ],
    limitsTitle: 'What it does not do yet',
    limits: [
      'It covers Italy, but outside town centres OpenStreetMap has little data: a map with no obstacles is not a street with no obstacles.',
      'Reports stay to be checked until a moderator verifies them.',
      'It uses free public services, which can be slow or fail to respond.',
      'Voice guidance was tried in the browser, not while moving around with a phone.',
    ],
  },
  faq: {
    title: 'Frequently asked questions',
    items: [
      { q: 'Where does it work?', a: 'Across Italy, for routes up to 10 km. The routes on this page are in Pisa, where the project was born. Outside town centres OpenStreetMap has little data about obstacles: the map shows this with hatching.' },
      { q: 'Is the route guaranteed to be barrier-free?', a: 'No. OpenWay shows what the data lets us check: known obstacles, reports and stretches with no information. The absence of known obstacles is not a guarantee, and no route has been checked in person.' },
      { q: 'Who checks the reports?', a: 'Every report starts as “to be checked”. Only a moderator can mark it as checked on site or as resolved. A resolved report is no longer avoided by routes.' },
      { q: 'What does the artificial intelligence do?', a: 'Gemma reads the description of a report, suggests a type and a severity and asks one targeted question. The person reporting confirms or corrects it. The AI never decides that an obstacle is verified.' },
      { q: 'Do I need voice to use it?', a: 'No: map, touch and text are enough. Dictation and voice guidance need HTTPS and the ElevenLabs service active on the server; when it is missing the app says so and you can type.' },
      { q: 'What data is kept?', a: 'The reports, with the point chosen on the map and the photo if there is one, resized in the browser and stripped of GPS data. Voice audio and transcripts are not kept.' },
    ],
  },
  closing: {
    title: 'A city is discovered together.',
    text: 'Open the map, try a route or report the first obstacle you come across.',
    primary: HAS_APP ? 'Try OpenWay' : 'How to try it',
    secondary: 'See the code',
  },
  footer: {
    about: 'A prototype for finding your way in a wheelchair in Italy.',
    productTitle: 'Product',
    projectTitle: 'Project',
    app: HAS_APP ? 'Open the map' : 'How to try it',
    repo: 'Source code',
    privacyTitle: 'Privacy',
    privacy: [
      'This page uses no cookies and no analytics tools, and the typeface is served by the site itself.',
      'To show the map the browser downloads data from the OpenFreeMap servers (or images from the OpenStreetMap servers, if the vector map is not available); if you search for a place, the search text goes to Nominatim (OpenStreetMap). They all receive the visitor’s IP address, as happens with any external content.',
      STATIC
        ? 'The site is hosted on GitHub Pages, which logs visits according to its own privacy statement. When it opens, the page also sends one request to the OpenWay demo, hosted on Render, to start it in advance: that server receives the visitor’s IP address too.'
        : 'In the app, reports are saved on the project server with the point chosen on the map; photos are resized in the browser and stripped of GPS data; voice audio and transcripts are not kept.',
    ],
    privacyLinks: [
      { href: 'https://osmfoundation.org/wiki/Privacy_Policy', label: 'OpenStreetMap privacy policy' },
      { href: 'https://openfreemap.org/privacy/', label: 'OpenFreeMap privacy policy' },
      ...(STATIC ? [
        { href: 'https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement', label: 'GitHub privacy statement' },
        { href: 'https://render.com/privacy', label: 'Render privacy policy' },
      ] : []),
    ],
    credits: 'Map data © OpenStreetMap contributors (ODbL). Base map: OpenFreeMap, © OpenMapTiles. Routes: Valhalla and OSRM (FOSSGIS e.V.). Typeface: Atkinson Hyperlegible Next (OFL), served by the site.',
  },
};
