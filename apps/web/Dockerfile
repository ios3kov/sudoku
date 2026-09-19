FROM node:22-alpine

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /srv/app
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN npm install --workspaces --include-workspace-root

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain
RUN npm run build:web

EXPOSE 3000
CMD ["npm", "--workspace", "@sudoku/web", "run", "start"]
