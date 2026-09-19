import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TextImporter,
  planMediaRelink,
  applyMediaRelinkPlan,
  replayEase,
  revealText,
  duplicateOutlineGroup,
  deleteOutlineGroup,
  buildScriptOutline,
  compilePerformance
} from '../dist/index.js';

test('RplGen-style bulk relocation matches exact filenames and exposes ambiguity', () => {
  const project = TextImporter.parse('A: hello');
  project.assets.push(
    {id:'a1',kind:'background',name:'room.png',sourcePath:'assets/backgrounds/old_room.png'},
    {id:'a2',kind:'sfx',name:'door.wav',sourcePath:'assets/sfx/door.wav'},
    {id:'a3',kind:'character',name:'Arthur.png',sourcePath:'assets/characters/Arthur.png'}
  );
  const plan = planMediaRelink(project,[
    {path:'Recovered/room.png'},
    {path:'Recovered/A/door.wav'},
    {path:'Recovered/B/door.wav'}
  ]);
  assert.equal(plan.find(x=>x.assetId==='a1').status,'matched');
  assert.equal(plan.find(x=>x.assetId==='a2').status,'ambiguous');
  assert.equal(plan.find(x=>x.assetId==='a3').status,'missing');
  assert.equal(applyMediaRelinkPlan(project,plan),1);
  assert.equal(project.assets.find(x=>x.id==='a1').sourcePath,'Recovered/room.png');
  assert.equal(project.assets.find(x=>x.id==='a2').sourcePath,'assets/sfx/door.wav');
});

test('ported RplGen easing curves are normalized and monotonic at endpoints', () => {
  const names=['linear','quadratic','quadraticR','sigmoid','right','left','sincurve'];
  for(const name of names){
    assert.ok(Math.abs(replayEase(name,0)) < 1e-9, `${name} starts at 0`);
    assert.ok(Math.abs(replayEase(name,1)-1) < 1e-9, `${name} ends at 1`);
    let prev=-1;
    for(let i=0;i<=20;i++){
      const value=replayEase(name,i/20);
      assert.ok(value>=prev-1e-9, `${name} monotonic`);
      prev=value;
    }
  }
});

test('text reveal modes compile and reveal progressively', () => {
  const project=TextImporter.parse('A: abcdef');
  project.lines[0].duration=2;
  project.lines[0].textEffect='w2w';
  project.lines[0].textEffectDuration=1;
  const perf=compilePerformance(project).lines[0];
  assert.equal(perf.textEffect,'w2w');
  assert.equal(revealText(perf,0),'');
  assert.ok(revealText(perf,0.5).length>=3);
  assert.equal(revealText(perf,1),'abcdef');
});

test('duplicate Scene creates a new structural sibling with fresh line ids', () => {
  const project=TextImporter.parse('A: a1\nA: a2\nA: b1');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='A';
  project.lines[2].sceneTitle='B';
  const originalIds=project.lines.map(x=>x.id);
  const result=duplicateOutlineGroup(project,0,'scene');
  assert.ok(result);
  assert.deepEqual(project.lines.map(x=>x.text),['a1','a2','a1','a2','b1']);
  assert.ok(result.lineIds.every(id=>!originalIds.includes(id)));
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[2].scene,'A 副本');
  assert.equal(outline[4].scene,'B');
});

test('duplicate and delete Chapter operate as complete blocks', () => {
  const project=TextImporter.parse('A: a1\nA: a2\nA: b1');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='S1';
  project.lines[2].chapterTitle='C2';
  project.lines[2].sceneTitle='S2';
  const dup=duplicateOutlineGroup(project,0,'chapter');
  assert.ok(dup);
  assert.equal(buildScriptOutline(project.lines)[2].chapter,'C1 副本');
  assert.equal(deleteOutlineGroup(project,dup.start,'chapter'),true);
  assert.deepEqual(project.lines.map(x=>x.text),['a1','a2','b1']);
  assert.equal(buildScriptOutline(project.lines)[2].chapter,'C2');
});

import { RplGenImporter } from '../dist/index.js';

test('RGL importer carries RplGen global text method and formula into structured Replay data', () => {
  const project=RplGenImporter.parse('<set:tx_method_default>:<w2w=2>\n<set:formula>:sigmoid\n[A]:abcd');
  assert.equal(project.lines[0].textEffect,'w2w');
  assert.ok(Math.abs(project.lines[0].textEffectDuration - 8/30) < 1e-9);
  assert.equal(project.lines[0].scene.cameraCurve,'sigmoid');
  assert.equal(project.lines[0].scene.transitionCurve,'sigmoid');
});

import { parseRplGenMethodLabel, parseRplGenMethodToken, evaluateRplGenMotion } from '../dist/index.js';

test('RGL importer preserves background switch methods and stage motion methods', () => {
  const project=RplGenImporter.parse('<background><cross=30>:room.png\n[A]<black_pass_up_minor=15>:hello');
  const line=project.lines[0];
  assert.equal(line.scene.background,'room.png');
  assert.equal(line.scene.backgroundMethod,'cross');
  assert.ok(Math.abs(line.scene.backgroundMethodDuration-1) < 1e-9);
  assert.equal(line.stageMethod.name,'black_pass_up_minor');
  assert.ok(Math.abs(line.stageMethod.duration-0.5) < 1e-9);
});

