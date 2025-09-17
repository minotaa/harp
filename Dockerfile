FROM oven/bun:1 AS bun-deps
WORKDIR /app
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

FROM eclipse-temurin:17-jdk AS final
WORKDIR /app

RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY --from=bun-deps /app/node_modules ./node_modules
COPY . .

COPY lavalink ./lavalink

EXPOSE 8080

CMD java -jar lavalink/Lavalink.jar & bun run start
