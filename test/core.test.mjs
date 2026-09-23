import test from 'node:test';
import {mockWav} from './helpers/wav.mjs';
import assert from 'node:assert/strict';
import {
  TextImporter,
  CocofoliaImporter,
  RplGenImporter,
  parseLab,
  phonemeToViseme,
  englishPhonemeToViseme,
  universalPhonemeToViseme,
  phonemesToMouthCues,
  compilePerformance,
  applyTemplate,
  BUILTIN_TEMPLATES,
  exportTyranoScript,
  createProject,
  normalizeReplayProject,
  createCharacter,
  createFaceTemplate,
  classifyFaceTemplatePartFilename,
  planFaceTemplateBindings,
  planSpeechPauses,
  speechPauseExtraSeconds,
  speechTextForGenericTts,
  resolveSpeechPauseScale
} from '../dist/index.js';

test('0.40 core project normalizer upgrades partial/older project shapes consistently', () => {
  const raw={format:'ReplayLabProject',version:'0.33',title:'old',characters:[{id:'c',name:'Arthur',color:'#fff',kind:'normal',showOnStage:true,defaultPosition:'auto'}],lines:[],assets:[]};
  const project=normalizeReplayProject(raw);
  assert.equal(project.version,'0.53');
  assert.equal(project.settings.speechPauseScale,1);
  assert.deepEqual(project.faceTemplates,[]);
  assert.deepEqual(project.characters[0].aliases,[]);
  assert.ok(project.characters[0].faceFit);
  assert.ok(project.characters[0].puppet);
});

test('QQ/plain text importer', () => {
  const input = `Arthur 21:57:56\n我要调查这扇门。\nKP：投一个侦查。`;
  const project = TextImporter.parse(input, { title: 'test' });
  assert.equal(project.lines.length, 2);
  assert.equal(project.characters[0].name, 'Arthur');
  assert.equal(project.lines[1].text, '投一个侦查。');
});

test('Cocofolia semantic HTML importer', () => {
  const html = `<section class="tab"><ol><li class="player"><span class="speaker"><span class="speaker-text">太郎</span></span><div class="player-message">こんにちは！</div></li></ol></section>`;
  const project = CocofoliaImporter.parse(html);
  assert.equal(project.lines.length, 1);
  assert.equal(project.characters[0].name, '太郎');
});

test('RGL dialogue and scene commands', () => {
  const rgl = `<background>:warehouse.png\n<BGM>:tension.mp3\n[Arthur]Hello^world\n<dice>:1d100=32/65 success`;
  const project = RplGenImporter.parse(rgl);
  assert.ok(project.lines.length >= 2);
  assert.equal(project.lines[0].scene.background, 'warehouse.png');
  assert.equal(project.lines[0].text, 'Hello\nworld');
  assert.equal(project.lines.at(-1).type, 'dice');
});

test('LAB ticks and KuchiPaku-derived viseme groups', () => {
  const lab = `0 1000000 sil\n1000000 2000000 a\n2000000 3000000 m\n3000000 4000000 iy`;
  const parsed = parseLab(lab);
  assert.equal(parsed[1].start, 0.1);
  assert.equal(phonemeToViseme('a'), 'A');
  assert.equal(phonemeToViseme('m'), 'CLOSED');
  assert.equal(phonemeToViseme('iy'), 'I');
  const cues = phonemesToMouthCues(parsed, { visualLeadMs: 0 });
  assert.equal(cues[1].viseme, 'A');
});


test('old LipSync Studio English ARPABET mapping keeps its compact extra visemes', () => {
  assert.equal(englishPhonemeToViseme('AA1'), 'A');
  assert.equal(englishPhonemeToViseme('AE2'), 'AE');
  assert.equal(englishPhonemeToViseme('AH0'), 'SCHWA');
  assert.equal(englishPhonemeToViseme('AO1'), 'OO');
  assert.equal(englishPhonemeToViseme('UH0'), 'UU');
  assert.equal(englishPhonemeToViseme('F'), 'F');
  assert.equal(englishPhonemeToViseme('V'), 'F');
  assert.equal(englishPhonemeToViseme('DH'), 'TH');
  assert.equal(englishPhonemeToViseme('B'), 'M');
  assert.equal(englishPhonemeToViseme('L'), 'CLOSED');
  assert.equal(phonemeToViseme('AE1', 'open-closed', 'en-GB'), 'AE');
  assert.equal(phonemeToViseme('m'), 'CLOSED', 'generic lowercase LAB mapping stays backward compatible');
  assert.equal(phonemesToMouthCues([{start:0,end:.1,phoneme:'W'}], {visualLeadMs:0,language:'en-US'})[0].viseme, 'W');
});

test('0.27 universal articulatory fallback reuses extended English visemes for other languages', () => {
  assert.equal(universalPhonemeToViseme('p'), 'M');
  assert.equal(universalPhonemeToViseme('ɱ'), 'F');
  assert.equal(universalPhonemeToViseme('θ'), 'TH');
  assert.equal(universalPhonemeToViseme('ʍ'), 'W');
  assert.equal(universalPhonemeToViseme('ə'), 'SCHWA');
  assert.equal(universalPhonemeToViseme('æ'), 'AE');
  assert.equal(universalPhonemeToViseme('ʊ'), 'UU');
  assert.equal(universalPhonemeToViseme('ɔ'), 'OO');
  assert.equal(universalPhonemeToViseme('k'), null);

  assert.equal(phonemeToViseme('m', 'open-closed', 'cy-GB'), 'M', 'Welsh/language-tagged bilabial uses universal visual class');
  assert.equal(phonemeToViseme('f', 'open-closed', 'is-IS'), 'F');
  assert.equal(phonemeToViseme('θ', 'open-closed', 'is-IS'), 'TH');
  assert.equal(phonemeToViseme('w', 'open-closed', 'cy-GB'), 'W');
  assert.equal(phonemeToViseme('ə', 'open-closed', 'ga-IE'), 'SCHWA');
  assert.equal(phonemeToViseme('ɔ', 'open-closed', 'gd-GB'), 'OO');
  assert.equal(phonemeToViseme('m'), 'CLOSED', 'language-less legacy LAB behavior stays unchanged');
  assert.equal(phonemeToViseme('θ'), 'TH', 'distinctive IPA can safely auto-route without a language tag');
});

test('0.27 universal fallback strips IPA stress/length/diacritics and handles labialisation', () => {
  assert.equal(universalPhonemeToViseme('ˈæː'), 'AE');
  assert.equal(universalPhonemeToViseme('ã'), 'A');
  assert.equal(universalPhonemeToViseme('kʷ'), 'W');
  assert.equal(universalPhonemeToViseme('eɪ'), 'E');
});

test('0.35 face-template autobind classifies clear names and marks incomplete names as low-confidence guesses', () => {
  assert.equal(classifyFaceTemplatePartFilename('eyes/left/open.png').slot, 'eyeLeftOpen');
  assert.equal(classifyFaceTemplatePartFilename('Arthur_eyeRightClosed.webp').slot, 'eyeRightClosed');
  assert.equal(classifyFaceTemplatePartFilename('眉毛_左.png').slot, 'browLeft');
  assert.equal(classifyFaceTemplatePartFilename('mouth/AE.png').slot, 'mouthAe');
  assert.equal(classifyFaceTemplatePartFilename('mouth_th.png').slot, 'mouthTh');
  assert.equal(classifyFaceTemplatePartFilename('pretty_face.png').slot, null);
  const eyeGuess = classifyFaceTemplatePartFilename('eye.png');
  assert.equal(eyeGuess.slot, 'eyesOpen');
  assert.ok(eyeGuess.confidence < 0.9, 'eye without open/closed must require user confirmation');
});

test('0.31 face-template autobind marks same-slot collisions instead of silently choosing a file', () => {
  const plan = planFaceTemplateBindings(['mouth_A.png','mouth/a.webp','eyes_left_open.png','notes.png']);
  assert.equal(plan.recognized, 3);
  assert.equal(plan.unknown, 1);
  assert.equal(plan.conflicts, 2);
  assert.equal(plan.items.filter(item => item.slot === 'mouthA').every(item => item.conflict), true);
  assert.equal(plan.items.find(item => item.slot === 'eyeLeftOpen').conflict, false);
});

