import { setupDom } from './env.js';

export const DIAGRAM_TYPES = [
  { keyword: 'flowchart', description: 'Flowchart / graph (TD, LR, TB, RL directions)' },
  { keyword: 'sequenceDiagram', description: 'Sequence diagram (actors, messages)' },
  { keyword: 'classDiagram', description: 'Class diagram (classes, relations)' },
  { keyword: 'stateDiagram', description: 'State diagram (legacy syntax)' },
  { keyword: 'stateDiagram-v2', description: 'State diagram (current syntax)' },
  { keyword: 'erDiagram', description: 'Entity relationship diagram' },
  { keyword: 'journey', description: 'User journey (sections, tasks, scores)' },
  { keyword: 'gantt', description: 'Gantt chart (tasks, milestones, sections)' },
  { keyword: 'pie', description: 'Pie chart' },
  { keyword: 'quadrantChart', description: 'Quadrant chart (points in 4 quadrants)' },
  { keyword: 'requirementDiagram', description: 'Requirements diagram (req/ele/interface)' },
  { keyword: 'gitGraph', description: 'Git commit/branch graph' },
  { keyword: 'mindmap', description: 'Mind map (tree of nodes)' },
  { keyword: 'timeline', description: 'Timeline (events per period)' },
  { keyword: 'sankey-beta', description: 'Sankey flow diagram (beta)' },
  { keyword: 'xychart-beta', description: 'XY chart with bars/lines (beta)' },
  { keyword: 'block-beta', description: 'Block diagram (beta)' },
  { keyword: 'packet-beta', description: 'Network packet layout (beta)' },
  { keyword: 'architecture-beta', description: 'Architecture diagram (beta)' },
  { keyword: 'kanban', description: 'Kanban board (sections, tasks)' },
  { keyword: 'C4Context', description: 'C4 context diagram' },
  { keyword: 'C4Container', description: 'C4 container diagram' },
  { keyword: 'C4Component', description: 'C4 component diagram' },
  { keyword: 'C4Dynamic', description: 'C4 dynamic diagram' },
  { keyword: 'C4Deployment', description: 'C4 deployment diagram' },
  { keyword: 'venn-beta', description: 'Venn diagram (beta)' },
];

const THEMES = ['default', 'neutral', 'dark', 'forest', 'base'];

let mermaidPromise = null;

async function getMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = (async () => {
    setupDom();
    const module = await import('mermaid');
    const mermaid = module.default;
    await mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: 'default',
      useMaxWidth: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
      fontFamily: 'Liberation Sans, sans-serif',
    });
    return mermaid;
  })();
  return mermaidPromise;
}

export function stripFrontmatter(code) {
  const lines = code.split('\n');
  if (lines[0] && lines[0].trim().startsWith('---')) {
    const end = lines.slice(1).findIndex((l) => l.trim().startsWith('---'));
    if (end >= 0) return lines.slice(end + 2).join('\n');
  }
  return code;
}

export function detectType(code) {
  const stripped = stripFrontmatter(code);
  const firstLine = (stripped.match(/\S.*/) || [''])[0].trim();
  for (const { keyword } of DIAGRAM_TYPES) {
    if (firstLine === keyword) return keyword;
  }
  if (/^(flowchart|graph)\b/.test(firstLine)) return 'flowchart';
  return null;
}

export async function validateMermaid(code) {
  const mermaid = await getMermaid();
  const type = detectType(code);
  try {
    await mermaid.parse(code);
    return { valid: true, type: type ?? 'unknown', error: null };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    const lineMatch = message.match(/line (\d+)/i);
    return {
      valid: false,
      type: type ?? 'unknown',
      error: message,
      line: lineMatch ? Number(lineMatch[1]) : null,
    };
  }
}

export async function renderMermaid(code, options = {}) {
  const mermaid = await getMermaid();
  const theme = options.theme || 'default';
  if (!THEMES.includes(theme)) {
    throw new Error(`Unsupported theme "${theme}". Supported: ${THEMES.join(', ')}`);
  }
  const id = `diagram-${Math.random().toString(36).slice(2, 10)}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

export function sanitizeSvg(svg) {
  return svg
    .replace(/NaN/g, '0')
    .replace(/\bundefined\b/g, '0')
    .replace(/\bInfinity\b/g, '0');
}
