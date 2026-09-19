export type LineType = 'dialogue' | 'dice' | 'hitpoint' | 'wheel' | 'bubble' | 'system' | 'narration' | 'command';
export type DirectorCommandKind = 'dismiss' | 'enter' | 'move' | 'motion' | 'expression' | 'background' | 'cg' | 'object' | 'bgm' | 'ambient' | 'sfx' | 'camera' | 'transition' | 'scene' | 'chapter' | 'wait';
export type DirectorBeatTimingMode = 'parallel' | 'sequence';
export type LineExpressionMode = 'inherit' | 'set';
export type CharacterKind = 'normal' | 'npc' | 'kp' | 'system';
export type StagePosition = 'auto' | 'left' | 'center' | 'right';
export type StagePlacementSource = 'auto' | 'manual' | 'inherited';
export type CharacterFacingPolicy = 'fixed' | 'flippable' | 'paired';
export type CharacterFacing = 'left' | 'right' | 'neutral';
export type AutoStageMode = 'vn-continuity' | 'recent';
export type SpeakerFocusMode = 'none' | 'subtle' | 'strong';
export type CameraEffect = 'none' | 'push' | 'shake' | 'focus-speaker';
export type CameraPlacementSource = 'auto' | 'manual' | 'inherited';
export type TransitionEffect = 'cut' | 'fade';
export type BackgroundMethod = 'replace' | 'delay' | 'cross' | 'black' | 'white' | 'push' | 'cover';
export type AnimationCurve = 'linear' | 'quadratic' | 'quadraticR' | 'sigmoid' | 'right' | 'left' | 'sincurve';
/** RplGen-compatible text reveal modes: all / word-by-word / line-by-line / run. */
export type TextEffect = 'all' | 'w2w' | 'l2l' | 'run';
export type AssetKind = 'character' | 'background' | 'cg' | 'bgm' | 'ambient' | 'sfx' | 'voice' | 'other';
export type CgFitMode = 'contain' | 'cover';
export type CgMotionPreset = 'none' | 'slow-push' | 'pan-left' | 'pan-right';
export type SceneSpace = 'world' | 'screen';
export type StageProjectionMode = 'flat' | '2.5d';
export type SceneLayerId = 'world.background' | 'world.cg' | 'world.characters' | 'world.front-fx' | 'screen.presentation' | 'screen.dialogue' | 'screen.fx';
export type SceneNodeKind = 'background' | 'cg' | 'character' | 'custom-object' | 'dice' | 'wheel' | 'hitpoint' | 'dialogue-ui' | 'screen-fx';
export type SceneFilterKind = 'brightness' | 'contrast' | 'saturation' | 'grayscale' | 'blur' | 'tint' | 'custom';
export type CustomObjectTemplate = 'blank' | 'illustration' | 'document' | 'map' | 'phone' | 'title-card';
export type CustomObjectInteractionMode = 'none' | 'inspect' | 'stateful' | 'pan-zoom' | 'hotspots';
export type CustomObjectAction = 'show' | 'hide' | 'state' | 'transform';
export type CustomObjectHotspotAction = 'none' | 'state' | 'hide' | 'note';
export type CustomObjectInteractionStepKind = 'show' | 'hide' | 'state' | 'transform' | 'hotspot' | 'pan' | 'zoom';
export type Viseme = 'SILENCE' | 'CLOSED' | 'OPEN' | 'A' | 'I' | 'U' | 'E' | 'O' | 'SCHWA' | 'AE' | 'UU' | 'OO' | 'W' | 'F' | 'TH' | 'M';
export type AccentStrength = 'off' | 'light' | 'natural' | 'strong';
export type MediaDefinitionType = 'text' | 'richtext' | 'image' | 'bubble' | 'balloon' | 'dynamic-bubble' | 'chat-window';
export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'center' | 'bottom';
export type CharacterFraming = 'auto' | 'portrait' | 'bust' | 'half' | 'full';
export type PuppetPartName = 'base' | 'eyes' | 'eyelids' | 'pupils' | 'brows' | 'mouth' | 'overlay';
export type PuppetBindingProperty = 'translateX' | 'translateY' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'deform';



