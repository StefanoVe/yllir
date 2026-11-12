import type {
  BoardModule,
  CockpitSession,
  CockpitSessionView,
  CockpitState,
  CockpitStateView,
  ResolvedContent,
} from "../../../shared/src/cockpit-types.js";
export type Resolver = (module: BoardModule) => ResolvedContent;
export function stateView(
  state: CockpitState,
  resolve: Resolver,
  sessionId?: string,
): CockpitStateView {
  return {
    ...structuredClone(state),
    board: {
      ...structuredClone(state.board),
      modules: state.board.modules.map((module) => {
        const content = resolve(module);
        if (module.ref.type === "image" && sessionId)
          content.image = `/api/cockpit/sessions/${encodeURIComponent(sessionId)}/files/${encodeURIComponent(module.ref.path)}`;
        return { ...structuredClone(module), content };
      }),
    },
  };
}
export function sessionView(
  session: CockpitSession,
  resolve: Resolver,
): CockpitSessionView {
  return {
    ...structuredClone(session),
    state: stateView(session.state, resolve, session.id),
  };
}
