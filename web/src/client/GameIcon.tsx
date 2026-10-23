import {Icon} from "../Icons";

export function GameIcon({minecraft=false}:{minecraft?:boolean}) {
  if (!minecraft) return <span className="game-icon game-icon-generic"><Icon name="server"/></span>;
  return <span className="game-icon game-icon-minecraft"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 3 59 17 32 32 5 17Z" fill="#78b948"/>
    <path d="M5 17 32 32v29L5 46Z" fill="#825334"/>
    <path d="m32 32 27-15v29L32 61Z" fill="#60402c"/>
    <path d="m5 17 27 15v10l-6-3v-5l-6-3v6l-6-3v-7l-9-5Z" fill="#579b35"/>
    <path d="m32 32 27-15v9l-7 4v6l-6 3v-6l-7 4v6l-7 4Z" fill="#3d7f2b"/>
    <path d="m18 15 6 3 7-4-6-3ZM32 8l7 4 7-4-7-3ZM37 21l6 3 7-4-6-3ZM10 41l6 3v5l-6-3ZM23 45l5 3v6l-5-3ZM39 47l6-3v5l-6 3ZM50 35l5-3v5l-5 3Z" fill="#af8753" opacity=".65"/>
  </svg></span>;
}
