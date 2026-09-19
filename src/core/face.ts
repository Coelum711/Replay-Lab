import type { CharacterLayerSet, CharacterFaceFit, FaceFeatureFit, FaceOrientationPreset, FaceTemplate, FaceTemplateFeatureName } from './types.js';
import { makeId } from './id.js';

export const FACE_TEMPLATE_FEATURES: FaceTemplateFeatureName[] = ['eyes', 'eyelids', 'pupils', 'brows', 'leftEye', 'rightEye', 'leftEyelid', 'rightEyelid', 'leftPupil', 'rightPupil', 'leftBrow', 'rightBrow', 'mouth'];

export const FACE_TEMPLATE_LAYER_SLOTS = [
  'eyesOpen','eyesClosed','eyelidsOpen','eyelidsClosed','pupils','brows',
  'eyeLeftOpen','eyeLeftClosed','eyeRightOpen','eyeRightClosed',
  'eyelidLeftOpen','eyelidLeftClosed','eyelidRightOpen','eyelidRightClosed',
  'pupilLeft','pupilRight','browLeft','browRight',
  'mouthClosed','mouthOpen','mouthA','mouthI','mouthU','mouthE','mouthO',
  'mouthSchwa','mouthAe','mouthUu','mouthOo','mouthW','mouthF','mouthTh','mouthM'
] as const satisfies ReadonlyArray<keyof CharacterLayerSet>;

function defaultFeatureFit(name: FaceTemplateFeatureName): FaceFeatureFit {
  const common = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0 };
  switch (name) {
    case 'brows': return { x: 0.50, y: 0.24, ...common };
    case 'leftBrow': return { x: 0.39, y: 0.24, ...common };
    case 'rightBrow': return { x: 0.61, y: 0.24, ...common };
    case 'leftEye':
    case 'leftEyelid':
    case 'leftPupil': return { x: 0.39, y: 0.31, ...common };
    case 'rightEye':
    case 'rightEyelid':
    case 'rightPupil': return { x: 0.61, y: 0.31, ...common };
    case 'mouth': return { x: 0.50, y: 0.43, ...common };
    default: return { x: 0.50, y: 0.31, ...common };
  }
}

export function defaultFaceFit(): CharacterFaceFit {
  return {
    templateId: null,
    orientation: 'front',
    perspective: 1,
    features: Object.fromEntries(FACE_TEMPLATE_FEATURES.map(name => [name, defaultFeatureFit(name)])) as Record<FaceTemplateFeatureName, FaceFeatureFit>
  };
}

export function normalizeFaceFit(input?: Partial<CharacterFaceFit> | null): CharacterFaceFit {
  const fit = defaultFaceFit();
  if (!input) return fit;
  fit.templateId = input.templateId ?? null;
  const orientation = input.orientation;
  fit.orientation = orientation === 'left-3q' || orientation === 'right-3q' || orientation === 'front' ? orientation : 'front';
  fit.perspective = Number.isFinite(input.perspective) ? Math.max(0, Math.min(1, Number(input.perspective))) : 1;
  const source = (input.features ?? {}) as Partial<Record<FaceTemplateFeatureName, Partial<FaceFeatureFit>>>;
  for (const name of FACE_TEMPLATE_FEATURES) {
    const current = source[name] ?? {};
    fit.features[name] = {
      ...fit.features[name],
      ...Object.fromEntries(Object.entries(current).map(([key, value]) => [key, Number(value)]))
    };
  }
  return fit;
}

export function createFaceTemplate(name = '脸部模板'): FaceTemplate {
  return {
    id: makeId('facetpl'),
    name,
    layers: {},
    notes: ''
  };
}

export function faceTemplateLayerSubset(source: CharacterLayerSet): CharacterLayerSet {
  const result: CharacterLayerSet = {};
  for (const key of FACE_TEMPLATE_LAYER_SLOTS) result[key] = source?.[key] ?? null;
  return result;
}

export function mergeFaceTemplateLayers(base: CharacterLayerSet | null | undefined, template: CharacterLayerSet | null | undefined): CharacterLayerSet {
  return { ...(template ?? {}), ...(base ?? {}) };
}

export function orientationLabel(value: FaceOrientationPreset): string {
  return ({ front: '正面', 'left-3q': '左 3/4', 'right-3q': '右 3/4' } as const)[value] ?? '正面';
}

export interface FacePerspectiveProjection {
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Resolve a Face Fit feature into normalized projected coordinates. Left/right
 * names are screen-space, not anatomical. At 3/4 the far side moves toward the
 * face centre and compresses; combined features keep the older whole-face shift.
 */
export function projectFaceFeature(
  name: FaceTemplateFeatureName,
  feature: FaceFeatureFit,
  orientation: FaceOrientationPreset,
  perspective = 1
): FacePerspectiveProjection {
  const turn = orientation === 'left-3q' ? -1 : orientation === 'right-3q' ? 1 : 0;
  const intensity = Math.max(0, Math.min(1, Number.isFinite(perspective) ? perspective : 1));
  const isLeft = /^left/.test(name);
  const isRight = /^right/.test(name);
  const sideFeature = isLeft || isRight;
  const farSide = turn < 0 ? isRight : turn > 0 ? isLeft : false;
  const nearSide = turn < 0 ? isLeft : turn > 0 ? isRight : false;
  let centerX = feature.x + feature.offsetX;
  const centerY = feature.y + feature.offsetY;
  let scaleX = sideFeature ? 1 : (turn === 0 ? 1 : 1 - 0.18 * intensity);
  let scaleY = 1;
  if (sideFeature && turn !== 0) {
    centerX += turn * 0.018 * intensity;
    if (farSide) {
      centerX += (0.5 - centerX) * 0.18 * intensity;
      scaleX *= 1 - 0.30 * intensity;
      scaleY *= 1 - 0.12 * intensity;
    } else if (nearSide) {
      scaleX *= 1 + 0.035 * intensity;
    }
  } else if (!sideFeature && turn !== 0) {
    centerX += turn * 0.035 * intensity;
  }
  return { centerX, centerY, scaleX, scaleY };
}

/** Inverse X projection used by the Studio drag handle. */
export function unprojectFaceFeatureX(
  name: FaceTemplateFeatureName,
  desiredProjectedX: number,
  feature: FaceFeatureFit,
  orientation: FaceOrientationPreset,
  perspective = 1
): number {
  const turn = orientation === 'left-3q' ? -1 : orientation === 'right-3q' ? 1 : 0;
  const intensity = Math.max(0, Math.min(1, Number.isFinite(perspective) ? perspective : 1));
  const isLeft = /^left/.test(name);
  const isRight = /^right/.test(name);
  const sideFeature = isLeft || isRight;
  const farSide = turn < 0 ? isRight : turn > 0 ? isLeft : false;
  let raw = desiredProjectedX;
  if (sideFeature && turn !== 0) {
    if (farSide) {
      const k = 0.18 * intensity;
      raw = (desiredProjectedX - 0.5 * k) / Math.max(0.01, 1 - k);
    }
    raw -= turn * 0.018 * intensity;
  } else if (!sideFeature && turn !== 0) {
    raw -= turn * 0.035 * intensity;
  }
  return raw - feature.offsetX;
}
