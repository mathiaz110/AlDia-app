# ════════════════════════════════════════════════════
#  ALDIA APP — Dockerfile
#  Imagen Node.js 22 LTS Alpine (liviana)
# ════════════════════════════════════════════════════

# Imagen base oficial Node 22 LTS (Alpine = más liviana)
FROM node:22-alpine

# Metadatos de la imagen
LABEL maintainer="AlDía App"
LABEL description="Backend AlDía — Node.js + Firestore + Cloudflare R2"
LABEL version="5.0.0"

# Carpeta de trabajo dentro del contenedor
WORKDIR /app

# Copiar package.json primero para aprovechar el caché de capas
# Si package.json no cambia, Docker no reinstala dependencias
COPY package.json ./

# Instalar solo dependencias de producción (sin devDependencies)
RUN npm install --omit=dev --no-audit --no-fund

# Copiar el resto del código del backend
COPY . .

# Puerto que expone el servidor Express
EXPOSE 3000

# Variables de entorno por defecto (se sobreescriben con .env)
ENV NODE_ENV=production
ENV PORT=3000

# Comando para iniciar el servidor
CMD ["node", "server.js"]
