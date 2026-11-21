FROM node:20-alpine AS dependencies
WORKDIR /app
COPY package.json ./
RUN npm install

FROM dependencies AS development
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM production AS https
COPY docker/https/ /opt/everest-https/
EXPOSE 443
ENTRYPOINT ["/bin/sh", "/opt/everest-https/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
