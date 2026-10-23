// Build the same Windows icon resource that Wails' generate syso command uses.
// This small build-only module keeps CLI dependencies out of the desktop app.
package main

import (
	"flag"
	"fmt"
	"os"
	"runtime"

	"github.com/tc-hib/winres"
)

func main() {
	icon := flag.String("icon", "", "multi-resolution ICO file")
	out := flag.String("out", "", "output .syso file")
	arch := flag.String("arch", runtime.GOARCH, "Windows target architecture")
	flag.Parse()
	if err := generate(*icon, *out, *arch); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func generate(icon, out, arch string) error {
	target, ok := map[string]winres.Arch{"amd64": winres.ArchAMD64, "arm64": winres.ArchARM64, "386": winres.ArchI386}[arch]
	if !ok || icon == "" || out == "" {
		return fmt.Errorf("specify -icon, -out and supported -arch")
	}
	input, err := os.Open(icon)
	if err != nil {
		return err
	}
	defer input.Close()
	image, err := winres.LoadICO(input)
	if err != nil {
		return err
	}
	resources := winres.ResourceSet{}
	// Wails uses resource ID RT_ICON (3) for the application/window icon.
	if err = resources.SetIcon(winres.RT_ICON, image); err != nil {
		return err
	}
	output, err := os.Create(out)
	if err != nil {
		return err
	}
	if err = resources.WriteObject(output, target); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}
