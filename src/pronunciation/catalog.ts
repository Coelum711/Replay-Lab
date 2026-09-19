import type { AccentProfile, AccentSearchResult } from './types.js';

const tendencyNote = 'These are descriptive tendencies, not rules that every speaker from the region follows. Age, community, class, ethnicity and individual style can differ substantially.';

export const ACCENT_CATALOG: AccentProfile[] = [
  {
    id: 'en-gb-southern-british', language: 'en', localeFallback: 'en-GB', label: 'Southern British / London-adjacent English', shortLabel: 'Southern British',
    aliases: ['London', 'London English', '伦敦', '伦敦腔', 'Southern England', '南英格兰', 'Standard Southern British'],
    tags: ['UK', 'England', 'London', 'southern', 'British'], region: { country: 'GB', region: 'England', city: 'London' },
    summary: 'A broad Southern English profile useful as a London-area default when a more specific accent is not selected.', variabilityNote: tendencyNote,
    rules: [
      { id:'non-rhotic', category:'pronunciation', label:'Non-rhotic tendency', description:'Post-vocalic /r/ is commonly absent unless a following vowel licenses linking.', examples:['car', 'hard'], defaultEnabled:true, machine:{kind:'phoneme-rewrite',input:'R',output:'∅',environment:'post-vocalic before consonant or boundary'} },
      { id:'trap-bath', category:'pronunciation', label:'TRAP–BATH split', description:'Words in the BATH lexical set may use a backer/longer vowel than TRAP words.', examples:['bath', 'class', 'dance'], defaultEnabled:true, machine:{kind:'lexical-set',value:'BATH'} },
      { id:'linking-r', category:'pronunciation', label:'Linking R', description:'Historical /r/ may surface before a following vowel across a word boundary.', defaultEnabled:true },
      { id:'t-glottal-variable', category:'pronunciation', label:'Variable T glottalling', description:'/t/ may be glottalised in some environments; frequency is speaker- and style-dependent.', examples:['bottle', 'water'], defaultEnabled:false },
      { id:'southern-british-prosody', category:'prosody', label:'Southern British prosody', description:'Use a neutral Southern British rhythm/intonation unless a more specific voice profile supplies its own prosody.', defaultEnabled:true, machine:{kind:'prosody-hint',value:'southern-british'} },
      { id:'uk-vocab', category:'vocabulary', label:'British lexical preferences', description:'When explicitly enabled for translation, prefer ordinary British choices where meaning is unchanged.', examples:['flat', 'lift', 'holiday'], defaultEnabled:false, machine:{kind:'lexical-choice',value:'british-english'} }
    ]
  },
  {
    id:'en-gb-rp', language:'en', localeFallback:'en-GB', label:'Received Pronunciation (RP)', shortLabel:'RP', aliases:['Received Pronunciation','RP','BBC English','标准英音','英式标准音'], tags:['UK','England','prestige','British'], region:{country:'GB',region:'England'}, summary:'A non-regional prestige-oriented British English reference profile.', variabilityNote:tendencyNote,
    rules:[
      {id:'non-rhotic',category:'pronunciation',label:'Non-rhotic',description:'Post-vocalic /r/ is normally absent except in linking contexts.',defaultEnabled:true},
      {id:'trap-bath',category:'pronunciation',label:'TRAP–BATH split',description:'BATH-set words typically pattern separately from TRAP.',defaultEnabled:true},
      {id:'rp-prosody',category:'prosody',label:'RP-oriented prosody',description:'Prefer controlled, relatively conservative Southern British timing and vowel targets.',defaultEnabled:true,machine:{kind:'prosody-hint',value:'rp'}},
      {id:'uk-vocab',category:'vocabulary',label:'British lexical preferences',description:'Optional British lexical choices during translation.',examples:['flat','lift','holiday'],defaultEnabled:false}
    ]
  },
  {
    id:'en-gb-estuary', language:'en', localeFallback:'en-GB', label:'Estuary English', aliases:['Estuary','河口英语','London commuter belt','Southeast England'], tags:['UK','England','London','southeast','British'], region:{country:'GB',region:'South East England'}, summary:'A broad South-East English profile often described between more conservative Southern British speech and stronger London varieties.', variabilityNote:tendencyNote,
    rules:[
      {id:'non-rhotic',category:'pronunciation',label:'Non-rhotic',description:'Post-vocalic /r/ is generally absent.',defaultEnabled:true},
      {id:'t-glottal-variable',category:'pronunciation',label:'T glottalling',description:'Glottal realisations of /t/ can occur in selected environments.',defaultEnabled:true},
      {id:'l-vocalisation-variable',category:'pronunciation',label:'Variable L vocalisation',description:'Dark /l/ may become more vowel-like in some positions.',defaultEnabled:false},
      {id:'estuary-prosody',category:'prosody',label:'South-East English prosody',description:'Use a contemporary South-East English rhythm rather than a highly formal RP target.',defaultEnabled:true},
      {id:'uk-vocab',category:'vocabulary',label:'British lexical preferences',description:'Optional British lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-gb-cockney', language:'en', localeFallback:'en-GB', label:'Cockney / Traditional London English', shortLabel:'Cockney', aliases:['Cockney','伦敦东区','East London','东伦敦口音','Traditional London'], tags:['UK','England','London','East London','British'], region:{country:'GB',region:'England',city:'London'}, summary:'A marked traditional London profile. Best treated as a strong character choice rather than a generic “London accent”.', variabilityNote:tendencyNote,
    rules:[
      {id:'non-rhotic',category:'pronunciation',label:'Non-rhotic',description:'Post-vocalic /r/ is generally absent.',defaultEnabled:true},
      {id:'t-glottal',category:'pronunciation',label:'T glottalling',description:'/t/ may be realised with a glottal stop in many eligible environments.',defaultEnabled:true},
      {id:'th-fronting-variable',category:'pronunciation',label:'Variable TH-fronting',description:'Dental fricatives may pattern toward labiodental realisations for some speakers and styles.',defaultEnabled:false},
      {id:'h-dropping-variable',category:'pronunciation',label:'Variable H-dropping',description:'Word-initial /h/ may be absent in some lexical items/styles.',defaultEnabled:false},
      {id:'cockney-prosody',category:'prosody',label:'London prosody',description:'Allow a more locally marked London rhythm/intonation when the voice supports it.',defaultEnabled:true},
      {id:'london-vocab',category:'vocabulary',label:'London/UK lexical flavour',description:'Optional regionally appropriate lexical choices; never applied unless explicitly enabled.',defaultEnabled:false}
    ]
  },
  {
    id:'en-us-general', language:'en', localeFallback:'en-US', label:'General American English', shortLabel:'General American', aliases:['General American','American','美音','标准美音','美国英语'], tags:['US','American','general'], region:{country:'US'}, summary:'A broad US reference profile intended as a safe fallback when no narrower US region is selected.', variabilityNote:tendencyNote,
    rules:[
      {id:'rhotic',category:'pronunciation',label:'Rhotic',description:'Post-vocalic /r/ is generally retained.',defaultEnabled:true},
      {id:'t-flap',category:'pronunciation',label:'Intervocalic T/D flapping',description:'Eligible /t, d/ may surface as a flap in unstressed intervocalic contexts.',examples:['water','city'],defaultEnabled:true},
      {id:'ga-prosody',category:'prosody',label:'General American prosody',description:'Use a neutral contemporary US rhythm/intonation.',defaultEnabled:true},
      {id:'us-vocab',category:'vocabulary',label:'US lexical preferences',description:'Optional American lexical choices during translation.',examples:['apartment','elevator','vacation'],defaultEnabled:false}
    ]
  },
  {
    id:'en-us-new-york-city', language:'en', localeFallback:'en-US', label:'New York City English', shortLabel:'New York City', aliases:['NYC','New York','纽约','纽约口音','New Yorker'], tags:['US','New York','NYC','East Coast'], region:{country:'US',region:'New York',city:'New York City'}, summary:'A New York City regional intent. Actual NYC speech varies strongly by community, generation and style.', variabilityNote:tendencyNote,
    rules:[
      {id:'nyc-rhotic-variable',category:'pronunciation',label:'Variable rhoticity',description:'Rhoticity varies substantially across speakers and generations; do not force a single value by default.',defaultEnabled:false},
      {id:'nyc-vowels',category:'pronunciation',label:'NYC vowel system',description:'Some vowel lexical sets may differ from General American; leave provider/native voice in control when possible.',defaultEnabled:true},
      {id:'nyc-prosody',category:'prosody',label:'NYC prosodic intent',description:'Prefer a voice explicitly tagged New York/NYC rather than simulating via text substitutions.',defaultEnabled:true},
      {id:'us-vocab',category:'vocabulary',label:'US lexical preferences',description:'Optional American lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-us-southern', language:'en', localeFallback:'en-US', label:'Southern American English', shortLabel:'Southern US', aliases:['Southern US','Southern American','美国南方','南方口音','Southern accent'], tags:['US','South','American'], region:{country:'US',region:'Southern United States'}, summary:'A broad Southern US intent; useful as a parent profile for narrower areas such as Texas.', variabilityNote:tendencyNote,
    rules:[
      {id:'rhotic-us-south',category:'pronunciation',label:'Usually rhotic in many contemporary varieties',description:'Do not assume one historical rhoticity pattern across the entire US South.',defaultEnabled:true},
      {id:'southern-vowels',category:'pronunciation',label:'Southern vowel tendencies',description:'Vowel trajectories may differ from General American; native/region-tagged voices should take precedence over synthetic rewrites.',defaultEnabled:true},
      {id:'southern-prosody',category:'prosody',label:'Southern US prosodic intent',description:'Allow region-appropriate timing and intonation when the provider voice supports it.',defaultEnabled:true},
      {id:'us-vocab',category:'vocabulary',label:'US lexical preferences',description:'Optional American lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-us-texas', language:'en', localeFallback:'en-US', label:'Texas English', shortLabel:'Texas', aliases:['Texas','Texan','德州','德州口音','Texas accent'], tags:['US','Texas','South','American'], region:{country:'US',region:'Texas'}, summary:'A Texas regional intent. Falls back to en-US/Southern US when no Texas-tagged voice is available.', variabilityNote:tendencyNote,
    rules:[
      {id:'texas-rhotic',category:'pronunciation',label:'Rhotic tendency',description:'Contemporary Texas English is commonly rhotic.',defaultEnabled:true},
      {id:'texas-vowels',category:'pronunciation',label:'Texas/Southern vowel tendencies',description:'Use a Texas- or Southern-tagged native voice when available rather than hard-coded spelling hacks.',defaultEnabled:true},
      {id:'texas-prosody',category:'prosody',label:'Texas regional prosody',description:'Provider/native voice controls fine-grained intonation; this profile supplies search intent and fallbacks.',defaultEnabled:true},
      {id:'us-vocab',category:'vocabulary',label:'US lexical preferences',description:'Optional American lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-us-boston', language:'en', localeFallback:'en-US', label:'Boston / Eastern New England English', shortLabel:'Boston', aliases:['Boston','Boston accent','波士顿','波士顿口音','Eastern New England'], tags:['US','Massachusetts','Boston','New England'], region:{country:'US',region:'Massachusetts',city:'Boston'}, summary:'An Eastern New England/Boston intent, with substantial speaker variation.', variabilityNote:tendencyNote,
    rules:[
      {id:'boston-rhotic-variable',category:'pronunciation',label:'Variable/non-rhotic heritage',description:'Non-rhotic patterns are historically salient, but contemporary speakers vary; use a native tagged voice when possible.',defaultEnabled:false},
      {id:'boston-vowels',category:'pronunciation',label:'Eastern New England vowel tendencies',description:'Treat vowel details as provider/native-voice territory rather than deterministic rewrites.',defaultEnabled:true},
      {id:'boston-prosody',category:'prosody',label:'Boston regional intent',description:'Search/rank Boston or New England tagged voices before generic en-US.',defaultEnabled:true},
      {id:'us-vocab',category:'vocabulary',label:'US lexical preferences',description:'Optional American lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-in-general', language:'en', localeFallback:'en-IN', label:'Indian English', shortLabel:'India', aliases:['India','Indian English','印度英语','印度口音','en-IN'], tags:['India','Indian','South Asia'], region:{country:'IN'}, summary:'A broad Indian English intent. Provider voices with en-IN should be preferred when available.', variabilityNote:tendencyNote,
    rules:[
      {id:'indian-english-consonants',category:'pronunciation',label:'Indian English consonant profile',description:'Consonant realisations can differ by first language and region; avoid one-size-fits-all phoneme substitutions.',defaultEnabled:true},
      {id:'indian-english-rhythm',category:'prosody',label:'Indian English rhythm',description:'Prefer an en-IN/native provider voice for timing and intonation details.',defaultEnabled:true},
      {id:'indian-vocab',category:'vocabulary',label:'Indian English lexical preferences',description:'Optional Indian English lexical choices during translation when natural and context-appropriate.',defaultEnabled:false}
    ]
  },
  {
    id:'en-au-general', language:'en', localeFallback:'en-AU', label:'Australian English', shortLabel:'Australia', aliases:['Australia','Australian','澳大利亚英语','澳音','en-AU'], tags:['Australia','Australian'], region:{country:'AU'}, summary:'A broad Australian English profile and locale fallback.', variabilityNote:tendencyNote,
    rules:[
      {id:'au-non-rhotic',category:'pronunciation',label:'Non-rhotic tendency',description:'Post-vocalic /r/ is generally absent except in linking contexts.',defaultEnabled:true},
      {id:'au-vowels',category:'pronunciation',label:'Australian vowel profile',description:'Prefer a native en-AU voice for vowel quality rather than spelling-based simulation.',defaultEnabled:true},
      {id:'au-prosody',category:'prosody',label:'Australian prosody',description:'Use native en-AU timing/intonation when available.',defaultEnabled:true},
      {id:'au-vocab',category:'vocabulary',label:'Australian lexical preferences',description:'Optional Australian lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-ca-general', language:'en', localeFallback:'en-CA', label:'Canadian English', shortLabel:'Canada', aliases:['Canada','Canadian','加拿大英语','加拿大口音','en-CA'], tags:['Canada','Canadian'], region:{country:'CA'}, summary:'A broad Canadian English profile and locale fallback.', variabilityNote:tendencyNote,
    rules:[
      {id:'ca-rhotic',category:'pronunciation',label:'Rhotic',description:'Post-vocalic /r/ is generally retained.',defaultEnabled:true},
      {id:'canadian-raising',category:'pronunciation',label:'Canadian raising tendency',description:'Some diphthongs may have raised onsets before voiceless consonants; actual implementation should be voice/provider-led.',defaultEnabled:true},
      {id:'ca-prosody',category:'prosody',label:'Canadian English prosody',description:'Prefer en-CA or Canadian-tagged provider voices.',defaultEnabled:true},
      {id:'ca-vocab',category:'vocabulary',label:'Canadian lexical preferences',description:'Optional Canadian lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-ie-general', language:'en', localeFallback:'en-IE', label:'Irish English', shortLabel:'Ireland', aliases:['Ireland','Irish English','爱尔兰英语','爱尔兰口音','en-IE'], tags:['Ireland','Irish'], region:{country:'IE'}, summary:'A broad Irish English intent; regional variation inside Ireland is substantial.', variabilityNote:tendencyNote,
    rules:[
      {id:'irish-rhotic',category:'pronunciation',label:'Rhotic tendency',description:'Many Irish English varieties retain post-vocalic /r/.',defaultEnabled:true},
      {id:'irish-english-vowels',category:'pronunciation',label:'Irish English vowel profile',description:'Use a native/region-tagged voice for detailed vowel realisation.',defaultEnabled:true},
      {id:'irish-prosody',category:'prosody',label:'Irish English prosody',description:'Prefer en-IE or Irish-tagged voices for intonation and rhythm.',defaultEnabled:true},
      {id:'irish-vocab',category:'vocabulary',label:'Irish English lexical preferences',description:'Optional regional lexical choices during translation.',defaultEnabled:false}
    ]
  },
  {
    id:'en-sg-general', language:'en', localeFallback:'en-SG', label:'Singapore English', shortLabel:'Singapore', aliases:['Singapore','Singapore English','新加坡英语','新加坡口音','en-SG'], tags:['Singapore','Southeast Asia'], region:{country:'SG'}, summary:'A broad Singapore English intent; formal Singapore English and colloquial Singlish are not the same register.', variabilityNote:tendencyNote,
    rules:[
      {id:'sg-register',category:'prosody',label:'Register-sensitive delivery',description:'Keep formal Singapore English and colloquial Singlish distinct; do not inject colloquial features unless requested.',defaultEnabled:true},
      {id:'sg-pronunciation',category:'pronunciation',label:'Singapore English pronunciation intent',description:'Prefer en-SG/native tagged voices; avoid caricatured text spellings.',defaultEnabled:true},
      {id:'sg-vocab',category:'vocabulary',label:'Singapore English lexical preferences',description:'Optional regional lexical choices; colloquial particles require an explicit style setting.',defaultEnabled:false}
    ]
  }
];

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[\s_./-]+/g, ' ').trim();
}

function languageBase(language: string): string {
  return normalize(language).split(' ')[0]!.split('-')[0]!;
}

export function getAccentProfile(id?: string | null): AccentProfile | undefined {
  if (!id) return undefined;
  return ACCENT_CATALOG.find(profile => profile.id === id);
}

export function accentsForLanguage(language: string): AccentProfile[] {
  const base = languageBase(language);
  return ACCENT_CATALOG.filter(profile => languageBase(profile.language) === base);
}

export function searchAccents(language: string, query: string, limit = 12): AccentSearchResult[] {
  const base = languageBase(language);
  const q = normalize(query);
  const candidates = ACCENT_CATALOG.filter(profile => !base || base === 'auto' || languageBase(profile.language) === base);
  if (!q) return candidates.slice(0, limit).map(profile => ({ profile, score: 1, matchedBy: ['language'] }));
  const qTokens = q.split(' ').filter(Boolean);
  const scored = candidates.map(profile => {
    const fields = [profile.label, profile.shortLabel ?? '', ...profile.aliases, ...profile.tags, profile.region?.country ?? '', profile.region?.region ?? '', profile.region?.city ?? '']
      .filter(Boolean)
      .map(normalize);
    let score = 0; const matched = new Set<string>();
    for (const field of fields) {
      if (field === q) { score += 100; matched.add(field); continue; }
      if (field.startsWith(q)) { score += 55; matched.add(field); }
      else if (field.includes(q)) { score += 35; matched.add(field); }
      for (const token of qTokens) if (field.includes(token)) { score += 8; matched.add(field); }
    }
    return { profile, score, matchedBy: [...matched].slice(0, 4) };
  }).filter(result => result.score > 0);
  return scored.sort((a,b)=>b.score-a.score || a.profile.label.localeCompare(b.profile.label)).slice(0, limit);
}