test('RplGen Motion.py port parses compound method vocabulary and produces finite offsets', () => {
  const parsed=parseRplGenMethodLabel('black_pass_left_minor_in');
  assert.equal(parsed.alpha,'black');
  assert.equal(parsed.motion,'pass');
  assert.equal(parsed.directionDeg,90);
  assert.equal(parsed.scale,'minor');
  assert.equal(parsed.cutIn,true);
  assert.equal(parsed.cutOut,false);
  const spec=parseRplGenMethodToken('<black_pass_left_minor=30>');
  const start=evaluateRplGenMotion(spec,0,3,{width:1920,height:1080},'sigmoid');
  const settled=evaluateRplGenMotion(spec,1.1,3,{width:1920,height:1080},'sigmoid');
  assert.ok(start.alpha <= settled.alpha);
  assert.ok(Math.abs(start.dx) > Math.abs(settled.dx));
});

test('RGL structured Dice preserves RplGen tuple fields including NA checks', () => {
  const project=RplGenImporter.parse('<dice>:(侦查,100,65,32),(伤害,6,NA,4)');
  const line=project.lines[0];
  assert.equal(line.type,'dice');
  assert.deepEqual(line.diceRolls,[
    {label:'侦查',sides:100,check:65,result:32},
    {label:'伤害',sides:6,check:null,result:4}
  ]);
  assert.deepEqual(compilePerformance(project).lines[0].diceRolls,line.diceRolls);
});

test('RGL HitPoint command becomes structured HP animation data', () => {
  const project=RplGenImporter.parse('<hitpoint>:(Arthur,10,8,3)');
  const line=project.lines[0];
  assert.equal(line.type,'hitpoint');
  assert.deepEqual(line.hitPoint,{label:'Arthur',max:10,before:8,after:3});
  const perf=compilePerformance(project).lines[0];
  assert.deepEqual(perf.hitPoint,line.hitPoint);
  assert.equal(perf.stage.length,0);
});

import { parseRplGenMediaDef, rplgenMediaDefinitionId, importVirtualFolder, createDefaultImporterRegistry } from '../dist/index.js';

test('RplGen MediaDef parser normalizes Text/RichText/Bubble/DynamicBubble/ChatWindow and keeps source metadata', () => {
  const defs=parseRplGenMediaDef(`
气泡主文本 = Text(fontfile='./font.otf',fontsize=40,color=(60,60,60,255),line_limit=30)
气泡富文本 = RichText(fontfile='./font.otf',fontsize=44,color=(255,255,255,255),line_limit=20)
气泡左 = Bubble(filepath='@/media/bubble.png',Main_Text=气泡主文本,Header_Text=气泡富文本,pos=(70,700),mt_pos=(50,110),ht_pos=(200,10),align='left',line_distance=1.3)
自适应白 = DynamicBubble(filepath='@/media/dynamic.png',Main_Text=气泡主文本,Header_Text=None,pos=(100,600),mt_pos=(50,93),mt_end=(86,129),fill_mode='stretch')
聊天窗 = ChatWindow(filepath='@/media/chat.png',sub_align=['right','left'],pos=(0,240),sub_pos=(188,185),sub_end=(1240,800),sub_distance=6)
`);
  assert.equal(defs.length,5);
  const text=defs.find(x=>x.name==='气泡主文本');
  assert.equal(text.type,'text');
  assert.equal(text.fontSize,40);
  assert.match(text.color,/rgba\(60,60,60,1\)/);
  const bubble=defs.find(x=>x.name==='气泡左');
  assert.equal(bubble.type,'bubble');
  assert.equal(bubble.backgroundSource,'media/bubble.png');
  assert.equal(bubble.mainTextStyleId,rplgenMediaDefinitionId('气泡主文本'));
  assert.equal(bubble.headerTextStyleId,rplgenMediaDefinitionId('气泡富文本'));
  const chat=defs.find(x=>x.name==='聊天窗');
  assert.equal(chat.type,'chat-window');
  assert.equal(chat.width,1052);
  assert.equal(chat.height,615);
  assert.equal(chat.messageGap,6);
  assert.equal(chat.metadata.rplgen.revision,'89e65b63c97a74ebff665be038e6dea2a700ec14');
});

test('RGL bubble command becomes a structured BubbleEvent and survives compilation', () => {
  const project=RplGenImporter.parse(`<bubble><cross=15>:气泡左("Arthur","Hello",<w2w=2>)`);
  const line=project.lines[0];
  assert.equal(line.type,'bubble');
  assert.equal(line.bubble.definitionId,rplgenMediaDefinitionId('气泡左'));
  assert.equal(line.bubble.headerText,'Arthur');
  assert.equal(line.bubble.mainText,'Hello');
  assert.equal(line.bubble.textEffect,'w2w');
  assert.ok(Math.abs(line.bubble.textEffectDuration-10/30)<1e-9);
  const perf=compilePerformance(project).lines[0];
  assert.equal(perf.bubble.definitionId,line.bubble.definitionId);
  assert.equal(perf.type,'bubble');
});

