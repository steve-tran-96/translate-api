FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067

ENTRYPOINT ["/bin/bash", "-l", "-c"]
WORKDIR /app/
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs python3 make g++
ENV PATH="/usr/local/bin:/usr/bin:/bin:$PATH"




ARG CI NIXPACKS_METADATA NODE_ENV NPM_CONFIG_PRODUCTION
ENV CI=$CI NIXPACKS_METADATA=$NIXPACKS_METADATA NODE_ENV=$NODE_ENV NPM_CONFIG_PRODUCTION=$NPM_CONFIG_PRODUCTION

# setup phase
# noop

# install phase
ENV NIXPACKS_PATH=/app/node_modules/.bin:$NIXPACKS_PATH
COPY . /app/.
RUN --mount=type=cache,id=5yh86ZYSe4-/root/npm,target=/root/.npm npm ci

# build phase
COPY . /app/.
RUN --mount=type=cache,id=5yh86ZYSe4-node_modules/cache,target=/app/node_modules/.cache npm run build


RUN npm install -g @openai/codex

RUN printf '\nPATH=/app/node_modules/.bin:$PATH' >> /root/.profile


# start
COPY . /app

CMD ["npm run start"]