export interface AudioLineMix {
  /** Per-line voice gain multiplier. */
  voiceGain?: number;
  /** Stereo pan from -1 (left) to +1 (right). */
  voicePan?: number;
  /** Per-line SFX gain multiplier. */
  sfxGain?: number;
  /** Stereo pan from -1 (left) to +1 (right). */
  sfxPan?: number;
  /** Voice start offset relative to dialogue start, seconds. */
  voiceOffset?: number;
  /** Hold before spoken audio when line duration follows voice. */
  preRoll?: number;
  /** Hold after spoken audio before advancing. */
  postRoll?: number;
}

export interface AudioDuckingSettings {
  enabled: boolean;
  /** Gain multiplier applied to BGM while voice is active. */
  bgmGain: number;
  /** Gain multiplier applied to ambience while voice is active. */
  ambientGain: number;
  attackSeconds: number;
  releaseSeconds: number;
}

export interface AudioLimiterSettings {
  enabled: boolean;
  /** Linear ceiling; 0.95 is roughly -0.45 dBFS. */
  threshold: number;
}

export interface AudioMixSettings {
  masterVolume: number;
  voiceVolume: number;
  bgmVolume: number;
  ambientVolume: number;
  sfxVolume: number;
  /** Default BGM overlap when switching tracks. */
  bgmCrossfadeSeconds: number;
  ducking: AudioDuckingSettings;
  limiter: AudioLimiterSettings;
}

export type FaceTemplateFeatureName = 'eyes' | 'eyelids' | 'pupils' | 'brows' | 'leftEye' | 'rightEye' | 'leftEyelid' | 'rightEyelid' | 'leftPupil' | 'rightPupil' | 'leftBrow' | 'rightBrow' | 'mouth';
export type FaceOrientationPreset = 'front' | 'left-3q' | 'right-3q';



export interface ReplayTextDefinition {
  id: string;
  name: string;
  type: 'text' | 'richtext';
  fontFamily?: string | null;
  fontSize: number;
  color: string;
  align: TextAlign;
  lineHeight: number;
  maxCharsPerLine?: number | null;
  strokeColor?: string | null;
  strokeWidth?: number | null;
  iconMap?: Record<string, string>;
  metadata?: Record<string, unknown>;
}


export interface ReplayImageDefinition {
  id: string;
  name: string;
  type: 'image';
  source?: string | null;
  assetId?: string | null;
  x: number;
  y: number;
  scale: number;
  metadata?: Record<string, unknown>;
}

export interface ReplayBubbleHeaderDefinition {
  textStyleId?: string | null;
  x: number;
  y: number;
  target?: string | null;
  align?: TextAlign;
}

export interface ReplayChatParticipantDefinition {
  key: string;
  bubbleDefinitionId?: string | null;
  avatarDefinitionId?: string | null;
  align: 'left' | 'right';
}

export interface ReplayBubbleDefinition {
  id: string;
  name: string;
  type: 'bubble' | 'balloon' | 'dynamic-bubble';
  backgroundAssetId?: string | null;
  backgroundSource?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  scale: number;
  mainTextStyleId?: string | null;
  headerTextStyleId?: string | null;
  mainTextX: number;
  mainTextY: number;
  headerTextX: number;
  headerTextY: number;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  headerAlign: TextAlign;
  lineDistance: number;
  lineCountEstimate: number;
  fillMode?: string | null;
  fitAxis?: 'free' | 'vertical' | 'horizontal' | null;
  mainTextEndX?: number | null;
  mainTextEndY?: number | null;
  headers?: ReplayBubbleHeaderDefinition[];
  metadata?: Record<string, unknown>;
}

export interface ReplayChatWindowDefinition {
  id: string;
  name: string;
  type: 'chat-window';
  backgroundAssetId?: string | null;
  backgroundSource?: string | null;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  scale: number;
  messageGap: number;
  align: TextAlign;
  subX?: number;
  subY?: number;
  subWidth?: number;
  subHeight?: number;
  avatarLeft?: number;
  avatarRight?: number;
  participants?: ReplayChatParticipantDefinition[];
  metadata?: Record<string, unknown>;
}

export type ReplayMediaDefinition = ReplayTextDefinition | ReplayImageDefinition | ReplayBubbleDefinition | ReplayChatWindowDefinition;

export interface BubbleEvent {
  definitionId?: string | null;
  headerText?: string;
  mainText: string;
  textEffect?: TextEffect;
  textEffectDuration?: number | null;
  metadata?: Record<string, unknown>;
}

