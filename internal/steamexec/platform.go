package steamexec

import (
	"encoding/binary"
	"errors"
	"io"
	"os"
	"voltra/internal/steamapi"
)

// A complete Linux manifest is not evidence that the Windows payload exists.
// The only supported Windows target has a fixed executable and machine type.
func readInstalledRequest(dir string, request steamapi.Request) (string, error) {
	build, err := readInstalled(dir, request.AppID)
	if err != nil || build == "" || request.Platform != "windows" {
		return build, err
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return "", errors.New("game directory unavailable")
	}
	defer root.Close()
	path := ""
	for _, part := range []string{"Pal", "Binaries", "Win64", "PalServer-Win64-Shipping.exe"} {
		if path != "" {
			path += "/"
		}
		path += part
		stat, statErr := root.Lstat(path)
		if os.IsNotExist(statErr) {
			return "", nil
		}
		if statErr != nil || stat.Mode()&os.ModeSymlink != 0 {
			return "", errors.New("Windows game executable path is unsafe")
		}
	}
	file, err := root.Open(path)
	if err != nil {
		return "", errors.New("Windows game executable unavailable")
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		return "", errors.New("Windows game executable is not a regular file")
	}
	header := make([]byte, 64)
	if _, err = io.ReadFull(file, header); err != nil || string(header[:2]) != "MZ" {
		return "", errors.New("Windows game executable has an invalid DOS header")
	}
	offset := int64(binary.LittleEndian.Uint32(header[60:64]))
	if offset < 64 || offset > stat.Size()-6 {
		return "", errors.New("Windows game executable has an invalid PE offset")
	}
	pe := make([]byte, 6)
	if _, err = file.ReadAt(pe, offset); err != nil || string(pe[:4]) != "PE\x00\x00" || binary.LittleEndian.Uint16(pe[4:]) != 0x8664 {
		return "", errors.New("Windows game executable is not an AMD64 PE image")
	}
	return build, nil
}