test('0.29 characters default face-fit settings and compiled projects preserve shared face templates', () => {
  const project = createProject('face');
  const arthur = createCharacter('Arthur');
  project.characters.push(arthur);
  const template = createFaceTemplate('通用脸');
  template.layers.eyesOpen = 'eyes-open';
  project.faceTemplates.push(template);
  arthur.faceFit.templateId = template.id;
  assert.equal(arthur.faceFit.orientation, 'front');
  const perf = compilePerformance(project);
  assert.equal(perf.version, '0.53');
  assert.equal(perf.faceTemplates[0].name, '通用脸');
  assert.equal(perf.characters[0].faceFit.templateId, template.id);
});

test('0.43 compiler carries visual stage transforms through a Scene and exposes manual/inherited/auto provenance', () => {
  const project = TextImporter.parse(`Arthur: one\nArthur: two\nArthur: three`);
  const arthur = project.characters.find(c => c.name === 'Arthur');
  project.lines[0].stageTransforms = { [arthur.id]: { x:.33, y:.81, scale:1.12 } };
  project.lines[2].stageTransforms = { [arthur.id]: null };
  const perf = compilePerformance(project);
  const first=perf.lines[0].stage.find(actor=>actor.characterId===arthur.id);
  const second=perf.lines[1].stage.find(actor=>actor.characterId===arthur.id);
  const third=perf.lines[2].stage.find(actor=>actor.characterId===arthur.id);
  assert.equal(first.placementSource,'manual');
  assert.deepEqual(first.transform,{x:.33,y:.81,scale:1.12});
  assert.equal(second.placementSource,'inherited');
  assert.deepEqual(second.transform,{x:.33,y:.81,scale:1.12});
  assert.equal(third.placementSource,'auto');
  assert.equal(third.transform,undefined);
});

test('compiler inherits scene state and roster events', () => {
  const project = TextImporter.parse(`Arthur: one\nMatthew: two\nArthur: three`);
  const arthur = project.characters.find(c => c.name === 'Arthur');
  const matthew = project.characters.find(c => c.name === 'Matthew');
  project.settings.speechLanguage = 'fr-FR';
  project.lines[0].scene = { background: 'room.png', enterIds: [arthur.id], camera: 'none', transition: 'fade' };
  project.lines[1].scene = { enterIds: [matthew.id], camera: 'none', transition: 'cut' };
  project.lines[2].scene = { exitIds: [matthew.id], camera: 'focus-speaker', transition: 'cut' };
  const perf = compilePerformance(project);
  assert.equal(perf.lines[1].state.background, 'room.png');
  assert.deepEqual(perf.lines[1].state.roster, [arthur.id, matthew.id]);
  assert.deepEqual(perf.lines[2].state.roster, [arthur.id]);
});


test('0.48 compiler derives a unified WorldSpace/ScreenSpace scene graph without replacing legacy authoring state', () => {
  const project = TextImporter.parse(`Arthur: hello`);
  const arthur = project.characters.find(c => c.name === 'Arthur');
  project.assets.push({id:'bg-room',kind:'background',name:'room.png',mime:'image/png'});
  project.lines[0].scene = { ...project.lines[0].scene, background:'bg-room' };
  project.lines[0].stageTransforms = { [arthur.id]: { x:.3, y:.88, scale:1.1, depth:.42 } };
  const perf = compilePerformance(project);
  assert.equal(perf.sceneGraph.projection, 'flat');
  const graph = perf.lines[0].sceneGraph;
  assert.equal(graph.projection, 'flat');
  assert.equal(graph.nodes.find(n => n.id === 'background')?.space, 'world');
  const actor = graph.nodes.find(n => n.id === `character:${arthur.id}`);
  assert.equal(actor?.layerId, 'world.characters');
  assert.equal(actor?.depth, .42);
  assert.equal(actor?.transform?.depth, .42);
  assert.equal(graph.nodes.find(n => n.id === 'ui:dialogue')?.space, 'screen');
  assert.deepEqual(project.lines[0].stageTransforms[arthur.id], { x:.3, y:.88, scale:1.1, depth:.42 }, 'scene graph remains derived from authoring state');
});

test('0.48 scene graph normalizer keeps flat compatibility and safely preserves future layer effects', () => {
  const project = createProject('graph');
  project.sceneGraph = {
    projection: '2.5d',
    layerEffects: { 'world.characters': { filters:[{kind:'tint',color:'#8899ff'}], mask:null } },
    nodeOverrides: { 'cg': { space:'screen', zBias:7, filters:[{kind:'grayscale',amount:.5}], mask:null } }
  };
  const normalized = normalizeReplayProject(project);
  assert.equal(normalized.sceneGraph.projection, '2.5d');
  assert.equal(normalized.sceneGraph.layerEffects['world.characters'].filters[0].kind, 'tint');
  assert.equal(normalized.sceneGraph.nodeOverrides.cg.space, 'screen');
  assert.equal(normalized.sceneGraph.nodeOverrides.cg.zBias, 7);
});

test('templates and Tyrano exporter', () => {
  const project = TextImporter.parse(`Arthur: hello`);
  applyTemplate(project, BUILTIN_TEMPLATES[1]);
  assert.equal(project.settings.templateId, 'yukkuri');
  const tyrano = exportTyranoScript(project);
  assert.match(tyrano, /Arthur/);
  assert.match(tyrano, /hello/);
});

import { createDefaultImporterRegistry, importVirtualFolder, migrateV07Project } from '../dist/index.js';

test('folder importer makes chapters and indexes assets', async () => {
  const files = [
    { name:'01.txt', relativePath:'Campaign/Session 01/01.txt', type:'text/plain', async text(){ return 'Arthur: hello'; } },
    { name:'02.rgl', relativePath:'Campaign/Session 02/02.rgl', type:'text/plain', async text(){ return '[Matthew]hi'; } },
    { name:'idle.png', relativePath:'Campaign/characters/Arthur/idle.png', type:'image/png', async text(){ return ''; } }
  ];
  const result = await importVirtualFolder(files, createDefaultImporterRegistry());
  assert.equal(result.project.lines.length, 2);
  assert.match(result.project.lines[0].chapterTitle, /Session 01/);
  assert.equal(result.project.assets[0].kind, 'character');
});

test('legacy v0.7 migration converts embedded data assets', () => {
  const migrated = migrateV07Project({
    version:'0.7',
    settings:{ maxOnStage:2 },
    characters:[{ id:'a', name:'Arthur', images:{ idle:'data:image/png;base64,AA==' }, expressions:{} }],
    lines:[{ id:'l', speakerId:'a', type:'dialogue', text:'hello', scene:{ bgAction:'set', bgData:'data:image/png;base64,BB==', bgName:'room.png', enterIds:['a'], exitIds:[] } }]
  });
  assert.equal(migrated.characters.length, 1);
  assert.ok(migrated.assets.length >= 2);
  assert.ok(migrated.lines[0].scene.background);
});

import {
  TranslationRegistry,
  TtsRegistry,
  prepareLineSpeech,
  resolveSpeechPolicy,
  compilePerformance as compilePerformanceWithSpeech
} from '../dist/index.js';

test('0.35 speech pauses add light punctuation gaps and explicit slash pauses without changing display text', () => {
  const segments = planSpeechPauses('Hello. Wait/what?!', 1);
  assert.deepEqual(segments.map(item => item.kind), ['sentence','manual','sentence']);
  assert.equal(Number(speechPauseExtraSeconds('Hello. Wait/what?!', 1).toFixed(2)), 0.60);
  assert.equal(speechTextForGenericTts('Wait/what\\/ever.'), 'Wait … what/ever.');
});

test('0.44.3 punctuation timing supports uniform/custom exact gaps and collapses punctuation clusters', () => {
  const uniform={mode:'uniform',uniformSeconds:0.25};
  const uniformSegments=planSpeechPauses('等等？！真的……好，走。', 2, uniform);
  assert.deepEqual(uniformSegments.filter(x=>x.pauseAfter>0).map(x=>Number(x.pauseAfter.toFixed(2))), [0.25,0.25,0.25,0.25]);
  const custom={mode:'custom',comma:0.1,period:0.3,question:0.4,exclamation:0.5,ellipsis:0.6,semicolon:0.2,colon:0.15};
  const customSegments=planSpeechPauses('啊？！等等！！！……好，行；对：完。', 1, custom);
  assert.deepEqual(customSegments.filter(x=>x.pauseAfter>0).map(x=>Number(x.pauseAfter.toFixed(2))), [0.4,0.5,0.6,0.1,0.2,0.15,0.3]);
  assert.equal(Number(speechPauseExtraSeconds('1.5。真的？！', 3, custom).toFixed(2)), 0.7,'decimal point must not become punctuation and custom seconds are exact');
});

