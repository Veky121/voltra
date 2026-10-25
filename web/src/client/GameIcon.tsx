import {Icon} from "../Icons";

export function GameIcon({minecraft=false}:{minecraft?:boolean}) {
  if (!minecraft) return <span className="game-icon game-icon-generic"><Icon name="server"/></span>;
  return <span className="game-icon game-icon-minecraft"><img src="/game-icons/minecraft-official.png" width={128} height={128} alt="" aria-hidden="true"/></span>;
}
