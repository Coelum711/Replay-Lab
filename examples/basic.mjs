import {
  TextImporter,
  compilePerformance,
  exportYmmScript,
  exportTyranoScript
} from '../dist/index.js';

const project = TextImporter.parse(`Arthur: 我要调查这扇门。\nKP: 投一个侦查。\nArthur: 1d100=32/65 成功。`, { title: 'Demo' });
project.lines[0].scene = { background: 'warehouse.png', transition: 'fade', camera: 'none', enterIds: [project.characters[0].id] };

console.log(JSON.stringify(compilePerformance(project), null, 2));
console.log(exportYmmScript(project));
console.log(exportTyranoScript(project));