test('0.35 pause strength inherits project → character → line', () => {
  const project = TextImporter.parse('Arthur: Hello.');
  project.settings.speechPauseScale = 0.8;
  const line = project.lines[0], character = project.characters[0];
  assert.equal(resolveSpeechPauseScale(project, line), 0.8);
  character.speech.pauseScale = 1.4;
  assert.equal(resolveSpeechPauseScale(project, line), 1.4);
  line.speech.pauseScale = 2.1;
  assert.equal(resolveSpeechPauseScale(project, line), 2.1);
});

test('speech language precedence is line > character > project speech language > log language', () => {
  const project = TextImporter.parse(`Arthur: 你好\nMatthew: 你好`);
  project.settings.logLanguage = 'zh-CN';
  const arthur = project.characters.find(c => c.name === 'Arthur');
  const matthew = project.characters.find(c => c.name === 'Matthew');
  project.settings.speechLanguage = 'fr-FR';
  arthur.speech = { defaultLanguage: 'en-GB', voices: {} };
  matthew.speech = { defaultLanguage: null, voices: {} };

  assert.equal(resolveSpeechPolicy(project, project.lines[0]).targetLanguage, 'en-GB');
  assert.equal(resolveSpeechPolicy(project, project.lines[1]).targetLanguage, 'fr-FR');
  project.lines[0].speech.languageOverride = 'ja-JP';
  assert.equal(resolveSpeechPolicy(project, project.lines[0]).targetLanguage, 'ja-JP');
});

test('translation changes spoken text but never display Log text, and caches by source text', async () => {
  const project = TextImporter.parse(`Arthur: 你好，世界`);
  project.settings.logLanguage = 'zh-CN';
  project.settings.translationProvider = 'mock-translator';
  project.settings.ttsProvider = 'mock-tts';
  const arthur = project.characters[0];
  arthur.speech = {
    defaultLanguage: 'en-GB',
    voices: { 'en-GB': { voiceId: 'arthur-en', rate: 1.05 } }
  };

  let translations = 0;
  const translationRegistry = new TranslationRegistry().register({
    id: 'mock-translator', label: 'Mock translator',
    async translate(req) { translations += 1; return { text: `EN(${req.text})`, detectedSourceLanguage: 'zh-CN' }; }
  });
  let ttsRequest = null;
  const ttsRegistry = new TtsRegistry().register({
    id: 'mock-tts', label: 'Mock TTS',
    async synthesize(req) { ttsRequest = req; return { audio: new Uint8Array([1]), mime: 'audio/mock' }; }
  });

  const line = project.lines[0];
  const before = compilePerformanceWithSpeech(project).lines[0];
  assert.equal(before.text, '你好，世界');
  assert.equal(before.translationPending, true);

  const prepared = await prepareLineSpeech(project, line, { translations: translationRegistry, tts: ttsRegistry, synthesize: true });
  assert.equal(line.text, '你好，世界');
  assert.equal(prepared.displayText, '你好，世界');
  assert.equal(prepared.speechText, 'EN(你好，世界)');
  assert.equal(prepared.targetLanguage, 'en-GB');
  assert.equal(ttsRequest.text, 'EN(你好，世界)');
  assert.equal(ttsRequest.language, 'en-GB');
  assert.equal(ttsRequest.voiceId, 'arthur-en');

  await prepareLineSpeech(project, line, { translations: translationRegistry });
  assert.equal(translations, 1, 'valid translation cache should avoid a second request');

  const after = compilePerformanceWithSpeech(project).lines[0];
  assert.equal(after.text, '你好，世界');
  assert.equal(after.speechText, 'EN(你好，世界)');
  assert.equal(after.translationPending, false);

  line.text = '你好，Arthur';
  await prepareLineSpeech(project, line, { translations: translationRegistry });
  assert.equal(translations, 2, 'editing Log text should invalidate translation cache');
});


test('TTS phoneme timing stays on the candidate until adoption', async () => {
  const project=TextImporter.parse('Arthur: bad thought');
  project.settings.logLanguage='en-GB';
  project.settings.ttsProvider='phoneme-tts';
  const tts=new TtsRegistry().register({id:'phoneme-tts',label:'phoneme',async synthesize(){return {audio:new Uint8Array([1]),mime:'audio/mock',phonemes:[{start:0,end:.08,phoneme:'B'},{start:.08,end:.2,phoneme:'AE1'},{start:.2,end:.3,phoneme:'DH'}]}}});
  const prepared=await prepareLineSpeech(project,project.lines[0],{tts,synthesize:true});
  assert.equal(project.lines[0].mouth,'auto');
  assert.deepEqual(prepared.mouthCues.map(c=>c.viseme),['M','AE','TH']);
});

test('character without language slot speaks Log language without translation', async () => {
  const project = TextImporter.parse(`Matthew: bonjour`);
  project.settings.logLanguage = 'fr-FR';
  project.characters[0].speech = { defaultLanguage: null, voices: {} };
  const prepared = await prepareLineSpeech(project, project.lines[0]);
  assert.equal(prepared.targetLanguage, 'fr-FR');
  assert.equal(prepared.speechText, 'bonjour');
  assert.equal(prepared.translated, false);
});

test('auto Log language detection becomes a reusable translation cache source language', async () => {
  const project = TextImporter.parse(`Arthur: 你好`);
  project.settings.logLanguage = 'auto';
  project.settings.translationProvider = 'detecting';
  project.characters[0].speech.defaultLanguage = 'en-GB';
  let calls = 0;
  const translations = new TranslationRegistry().register({
    id: 'detecting', label: 'Detecting mock',
    async translate() { calls += 1; return { text: 'hello', detectedSourceLanguage: 'zh-CN' }; }
  });
  await prepareLineSpeech(project, project.lines[0], { translations });
  await prepareLineSpeech(project, project.lines[0], { translations });
  assert.equal(calls, 1);
  assert.equal(project.lines[0].speech.sourceLanguage, null);
  assert.equal(project.lines[0].speech.translationCache.detectedSourceLanguage, 'zh-CN');
});

import { prepareProjectSpeech } from '../dist/index.js';

test('one-click project speech preparation applies each character language policy', async () => {
  const project = TextImporter.parse(`Arthur: 你好\nFrancis: 你好\nMatthew: 你好`);
  project.settings.logLanguage = 'zh-CN';
  project.settings.translationProvider = 'batch';
  project.characters.find(c=>c.name==='Arthur').speech.defaultLanguage='en-GB';
  project.characters.find(c=>c.name==='Francis').speech.defaultLanguage='fr-FR';
  project.characters.find(c=>c.name==='Matthew').speech.defaultLanguage=null;
  const translations = new TranslationRegistry().register({
    id:'batch', label:'Batch mock',
    async translate(req){ return { text:`${req.targetLanguage}:${req.text}` }; }
  });
  const result = await prepareProjectSpeech(project,{translations,concurrency:2});
  assert.equal(result[0].speechText,'en-GB:你好');
  assert.equal(result[1].speechText,'fr-FR:你好');
  assert.equal(result[2].speechText,'你好');
});

import {
  searchAccents,
  getAccentProfile,
  resolveCharacterAccent,
  accentSynthesisHint,
  accentTranslationStyleKey,
  matchVoiceAccent
} from '../dist/index.js';

test('accent catalog searches by English and Chinese region aliases', () => {
  assert.equal(searchAccents('en-GB','London')[0].profile.id, 'en-gb-southern-british');
  assert.equal(searchAccents('en-GB','伦敦')[0].profile.id, 'en-gb-southern-british');
  assert.equal(searchAccents('en-US','Texas')[0].profile.id, 'en-us-texas');
  assert.equal(searchAccents('en-IN','India')[0].profile.id, 'en-in-general');
});

