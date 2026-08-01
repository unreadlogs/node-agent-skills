export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        const name = arg.slice(2, eq);
        flags[name] = arg.slice(eq + 1);
      } else {
        const name = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[name] = next;
          i++;
        } else {
          flags[name] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

export function getFlag(flags, names, fallback = null) {
  for (const name of names) {
    if (flags[name] !== undefined) return flags[name];
  }
  return fallback;
}

export function getNumberFlag(flags, names, fallback = null) {
  const value = getFlag(flags, names);
  if (value === null || value === true) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getBoolFlag(flags, names, fallback = false) {
  const value = getFlag(flags, names);
  if (value === null) return fallback;
  if (value === true) return true;
  return String(value).toLowerCase() === 'true';
}

export function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}
