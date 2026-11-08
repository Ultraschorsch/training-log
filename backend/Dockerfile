FROM node:20-alpine
WORKDIR /app
COPY server.js .
RUN mkdir -p /data
ENV PORT=3001 DATA_FILE=/data/training-log.json
EXPOSE 3001
# Unhealthy if the data file is unreadable or a plan has no exercises
HEALTHCHECK --interval=5m --timeout=5s --start-period=10s --retries=2 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