test('character accent resolves per language and builds synthesis hints', () => {
  const project = TextImporter.parse(`Arthur: hello`);
  project.settings.logLanguage = 'en-GB';
  const arthur = project.characters[0];
  arthur.speech.defaultLanguage = 'en-GB';
  arthur.speech.accents = {
    'en-GB': { accentId:'en-gb-cockney', query:'Cockney', strength:'light', useRegionalVocabulary:false }
  };
  const resolved = resolveCharacterAccent(arthur, 'en-GB', project.lines[0]);
  assert.equal(resolved.profile.id, 'en-gb-cockney');
  assert.equal(resolved.strength, 'light');
  const hint = accentSynthesisHint(resolved);
  assert.equal(hint.localeFallback, 'en-GB');
  assert.ok(hint.pronunciationHints.length >= 1);
});

test('accent voice matching distinguishes exact, tag, and locale fallback support', () => {
  const project = TextImporter.parse(`Alfred: hello`);
  const alfred = project.characters[0];
  alfred.speech.defaultLanguage='en-US';
  alfred.speech.accents={'en-US':{accentId:'en-us-texas',strength:'natural'}};
  const resolved=resolveCharacterAccent(alfred,'en-US',project.lines[0]);
  assert.equal(matchVoiceAccent(resolved,{voiceId:'exact',languages:['en-US'],accentIds:['en-us-texas']}).support,'native');
  assert.equal(matchVoiceAccent(resolved,{voiceId:'tag',languages:['en-US'],accentTags:['Texas']}).support,'approximate');
  assert.equal(matchVoiceAccent(resolved,{voiceId:'locale',languages:['en-US'],locales:['en-US']}).support,'locale-fallback');
});

test('regional-vocabulary accent intent participates in translation cache invalidation', async () => {
  const project = TextImporter.parse(`Arthur: 我住公寓`);
  project.settings.logLanguage='zh-CN';
  project.settings.translationProvider='accent-mock';
  const arthur=project.characters[0];
  arthur.speech.defaultLanguage='en-GB';
  arthur.speech.accents={'en-GB':{accentId:'en-gb-southern-british',strength:'natural',useRegionalVocabulary:false}};
  let calls=0;
  const translations=new TranslationRegistry().register({
    id:'accent-mock',label:'Accent mock',
    async translate(req){calls+=1;return{text:req.accent?.useRegionalVocabulary?'I live in a flat.':'I live in an apartment.'}}
  });
  await prepareLineSpeech(project,project.lines[0],{translations});
  await prepareLineSpeech(project,project.lines[0],{translations});
  assert.equal(calls,1);
  assert.equal(project.lines[0].speech.translationCache.text,'I live in an apartment.');
  arthur.speech.accents['en-GB'].useRegionalVocabulary=true;
  await prepareLineSpeech(project,project.lines[0],{translations});
  assert.equal(calls,2);
  assert.equal(project.lines[0].speech.translationCache.text,'I live in a flat.');
  assert.notEqual(accentTranslationStyleKey(resolveCharacterAccent(arthur,'en-GB')), '');
});

import {
  REPLAYLAB_FREE_TTS_ID,
  ReplayLabFreeTtsProvider,
  VoiceboxLocalTtsProvider,
  VOICEBOX_LOCAL_TTS_ID,
  createDefaultTtsRegistry
} from '../dist/index.js';


test('0.53.2 old projects inherit Log language into the new project speech language', () => {
  const project = TextImporter.parse('王耀: 你好');
  project.settings.logLanguage = 'zh-CN';
  delete project.settings.speechLanguage;
  const normalized = normalizeReplayProject(project);
  assert.equal(normalized.settings.speechLanguage, 'auto');
  assert.equal(resolveSpeechPolicy(normalized, normalized.lines[0]).targetLanguage, 'zh-CN');
});

test('0.53.2 Voicebox Local ranks sample-language matches but still exposes cross-language profiles and sends explicit base language', async () => {
  const calls=[]; let historyPolls=0;
  const fetchImpl=async (url, init={})=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith('/profiles')) return new Response(JSON.stringify([
      {id:'en-profile',name:'English sample',language:'en'},
      {id:'zh-profile',name:'中文样本',language:'zh'}
    ]),{status:200,headers:{'content-type':'application/json'}});
    if(String(url).endsWith('/generate')) return new Response(JSON.stringify({id:'gen-1',status:'generating'}),{status:200,headers:{'content-type':'application/json'}});
    if(String(url).endsWith('/history/gen-1')) { historyPolls++; return new Response(JSON.stringify({id:'gen-1',status:'completed',duration:1.25}),{status:200,headers:{'content-type':'application/json'}}); }
    if(String(url).endsWith('/audio/gen-1')) return new Response(new Uint8Array([1,2,3]),{status:200,headers:{'content-type':'audio/wav'}});
    if(String(url).endsWith('/health')) return new Response('{}',{status:200,headers:{'content-type':'application/json'}});
    throw new Error('unexpected '+url);
  };
  const provider=new VoiceboxLocalTtsProvider({fetchImpl,pollIntervalMs:0,timeoutMs:1000});
  assert.equal(provider.id,VOICEBOX_LOCAL_TTS_ID);
  const voices=await provider.listVoices('zh-CN');
  assert.deepEqual(voices.map(v=>v.id),['zh-profile','en-profile']);
  const out=await provider.synthesize({text:'你好',language:'zh-CN',voiceId:'zh-profile'});
  const body=JSON.parse(calls.find(c=>c.url.endsWith('/generate')).init.body);
  assert.equal(body.language,'zh');
  assert.equal(body.profile_id,'zh-profile');
  assert.equal(out.duration,1.25); assert.equal(out.mime,'audio/wav'); assert.equal(historyPolls,1);
});

test('experimental clone + instruct verifies the bridge and never posts experimental fields to stock Voicebox', async () => {
  const calls=[];
  const fetchImpl=async (url, init={})=>{
    calls.push({url:String(url),init});
    if(String(url).endsWith('/health')) return new Response(JSON.stringify({service:'replaylab-mlx-clone-bridge',protocol:1,ready:true,voicebox_url:'http://127.0.0.1:17493',capabilities:{clone_instruct:true,model_sizes:['1.7B']}}));
    if(String(url).endsWith('/synthesize')) return new Response(mockWav(),{status:200,headers:{'content-type':'audio/wav','X-ReplayLab-Profile':'arthur-clone','X-ReplayLab-Injected':'1','X-ReplayLab-Duration':String(2/24000)}});
    throw new Error('unexpected '+url);
  };
  const provider=new VoiceboxLocalTtsProvider({fetchImpl});
  await provider.synthesize({text:'Stay back.',language:'en-GB',voiceId:'arthur-clone',instruct:'restrained anger',seed:42,modelSize:'1.7B',experimentalCloneInstruct:true});
  const body=JSON.parse(calls.find(c=>c.url.endsWith('/synthesize')).init.body);
  assert.equal(body.profile_id,'arthur-clone');
  assert.equal(body.instruct,'restrained anger');
  assert.ok(calls.every(c=>!c.url.endsWith('/generate')));
  assert.equal(body.seed,42);
  assert.equal(body.model_size,'1.7B');
});

test('new projects default to Replay Lab Free TTS', () => {
  const project = TextImporter.parse(`Arthur: hello`);
  assert.equal(project.settings.ttsProvider, REPLAYLAB_FREE_TTS_ID);
  assert.equal(resolveSpeechPolicy(project, project.lines[0]).ttsProvider, REPLAYLAB_FREE_TTS_ID);
});

test('Replay Lab Free Kokoro provider selects a voice matching the requested language', async () => {
  let generated = null;
  const loader = async (options) => ({
    voices: {
      af_heart: { name:'Heart', language:'en-US', gender:'Female', overallGrade:'A' },
      bf_lily: { name:'Lily', language:'en-GB', gender:'Female', overallGrade:'A-' },
      bm_george: { name:'George', language:'en-GB', gender:'Male', overallGrade:'B' }
    },
    async generate(text, options) {
      generated = { text, ...options };
      const data = new Float32Array(2400);
      return { data, sampling_rate:24000, toBlob(){ return new Blob([new Uint8Array([1,2,3])],{type:'audio/wav'}); } };
    }
  });
  const provider = new ReplayLabFreeTtsProvider({ loader, device:'wasm' });
  const voices = await provider.listVoices('en-GB');
  assert.deepEqual(voices.map(v=>v.id), ['bf_lily','bm_george']);
  const result = await provider.synthesize({ text:'Hello', language:'en-GB' });
  assert.equal(generated.voice, 'bf_lily');
  assert.equal(result.mime, 'audio/wav');
  assert.equal(result.duration, 0.1);
  assert.equal(provider.capabilities.costModel, 'free-local');
});

