const mibPerGB = 1024;

export function limitsToGB<T extends Record<string, any>>(limits: T) {
  return {
    ...limits,
    memory: Number(limits.memory ?? 0) / mibPerGB,
    disk: Number(limits.disk ?? 0) / mibPerGB,
  };
}

export function limitsToMiB<T extends Record<string, any>>(limits: T) {
  const convert = (value: unknown, label: string) => {
    if (value == null || String(value).trim() === "") {
      throw new Error(`Enter a ${label} limit in GB.`);
    }
    const gb = Number(value);
    const mib = Math.round(gb * mibPerGB);
    if (!Number.isFinite(gb) || gb < 0 || !Number.isSafeInteger(mib) || (gb > 0 && mib === 0)) {
      throw new Error(`Enter a valid ${label} limit in GB, at least ${1 / mibPerGB} GB or 0 for unlimited.`);
    }
    return mib;
  };
  return {
    ...limits,
    memory: convert(limits.memory, "memory"),
    disk: convert(limits.disk, "disk"),
  };
}