export interface RplGenMethodSpec {
  /** RplGen switch/motion method label without angle brackets, e.g. cross, black_pass_up_minor. */
  name: string;
  /** Continuous-time Replay Lab duration in seconds. RGL frame durations are imported at 30 fps. */
  duration: number;
}

export interface DiceRoll {
  /** Human-readable roll label/description. */
  label: string;
  /** Maximum face value, mirroring RplGen's dicemax. */
  sides: number;
  /** Optional check/target. RplGen uses NA for no check. */
  check: number | null;
  /** Final rolled face/result. */
  result: number;
}


export interface WheelOption {
  id: string;
  label: string;
  weight: number;
  characterId?: string | null;
}

export interface WheelStep {
  title: string;
  options: WheelOption[];
  resultId?: string | null;
  resultLabel: string;
  note?: string;
}

/**
 * Deterministic wheel performance. Imported history uses mode='history': the
 * result is already known, but the renderer still animates the wheel landing on it.
 * A future interactive mode can pause VN auto-play until the player resolves it.
 */
export interface WheelEvent {
  title: string;
  mode: 'history' | 'interactive';
  steps: WheelStep[];
  source?: {
    app?: string;
    recordId?: string;
    recordType?: string;
    group?: string;
    day?: number;
    round?: number;
    timestamp?: string;
  };
  blockingAuto?: boolean;
  metadata?: Record<string, unknown>;
}

export interface HitPointChange {
  label: string;
  max: number;
  before: number;
  after: number;
}

export interface AccentSelection {
  /** Stable Accent Catalog id, e.g. en-gb-cockney. */
  accentId?: string | null;
  /** The user's original search text; useful when no exact catalog match exists. */
  query?: string;
  strength?: AccentStrength;
  /** Opt-in: translation providers may prefer regional lexical choices. */
  useRegionalVocabulary?: boolean;
  /** Optional user toggles for individual catalog rules. */
  enabledRuleIds?: string[];
}

export interface VoicePreset {
  provider?: string;
  voiceId?: string;
  rate?: number;
  pitch?: number;
}

export interface CharacterSpeechProfile {
  /** Undefined/null means: inherit the project's Log language. */
  defaultLanguage?: string | null;
  /** Multiplier for punctuation/manual speech pauses. Undefined means inherit project settings. */
  pauseScale?: number;
  translationProvider?: string;
  ttsProvider?: string;
  /** Language-specific voices, e.g. en-GB, fr-FR, ja-JP. */
  voices?: Record<string, VoicePreset>;
  /** Optional accent intent per spoken language. Keys may be exact locales or base languages. */
  accents?: Record<string, AccentSelection>;
}

export interface TranslationCache {
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
  text: string;
  provider?: string;
  /** Translation-style fingerprint (accent/regional vocabulary etc.) used for cache invalidation. */
  styleKey?: string;
  updatedAt?: string;
}

export type PunctuationPauseKey = 'comma' | 'period' | 'question' | 'exclamation' | 'ellipsis' | 'semicolon' | 'colon';

export interface PunctuationPauseTiming {
  /** uniform applies one exact gap to all enabled punctuation; custom uses per-category values. */
  mode: 'uniform' | 'custom';
  /** Exact seconds; unlike legacy pauseScale this is not multiplied again. */
  uniformSeconds?: number;
  comma?: number;
  period?: number;
  question?: number;
  exclamation?: number;
  ellipsis?: number;
  semicolon?: number;
  colon?: number;
}

export interface LineSpeechConfig {
  /** Per-line target language. Undefined/null means inherit character/project policy. */
  languageOverride?: string | null;
  /** Per-line pause multiplier. Undefined means inherit character/project settings. */
  pauseScale?: number;
  /** Optional exact punctuation gaps authored for this line, commonly via batch editing. */
  punctuationPauses?: PunctuationPauseTiming | null;
  /** Optional source-language override or language-detection result. */
  sourceLanguage?: string | null;
  /** Per-line accent override. Undefined means inherit the character language slot. */
  accentOverride?: AccentSelection | null;
  /** User-authored spoken text. When present, automatic translation is bypassed. */
  textOverride?: string | null;
  translationProvider?: string;
  ttsProvider?: string;
  voice?: VoicePreset;
  translationCache?: TranslationCache;
}


export interface PuppetVec2 { x: number; y: number; }

/**
 * Stage placement for any crop: portrait, bust, half-body and full-body all use
 * the same normalized anchor model. Values are relative to the source canvas.
 */
