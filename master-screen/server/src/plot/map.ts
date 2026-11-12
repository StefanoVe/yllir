// Maps the result of the framework's plot-map (plotMap(root)) to PlotResponse.
// Node ids: "session:<session id>" and "scene:<event id>"; a scene's `session` is the node id
// of its session. Edges: 'depends' from a prerequisite to what depends on it (declared
// depends_on only, unknown ids dropped); 'order' from each item to the next one of the same
// list (sessions of one arc, scenes of one session) when the two have no declared dependency
// between them. Only paths, titles, ids and statuses leave here: never a document body.
// Owner: plot engineer.
import type { PlotEdge, PlotNode, PlotResponse } from '../../../shared/src/types.js';

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

export const sessionNodeId = (id: string): string => `session:${id}`;
export const sceneNodeId = (id: string): string => `scene:${id}`;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function toPlotResponse(result: PlotMapResult): PlotResponse {
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
