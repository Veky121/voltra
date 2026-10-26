//go:build desktopdiagnostics

package main

// This build tag is used only by native UI acceptance tests. Normal and
// published builds expose no DevTools listener.
func init() {
	webviewTestArguments = []string{"--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9227"}
}
