/** Serializes writes within a page and, where available, across same-origin tabs. */
const tails = new WeakMap<object, Promise<unknown>>();
export function serializeWorkspaceWrite<T>(owner: object, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(owner) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(() => {
    const locks = globalThis.navigator?.locks;
    return locks ? locks.request('replaylab-workspace-manifest', task) : task();
  });
  tails.set(owner, result);
  return result;
}
