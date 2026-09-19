import type { CustomObjectInteractionTake, CustomObjectTransform, ReplayProject } from '../core/types.js';
import { formatDirectorCommand } from '../core/directives.js';

export interface BakedCustomObjectInteractionRow {
  at: number;
  text: string;
  sourceStepId?: string | null;
}

/** Convert a recorded object interaction into ordinary linear director rows. */
export function bakeCustomObjectInteractionTake(project: ReplayProject, take: CustomObjectInteractionTake): BakedCustomObjectInteractionRow[] {
  const object = project.customObjects.find(item => item.id === take.objectId);
  if (!object) return [];
  const rows: BakedCustomObjectInteractionRow[] = [];
  const transform: CustomObjectTransform = { ...object.transform };
  let cursor = 0;
  for (const step of [...(take.steps ?? [])].sort((a, b) => a.at - b.at)) {
    const at = Math.max(cursor, Number(step.at) || 0);
    const wait = at - cursor;
    if (wait > 0.025) rows.push({ at: cursor, text: `/wait ${wait.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}` });
    cursor = at;
    if (step.kind === 'state' && step.stateId) {
      rows.push({ at, sourceStepId: step.id, text: formatDirectorCommand(project, { kind: 'object', objectId: object.id, target: object.name, objectAction: 'state', objectStateId: step.stateId }) });
    } else if (step.kind === 'hide') {
      rows.push({ at, sourceStepId: step.id, text: formatDirectorCommand(project, { kind: 'object', objectId: object.id, target: object.name, objectAction: 'hide' }) });
    } else if (['transform','pan','zoom'].includes(step.kind) && step.transform) {
      Object.assign(transform, step.transform);
      rows.push({ at, sourceStepId: step.id, text: formatDirectorCommand(project, { kind: 'object', objectId: object.id, target: object.name, objectAction: 'transform', objectTransform: { ...transform } }) });
    }
  }
  return rows;
}
