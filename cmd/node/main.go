package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"voltra/internal/nodeagent"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "voltra-node:", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: voltra-node setup [--reconnect] | run [--config /etc/voltra/node.json]")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	switch os.Args[1] {
	case "setup":
		flags := flag.NewFlagSet("setup", flag.ContinueOnError)
		reconnect := flags.Bool("reconnect", false, "recover this node using an approved recovery connection string")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return fmt.Errorf("setup accepts only --reconnect; enter the connection string at the private prompt")
		}
		if err := requireSetupHost(); err != nil {
			return err
		}
		return nodeagent.Setup(ctx, nodeagent.SetupOptions{ReadConnection: func() (string, error) { return readPrivateLine(ctx) }, StartServices: true, Reconnect: *reconnect})
	case "run":
		flags := flag.NewFlagSet("run", flag.ContinueOnError)
		path := flags.String("config", nodeagent.DefaultConfigPath, "private connector config file")
		if err := flags.Parse(os.Args[2:]); err != nil {
			return err
		}
		if flags.NArg() != 0 {
			return fmt.Errorf("run accepts only --config")
		}
		return nodeagent.RunSaved(ctx, *path)
	default:
		return fmt.Errorf("usage: voltra-node setup [--reconnect] | run [--config /etc/voltra/node.json]")
	}
}
