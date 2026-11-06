//go:build !windows

package main

import "github.com/wailsapp/wails/v3/pkg/application"

func rememberWindow(_ *application.App, _ *application.WebviewWindow, _ string) {}
