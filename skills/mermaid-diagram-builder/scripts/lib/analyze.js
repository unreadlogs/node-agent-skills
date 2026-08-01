import { detectType, stripFrontmatter, validateMermaid } from './render.js';

const ARROW_RE = /(-->|--[^>]*>|-[.-]{1,3}>|==>|==|->|<=>|\.\.)|(--|\+\+|..)/;

export function analyzeCode(code) {
  const lines = code.split('\n');
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  return {
    lines: lines.length,
    nonBlankLines: nonBlank.length,
    characters: code.length,
    directives: nonBlank.filter((l) => /^\s*%%/.test(l)).length,
  };
}

export function countFlowchart(code) {
  const lines = stripFrontmatter(code).split('\n');
  let nodes = 0;
  let edges = 0;
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^(flowchart|graph)\b/.test(line) || line.startsWith('%%') || line.startsWith('classDef')) continue;
    if (/^subgraph\b/.test(line)) {
      const name = (line.match(/subgraph\s+([^\s\[]+)/) || [])[1];
      if (name) seen.add(name);
      continue;
    }
    const parts = line.split(/(?:--[^>]*>|===?[^>]*>|->>|-[->]+|<=>|==>|--+)/);
    if (parts.length > 1) {
      edges++;
      for (const part of parts.slice(0, 2)) {
        const id = (part.match(/[A-Za-z_][\w]*(?=\[|\{|\(|\)|\}|:|\s|$)/) || [part.trim()])[0]?.replace(/["']/g, '');
        if (id && !/^[{}()[\]]+$/.test(id)) seen.add(id);
      }
    } else if (/\[[^\]]*\]|\{[^}]*\}|\(\([^)]*\)\)|\([^)]*\)/.test(line)) {
      nodes++;
    } else if (/^[A-Za-z_][\w]*:/.test(line)) {
      nodes++;
    }
  }
  return { nodes: Math.max(nodes, seen.size), edges };
}

export function countSequence(code) {
  const lines = stripFrontmatter(code).split('\n');
  const actors = new Set();
  let messages = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    const actorMatch = line.match(/^(?:participant|actor)\s+(.+)$/i);
    if (actorMatch) {
      actors.add(actorMatch[1].trim());
      continue;
    }
    const msgMatch = line.match(/^([A-Za-z0-9_'"\-]+)\s*(?:->>|-->>|->|-|--)\s*([A-Za-z0-9_'"\-]+)/);
    if (msgMatch) {
      messages++;
      actors.add(msgMatch[1].replace(/["']/g, ''));
      actors.add(msgMatch[2].replace(/["']/g, ''));
    }
  }
  return { actors: actors.size, messages };
}

export function countClassDiagram(code) {
  const lines = stripFrontmatter(code).split('\n');
  let classes = 0;
  let relations = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^class\s+[A-Za-z_][\w]*/.test(line)) classes++;
    if (/^[A-Za-z_][\w]*\s*([|<>*o+]|--|\+\+|\*+)\s*[|<>*o+]*\s*[A-Za-z_][\w]*/.test(line)) relations++;
  }
  return { classes, relations };
}

export function countGantt(code) {
  const lines = stripFrontmatter(code).split('\n');
  const sections = new Set();
  let tasks = 0;
  let milestones = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^section\s+/i.test(line)) {
      sections.add(line.replace(/^section\s+/i, '').trim());
    } else if (/^[^:]+:\s+.*,\s*/.test(line)) {
      tasks++;
      if (/\bmilestone\b/i.test(line)) milestones++;
    }
  }
  return { sections: sections.size, tasks, milestones };
}

export function countStateDiagram(code) {
  const lines = stripFrontmatter(code).split('\n');
  let states = 0;
  let transitions = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    if (/^state\s+/.test(line) || /^\[?\*\]?\s*:?\s*$/.test(line) && line === '[*]') states++;
    if (/-->/ .test(line)) transitions++;
  }
  return { states, transitions };
}

export function countErDiagram(code) {
  const lines = stripFrontmatter(code).split('\n');
  const entities = new Set();
  let relations = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    const rel = line.match(/^([A-Z0-9_]+)\s+\|\|[^-]*--[^-]*\|\|\s+([A-Z0-9_]+)\s*:/);
    if (rel) {
      relations++;
      entities.add(rel[1]);
      entities.add(rel[2]);
    }
  }
  return { entities: entities.size, relations };
}

export async function buildStats(code, file = null) {
  const type = detectType(code) ?? 'unknown';
  const validation = await validateMermaid(code);
  const base = analyzeCode(code);
  const stats = { ...base, type, valid: validation.valid, file: file ?? null };
  switch (type) {
    case 'flowchart':
      Object.assign(stats, countFlowchart(code));
      break;
    case 'sequenceDiagram':
      Object.assign(stats, countSequence(code));
      break;
    case 'classDiagram':
      Object.assign(stats, countClassDiagram(code));
      break;
    case 'gantt':
      Object.assign(stats, countGantt(code));
      break;
    case 'stateDiagram':
    case 'stateDiagram-v2':
      Object.assign(stats, countStateDiagram(code));
      break;
    case 'erDiagram':
      Object.assign(stats, countErDiagram(code));
      break;
    default:
      break;
  }
  return stats;
}

export function extractMermaidBlocks(markdown) {
  const blocks = [];
  const re = /```mermaid\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(markdown)) !== null) {
    blocks.push({
      index: blocks.length,
      startLine: markdown.slice(0, match.index).split('\n').length,
      code: match[1].replace(/\n$/, ''),
    });
  }
  return blocks;
}

export function fixCode(code) {
  let out = code.replace(/^\uFEFF/, '');
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  out = out.replace(/[ \t]+$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  out = out.replace(/\s+$/, '') + '\n';
  return out;
}
