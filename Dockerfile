FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN yarn install

COPY . .
RUN yarn build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/burnalias.db

RUN corepack enable

COPY --from=build /app/package.json /app/yarn.lock ./
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
RUN yarn install --mode=skip-build

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3001
ENTRYPOINT ["node", "apps/server/dist/cli.js"]
CMD ["server"]