test('voice binding provider overrides built-in default, but imported audio overrides all TTS', async () => {
  const project = TextImporter.parse(`Arthur: 你好`);
  project.settings.logLanguage='zh-CN';
  const arthur=project.characters[0];
  arthur.speech.defaultLanguage='zh-CN';
  arthur.speech.voices={'zh-CN':{provider:'external-paid',voiceId:'arthur-premium'}};

  let externalCalls=0;
  const tts = createDefaultTtsRegistry({
    replayLabFree:{loader:async()=>({voices:{zf_test:{language:'zh-CN'}},async generate(){throw new Error('built-in should not be used')}})}
  }).register({
    id:'external-paid',label:'External paid',
    async synthesize(req){externalCalls+=1;assert.equal(req.voiceId,'arthur-premium');return{audio:new Uint8Array([9]),mime:'audio/mock'};}
  });

  const external = await prepareLineSpeech(project,project.lines[0],{tts,synthesize:true});
  assert.equal(external.audioSource,'external-tts');
  assert.equal(externalCalls,1);

  project.lines[0].audioAssetId='voice-import-001';
  const imported = await prepareLineSpeech(project,project.lines[0],{tts,synthesize:true});
  assert.equal(imported.audioSource,'imported');
  assert.equal(imported.audioAssetId,'voice-import-001');
  assert.equal(externalCalls,1,'imported audio must bypass TTS entirely');
});


test('Replay Lab Free advertises current browser language coverage and forwards a custom module specifier', async () => {
  let seenOptions = null;
  const provider = new ReplayLabFreeTtsProvider({
    moduleSpecifier:'https://example.invalid/kokoro.js',
    device:'wasm',
    loader:async options => {
      seenOptions = options;
      return {
        voices:{bf_lily:{name:'Lily',language:'en-gb'}},
        async generate(){
          const data=new Float32Array(240);
          return {data,sampling_rate:24000,toBlob(){return new Blob([new Uint8Array([1])],{type:'audio/wav'})}};
        }
      };
    }
  });
  assert.deepEqual(provider.capabilities.supportedLanguages,['en-US','en-GB']);
  await provider.listVoices('en-GB');
  assert.equal(seenOptions.moduleSpecifier,'https://example.invalid/kokoro.js');
  await assert.rejects(()=>provider.synthesize({text:'你好',language:'zh-CN'}),/currently supports en-US\/en-GB/);
});

import {
  MemoryProjectWorkspace,
  persistGeneratedSpeech,
  generatedVoicePath,
  PROJECT_MANIFEST_PATH,
  isWorkspaceConflictError
} from '../dist/index.js';

test('project workspace persists generated speech as a real voice asset and manifest', async () => {
  const project = TextImporter.parse(`Arthur: hello`);
  const line = project.lines[0];
  const character = project.characters[0];
  const workspace = new MemoryProjectWorkspace('test');
  const prepared = {
    displayText:'hello', speechText:'hello', sourceLanguage:'en-GB', targetLanguage:'en-GB', translated:false,
    ttsProvider:'replaylab-free', audioSource:'builtin-tts',
    ttsResult:{ audio:new Uint8Array([1,2,3,4]), mime:'audio/wav', duration:.2 }
  };
  const result = await persistGeneratedSpeech(workspace, project, line, prepared);
  assert.ok(result);
  assert.ok(result.path.startsWith(generatedVoicePath(character, line, 'audio/wav').replace('.wav','__')));
  assert.ok(await workspace.exists(result.path));
  assert.ok(await workspace.exists(PROJECT_MANIFEST_PATH));
  assert.equal(line.audioAssetId, result.assetId);
  const asset = project.assets.find(a=>a.id===result.assetId);
  assert.equal(asset.kind,'voice');
  assert.equal(asset.metadata.generatedLineId,line.id);
  const loaded = await workspace.loadProject();
  assert.equal(loaded.lines[0].audioAssetId,result.assetId);
});

test('0.37 workspace saves stop rather than overwrite a manifest changed by another context', async () => {
  const project=TextImporter.parse('Arthur: hello');
  const workspace=new MemoryProjectWorkspace('conflict');
  await workspace.saveProject(project);
  const external={...structuredClone(project),title:'changed elsewhere'};
  await workspace.write(PROJECT_MANIFEST_PATH,JSON.stringify(external,null,2),'application/json');
  project.title='stale local edit';
  await assert.rejects(()=>workspace.saveProject(project),error=>isWorkspaceConflictError(error));
  const reloaded=await workspace.loadProject();
  assert.equal(reloaded.title,'changed elsewhere');
  reloaded.title='after reload';
  await workspace.saveProject(reloaded);
  assert.equal((await workspace.loadProject()).title,'after reload');
});

test('0.37 generated speech checks manifest freshness before writing its audio asset', async () => {
  const project=TextImporter.parse('Arthur: hello');
  const line=project.lines[0];
  const workspace=new MemoryProjectWorkspace('voice-conflict');
  await workspace.saveProject(project);
  await workspace.write(PROJECT_MANIFEST_PATH,JSON.stringify({...structuredClone(project),title:'voice changed elsewhere'},null,2),'application/json');
  const prepared={displayText:'hello',speechText:'hello',sourceLanguage:'en-GB',targetLanguage:'en-GB',translated:false,ttsProvider:'replaylab-free',audioSource:'builtin-tts',ttsResult:{audio:new Uint8Array([1,2]),mime:'audio/wav'}};
  await assert.rejects(()=>persistGeneratedSpeech(workspace,project,line,prepared),error=>isWorkspaceConflictError(error));
  assert.equal(project.assets.length,0);
  assert.equal(line.audioAssetId,null);
  assert.equal((await workspace.list('assets/voice/generated/')).length,0);
});

test('workspace regeneration overwrites the same generated line asset instead of duplicating it', async () => {
  const project = TextImporter.parse(`Arthur: hello`);
  const workspace = new MemoryProjectWorkspace('test');
  const line = project.lines[0];
  const base = {displayText:'hello',speechText:'hello',sourceLanguage:'en-GB',targetLanguage:'en-GB',translated:false,ttsProvider:'replaylab-free',audioSource:'builtin-tts'};
  await persistGeneratedSpeech(workspace,project,line,{...base,ttsResult:{audio:new Uint8Array([1]),mime:'audio/wav'}});
  const firstId=line.audioAssetId;
  // Regeneration intentionally clears the bound generated audio before synthesis in the UI.
  line.audioAssetId=null;
  await persistGeneratedSpeech(workspace,project,line,{...base,ttsResult:{audio:new Uint8Array([2,3]),mime:'audio/wav'}});
  assert.equal(line.audioAssetId,firstId);
  assert.equal(project.assets.filter(a=>a.metadata?.generatedLineId===line.id).length,1);
  assert.equal((await workspace.read(project.assets.find(a=>a.id===firstId).sourcePath)).size,2);
});

test('generated workspace audio can be explicitly regenerated, while user-imported audio still blocks TTS', async () => {
  const project = TextImporter.parse(`Arthur: hello`);
  project.settings.logLanguage='en-GB';
  const line=project.lines[0];
  let calls=0;
  const tts=new TtsRegistry().register({id:'regen',label:'regen',async synthesize(){calls++;return{audio:new Uint8Array([calls]),mime:'audio/wav'}}});
  project.settings.ttsProvider='regen';
  project.assets.push({id:'generated',kind:'voice',name:'generated',metadata:{generated:true,generatedLineId:line.id}});
  line.audioAssetId='generated';
  const regenerated=await prepareLineSpeech(project,line,{tts,synthesize:true,regenerateGeneratedAudio:true});
  assert.equal(calls,1);
  assert.ok(regenerated.ttsResult);

  project.assets.push({id:'manual',kind:'voice',name:'manual',metadata:{generated:false}});
  line.audioAssetId='manual';
  const manual=await prepareLineSpeech(project,line,{tts,synthesize:true,regenerateGeneratedAudio:true});
  assert.equal(calls,1,'manual audio must still bypass TTS');
  assert.equal(manual.audioSource,'imported');
});

import {
  selectCharacterFrame,
  selectCharacterLayers,
  blinkAt,
  visemeAt,
  locatePerformanceLine,
  parseDiceText,
  buildAudioSchedule
} from '../dist/index.js';

