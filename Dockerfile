# Playwright's image ships Chromium and every system library it needs.
# The tag must match the playwright version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# pwuser exists in the Playwright image; no root for the running bot.
USER pwuser
CMD ["node", "dist/index.js"]
