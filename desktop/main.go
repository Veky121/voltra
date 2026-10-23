package main

import (
	"embed"
	"io/fs"
	"log"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Desktop and web compile the same React/Vite source. build.ps1 puts the
// desktop production bundle here before compiling this executable.
//
//go:embed all:frontend
var frontend embed.FS

//go:embed assets/app.png
var appIcon []byte

var version = "0.1.0-dev"
var updateManifestURL string
var updatePublicKey string

func main() {
	dir, err := configDirectory()
	if err != nil {
		log.Fatal(err)
	}
	assets, err := fs.Sub(frontend, "frontend")
	if err != nil {
		log.Fatal(err)
	}
	host := newHost(dir, assets)
	launch, closeHost, err := host.start()
	if err != nil {
		log.Fatal(err)
	}
	defer closeHost()
	var app *application.App
	app = application.New(application.Options{
		Name: "Voltra", Description: "Voltra server management",
		Icon:       appIcon,
		Windows:    application.WindowsOptions{WebviewUserDataPath: filepath.Join(dir, "WebView2")},
		Mac:        application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		OnShutdown: closeHost,
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.voltra.desktop",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if window, ok := app.Window.GetByName("main"); ok {
					window.Show()
					window.Focus()
				}
			},
		},
	})
	if err = configureUpdater(app, host); err != nil {
		log.Fatal(err)
	}
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Voltra", Width: 1440, Height: 940, MinWidth: 900, MinHeight: 640,
		BackgroundColour: application.NewRGB(17, 19, 24), URL: launch,
	})
	if err = app.Run(); err != nil {
		log.Fatal(err)
	}
}