test('canvas renderer frame selection prefers precise visemes, then open, then idle', () => {
  const character={
    id:'c',name:'Arthur',color:'#fff',kind:'normal',showOnStage:true,defaultPosition:'auto',
    images:{idle:'idle',open:'open',blink:'blink',A:'a'},expressions:{angry:{idle:'angry-idle',open:'angry-open'}},speech:{defaultLanguage:null,voices:{}}
  };
  assert.equal(selectCharacterFrame(character,'default','A',false).ref,'a');
  assert.equal(selectCharacterFrame(character,'default','I',false).ref,'open');
  assert.equal(selectCharacterFrame(character,'angry','OPEN',false).ref,'angry-open');
  assert.equal(selectCharacterFrame(character,'angry','CLOSED',true).ref,'blink');
});

test('layered character art inherits default parts and supports expression-only overrides', () => {
  const character={
    id:'c',name:'Arthur',color:'#fff',kind:'normal',showOnStage:true,defaultPosition:'auto',
    images:{},expressions:{},
    layers:{base:'body',eyesOpen:'eyes',eyesClosed:'blink',mouthClosed:'mouth0',mouthOpen:'mouth1',mouthA:'mouthA'},
    layerExpressions:{angry:{eyesOpen:'angry-eyes',overlay:'vein'}},speech:{defaultLanguage:null,voices:{}}
  };
  assert.deepEqual(selectCharacterLayers(character,'default','A',false),{base:'body',overlay:null,eyes:'eyes',eyelids:null,pupils:null,brows:null,mouth:'mouthA',blinking:false,viseme:'A'});
  assert.deepEqual(selectCharacterLayers(character,'angry','OPEN',false),{base:'body',overlay:'vein',eyes:'angry-eyes',eyelids:null,pupils:null,brows:null,mouth:'mouth1',blinking:false,viseme:'OPEN'});
  assert.equal(selectCharacterLayers(character,'angry','CLOSED',true).eyes,'blink');
});


test('English-specific layered mouths prefer exact art then old-site nearest-base fallback', () => {
  const character={id:'c',name:'Arthur',color:'#fff',kind:'normal',showOnStage:true,defaultPosition:'auto',images:{},expressions:{},layers:{base:'body',eyesOpen:'eyes',mouthClosed:'closed',mouthA:'a',mouthU:'u',mouthO:'o',mouthF:'f'},layerExpressions:{},puppet:{},speech:{defaultLanguage:'en-GB',voices:{}}};
  assert.equal(selectCharacterLayers(character,'default','F',false).mouth,'f');
  assert.equal(selectCharacterLayers(character,'default','AE',false).mouth,'a');
  assert.equal(selectCharacterLayers(character,'default','UU',false).mouth,'u');
  assert.equal(selectCharacterLayers(character,'default','OO',false).mouth,'o');
  assert.equal(selectCharacterLayers(character,'default','W',false).mouth,'u');
  assert.equal(selectCharacterLayers(character,'default','TH',false).mouth,'closed');
  assert.equal(selectCharacterLayers(character,'default','M',false).mouth,'closed');
});

test('placeholder characters blink even before any art is assigned', () => {
  const character={id:'c',name:'No Art',color:'#fff',kind:'normal',showOnStage:true,defaultPosition:'auto',images:{},expressions:{},layers:{},layerExpressions:{}};
  const samples=Array.from({length:80},(_,i)=>blinkAt(character,i/10,false));
  assert.ok(samples.some(Boolean),'placeholder should contain at least one blink in a short time window');
});

test('renderer timing helpers use mouth lead and preserve the previous frame during inter-line pause', () => {
  assert.equal(visemeAt([{start:.1,end:.2,viseme:'A'}],.05,50),'A');
  const project=TextImporter.parse('Arthur: one\nMatthew: two');
  project.lines[0].duration=1;project.lines[1].duration=1;
  const perf=compilePerformance(project);
  const paused=locatePerformanceLine(perf,1.09);
  assert.equal(paused.index,0);
  assert.equal(paused.localTime,1);
});

test('dice renderer parser and BGM audio schedule reflect compiled Replay state', () => {
  assert.deepEqual(parseDiceText('1d100 = 32 / 65，成功'),{expression:'1d100',result:'32',target:'65',outcome:'success'});
  const project=TextImporter.parse('Arthur: one\nArthur: two\nArthur: three');
  project.lines[0].duration=.5;project.lines[1].duration=.5;project.lines[2].duration=.5;
  project.lines[0].scene={bgm:'bgm-a',camera:'none',transition:'cut'};
  project.lines[2].scene={bgm:null,camera:'none',transition:'cut'};
  project.lines[1].audioAssetId='voice-2';project.lines[1].sfxAssetId='sfx-2';
  const perf=compilePerformance(project);
  const schedule=buildAudioSchedule(perf);
  const bgm=schedule.find(e=>e.kind==='bgm');
  assert.equal(bgm.assetId,'bgm-a');
  assert.equal(bgm.start,0);
  assert.ok(bgm.end > perf.lines[2].start,'BGM stop uses a real fade tail instead of a hard cut');
  assert.ok(bgm.fadeOut > 0);
  assert.ok(schedule.some(e=>e.kind==='voice'&&e.assetId==='voice-2'));
  assert.ok(schedule.some(e=>e.kind==='sfx'&&e.assetId==='sfx-2'));
});

test('0.53 Audio Director preserves legacy mix levels and schedules ambient/crossfade/pan', () => {
  const legacy=createProject('legacy audio');
  delete legacy.settings.audioMix;
  legacy.settings.bgmVolume=.17;legacy.settings.sfxVolume=.63;
  const migrated=normalizeReplayProject(legacy);
  assert.equal(migrated.settings.audioMix.bgmVolume,.17);
  assert.equal(migrated.settings.audioMix.sfxVolume,.63);

  const project=TextImporter.parse('Arthur: one\nArthur: two\nArthur: three');
  project.assets.push(
    {id:'a',kind:'bgm',name:'a.ogg'},
    {id:'b',kind:'bgm',name:'b.ogg'},
    {id:'rain',kind:'ambient',name:'rain.ogg'},
    {id:'voice',kind:'voice',name:'voice.wav',metadata:{duration:.4}},
    {id:'door',kind:'sfx',name:'door.wav'}
  );
  project.lines[0].scene={bgm:'a',ambient:'rain',camera:'none',transition:'cut'};
  project.lines[1].scene={bgm:'b',camera:'none',transition:'cut'};
  project.lines[1].audioAssetId='voice';project.lines[1].sfxAssetId='door';project.lines[1].audioMix={voicePan:-.4,sfxPan:.65,voiceGain:.8,sfxGain:.5};
  const perf=compilePerformance(project), schedule=buildAudioSchedule(perf);
  const bgms=schedule.filter(e=>e.kind==='bgm');
  assert.equal(bgms.length,2);
  assert.ok(bgms[0].end > bgms[1].start,'BGM changes overlap during crossfade');
  assert.ok(schedule.some(e=>e.kind==='ambient'&&e.assetId==='rain'&&e.loop));
  assert.equal(schedule.find(e=>e.kind==='voice')?.pan,-.4);
  assert.equal(schedule.find(e=>e.kind==='sfx')?.pan,.65);
});

test('compiler prefers persisted generated voice duration when line duration is automatic', () => {
  const project=TextImporter.parse('Arthur: this text estimate should be ignored');
  project.assets.push({id:'voice',kind:'voice',name:'voice.wav',metadata:{duration:3.25}});
  project.lines[0].audioAssetId='voice';
  assert.equal(compilePerformance(project).lines[0].duration,3.25);
});

import {
  ProjectHistory,
  buildScriptOutline,
  searchReplayLines,
  applyBatchEdit,
  copyPerformanceSettings,
  pastePerformanceSettings,
  applyPerformancePatch,
  BUILTIN_PERFORMANCE_PRESETS,
  diagnoseProject,
  collectReferencedAssetRefs,
  defaultFaceFit,
  projectFaceFeature,
  unprojectFaceFeatureX
} from '../dist/index.js';

