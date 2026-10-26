package panel

import (
	"archive/zip"
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"hash"
	"io"
	"os"
	"strings"
	"time"
)

const minecraftArchiveLimit int64 = 2 << 30
const minecraftExpandedLimit uint64 = 4 << 30

// Large packs stay on disk. Only manifests and ZIP directory metadata enter RAM.
// The caller owns cleanup even when later manifest/loader validation fails.
func (a *App) minecraftFetchArchive(ctx context.Context, file minecraftDownload) (*zip.Reader, func(), error) {
	if !minecraftHashValid(file.Algorithm, file.Hash) {
		return nil, nil, bad("The provider did not supply a supported checksum.")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	response, err := a.minecraftProviderResponse(ctx, file.URL, "", minecraftDownloadHosts, 10*time.Minute)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.ContentLength > minecraftArchiveLimit {
		return nil, nil, bad("This modpack download exceeds the supported 2 GiB archive size.")
	}
	archive, err := os.CreateTemp("", "voltra-minecraft-pack-*.zip")
	if err != nil {
		return nil, nil, bad("The panel could not allocate temporary storage for the modpack.")
	}
	cleanup := func() { archive.Close(); os.Remove(archive.Name()) }
	var checksum hash.Hash
	switch file.Algorithm {
	case "sha1":
		checksum = sha1.New()
	case "sha256":
		checksum = sha256.New()
	case "sha512":
		checksum = sha512.New()
	}
	size, err := io.Copy(io.MultiWriter(archive, checksum), io.LimitReader(response.Body, minecraftArchiveLimit+1))
	if err != nil {
		cleanup()
		return nil, nil, APIError{502, "MinecraftArchiveReadFailed", "The modpack download was interrupted or temporary storage could not be written. Try again."}
	}
	if size > minecraftArchiveLimit {
		cleanup()
		return nil, nil, bad("This modpack download exceeds the supported 2 GiB archive size.")
	}
	if !strings.EqualFold(hex.EncodeToString(checksum.Sum(nil)), file.Hash) {
		cleanup()
		return nil, nil, APIError{502, "MinecraftChecksumMismatch", "The provider download did not match its checksum. Try again later."}
	}
	reader, err := minecraftReadZipFrom(archive, size)
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return reader, cleanup, nil
}
