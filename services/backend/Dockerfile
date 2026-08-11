FROM swift:6.2-noble AS build

WORKDIR /build
COPY Package.swift Package.resolved ./
RUN swift package resolve

COPY Sources ./Sources
COPY Tests ./Tests
RUN swift build -c release --static-swift-stdlib

FROM ubuntu:noble

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libjemalloc2 tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /build/.build/release/App /usr/local/bin/App

ENV ANYPUB_DATA_DIR=/data \
    SQLITE_PATH=/data/anypub.sqlite \
    UPLOADS_DIR=/data/uploads \
    PORT=8080

EXPOSE 8080
ENTRYPOINT ["App"]
CMD ["serve", "--env", "production", "--hostname", "0.0.0.0", "--port", "8080"]