test('editor history coalesces typing and supports branching undo/redo', () => {
  const project = TextImporter.parse('Arthur: one');
  const history = new ProjectHistory({ coalesceMs: 1000 });
  history.reset(project);
  project.lines[0].text = 'onex';
  history.capture(project, '编辑文字', 'text:line', 1000);
  project.lines[0].text = 'onexx';
  history.capture(project, '编辑文字', 'text:line', 1200);
  assert.equal(history.state().length, 2, 'rapid typing should be one undo step');
  const undone = history.undo();
  assert.equal(undone.lines[0].text, 'one');
  const redone = history.redo();
  assert.equal(redone.lines[0].text, 'onexx');
  history.undo();
  const branch = history.undo() ?? project;
  branch.lines[0].text = 'branch';
  history.capture(branch, '分支', 'branch', 3000);
  assert.equal(history.state().canRedo, false);
});

test('script outline inherits chapter/scene anchors and search covers effective headings', () => {
  const project = TextImporter.parse('Arthur: first\nMatthew: second\nArthur: third');
  project.lines[0].chapterTitle = 'Session 1';
  project.lines[0].sceneTitle = 'Warehouse';
  project.lines[2].sceneTitle = 'Street';
  const outline = buildScriptOutline(project.lines);
  assert.equal(outline[1].chapter, 'Session 1');
  assert.equal(outline[1].scene, 'Warehouse');
  assert.notEqual(outline[1].sceneKey, outline[2].sceneKey);
  assert.deepEqual(searchReplayLines(project, 'warehouse').map(x=>x.index), [0,1]);
  assert.deepEqual(searchReplayLines(project, 'Matthew').map(x=>x.index), [1]);
});

test('0.44.3 batch edit stores punctuation timing structurally without touching visible text', () => {
  const project = TextImporter.parse('Arthur: one, two.\nArthur: three?!');
  const ids = project.lines.map(line=>line.id);
  applyBatchEdit(project, ids, { punctuationPauses:{mode:'custom',comma:0.1,period:0.3,question:0.4,exclamation:0.4,ellipsis:0.5,semicolon:0.2,colon:0.15} });
  assert.equal(project.lines[0].text,'one, two.');
  assert.equal(project.lines[0].speech.punctuationPauses.comma,0.1);
  assert.ok(compilePerformance(project).lines[0].duration > 0);
  applyBatchEdit(project,[ids[0]],{punctuationPauses:null});
  assert.equal(project.lines[0].speech.punctuationPauses,undefined);
});

test('batch edit and performance clipboard never alter visible dialogue text', () => {
  const project = TextImporter.parse('Arthur: one\nArthur: two');
  const ids = project.lines.map(l=>l.id);
  assert.equal(applyBatchEdit(project, ids, { type:'narration', camera:'focus-speaker' }), 2);
  assert.equal(project.lines[1].type, 'narration');
  assert.equal(project.lines[1].scene.camera, 'focus-speaker');
  project.lines[0].expression='angry';
  project.lines[0].scene={background:'room',camera:'shake',transition:'fade'};
  const clip=copyPerformanceSettings(project.lines[0]);
  pastePerformanceSettings(project.lines[1],clip);
  assert.equal(project.lines[1].text,'two');
  assert.equal(project.lines[1].scene.background,'room');
  const focus=BUILTIN_PERFORMANCE_PRESETS.find(x=>x.id==='focus-speaker');
  applyPerformancePatch(project.lines[1],focus.patch);
  assert.equal(project.lines[1].scene.background,'room','preset must not erase unrelated BG/BGM state');
  assert.equal(project.lines[1].scene.camera,'focus-speaker');
});

test('0.30 3/4 face projection shrinks the far side and remains draggable through its inverse', () => {
  const fit=defaultFaceFit();
  const left=projectFaceFeature('leftEye',fit.features.leftEye,'right-3q',1);
  const right=projectFaceFeature('rightEye',fit.features.rightEye,'right-3q',1);
  assert.ok(left.scaleX < right.scaleX,'screen-left eye is the far side in right 3/4');
  assert.ok(left.centerX > fit.features.leftEye.x,'far side moves toward the face centre');
  const recovered=unprojectFaceFeatureX('leftEye',left.centerX,fit.features.leftEye,'right-3q',1);
  assert.ok(Math.abs(recovered-fit.features.leftEye.x)<1e-9);
});

test('0.30 split Face Fit defaults and template-side assets participate in project references', () => {
  const fit=defaultFaceFit();
  assert.equal(fit.features.leftEye.x,0.39);
  assert.equal(fit.features.rightEye.x,0.61);
  const project=createProject('split-face');
  const template=createFaceTemplate('split');
  template.layers.eyeLeftOpen='left-eye';
  template.layers.eyeRightOpen='right-eye';
  project.faceTemplates.push(template);
  const refs=collectReferencedAssetRefs(project);
  assert.ok(refs.has('left-eye'));
  assert.ok(refs.has('right-eye'));
  const issues=diagnoseProject(project);
  assert.equal(issues.filter(issue=>issue.code==='missing-asset-reference').length,2);
});

test('0.39 diagnostics keep no-art placeholders out of the default problem list', () => {
  const project = TextImporter.parse('Arthur: hello');
  project.lines[0].scene={background:'missing-bg',camera:'none',transition:'cut'};
  const issues=diagnoseProject(project);
  assert.ok(issues.some(x=>x.code==='missing-asset-reference'&&x.ref==='missing-bg'));
  assert.ok(!issues.some(x=>x.code==='character-without-idle'), 'text-first placeholder art is a valid default state');
  const verbose=diagnoseProject(project,{includePlaceholderArtInfo:true});
  assert.ok(verbose.some(x=>x.code==='character-without-idle'&&x.characterId===project.characters[0].id));
});

test('project diagnostics report broken ChatWindow participant media-definition references', () => {
  const project = TextImporter.parse('Arthur: hello');
  project.mediaDefinitions = [{
    id: 'chat-main',
    name: 'Main Chat',
    type: 'chat-window',
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    messageGap: 12,
    participants: [
      { key: 'Arthur', bubbleDefinitionId: 'missing-bubble', avatarDefinitionId: 'missing-avatar', align: 'left' }
    ]
  }];
  project.lines[0].dialogueStyleId = 'chat-main';
  const issues = diagnoseProject(project);
  assert.ok(issues.some(x => x.code === 'missing-media-definition' && x.ref === 'missing-bubble'));
  assert.ok(issues.some(x => x.code === 'missing-media-definition' && x.ref === 'missing-avatar'));
});




test('Inochi-style 1D parameter bindings interpolate transforms and expression presets', async () => {
  const { createCharacter, evaluatePuppet, normalizePuppetRig } = await import('../dist/index.js');
  const character=createCharacter('Arthur');
  character.puppet=normalizePuppetRig(character.puppet);
  character.puppet.expressionPresets.angry={browY:-1,browAngle:-1,eyeSquash:.75};
  const state=evaluatePuppet(character,'angry','CLOSED',false);
  assert.equal(state.values.browY,-1);
  assert.ok(state.parts.brows.translateY>0);
  assert.ok(state.parts.brows.rotation<0);
  assert.ok(state.parts.eyes.scaleY<1);
});

test('expression lattice warp creates a 3x3 deform binding and evaluates only in that expression', async () => {
  const { createCharacter, setExpressionLatticeWarp, expressionLatticeWarp, evaluatePuppet, zeroLatticeOffsets } = await import('../dist/index.js');
  const character=createCharacter('Arthur');
  const offsets=zeroLatticeOffsets({columns:3,rows:3});offsets[4]={x:.1,y:-.08};
  character.puppet=setExpressionLatticeWarp(character.puppet,'smile','mouth',offsets,3,3);
  assert.deepEqual(expressionLatticeWarp(character.puppet,'smile','mouth')[4],{x:.1,y:-.08});
  assert.ok(evaluatePuppet(character,'default','CLOSED',false).parts.mouth.deform.every(v=>v.x===0&&v.y===0));
  assert.deepEqual(evaluatePuppet(character,'smile','CLOSED',false).parts.mouth.deform[4],{x:.1,y:-.08});
});

test('character framing and normalized stage anchor survive compilation for half-body art', async () => {
  const { TextImporter, compilePerformance } = await import('../dist/index.js');
  const project=TextImporter.parse('Arthur: hello');
  project.characters[0].puppet.layout={framing:'half',anchorX:.5,anchorY:.86,scale:1.15,offsetX:0,offsetY:.02};
  const perf=compilePerformance(project);
  assert.equal(perf.characters[0].puppet.layout.framing,'half');
  assert.equal(perf.characters[0].puppet.layout.anchorY,.86);
  assert.equal(perf.characters[0].puppet.layout.scale,1.15);
});
test('fast MP4 size estimator follows selected audio+video bitrate', async () => {
  const { estimateEncodedBytes } = await import('../dist/index.js');
  assert.equal(estimateEncodedBytes(60, 2_000_000, 128_000), 15_960_000);
  assert.equal(estimateEncodedBytes(0, 2_000_000, 128_000), 0);
});

