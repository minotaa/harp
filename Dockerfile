FROM oven/bun:1 AS bun-deps
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

FROM eclipse-temurin:17-jdk AS final
WORKDIR /app

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

COPY --from=bun-deps /app/node_modules ./node_modules
COPY . .

COPY lavalink/Lavalink.jar ./Lavalink.jar

EXPOSE 2333

CMD java -jar Lavalink.jar & bun run start
