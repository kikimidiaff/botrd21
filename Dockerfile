FROM node:20-bullseye

# Instala git (necessário para dependências via git)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Instala PM2 globalmente
RUN npm install -g pm2

# Define diretório de trabalho
WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Instala dependências
RUN npm install

# Copia todo o código do bot
COPY . .

# Copia arquivo de configuração do Discloud
COPY discloud.config discloud.config

# Comando padrão para iniciar o bot com PM2
CMD ["pm2-runtime", "start", "index.js", "--name", "RD21", "--env", "production"]

