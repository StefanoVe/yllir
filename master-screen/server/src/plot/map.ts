// Maps the result of the framework's plot-map (plotMap(root)) to PlotResponse.
// Node ids: "session:<session id>" and "scene:<event id>"; a scene's `session` is the node id
// of its session. Edges: 'depends' from a prerequisite to what depends on it (declared
// depends_on only, unknown ids dropped); 'order' from each item to the next one of the same
// list (sessions of one arc, scenes of one session) when the two have no declared dependency
// between them. Only paths, titles, ids and statuses leave here: never a document body.
// GET /api/plot is built by toPlotFlow: the Mermaid source of the plot flowchart (readPlotFlowchart)
// joined with the statuses and titles of plotMap(root), plus the status classes appended server side.
// toPlotResponse keeps the graph of the cockpit (nodes and edges from the same plotMap result).
// Owner: plot engineer.
import type {
  PlotEdge,
  PlotFlowNode,
  PlotNode,
  PlotResponse,
  PlotSheet,
  PlotSheetsResponse,
} from '../../../shared/src/types.js';

/** The fields of plotMap(root).sessions[] that the map uses. */
export interface PlotSceneInput {
  id: string;
  file: string;
  name: string;
  depends_on: string[];
}

export interface PlotSessionInput {
  id: string;
  file: string;
  name: string;
  arc: string;
  depends_on: string[];
  played: boolean;
  ready: boolean;
  events: PlotSceneInput[];
}

export interface PlotMapResult {
  sessions: PlotSessionInput[];
}

/** The fields of readPlotFlowchart(root) that the flowchart uses. */
export interface PlotFlowchartResult {
  file: string | null;
  mermaid: string;
  paths: Array<{ id: string; path: string }>;
  errors: Array<{ code: string; file: string; message: string }>;
}

/** The graph of the cockpit: nodes and edges of the plot map (not the master screen flowchart). */
export interface PlotMapGraph {
  nodes: PlotNode[];
  edges: PlotEdge[];
}

type PlotStatus = NonNullable<PlotFlowNode['status']>;

// Explicit colours: the flowchart is drawn in the master screen with its own theme, so the
// classes carry their own fill and text colour. Played is the quietest, waiting is dashed.
const STATUS_CLASS_DEFS: string[] = [
  'classDef played fill:#d9d9d9,stroke:#4a4a4a,color:#111111',
  'classDef ready fill:#fff4c2,stroke:#9a7b00,color:#111111',
  'classDef waiting fill:#ffffff,stroke:#8a8a8a,color:#333333,stroke-dasharray:4 3',
];

export const sessionNodeId = (id: string): string => `session:${id}`;
export const sceneNodeId = (id: string): string => `scene:${id}`;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function toPlotResponse(result: PlotMapResult): PlotMapGraph {
  const nodes: PlotNode[] = [];
  const edges: PlotEdge[] = [];
  const sessionIds = new Set(result.sessions.map((s) => sessionNodeId(s.id)));
  const sceneIds = new Set<string>();

  for (const session of result.sessions) {
    const status = session.played ? 'played' : session.ready ? 'ready' : 'waiting';
    nodes.push({
      id: sessionNodeId(session.id),
      kind: 'session',
      title: session.name,
      path: session.file,
      status,
    });
    for (const scene of session.events) {
      sceneIds.add(sceneNodeId(scene.id));
      nodes.push({
        id: sceneNodeId(scene.id),
        kind: 'scene',
        title: scene.name,
        path: scene.file,
        session: sessionNodeId(session.id),
      });
    }
  }

  const declared = new Set<string>(); // "from>to" of every depends edge, both directions checked below
  const addDepends = (from: string, to: string): void => {
    declared.add(`${from}>${to}`);
    edges.push({ from, to, kind: 'depends' });
  };

  for (const session of result.sessions) {
    // A self dependency is a cycle, which the framework reports; it is not drawn.
    for (const dep of unique(session.depends_on)) {
      if (dep !== session.id && sessionIds.has(sessionNodeId(dep))) {
        addDepends(sessionNodeId(dep), sessionNodeId(session.id));
      }
    }
    for (const scene of session.events) {
      for (const dep of unique(scene.depends_on)) {
        if (dep !== scene.id && sceneIds.has(sceneNodeId(dep))) {
          addDepends(sceneNodeId(dep), sceneNodeId(scene.id));
        }
      }
    }
  }

  const linked = (a: string, b: string): boolean => declared.has(`${a}>${b}`) || declared.has(`${b}>${a}`);
  const orderPairs = (ids: string[]): void => {
    for (let i = 0; i + 1 < ids.length; i++) {
      if (!linked(ids[i], ids[i + 1])) edges.push({ from: ids[i], to: ids[i + 1], kind: 'order' });
    }
  };

  for (const arc of unique(result.sessions.map((s) => s.arc))) {
    orderPairs(result.sessions.filter((s) => s.arc === arc).map((s) => sessionNodeId(s.id)));
  }
  for (const session of result.sessions) {
    orderPairs(session.events.map((scene) => sceneNodeId(scene.id)));
  }

  return { nodes, edges };
}

/**
 * GET /api/plot. A missing flowchart file gives `missing: true` and no source. Otherwise the
 * source is the file's Mermaid block, then the three status classes, then one `class <id> <status>`
 * line per node that has a status. Only nodes whose path is a sheet of the plot map are kept.
 */
export function toPlotFlow(flow: PlotFlowchartResult, result: PlotMapResult): PlotResponse {
  if (flow.file === null) return { mermaid: '', nodes: [], missing: true };

  const bySheet = new Map<string, Omit<PlotFlowNode, 'id' | 'path'>>();
  for (const session of result.sessions) {
    const status: PlotStatus = session.played ? 'played' : session.ready ? 'ready' : 'waiting';
    if (session.file) bySheet.set(session.file, { title: session.name, kind: 'session', status });
    for (const scene of session.events) {
      if (scene.file) bySheet.set(scene.file, { title: scene.name, kind: 'scene' });
    }
  }

  const nodes: PlotFlowNode[] = [];
  const classLines: string[] = [];
  for (const entry of flow.paths) {
    const sheet = bySheet.get(entry.path);
    if (sheet === undefined) continue;
    const node: PlotFlowNode = { id: entry.id, path: entry.path, ...sheet };
    nodes.push(node);
    if (node.status !== undefined) classLines.push(`class ${node.id} ${node.status}`);
  }

  const source = flow.mermaid.trimEnd();
  const mermaid = source === '' ? '' : [source, ...STATUS_CLASS_DEFS, ...classLines].join('\n');
  return { mermaid, nodes, missing: false };
}

/**
 * The plot sheets in navigator order: each session, immediately followed by its own scenes in
 * events order. Entries with an empty file are skipped. Only path, title, kind and the session
 * node id leave here, never a body.
 */
export function toPlotSheets(result: PlotMapResult): PlotSheetsResponse {
  const sheets: PlotSheet[] = [];
  for (const session of result.sessions) {
    if (session.file) {
      sheets.push({ path: session.file, title: session.name, kind: 'session' });
    }
    for (const scene of session.events) {
      if (scene.file) {
        sheets.push({
          path: scene.file,
          title: scene.name,
          kind: 'scene',
          session: sessionNodeId(session.id),
        });
      }
    }
  }
  return { sheets };
}
