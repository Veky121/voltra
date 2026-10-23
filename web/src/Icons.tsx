import type {ReactNode, SVGProps} from 'react';

const paths={
  star:<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/>,
  logout:<><path d="M9 4H4v16h5M14 8l4 4-4 4M8 12h13"/></>,
  dashboard:<><path d="m3 10 9-7 9 7"/><path d="M5 9v11h5v-6h4v6h5V9"/></>,
  console:<><path d="m5 6 6 6-6 6M13 18h6"/></>,
  schedules:<><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4M8 3v4M4 11h16M8 15h2M14 15h2"/></>,
  network:<><path d="M3 9a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 15a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/></>,
  startup:<><path d="M14 4c3-1 6-1 6-1s0 3-1 6l-7 7-4-4 6-8ZM8 12H4l3-5h5M12 16v4l5-3v-5M5 16l-2 5 5-2"/><circle cx="16" cy="7" r="1"/></>,
  settings:<><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/></>,
  files:<><path d="M3 8V5h6l2 2h10v3M3 8h18l-3 12H3V8Z"/></>,
  databases:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7"/></>,
  backups:<><path d="M7 18H6a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 0 10h-1M12 20V10m-4 4 4-4 4 4"/></>,
  users:<><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5v1"/></>,
  activity:<><path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/></>,
  cpu:<><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></>,
  memory:<><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M12 10v4M17 10v4M6 18v3M10 18v3M14 18v3M18 18v3"/></>,
  disk:<><path d="m5 4-3 9v7h20v-7l-3-9H5ZM2 13h20M16 17h2M6 17h1"/></>,
  server:<><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5"/></>,
  nodes:<><rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="8" height="6" rx="1"/><rect x="14" y="16" width="8" height="6" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/></>,
  locations:<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  eggs:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  mounts:<><path d="M4 7h16v13H4zM2 3h20v4H2zM9 12h6"/></>,
  key:<><circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-3-3 3-3m-6 0 3-3"/></>,
  back:<><path d="m10 6-6 6 6 6M4 12h16"/></>,
  download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  upload:<><path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
  play:<path d="m8 4 12 8-12 8V4Z"/>,
  restart:<><path d="M3 10a9 9 0 1 1 2 9M3 3v7h7"/></>,
  stop:<rect x="5" y="5" width="14" height="14" rx="2"/>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  file:<><path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 12h8M8 16h6"/></>,
  newFile:<><path d="M14 2H5v20h14V7l-5-5ZM14 2v6h5M9 15h6M12 12v6"/></>,
  folderPlus:<><path d="M3 8V5h6l2 2h10v13H3V8ZM9 14h6M12 11v6"/></>,
  archive:<><path d="M4 7h16v14H4zM2 3h20v4H2zM9 12h6"/></>,
  copy:<><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  edit:<><path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5"/></>,
  trash:<><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
  lock:<><rect x="4" y="10" width="16" height="12" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v3"/></>,
  close:<path d="m6 6 12 12M6 18 18 6"/>,
  chevron:<path d="m9 5 7 7-7 7"/>,
  info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  wrench:<path d="M21 3a6 6 0 0 1-8 8L5 21l-3-3 10-8a6 6 0 0 1 8-8l-4 4 2 2 3-5Z"/>,
  pause:<><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  send:<><path d="m3 3 19 9-19 9 4-9-4-9ZM7 12h15"/></>,
} satisfies Record<string,ReactNode>;
export type IconName=keyof typeof paths;

export function Icon({name,...props}:SVGProps<SVGSVGElement>&{name:IconName}){
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}

export function NavIcon({name}:{name:IconName}){
  return <span className="nav-icon" data-icon={name}><Icon name={name}/></span>;
}
