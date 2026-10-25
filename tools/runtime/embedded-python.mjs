// Extract literal Python heredocs without executing installer shell code.
export function embeddedPython(script) {
  const pattern = /cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)/g;
  return [...script.matchAll(pattern)].map(match => ({file: match[1] || match[2] || match[3], source: match[5]}));
}
