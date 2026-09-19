import { compilePerformance } from '../core/compiler.js';
import type { ReplayProject } from '../core/types.js';

export function exportPerformanceJson(project: ReplayProject, pretty = true): string {
  return JSON.stringify(compilePerformance(project), null, pretty ? 2 : 0);
}
