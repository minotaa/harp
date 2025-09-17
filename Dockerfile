FROM oven/bun:1 AS bun-deps
WORKDIR /app
COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

FROM eclipse-temurin:17-jdk AS final
WORKDIR /app

RUN apt-get update && apt-get install -y curl unzip python3 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY --from=bun-deps /app/node_modules ./node_modules
COPY . .

COPY lavalink/Lavalink.jar ./Lavalink.jar
COPY lavalink/application.example.yml ./application.yml
COPY --chmod=0755 lavalink/yt-dlp ./yt-dlp

EXPOSE 2333

CMD java -jar ./Lavalink.jar & bun run start