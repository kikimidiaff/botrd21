# Usa imagem oficial do Node
FROM node:20-bullseye

# Define diretório de trabalho
WORKDIR /app

# Instala git e build tools (necessário para algumas dependências npm)
RUN apt-get update && apt-get install -y git build-essential && rm -rf /var/lib/apt/lists/*

# Instala PM2 globalmente
RUN npm install -g pm2

# Copia package.json e package-lock.json
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia todo o código do bot
COPY . .

# Comando padrão para iniciar o bot com PM2
CMD ["pm2-runtime", "start", "index.js", "--name", "RD21", "--env", "production"]

