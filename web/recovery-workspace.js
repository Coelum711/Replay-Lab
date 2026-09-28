import {makeId} from '../dist/index.js';

// Legacy projects have no project ID. Match authored record IDs, never titles
// or speaker names; a renamed draft or a moved copy of its folder still works.
export function isRecoveryWorkspace(recovered,existing){
  if(!existing)return true;
  return ['lines','characters','assets'].some(key=>{
    const ids=new Set((existing[key]||[]).map(item=>item.id).filter(Boolean));
    return (recovered[key]||[]).some(item=>ids.has(item.id));
  });
}

/** Back up the loaded disk manifest before reconnecting a recovered draft. */
export async function backupBeforeRecovery(workspace, recovered, existing) {
  if(!existing)return null;
  if(!isRecoveryWorkspace(recovered,existing))throw new Error('所选目录可能属于另一个工程，无法确认与恢复稿的关联。恢复稿仍保留，请选择原工程目录，或空文件夹另存。');
  await workspace.assertProjectCurrent?.();
  const original=await workspace.read('project.replaylab.json');
  await workspace.assertProjectCurrent?.();
  const path=`backups/before-recovery-${globalThis.crypto?.randomUUID?.()||makeId('snapshot')}.replaylab.json`;
  await workspace.write(path,original,'application/json');
  // Recheck after the backup write; another window may have saved meanwhile.
  await workspace.assertProjectCurrent?.();
  return path;
}
