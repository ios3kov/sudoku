FROM rust:1.91-bookworm AS mls-build

WORKDIR /src
COPY packages/mls-wasm ./packages/mls-wasm
RUN rustup target add wasm32-unknown-unknown \
    && cargo build --manifest-path packages/mls-wasm/Cargo.toml --target wasm32-unknown-unknown --release --locked
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fL \
      https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.105/wasm-bindgen-0.2.105-x86_64-unknown-linux-musl.tar.gz \
      -o /tmp/wasm-bindgen.tar.gz \
    && echo "b391448c4926ac4b11425a6752484d85164e72489d97804461d5e868c643b88a  /tmp/wasm-bindgen.tar.gz" | sha256sum -c - \
    && mkdir -p /tmp/wasm-bindgen \
    && tar -xzf /tmp/wasm-bindgen.tar.gz -C /tmp/wasm-bindgen --strip-components=1 \
    && mkdir -p /out \
    && /tmp/wasm-bindgen/wasm-bindgen \
      packages/mls-wasm/target/wasm32-unknown-unknown/release/sudoku_mls_wasm.wasm \
      --target web \
      --typescript \
      --out-dir /out \
      --out-name sudoku_mls_wasm

FROM node:22-alpine

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /srv/app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN npm ci --workspaces --include-workspace-root

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain
COPY --from=mls-build /out ./apps/web/generated/mls-wasm
RUN npm run build:web \
    && chown -R node:node /srv/app

USER node

EXPOSE 3000
CMD ["npm", "--workspace", "@sudoku/web", "run", "start"]
