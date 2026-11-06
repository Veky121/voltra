package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"golang.org/x/sys/windows"
)

type placementPoint struct{ X, Y int32 }
type placementRect struct{ Left, Top, Right, Bottom int32 }
type windowPlacement struct {
	Length, Flags, ShowCmd   uint32
	MinPosition, MaxPosition placementPoint
	NormalPosition           placementRect
}

func (p windowPlacement) restorable() bool {
	r := p.NormalPosition
	return r.Right > r.Left && r.Bottom > r.Top && int64(r.Right)-int64(r.Left) <= 32768 && int64(r.Bottom)-int64(r.Top) <= 32768
}

func (p windowPlacement) forRestore() windowPlacement {
	// Never reopen minimized. Preserve the normal bounds even when maximized.
	if p.ShowCmd == 3 || p.ShowCmd == 2 && p.Flags&2 != 0 {
		p.ShowCmd = 3
	} else {
		p.ShowCmd = 1
	}
	p.Flags = 0
	p.Length = uint32(unsafe.Sizeof(p))
	return p
}

func rememberWindow(app *application.App, window *application.WebviewWindow, dir string) {
	user32 := windows.NewLazySystemDLL("user32.dll")
	get := user32.NewProc("GetWindowPlacement")
	set := user32.NewProc("SetWindowPlacement")
	var mu sync.Mutex
	ready := false
	save := func() {
		mu.Lock()
		defer mu.Unlock()
		if !ready {
			return
		}
		p := windowPlacement{}
		p.Length = uint32(unsafe.Sizeof(p))
		if ok, _, _ := get.Call(uintptr(window.NativeWindow()), uintptr(unsafe.Pointer(&p))); ok == 0 || !p.restorable() {
			return
		}
		data, _ := json.Marshal(p)
		if err := writePreference(dir, "window.json", data); err != nil {
			log.Printf("Could not save window placement: %v", err)
		}
	}
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		mu.Lock()
		var p windowPlacement
		if data, err := os.ReadFile(filepath.Join(dir, "window.json")); err == nil && json.Unmarshal(data, &p) == nil && p.restorable() {
			p = p.forRestore()
			// Use workspace coordinates end to end. Windows recovers offscreen windows
			// when displays are disconnected or their resolution changes.
			application.InvokeSync(func() {
				if ok, _, err := set.Call(uintptr(window.NativeWindow()), uintptr(unsafe.Pointer(&p))); ok == 0 {
					log.Printf("Could not restore window placement: %v", err)
				}
			})
		}
		ready = true
		mu.Unlock()
	})
	// Focus loss and shutdown cover Alt+F4, the custom close button, and updater quits.
	window.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) { save() })
	window.OnWindowEvent(events.Common.WindowDidMove, func(_ *application.WindowEvent) { save() })
	window.OnWindowEvent(events.Common.WindowDidResize, func(_ *application.WindowEvent) { save() })
	window.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) { save() })
	app.OnShutdown(save)
}
