FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN chmod +x /app/entrypoint.sh

EXPOSE 8081 19000 19001 19002

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["npm", "run", "docker:start"]