export interface CharacterPuppetLayout {
  framing: CharacterFraming;
  anchorX: number;
  anchorY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface PuppetLattice {
  columns: number;
  rows: number;
}

export interface PuppetPartRig {
  name: PuppetPartName;
  lattice?: PuppetLattice | null;
  /** Optional normalized pivot override; otherwise renderer estimates opaque-pixel center. */
  pivotX?: number | null;
  pivotY?: number | null;
}

export interface PuppetBindingKeyframe {
  at: number;
  value: number | PuppetVec2[];
}

/**
 * Intentionally mirrors Inochi2D's Parameter -> Binding split, reduced to the
 * property/deformation subset Replay Lab needs for replay puppets.
 */
export interface PuppetParameterBinding {
  part: PuppetPartName;
  property: PuppetBindingProperty;
  keyframes: PuppetBindingKeyframe[];
}

export interface PuppetParameter {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  points: number[];
  bindings: PuppetParameterBinding[];
}

export interface CharacterPuppetRig {
  layout: CharacterPuppetLayout;
  parts: Partial<Record<PuppetPartName, PuppetPartRig>>;
  parameters: PuppetParameter[];
  /** Expression name -> parameter values. Layer-image expressions remain separate. */
  expressionPresets: Record<string, Record<string, number>>;
}

export interface ImageSet {
  idle?: string | null;
  open?: string | null;
  blink?: string | null;
  A?: string | null;
  I?: string | null;
  U?: string | null;
  E?: string | null;
  O?: string | null;
}

/**
 * Composable character art. Unlike ImageSet (legacy whole-frame variants),
 * each entry here is drawn as a separate transparent layer.
 */
export interface CharacterLayerSet {
  /** Body / clothes / hair base. May be omitted while using the procedural placeholder. */
  base?: string | null;
  /** Optional expression overlay (blush, tears, shadow, etc.). */
  overlay?: string | null;
  eyesOpen?: string | null;
  eyesClosed?: string | null;
  /** Optional separate eyelid art; if absent, eyesClosed still works as before. */
  eyelidsOpen?: string | null;
  eyelidsClosed?: string | null;
  pupils?: string | null;
  brows?: string | null;
  /** Optional per-side facial art for perspective-aware Face Fit. If absent, combined eyes/pupils/brows remain valid. */
  eyeLeftOpen?: string | null;
  eyeLeftClosed?: string | null;
  eyeRightOpen?: string | null;
  eyeRightClosed?: string | null;
  eyelidLeftOpen?: string | null;
  eyelidLeftClosed?: string | null;
  eyelidRightOpen?: string | null;
  eyelidRightClosed?: string | null;
  pupilLeft?: string | null;
  pupilRight?: string | null;
  browLeft?: string | null;
  browRight?: string | null;
  mouthClosed?: string | null;
  mouthOpen?: string | null;
  mouthA?: string | null;
  mouthI?: string | null;
  mouthU?: string | null;
  mouthE?: string | null;
  mouthO?: string | null;
  /** Optional English-specific viseme mouths ported from the user's LipSync Studio. */
  mouthSchwa?: string | null;
  mouthAe?: string | null;
  mouthUu?: string | null;
  mouthOo?: string | null;
  mouthW?: string | null;
  mouthF?: string | null;
  mouthTh?: string | null;
  mouthM?: string | null;
}

export interface FaceTemplate {
  id: string;
  name: string;
  layers: CharacterLayerSet;
  notes?: string;
}

export interface FaceFeatureFit {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export interface CharacterFaceFit {
  templateId?: string | null;
  orientation: FaceOrientationPreset;
  perspective: number;
  features: Record<FaceTemplateFeatureName, FaceFeatureFit>;
}

export interface CharacterFacingVariant {
  /** Direction-specific whole-frame fallbacks. Missing slots inherit the common character art. */
  images?: ImageSet;
  /** Direction-specific whole-frame expression fallbacks. */
  expressions?: Record<string, ImageSet>;
  /** Direction-specific layered overrides. Base is the common case for asymmetric sprites. */
  layers?: CharacterLayerSet;
  /** Optional direction-specific expression-layer overrides. */
  layerExpressions?: Record<string, CharacterLayerSet>;
}

export interface CharacterStageFacing {
  /** Symmetric art is the normal case (flippable); paired is reserved for explicitly asymmetric characters. Legacy fixed values are normalized on load. */
  policy: CharacterFacingPolicy;
  /** Internal baseline used to store manual mirror state. Normal Studio projects use left as the unmirrored baseline. */
  nativeFacing: CharacterFacing;
  /** For explicitly asymmetric art, left/right variants are independent assets rather than mirrored pixels. */
  variants?: Partial<Record<'left' | 'right', CharacterFacingVariant>>;
}

export interface SceneFilterSpec {
  kind: SceneFilterKind;
  /** Generic strength; interpretation depends on the filter kind. */
  amount?: number;
  color?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneMaskSpec {
  kind: 'none' | 'asset' | 'node' | 'circle' | 'rect';
  assetId?: string | null;
  nodeId?: string | null;
  inverted?: boolean;
  /** Normalized mask centre for generated circle/rect masks. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  /** 0 = hard edge, 1 = very soft edge. */
  feather?: number;
  /** Optional reveal animation used by CG/object presentation. */
  animation?: 'none' | 'reveal' | 'wipe-left' | 'wipe-right';
  duration?: number;
}

export interface SceneEffectStack {
  filters: SceneFilterSpec[];
  mask?: SceneMaskSpec | null;
}

export interface SceneNodeOverride extends SceneEffectStack {
  layerId?: SceneLayerId;
  space?: SceneSpace;
  /** Small manual ordering correction inside the layer. */
  zBias?: number;
}

export interface SceneAmbientLight {
  enabled: boolean;
  color: string;
  /** 0..1 overlay/mix strength. */
  intensity: number;
  /** Lighting is opt-in per layer so UI remains unaffected by default. */
  layers: SceneLayerId[];
}

export interface SceneGraphSettings {
  /** Flat preserves current VN rendering; 2.5d enables depth projection. */
  projection: StageProjectionMode;
  /** Ambient/environment light applied to selected visual layers. */
  ambientLight: SceneAmbientLight;
  /** Effects applied to all WorldSpace content before UI/presentation is drawn. */
  worldEffects: SceneEffectStack;
  /** Final output effects. These intentionally affect dialogue/UI too. */
  outputEffects: SceneEffectStack;
  layerEffects: Partial<Record<SceneLayerId, SceneEffectStack>>;
  /** Stable node ids are used, e.g. character:<id>, custom-object:<id>, cg. */
  nodeOverrides: Record<string, SceneNodeOverride>;
}

export interface SceneGraphPatch {
  ambientLight?: Partial<SceneAmbientLight> | null;
  worldEffects?: SceneEffectStack | null;
  outputEffects?: SceneEffectStack | null;
  layerEffects?: Partial<Record<SceneLayerId, SceneEffectStack | null>>;
  nodeOverrides?: Record<string, SceneNodeOverride | null>;
}

export interface SceneGraphLayer {
  id: SceneLayerId;
  space: SceneSpace;
  order: number;
  cameraAffected: boolean;
  effects: SceneEffectStack;
}

export interface SceneGraphNode {
  id: string;
  kind: SceneNodeKind;
  layerId: SceneLayerId;
  space: SceneSpace;
  visible: boolean;
  /** 0 is nearest/front; 1 is farther away. Flat mode ignores depth visually. */
  depth: number;
  zBias: number;
  assetId?: string | null;
  characterId?: string | null;
  objectId?: string | null;
  stateId?: string | null;
  transform?: { x: number; y: number; scale: number; rotation: number; depth: number };
  effects: SceneEffectStack;
  metadata?: Record<string, unknown>;
}

export interface SceneGraphSnapshot {
  projection: StageProjectionMode;
  ambientLight: SceneAmbientLight;
  worldEffects: SceneEffectStack;
  outputEffects: SceneEffectStack;
  layers: SceneGraphLayer[];
  nodes: SceneGraphNode[];
}

export interface CameraTransform {
  /** Normalized world-space point kept at the centre of the viewport. */
  x: number;
  y: number;
  /** 1 = full frame. Values above 1 crop in. */
  zoom: number;
}

export interface StageTransform {
  /** Normalized actor anchor in the stage viewport. x is horizontal centre, y is floor/bottom anchor. */
  x: number;
  y: number;
  /** Multiplier on top of the normal VN slot size. */
  scale: number;
  /** 0 is nearest/front and 1 is farther away. Flat projects ignore it visually. */
  depth?: number;
  /** Optional user-selected facing. Only flippable art may be mirrored by the renderer. */
  facing?: CharacterFacing | null;
}

export interface ReplayCharacter {
  id: string;
  name: string;
  /** Alternative/imported names confirmed by the user; used for safe identity matching. */
  aliases?: string[];
  color: string;
  kind: CharacterKind;
  showOnStage: boolean;
  defaultPosition: StagePosition;
  /** Explicit art-direction capability. Layout code must never infer mirroring from left/right placement. */
  stageFacing: CharacterStageFacing;
  images: ImageSet;
  expressions: Record<string, ImageSet>;
  /** Preferred composable art model. Missing layers simply inherit from the default set. */
  layers: CharacterLayerSet;
  /** Per-expression layer overrides, e.g. angry eyes + default mouth. */
  layerExpressions: Record<string, CharacterLayerSet>;
  /** Lightweight Inochi-style parameter/deformer rig. */
  puppet: CharacterPuppetRig;
  /** Shared face-template placement and perspective fit. */
  faceFit: CharacterFaceFit;
  /** Legacy/default voice fallback. */
  voice?: VoicePreset;
  /** Spoken-audio language/voice policy. Visible dialogue text is unaffected. */
  speech?: CharacterSpeechProfile;
}


export interface CgPresentation {
  fit: CgFitMode;
  hideCharacters: boolean;
  hideTextbox: boolean;
  motion: CgMotionPreset;
  /** Optional CG-specific mask; null means no mask. */
  mask?: SceneMaskSpec | null;
  /** Seconds used by CG presentation motion/fade/mask presets. */
  duration: number;
}

export interface CustomObjectTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  /** Reserved for world-space objects; screen-space presentation ignores it. */
  depth?: number;
}

export interface CustomObjectState {
  id: string;
  name: string;
  assetId?: string | null;
}

export interface CustomObjectHotspot {
  id: string;
  label: string;
  /** Optional source state. null means this hotspot is active in every object state. */
  stateId?: string | null;
  /** Normalized rectangle inside the object image. */
  x: number;
  y: number;
  width: number;
  height: number;
  action?: CustomObjectHotspotAction;
  targetStateId?: string | null;
  note?: string;
}

export interface CustomPresentationObject {
  id: string;
  name: string;
  template: CustomObjectTemplate;
  interactionMode: CustomObjectInteractionMode;
  states: CustomObjectState[];
  initialStateId?: string | null;
  hotspots: CustomObjectHotspot[];
  transform: CustomObjectTransform;
  metadata?: Record<string, unknown>;
}

export interface CustomObjectRuntimeState {
  objectId: string;
  visible: boolean;
  stateId?: string | null;
  transform: CustomObjectTransform;
}

export interface CustomObjectInteractionStep {
  id: string;
  /** Seconds since the take started. */
  at: number;
  kind: CustomObjectInteractionStepKind;
  objectId: string;
  stateId?: string | null;
  hotspotId?: string | null;
  transform?: Partial<CustomObjectTransform>;
  note?: string | null;
}

export interface CustomObjectInteractionTake {
  id: string;
  name: string;
  objectId: string;
  duration: number;
  steps: CustomObjectInteractionStep[];
}

export interface MediaAsset {
  id: string;
  kind: AssetKind;
  name: string;
  uri?: string;
  sourcePath?: string;
  mime?: string;
  metadata?: Record<string, unknown>;
}

export interface MouthCue {
  start: number;
  end: number;
  viseme: Viseme;
  phoneme?: string;
}


export interface CharacterVisualState {
  /** Persistent semantic expression state. */
  expression: string;
  /** Current blocking slot; auto means no explicit semantic slot is pinned. */
  position: StagePosition;
  /** Direct-manipulation transform inherited inside the current Scene. */
  transform?: StageTransform;
  /** User-selected facing state; paired assets switch source, symmetric art may mirror. */
  facing?: CharacterFacing | null;
  /** Existing/custom motion label currently attached to this beat/line. */
  motion?: string | null;
}

export interface DirectorBeatChange {
  kind: 'command' | 'auto-blocking' | 'expression' | 'motion';
  lineId?: string;
  command?: ReplayDirectorCommand;
  characterId?: string | null;
  label: string;
}

export interface DirectorBeat {
  id: string;
  /** How explicit command rows in this beat are cued. Parallel fires non-blocking events at one cue point; sequence preserves row order. */
  timingMode: DirectorBeatTimingMode;
  /** Inclusive project line index where the beat begins. */
  startIndex: number;
  /** Inclusive project line index where the beat ends. */
  endIndex: number;
  /** Explicit /command lines that form this beat. */
  commandLineIds: string[];
  /** First visible line after the commands, when one exists. */
  targetLineId?: string | null;
  /** Auto-layout/state changes materialized by the compiler for author inspection. */
  changes: DirectorBeatChange[];
  summary: string;
}

export interface ReplayDirectorCommand {
  kind: DirectorCommandKind;
  /** Human-readable argument retained even if the referenced object is later renamed or temporarily unresolved. */
  target?: string | null;
  characterId?: string | null;
  assetId?: string | null;
  objectId?: string | null;
  objectAction?: CustomObjectAction | null;
  objectStateId?: string | null;
  objectTransform?: Partial<CustomObjectTransform> | null;
  expression?: string | null;
  position?: StagePosition | null;
  value?: string | null;
  duration?: number | null;
  /** Source-level beat timing. Stored on each command so grouping remains derived and draggable. */
  beatMode?: DirectorBeatTimingMode;
}

export interface ScenePatch {
  background?: string | null;
  cg?: string | null;
  cgPresentation?: Partial<CgPresentation>;
  /** Scene-local lighting/filter/mask overrides. Persist until the Scene ends or a later patch changes them. */
  sceneGraph?: SceneGraphPatch;
  bgm?: string | null;
  ambient?: string | null;
  /** Optional per-cue crossfade duration; omitted uses project audio mix default. */
  bgmFadeSeconds?: number | null;
  enterIds?: string[];
  exitIds?: string[];
  camera?: CameraEffect;
  transition?: TransitionEffect;
  cameraCurve?: AnimationCurve;
  transitionCurve?: AnimationCurve;
  /** RplGen-compatible background switch method. */
  backgroundMethod?: BackgroundMethod;
  backgroundMethodDuration?: number | null;
}

export interface ReplayLine {
  id: string;
  speakerId: string;
  sourceSpeaker?: string;
  type: LineType;
  /** Original/imported Log text. This is what is displayed on screen. */
  text: string;
  /** Text reveal behavior. Names intentionally follow RplGen's mature replay vocabulary. */
  textEffect?: TextEffect;
  /** Approximate seconds used for the reveal phase; null/undefined uses an automatic value. */
  textEffectDuration?: number | null;
  /** Spoken-audio language/translation configuration. */
  speech?: LineSpeechConfig;
  chapterTitle?: string;
  sceneTitle?: string;
  duration?: number | null;
  expression?: string;
  /** inherit keeps the previous character expression; set applies expression on this line. */
  expressionMode?: LineExpressionMode;
  mouth?: 'auto' | 'off' | 'timed';
  mouthCues?: MouthCue[];
  audioAssetId?: string | null;
  sfxAssetId?: string | null;
  /** Per-line voice/SFX timing and mix overrides. */
  audioMix?: AudioLineMix;
  /** Structured RplGen-style dice animation data. */
  diceRolls?: DiceRoll[];
  /** Structured RplGen-style HP animation data. */
  hitPoint?: HitPointChange | null;
  /** Structured weighted-wheel animation / imported draw history. */
  wheel?: WheelEvent | null;
  /** Structured speech-bubble / chat-window event. */
  bubble?: BubbleEvent | null;
  /** Optional dialogue box definition for ordinary dialogue lines. */
  dialogueStyleId?: string | null;
  /** RplGen dialogue/animation switch method applied to stage actors. */
  stageMethod?: RplGenMethodSpec | null;
  stageMode?: 'auto' | 'custom';
  stageIds?: string[];
  stagePositions?: Record<string, StagePosition>;
  /** Freeform visual placement authored by direct manipulation. Missing entries inherit earlier Scene state. */
  stageTransforms?: Record<string, StageTransform | null>;
  /** Human-authored camera framing. Missing means inherit inside the Scene; null resets to full-frame. */
  cameraTransform?: CameraTransform | null;
  scene?: ScenePatch;
  /** Structured director event used by /commands in the script timeline. */
  command?: ReplayDirectorCommand | null;
  metadata?: Record<string, unknown>;
}

export interface ReplaySettings {
  maxOnStage: 1 | 2 | 3;
  /** VN continuity keeps actors/slots stable inside a Scene; recent preserves the 0.40 behavior. */
  autoStageMode: AutoStageMode;
  /** Visual emphasis applied to the active speaker by renderers. */
  speakerFocus: SpeakerFocusMode;
  dimOthers: boolean;
  showNameTags: boolean;
  bgColor: string;
  /** Legacy mirrors kept for older projects/exporters. New code should use audioMix. */
  bgmVolume: number;
  sfxVolume: number;
  audioMix: AudioMixSettings;
  mouthLeadMs: number;
  /** Additional pause strength for speech punctuation and manual '/' pause markers. */
  speechPauseScale: number;
  templateId: string;
  /** Language of imported Log text, e.g. zh-CN, en-GB, or 'auto'. */
  logLanguage: string;
  translationProvider?: string;
  ttsProvider?: string;
}

export interface ReplayProject {
  format: 'ReplayLabProject';
  version: string;
  title: string;
  characters: ReplayCharacter[];
  lines: ReplayLine[];
  assets: MediaAsset[];
  customObjects: CustomPresentationObject[];
  customObjectTakes?: CustomObjectInteractionTake[];
  mediaDefinitions: ReplayMediaDefinition[];
  faceTemplates: FaceTemplate[];
  settings: ReplaySettings;
  /** Unified visual-scene foundation. Existing authoring fields remain the source of truth. */
  sceneGraph: SceneGraphSettings;
}

export interface PerformanceState {
  background: string | null;
  cg: string | null;
  cgPresentation: CgPresentation;
  customObjects: Record<string, CustomObjectRuntimeState>;
  bgm: string | null;
  ambient: string | null;
  roster: string[];
  /** Compatibility view of characterVisuals[*].expression. */
  expressions: Record<string, string>;
  /** Persistent per-character visual state; partial authoring changes never wipe unrelated state. */
  characterVisuals: Record<string, CharacterVisualState>;
  bubble: BubbleEvent | null;
}

export interface PerformanceLine {
  index: number;
  lineId: string;
  start: number;
  end: number;
  duration: number;
  speakerId: string;
  speakerName: string;
  type: LineType;
  /** Visible dialogue text from the Log. */
  text: string;
  textEffect: TextEffect;
  textEffectDuration: number;
  /** Cached/manual spoken text when available; otherwise visible text until translation runs. */
  speechText: string;
  speechLanguage: string;
  translationPending: boolean;
  chapterTitle?: string;
  sceneTitle?: string;
  expression: string;
  mouth: 'auto' | 'off' | 'timed';
  mouthCues: MouthCue[];
  stage: Array<{ characterId: string; name: string; position: StagePosition; active: boolean; transform?: StageTransform; motion?: RplGenMethodSpec | null; placementSource: StagePlacementSource }>;
  state: PerformanceState;
  camera: CameraEffect;
  cameraTransform: CameraTransform;
  cameraPlacementSource: CameraPlacementSource;
  transition: TransitionEffect;
  cameraCurve: AnimationCurve;
  transitionCurve: AnimationCurve;
  backgroundChanged: boolean;
  backgroundMethod: BackgroundMethod;
  backgroundMethodDuration: number;
  diceRolls: DiceRoll[];
  hitPoint: HitPointChange | null;
  wheel: WheelEvent | null;
  bubble: BubbleEvent | null;
  dialogueStyleId?: string | null;
  stageMethod: RplGenMethodSpec | null;
  /** Derived unified scene graph for this authored moment. */
  sceneGraph: SceneGraphSnapshot;
  /** Director beat owning this line; command lines and the following visible line share it. */
  directorBeatId?: string | null;
  audioAssetId?: string | null;
  sfxAssetId?: string | null;
  audioMix: AudioLineMix;
  bgmFadeSeconds?: number | null;
}

export interface PerformanceDocument {
  format: 'ReplayLabPerformance';
  version: string;
  title: string;
  settings: ReplaySettings;
  sceneGraph: SceneGraphSettings;
  characters: ReplayCharacter[];
  assets: MediaAsset[];
  customObjects: CustomPresentationObject[];
  customObjectTakes?: CustomObjectInteractionTake[];
  mediaDefinitions: ReplayMediaDefinition[];
  faceTemplates: FaceTemplate[];
  lines: PerformanceLine[];
  /** Human-readable grouping of consecutive director commands and implicit auto-blocking changes. */
  directorBeats: DirectorBeat[];
  duration: number;
}
