# Backend OSM-Golf — Express, déployé sur Cloud Run.
# Image single-stage : le backend est du JS pur (aucune étape de build/transpile).
FROM node:22-slim

# Dossier de travail
WORKDIR /app

ENV NODE_ENV=production
# Cloud Run n'autorise l'écriture que sous /tmp en non-root → on y déporte les caches disque.
ENV CACHE_DIR=/tmp/osm-golf

# Dépendances de prod uniquement (npm ci exige package-lock.json ; --omit=dev retire nodemon).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Code applicatif
COPY src ./src

# Exécution en utilisateur non privilégié (présent dans les images officielles node).
USER node

# Cloud Run injecte PORT (8080) ; src/index.js lit process.env.PORT. EXPOSE = documentation.
EXPOSE 8080

CMD ["node", "src/index.js"]
