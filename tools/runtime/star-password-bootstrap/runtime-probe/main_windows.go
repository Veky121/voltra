//go:build windows

// MIT. Import-resolution probe; never loads the UE4SS/game DLLs.
package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"unsafe"
)

//go:embed imports.json
var importsJSON []byte

var kernel = syscall.NewLazyDLL(`C:\windows\system32\kernel32.dll`)
var debugOutput = kernel.NewProc("OutputDebugStringW")
var loadLibraryEx = kernel.NewProc("LoadLibraryExW")

// Only fixed status or embedded public import names reach this diagnostic.
// Proton's Steam shim can detach standard handles, so debugstr is independent.
func report(line string) {
	fmt.Fprintln(os.Stdout, line)
	text, err := syscall.UTF16PtrFromString(line + "\n")
	if err != nil {
		os.Exit(2)
	}
	debugOutput.Call(uintptr(unsafe.Pointer(text)))
	runtime.KeepAlive(text)
}

// API-set names are virtual contracts, resolved through the OS loader. Restrict
// its search to System32, never the application, user directories or PATH.
func systemLibraryRequest(name string) (string, uintptr, error) {
	if !regexp.MustCompile(`^[a-z0-9._-]+\.dll$`).MatchString(name) {
		return "", 0, syscall.EINVAL
	}
	if strings.HasPrefix(name, "api-") || strings.HasPrefix(name, "ext-") {
		return name, 0x800, nil // LOAD_LIBRARY_SEARCH_SYSTEM32
	}
	return `C:\windows\system32\` + name, 0x800, nil
}

func loadSystemLibrary(name string) (*syscall.DLL, error) {
	filename, flags, err := systemLibraryRequest(name)
	if err != nil {
		return nil, err
	}
	text, err := syscall.UTF16PtrFromString(filename)
	if err != nil {
		return nil, err
	}
	handle, _, loadErr := loadLibraryEx.Call(uintptr(unsafe.Pointer(text)), 0, flags)
	runtime.KeepAlive(text)
	if handle == 0 {
		return nil, loadErr
	}
	return &syscall.DLL{Name: name, Handle: syscall.Handle(handle)}, nil
}

func main() {
	if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "This probe accepts no runtime paths or commands.")
		os.Exit(2)
	}
	if err := debugOutput.Find(); err != nil {
		fmt.Fprintln(os.Stderr, "PUBLIC_PROBE_DEBUG_OUTPUT_UNAVAILABLE")
		os.Exit(2)
	}
	report("VOLTRA_STAR_PROBE_MAIN_ENTERED")
	var manifest struct {
		Imports map[string][]string `json:"imports"`
	}
	if json.Unmarshal(importsJSON, &manifest) != nil {
		os.Exit(2)
	}
	getProc := kernel.NewProc("GetProcAddress")
	failed := false
	names := make([]string, 0, len(manifest.Imports))
	for name, symbols := range manifest.Imports {
		if _, _, err := systemLibraryRequest(name); err != nil {
			os.Exit(2)
		}
		for _, symbol := range symbols {
			if !validSymbol(symbol) {
				os.Exit(2)
			}
		}
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		symbols := manifest.Imports[name]
		if !regexp.MustCompile(`^[a-z0-9._-]+\.dll$`).MatchString(name) {
			os.Exit(2)
		}
		// Real DLLs use absolute System32 paths; API sets use the safe loader.
		dll, err := loadSystemLibrary(name)
		if err != nil {
			report("MISSING_RUNTIME_LIBRARY " + name)
			failed = true
			continue
		}
		for _, symbol := range symbols {
			missing := false
			if strings.HasPrefix(symbol, "#") {
				ordinal, err := strconv.ParseUint(symbol[1:], 10, 16)
				if err != nil || ordinal == 0 {
					os.Exit(2)
				}
				address, _, _ := getProc.Call(uintptr(dll.Handle), uintptr(ordinal))
				missing = address == 0
			} else {
				_, err := dll.FindProc(symbol)
				missing = err != nil
			}
			if missing {
				report("MISSING_RUNTIME_EXPORT " + name + ":" + symbol)
				failed = true
			}
		}
		dll.Release()
	}
	if failed {
		fmt.Fprintln(os.Stderr, "Star loader runtime imports are incomplete; no game or loader was launched.")
		os.Exit(1)
	}
	report("VOLTRA_STAR_RUNTIME_IMPORTS_READY")
}

func validSymbol(symbol string) bool {
	if strings.HasPrefix(symbol, "#") {
		value, err := strconv.ParseUint(symbol[1:], 10, 16)
		return err == nil && value > 0
	}
	if len(symbol) == 0 || len(symbol) > 4096 {
		return false
	}
	for _, value := range symbol {
		if value < 33 || value > 126 {
			return false
		}
	}
	return true
}
