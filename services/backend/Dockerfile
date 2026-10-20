FROM golang:1.26.6-bookworm AS build
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -ldflags='-s -w' -o /anypub ./cmd/anypub

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tzdata && rm -rf /var/lib/apt/lists/* && mkdir -p /data/uploads
WORKDIR /app
COPY --from=build /anypub /usr/local/bin/anypub
ENV ANYPUB_DATA_DIR=/data SQLITE_PATH=/data/anypub.sqlite UPLOADS_DIR=/data/uploads PORT=8080 APP_ENV=production
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/anypub"]
