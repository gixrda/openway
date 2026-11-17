# Immagine dell'app completa (interfaccia + server): è ciò che serve per una demo pubblica.
# Il server non ha dipendenze npm a runtime: Node esegue direttamente i file TypeScript.
#   docker build -t openway .
#   docker run -p 8787:8787 --env-file .env -v openway-data:/data openway
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
# Dati OSM di tutta l'Italia dalla release "osm-data" (~125 MB compressi). Se il download non riesce il build
# si ferma: un ripiego silenzioso resterebbe nella cache degli strati e la demo girerebbe con i soli dati di Pisa.
#   --build-arg OSM_TILES_URL=…  prende l'archivio da un altro indirizzo
#   --build-arg OSM_DEMO=1       salta il download: immagine con lo snapshot demo di Pisa (per le prove)
ARG OSM_TILES_URL
ARG OSM_DEMO
RUN if [ -z "$OSM_DEMO" ]; then npm run osm:download; else echo "Solo lo snapshot demo di Pisa"; fi

FROM node:24-slim AS runtime
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/shared ./shared
# L'utente "node" è proprietario di server/data già nella copia: senza i dati completi la griglia viene creata lì
# dallo snapshot demo. (Un chown -R dopo la copia raddoppierebbe l'immagine: 0,7 GB di celle in un secondo strato.)
COPY --from=build --chown=node:node /app/server ./server
# Segnalazioni e foto stanno in /data: montaci un volume per conservarle tra un deploy e l'altro.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/status').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.ts"]
