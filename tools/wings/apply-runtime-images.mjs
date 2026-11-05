import fs from 'node:fs';
import path from 'node:path';

export function applyRuntimeImages(root, moduleRoot) {
  const edit = (name, replacements) => {
    const target = path.join(root, name);
    let text = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    for (const [before, after] of replacements) {
      if (text.split(before).length !== 2) throw Error(`Image manager patch anchor mismatch: ${name}: ${before.slice(0, 90)}`);
      text = text.replace(before, after);
    }
    fs.writeFileSync(target, text);
  };
  const runtimePath = path.join(root, 'environment/docker/container.go');
  const runtimeText = fs.readFileSync(runtimePath, 'utf8').replace(/\r\n/g, '\n');
  const start = runtimeText.indexOf('func (e *Environment) ensureImageExists(img string) error {');
  const end = runtimeText.indexOf('\nfunc (e *Environment) convertMounts()', start);
  if (start < 0 || end < start) throw Error('Image manager runtime function anchors missing');
  edit('environment/docker/container.go', [
    ['\t"github.com/buger/jsonparser"\n', ''], ['\t"github.com/docker/docker/api/types/image"\n', ''],
    ['\t"github.com/pterodactyl/wings/environment"', '\t"github.com/pterodactyl/wings/environment"\n\t"github.com/pterodactyl/wings/internal/runtimeimages"'],
    ['if err := e.ensureImageExists(e.meta.Image); err != nil {', 'resolvedImage, err := e.ensureImageExists(e.meta.Image)\n\tif err != nil {'],
    ['Image:        strings.TrimPrefix(e.meta.Image, "~"),', 'Image:        resolvedImage,'],
    [runtimeText.slice(start,end), `func (e *Environment) ensureImageExists(img string) (string, error) {
 ctx := runtimeimages.WithProgress(context.Background(), func(kind, detail string) {
  switch kind {
  case "started": e.Events().Publish(environment.DockerImagePullStarted, "")
  case "completed": e.Events().Publish(environment.DockerImagePullCompleted, "")
  case "status": e.Events().Publish(environment.DockerImagePullStatus, detail)
  }
 })
 return runtimeimages.Resolve(ctx, img)
}
`],
  ]);
  const installerText = fs.readFileSync(path.join(root, 'server/install.go'), 'utf8').replace(/\r\n/g, '\n');
  const installStart = installerText.indexOf('func (ip *InstallationProcess) pullInstallationImage() error {');
  const installEnd = installerText.indexOf('\n// BeforeExecute', installStart);
  if (installStart < 0 || installEnd < installStart) throw Error('Image manager installer anchors missing');
  edit('server/install.go', [
    ['\t"bufio"\n', ''],
    ['\t"github.com/docker/docker/api/types/image"\n', ''],
    ['\t"github.com/pterodactyl/wings/environment"', '\t"github.com/pterodactyl/wings/environment"\n\t"github.com/pterodactyl/wings/internal/runtimeimages"'],
    ['\tclient *client.Client\n}', '\tclient *client.Client\n\tresolvedImage string\n}'],
    ['Image:        ip.Script.ContainerImage,', 'Image:        ip.resolvedImage,'],
    [installerText.slice(installStart,installEnd), `func (ip *InstallationProcess) pullInstallationImage() error {
 resolved, err := runtimeimages.Resolve(ip.Server.Context(), ip.Script.ContainerImage)
 if err != nil { return err }
 ip.resolvedImage = resolved
 return nil
}
`],
  ]);
  edit('router/router.go', [
    ['\t"github.com/pterodactyl/wings/config"', '\t"github.com/pterodactyl/wings/config"\n\t"github.com/pterodactyl/wings/internal/runtimeimages"'],
    ['gin.SetMode("release")', 'gin.SetMode("release")\n\tif _, err := runtimeimages.Default(); err != nil { log.WithError(err).Error("image management unavailable; repair node state before starting servers") }'],
    ['protected.GET("/api/system", getSystemInformation)', 'protected.GET("/api/system", getSystemInformation)\n\tprotected.GET("/api/runtime-images", getRuntimeImages)\n\tprotected.POST("/api/runtime-images", postRuntimeImages)'],
  ]);
  const destination = path.join(root, 'internal/runtimeimages');
  fs.mkdirSync(destination, {recursive:true});
  for (const [input, output] of [
    ['runtime_images.go.txt','manager.go'],['runtime_images_sync.go.txt','sync.go'],
    ['runtime_images_docker.go.txt','docker.go'],['runtime_images_test.go.txt','manager_test.go'],
    ['runtime_images_docker_test.go.txt','docker_test.go'],
  ]) fs.copyFileSync(path.join(moduleRoot,'tools/wings',input),path.join(destination,output));
  fs.copyFileSync(path.join(moduleRoot,'tools/wings/runtime_images_router.go.txt'),path.join(root,'router/runtime_images.go'));
}
