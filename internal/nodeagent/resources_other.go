//go:build !linux

package nodeagent

func hostResources() (int64, int64) { return 0, 0 }
