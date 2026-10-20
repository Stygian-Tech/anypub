package main

import (
	"context"
	"errors"
	"github.com/stygian-tech/anypub-kit/xrpc"
	"github.com/stygian-tech/anypub/services/backend/internal/backend"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	config := backend.LoadConfig()
	app, e := backend.New(config)
	if e != nil {
		slog.Error("AnyPub configuration failed", "error", e)
		os.Exit(1)
	}
	defer app.Close()
	app.Mount("/xrpc/"+xrpc.NSID, xrpc.Handler())
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: app, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 120 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	app.StartScheduler(ctx)
	go func() {
		<-ctx.Done()
		shutdown, c := context.WithTimeout(context.Background(), 15*time.Second)
		defer c()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("AnyPub listening", "port", port)
	if e = server.ListenAndServe(); e != nil && !errors.Is(e, http.ErrServerClosed) {
		slog.Error("AnyPub server failed", "error", e)
		os.Exit(1)
	}
}
