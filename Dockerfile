# Usa imagem oficial do Node
FROM node:20-bullseye

# Define diretório de trabalho
WORKDIR /app

# Instala git e build tools (necessário para dependências npm que usam git)
RUN apt-get update && \
    apt-get install -y git build-essential && \
    rm -rf /var/lib/apt/lists/*

# Instala PM2 globalmente
RUN npm install -g pm2@latest

# Copia package.json e package-lock.json primeiro (para cache de build)
COPY package*.json ./

# Trava a versão do Baileys para evitar breaking changes
RUN npm install

# Copia todo o código do bot
COPY . .

# Define o usuário não root (opcional, bom para segurança)
RUN chown -R node:node /app
USER node

# Comando padrão para iniciar o bot com PM2
CMD ["pm2-runtime", "start", "index.js", "--name", "RD21", "--env", "production"]

