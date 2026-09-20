FROM golang:1.24-alpine AS build
ARG MC_VERSION
ENV CGO_ENABLED=0
RUN apk add --no-cache ca-certificates git
RUN test -n "$MC_VERSION" && GOBIN=/out go install "github.com/minio/mc@$MC_VERSION"

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/mc /usr/local/bin/mc
ENTRYPOINT ["mc"]
