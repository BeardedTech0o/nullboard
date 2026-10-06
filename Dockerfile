# nullboard, self-hosted. No npm dependencies: Node 22 ships node:sqlite.
FROM node:22-alpine
WORKDIR /app
COPY worker ./worker
COPY server ./server
COPY migrations ./migrations
COPY public ./public
COPY scripts ./scripts
# New service worker cache name for every image build.
RUN node scripts/stamp-build.mjs && mkdir -p /data && chown -R node:node /data /app/public
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/nullboard.db
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
