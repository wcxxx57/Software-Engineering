import type {
  RuntimeCommand,
  VisualizationElement,
  VisualizationRelation,
  VisualizationSpec,
} from "./schema.js";

export interface MaterializedVisualization {
  elements: VisualizationElement[];
  relations: VisualizationRelation[];
  focusIds: string[];
}

export interface RuntimeState {
  step: number;
  playing: boolean;
  highlightedIds: string[];
  focusedIds: string[];
}

export const INITIAL_RUNTIME_STATE: RuntimeState = {
  step: 0,
  playing: false,
  highlightedIds: [],
  focusedIds: [],
};

export function normalizeRuntimeState(spec: VisualizationSpec, state: RuntimeState = INITIAL_RUNTIME_STATE): RuntimeState {
  const knownIds = new Set([...spec.elements.map((element) => element.id), ...spec.relations.map((relation) => relation.id)]);
  return {
    step: Math.max(0, Math.min(spec.steps.length, state.step)),
    playing: state.playing,
    highlightedIds: [...new Set(state.highlightedIds.filter((id) => knownIds.has(id)))],
    focusedIds: [...new Set(state.focusedIds.filter((id) => knownIds.has(id)))],
  };
}

export function materializeVisualization(spec: VisualizationSpec, step: number): MaterializedVisualization {
  const elements = structuredClone(spec.elements);
  const relations = structuredClone(spec.relations);
  const elementById = new Map(elements.map((element) => [element.id, element]));
  const relationById = new Map(relations.map((relation) => [relation.id, relation]));
  let focusIds: string[] = [];

  for (const current of spec.steps.slice(0, Math.max(0, Math.min(step, spec.steps.length)))) {
    for (const operation of current.operations) {
      if (operation.type === "focus") {
        focusIds = operation.targetIds;
        continue;
      }
      if (operation.type === "setPointerTarget") {
        const pointer = elementById.get(operation.targetId);
        if (!pointer || pointer.kind !== "pointer") continue;
        if (operation.pointsToId === null) {
          delete pointer.targetId;
          delete pointer.targetIndex;
        } else {
          pointer.targetId = operation.pointsToId;
          if (operation.targetIndex === undefined) delete pointer.targetIndex;
          else pointer.targetIndex = operation.targetIndex;
        }
        continue;
      }
      const target = elementById.get(operation.targetId) ?? relationById.get(operation.targetId);
      if (!target) continue;
      if (operation.type === "setState") target.state = operation.state;
      if (operation.type === "setVisible") target.visible = operation.visible;
      if ("value" in operation && "value" in target) target.value = operation.value;
      if (operation.type === "setLabel") target.label = operation.label;
    }
  }

  return { elements, relations, focusIds };
}

export function applyRuntimeCommand(state: RuntimeState, command: RuntimeCommand, totalSteps: number): RuntimeState {
  switch (command.type) {
    case "play": return { ...state, playing: true };
    case "pause": return { ...state, playing: false };
    case "reset": return { ...INITIAL_RUNTIME_STATE };
    case "next": return { ...state, playing: false, step: Math.min(totalSteps, state.step + 1) };
    case "previous": return { ...state, playing: false, step: Math.max(0, state.step - 1) };
    case "seek": return { ...state, playing: false, step: Math.max(0, Math.min(totalSteps, command.step)) };
    case "highlight": return { ...state, highlightedIds: command.targetIds };
    case "clearHighlight": return { ...state, highlightedIds: [] };
    case "focus": return { ...state, focusedIds: command.targetIds };
  }
}
