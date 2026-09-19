FROM rust:1.91-bookworm AS mls-build

WORKDIR /src
COPY packages/mls-wasm ./packages/mls-wasm
RUN rustup target add wasm32-unknown-unknown \
    && cargo build --manifest-path packages/mls-wasm/Cargo.toml --target wasm32-unknown-unknown --release --locked \
    && cargo install wasm-bindgen-cli --version 0.2.105 --locked
RUN mkdir -p /out \
    && wasm-bindgen \
      packages/mls-wasm/target/wasm32-unknown-unknown/release/sudoku_mls_wasm.wasm \
      --target web \
      --typescript \
      --out-dir /out \
      --out-name sudoku_mls_wasm

FROM node:22-alpine

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

WORKDIR /srv/app
COPY package.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN npm install --workspaces --include-workspace-root

COPY apps/web ./apps/web
COPY packages/domain ./packages/domain
COPY --from=mls-build /out ./apps/web/generated/mls-wasm
RUN npm run build:web

EXPOSE 3000
CMD ["npm", "--workspace", "@sudoku/web", "run", "start"]
