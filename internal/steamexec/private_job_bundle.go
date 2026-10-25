package steamexec

// PrivateWorkerBundle is provisioner-owned configuration, never a wire request.
// Both inventories are exact closed worlds with independently reviewed digests.
type PrivateWorkerBundle struct {
	Provider     string
	Root         string
	Files        map[string]string
	RuntimeRoot  string
	RuntimeFiles map[string]string
}
