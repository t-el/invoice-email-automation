FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY samples ./samples
ENV DATA_DIR=/data INBOX_DIR=/data/inbox
VOLUME /data
CMD ["npx", "tsx", "src/cli.ts", "watch"]
