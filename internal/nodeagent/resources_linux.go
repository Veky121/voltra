//go:build linux

package nodeagent

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

func hostResources() (memoryMiB, diskMiB int64) {
	if b, err := os.ReadFile("/proc/meminfo"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			var kib int64
			if strings.HasPrefix(line, "MemTotal:") {
				_, _ = fmt.Sscanf(line, "MemTotal: %d kB", &kib)
				memoryMiB = kib / 1024
				break
			}
		}
	}
	var fs unix.Statfs_t
	if unix.Statfs("/var/lib", &fs) == nil {
		diskMiB = int64(fs.Blocks) * fs.Bsize / 1024 / 1024
	}
	return
}
