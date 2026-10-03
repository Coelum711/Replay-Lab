/** Check media bindings without hiding permission or disk errors as healthy files. */
export async function diagnoseWorkspaceAssets(assets, workspace) {
  const issues=[];
  for(const asset of assets){
    if(!asset.sourcePath||/^(data:|https?:|blob:)/i.test(asset.sourcePath))continue;
    try{
      if(!(await workspace.exists(asset.sourcePath)))issues.push({code:'missing-workspace-file',severity:'error',assetId:asset.id,message:`工程目录缺少文件：${asset.sourcePath}`});
    }catch(error){
      issues.push({code:'unreadable-workspace-file',severity:'error',assetId:asset.id,message:`无法检查工程素材「${asset.name}」：${error?.message||error}`});
    }
  }
  return issues;
}