test('0.33 text-only import remains a first-class no-art workflow', () => {
  const project = TextImporter.parse('Arthur: hello\nMatthew: hi', { title: 'text only' });
  assert.equal(project.assets.length, 0);
  assert.equal(project.faceTemplates.length, 0);
  assert.equal(project.characters.length, 2);
  assert.ok(project.characters.every(character => !character.layers.base && !character.images.idle));
  assert.ok(project.characters.every(character => character.faceFit && character.puppet));
  const perf = compilePerformance(project);
  assert.equal(perf.characters.length, 2);
  assert.equal(perf.assets.length, 0);
  assert.equal(perf.faceTemplates.length, 0);
});

test('0.40 recent-speaker compatibility mode preserves the historical roster order', () => {
  const project=TextImporter.parse('A: one\nB: two\nA: three\nC: four\nA: five');
  project.settings.maxOnStage=3;
  project.settings.autoStageMode='recent';
  const ids=Object.fromEntries(project.characters.map(c=>[c.name,c.id]));
  const perf=compilePerformance(project);
  assert.deepEqual(perf.lines[2].state.roster,[ids.B,ids.A]);
  assert.deepEqual(perf.lines[3].state.roster,[ids.B,ids.A,ids.C]);
  assert.deepEqual(perf.lines[4].state.roster,[ids.B,ids.C,ids.A]);
});

test('0.41 VN auto director keeps alternating speakers on stable sides instead of reordering the roster', () => {
  const project=TextImporter.parse('A: one\nB: two\nA: three\nB: four');
  project.settings.maxOnStage=3;
  project.settings.autoStageMode='vn-continuity';
  const ids=Object.fromEntries(project.characters.map(c=>[c.name,c.id]));
  const perf=compilePerformance(project);
  assert.deepEqual(perf.lines[1].state.roster,[ids.A,ids.B]);
  assert.deepEqual(perf.lines[2].state.roster,[ids.A,ids.B]);
  assert.deepEqual(perf.lines[3].state.roster,[ids.A,ids.B]);
  const positions=Object.fromEntries(perf.lines[1].stage.map(actor=>[actor.characterId,actor.position]));
  assert.deepEqual(positions,{[ids.A]:'left',[ids.B]:'right'});
  assert.deepEqual(Object.fromEntries(perf.lines[3].stage.map(actor=>[actor.characterId,actor.position])),positions);
});

test('0.41 VN auto director places a newly joining third actor in center and preserves the existing pair', () => {
  const project=TextImporter.parse('A: one\nB: two\nA: three\nC: joins');
  project.settings.maxOnStage=3;
  const ids=Object.fromEntries(project.characters.map(c=>[c.name,c.id]));
  const perf=compilePerformance(project);
  const before=Object.fromEntries(perf.lines[2].stage.map(actor=>[actor.characterId,actor.position]));
  const after=Object.fromEntries(perf.lines[3].stage.map(actor=>[actor.characterId,actor.position]));
  assert.deepEqual(before,{[ids.A]:'left',[ids.B]:'right'});
  assert.equal(after[ids.A],'left');
  assert.equal(after[ids.B],'right');
  assert.equal(after[ids.C],'center');
});

test('0.41 VN auto director keeps actors through narration and resets the automatic conversation cluster at a Scene boundary', () => {
  const project=TextImporter.parse('A: one\nB: two\nNarration: meanwhile\nC: new scene');
  project.settings.maxOnStage=3;
  project.lines[0].sceneTitle='Scene 1';
  project.lines[3].sceneTitle='Scene 2';
  const ids=Object.fromEntries(project.characters.map(c=>[c.name,c.id]));
  const perf=compilePerformance(project);
  assert.deepEqual(perf.lines[2].state.roster,[ids.A,ids.B]);
  assert.deepEqual(perf.lines[3].state.roster,[ids.C]);
  assert.equal(perf.lines[3].stage[0].position,'center');
});

test('0.41 character default position acts as a persistent Auto Director placement preference', () => {
  const project=TextImporter.parse('A: one\nB: two\nA: three');
  const ids=Object.fromEntries(project.characters.map(c=>[c.name,c.id]));
  project.characters.find(c=>c.id===ids.A).defaultPosition='right';
  project.characters.find(c=>c.id===ids.B).defaultPosition='left';
  const perf=compilePerformance(project);
  const positions=Object.fromEntries(perf.lines[2].stage.map(actor=>[actor.characterId,actor.position]));
  assert.deepEqual(positions,{[ids.A]:'right',[ids.B]:'left'});
});

test('0.40 editor history enforces a byte budget while retaining one useful undo step', () => {
  const project=TextImporter.parse('Arthur: one');
  project.metadata={payload:'x'.repeat(4000)};
  const history=new ProjectHistory({limit:100,maxBytes:12000,coalesceMs:0});
  history.reset(project);
  for(let i=0;i<8;i+=1){
    project.lines[0].text=`edit-${i}`;
    history.capture(project,`edit ${i}`,`edit-${i}`,i+1);
  }
  assert.ok(history.state().length<=2,'large snapshots should be trimmed to the byte budget');
  assert.ok(history.state().canUndo,'at least one undo step must remain');
  assert.ok(history.undo());
});


test('0.44.1 facing normalization defaults to mirror-safe art and upgrades legacy fixed characters', () => {
  const fresh = createProject('Facing');
  const character = createCharacter('Arthur');
  fresh.characters.push(character);
  assert.equal(character.stageFacing.policy, 'flippable');
  assert.equal(character.stageFacing.nativeFacing, 'left');

  character.stageFacing = { policy: 'fixed', nativeFacing: 'neutral' };
  normalizeReplayProject(fresh);
  assert.equal(character.stageFacing.policy, 'flippable');
  assert.equal(character.stageFacing.nativeFacing, 'left');
});

test('0.50 scene-local lighting and filters persist inside a Scene and reset at the next Scene boundary', () => {
  const project = TextImporter.parse(`Arthur: one\nArthur: two\nArthur: three`);
  project.lines[0].sceneTitle='Night';
  project.lines[0].scene={sceneGraph:{
    ambientLight:{enabled:true,color:'#6677aa',intensity:.4,layers:['world.characters','world.cg']},
    worldEffects:{filters:[{kind:'saturation',amount:.6,metadata:{preset:'desaturate'}}],mask:null},
    layerEffects:{'world.characters':{filters:[{kind:'contrast',amount:1.2}],mask:null}}
  }};
  project.lines[2].sceneTitle='Morning';
  const perf=compilePerformance(project);
  assert.equal(perf.lines[0].sceneGraph.ambientLight.enabled,true);
  assert.equal(perf.lines[1].sceneGraph.ambientLight.color,'#6677aa');
  assert.equal(perf.lines[1].sceneGraph.worldEffects.filters[0].kind,'saturation');
  assert.equal(perf.lines[1].sceneGraph.layers.find(l=>l.id==='world.characters').effects.filters[0].kind,'contrast');
  assert.equal(perf.lines[2].sceneGraph.ambientLight.enabled,false);
  assert.equal(perf.lines[2].sceneGraph.worldEffects.filters.length,0);
});

test('0.50 CG masks compile as node-local effects without becoming background or character state', () => {
  const project=TextImporter.parse(`Arthur: look`);
  project.assets.push({id:'cg-1',kind:'cg',name:'event.png',mime:'image/png'});
  project.lines[0].scene={cg:'cg-1',cgPresentation:{fit:'cover',mask:{kind:'circle',x:.4,y:.45,radius:.3,feather:.12,animation:'reveal',duration:.8}}};
  const perf=compilePerformance(project);
  const cg=perf.lines[0].sceneGraph.nodes.find(node=>node.id==='cg');
  assert.equal(cg.effects.mask.kind,'circle');
  assert.equal(cg.effects.mask.animation,'reveal');
  assert.equal(perf.lines[0].state.cgPresentation.mask.radius,.3);
  assert.equal(perf.lines[0].sceneGraph.nodes.find(node=>node.kind==='character').effects.mask,null);
});
