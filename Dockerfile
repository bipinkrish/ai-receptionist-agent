FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE ${PORT}

CMD ["npm", "run", "tools"]