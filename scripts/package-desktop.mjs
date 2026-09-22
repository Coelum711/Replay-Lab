import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {packager} from '@electron/packager';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const platform=process.argv.includes('--linux')?'linux':'darwin',arch=platform==='darwin'?'arm64':'x64';
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'replay-desktop-build-'));
try{
  for(const folder of ['web','dist','docs','desktop'])await fs.cp(path.join(root,folder),path.join(stage,folder),{recursive:true});
  for(const file of ['LICENSE','THIRD_PARTY_NOTICES.md','DESKTOP_README_CN.md','PROSODY_0.56_CN.md','CAMERA_WORKBENCH_0.57_CN.md'])await fs.copyFile(path.join(root,file),path.join(stage,file));
  await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'replay-lab',productName:'Replay Lab',version:pkg.version,main:'desktop/main.cjs',type:'module',license:pkg.license},null,2));
  const destinations=await packager({dir:stage,out:path.join(root,'..','app-builds'),name:'Replay Lab',executableName:'Replay Lab',platform,arch,electronVersion:pkg.devDependencies.electron,appBundleId:'studio.replaylab.desktop',appVersion:pkg.version.split('-')[0],buildVersion:pkg.version.split('-')[0],icon:path.join(root,'desktop/assets/icon'),asar:true,prune:false,overwrite:true,osxSign:false,darwinDarkModeSupport:true,appCategoryType:'public.app-category.video',extendInfo:{NSHumanReadableCopyright:'Replay Lab contributors · GPL-3.0-only',CFBundleDisplayName:'Replay Lab'}});
  console.log(destinations.join('\n'));
}finally{await fs.rm(stage,{recursive:true,force:true});}
