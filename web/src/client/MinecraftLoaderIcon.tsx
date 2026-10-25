const loaderIcons: Record<string, string> = {
  vanilla: "/game-icons/minecraft-official.png",
  paper: "/game-icons/paper-official.png",
  fabric: "/game-icons/fabric-official.png",
  forge: "/game-icons/forge-official.jpg",
  neoforge: "/game-icons/neoforge-official.png",
  quilt: "/game-icons/quilt-official.png",
};

export function MinecraftLoaderIcon({id, name}: {id: string; name: string}) {
  const src = loaderIcons[id];
  return <span className={`mc-loader-mark mc-loader-${id}`} aria-hidden="true">
    {src ? <img src={src} alt="" width={32} height={32}/> : name.slice(0, 1)}
  </span>;
}