test('folder import recognizes RplGen MediaObject txt as definitions rather than fake dialogue log', async () => {
  const files=[
    {name:'MediaObject.txt',relativePath:'Demo/MediaObject.txt',type:'text/plain',async text(){return `TextA = Text(fontsize=40,color=(255,255,255,255))\nBubbleA = Bubble(filepath='@/media/bubble.png',Main_Text=TextA,pos=(10,20))`; }},
    {name:'LogFile.rgl',relativePath:'Demo/LogFile.rgl',type:'text/plain',async text(){return `[A]:hello`;}}
  ];
  const result=await importVirtualFolder(files,createDefaultImporterRegistry());
  assert.equal(result.project.lines.length,1);
  assert.equal(result.project.lines[0].text,'hello');
  assert.equal(result.project.mediaDefinitions.length,2);
  assert.ok(result.project.mediaDefinitions.some(x=>x.name==='BubbleA'));
});

test('RplGen MediaDef keeps ChatWindow participant bubble/avatar mappings and imports Animation avatars', () => {
  const defs=parseRplGenMediaDef(`
TextA = Text(fontsize=36,color=(255,255,255,255))
BubbleL = DynamicBubble(filepath='@/media/l.png',Main_Text=TextA,pos=(0,0),mt_pos=(20,30),mt_end=(60,70),fill_mode='stretch',fit_axis='free')
BubbleR = DynamicBubble(filepath='@/media/r.png',Main_Text=TextA,pos=(0,0),mt_pos=(20,30),mt_end=(60,70),fill_mode='collage',fit_axis='vertical')
AvatarA = Animation(filepath='@/media/a.png',scale=1.2,pos=(10,20))
AvatarB = Animation(filepath='@/media/b.png',scale=1,pos=(10,20))
Chat = ChatWindow(filepath='@/media/chat.png',sub_key=['A','B'],sub_Bubble=[BubbleL,BubbleR],sub_Anime=[AvatarA,AvatarB],sub_align=['left','right'],pos=(0,240),sub_pos=(188,185),sub_end=(1240,800),am_left=35,am_right=1398,sub_distance=12)
`);
  const avatar=defs.find(x=>x.name==='AvatarA');
  assert.equal(avatar.type,'image');
  assert.equal(avatar.source,'media/a.png');
  assert.equal(avatar.scale,1.2);
  const left=defs.find(x=>x.name==='BubbleL');
  assert.equal(left.type,'dynamic-bubble');
  assert.equal(left.mainTextEndX,60);
  assert.equal(left.mainTextEndY,70);
  assert.equal(left.fitAxis,'free');
  const right=defs.find(x=>x.name==='BubbleR');
  assert.equal(right.fillMode,'collage');
  assert.equal(right.fitAxis,'vertical');
  const chat=defs.find(x=>x.name==='Chat');
  assert.deepEqual(chat.participants,[
    {key:'A',bubbleDefinitionId:rplgenMediaDefinitionId('BubbleL'),avatarDefinitionId:rplgenMediaDefinitionId('AvatarA'),align:'left'},
    {key:'B',bubbleDefinitionId:rplgenMediaDefinitionId('BubbleR'),avatarDefinitionId:rplgenMediaDefinitionId('AvatarB'),align:'right'}
  ]);
  assert.equal(chat.subX,188);
  assert.equal(chat.subY,185);
  assert.equal(chat.subWidth,1052);
  assert.equal(chat.subHeight,615);
  assert.equal(chat.avatarLeft,35);
  assert.equal(chat.avatarRight,1398);
});

test('RplGen RichText icon substitution and Balloon multi-header metadata are normalized', () => {
  const defs=parseRplGenMediaDef(`
Main = RichText(fontsize=40,color=(255,255,255,255),line_limit=20,sub_key=['heart','star'],sub_icon=['@/media/heart.png','@/media/star.png'])
Head = Text(fontsize=28,color=(255,255,255,255))
HP = Text(fontsize=24,color=(255,80,80,255))
BalloonA = Balloon(filepath='@/media/balloon.png',Main_Text=Main,Header_Text=[Head,HP],pos=(70,700),mt_pos=(50,110),ht_pos=[(200,10),(900,20)],ht_target=['Name','HitPoint'],head_align=['left','right'])
`);
  const rich=defs.find(x=>x.name==='Main');
  assert.deepEqual(rich.iconMap,{heart:'media/heart.png',star:'media/star.png'});
  const balloon=defs.find(x=>x.name==='BalloonA');
  assert.equal(balloon.type,'balloon');
  assert.equal(balloon.headers.length,2);
  assert.deepEqual(balloon.headers.map(x=>[x.textStyleId,x.x,x.y,x.target,x.align]),[
    [rplgenMediaDefinitionId('Head'),200,10,'Name','left'],
    [rplgenMediaDefinitionId('HP'),900,20,'HitPoint','right']
  ]);
});
