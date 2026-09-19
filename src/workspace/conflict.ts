export class WorkspaceConflictError extends Error {
  readonly code = 'workspace-project-conflict';
  constructor(message = 'The project file changed in another window or process.') {
    super(message);
    this.name = 'WorkspaceConflictError';
  }
}

/** Small deterministic fingerprint for optimistic workspace conflict detection. */
export function workspaceManifestFingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

export function isWorkspaceConflictError(error: unknown): error is WorkspaceConflictError {
  return !!error && typeof error === 'object' && ((error as any).code === 'workspace-project-conflict' || (error as any).name === 'WorkspaceConflictError');
}
