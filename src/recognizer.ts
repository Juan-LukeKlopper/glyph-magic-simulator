/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point, Stroke, GestureTemplate, RecognitionResult, ElementType } from './types';

/** Euclidean distance between two points. */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Total path length of a sequence of points. */
export function pathLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += distance(points[i - 1], points[i]);
  }
  return len;
}

/** Resamples a polyline to exactly `n` equidistant points. */
export function resample(points: Point[], n: number): Point[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const res: Point[] = [];
    for (let i = 0; i < n; i++) res.push({ x: points[0].x, y: points[0].y });
    return res;
  }

  const resampledPoints: Point[] = [points[0]];
  const totalLength = pathLength(points);
  const interval = totalLength / (n - 1);
  let accumulatedDistance = 0;

  // Work on a copy to avoid mutating inputs
  const pts = [...points];

  let i = 1;
  while (i < pts.length) {
    const d = distance(pts[i - 1], pts[i]);
    if (accumulatedDistance + d >= interval) {
      const ratio = (interval - accumulatedDistance) / d;
      const qx = pts[i - 1].x + ratio * (pts[i].x - pts[i - 1].x);
      const qy = pts[i - 1].y + ratio * (pts[i].y - pts[i - 1].y);
      const q: Point = { x: qx, y: qy };
      resampledPoints.push(q);
      pts.splice(i, 0, q); // insert q as the next point to continue measuring from it
      accumulatedDistance = 0;
    } else {
      accumulatedDistance += d;
    }
    i++;
  }

  // Ensure arrays are exactly of size N
  while (resampledPoints.length < n) {
    resampledPoints.push(pts[pts.length - 1]);
  }
  if (resampledPoints.length > n) {
    resampledPoints.length = n;
  }
  return resampledPoints;
}

/** Uniformly scales a point cloud into a 1x1 bounding box, preserving aspect ratio. */
export function scaleUniform(points: Point[]): Point[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const size = Math.max(width, height, 0.001);

  return points.map((p) => ({
    x: (p.x - minX) / size,
    y: (p.y - minY) / size,
  }));
}

/** Translates a point cloud so its centroid sits at the origin. */
export function translateToCentroid(points: Point[]): Point[] {
  if (points.length === 0) return [];
  let sumX = 0;
  let sumY = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }

  const cx = sumX / points.length;
  const cy = sumY / points.length;

  return points.map((p) => ({
    x: p.x - cx,
    y: p.y - cy,
  }));
}


// Computes bidirectional chamfer distance (nearest neighbor average).
// This is robust for hand-drawn sketches where stroke count/density/order differ.
//
// `pts2NN` is an optional precomputed per-index nearest-neighbour table of `pts2`
// (built by buildNearestNeighborTable). When provided, the second (reverse) pass is
// skipped and the table's cached value is used. The template side never changes
// across rotation trials, so its average is invariant. Cuts per-call work ~2x and
// removes the O(n*m) reverse pass from the hot path entirely.
export function chamferDistance(
  pts1: Point[],
  pts2: Point[],
  pts2NN?: Float32Array,
): number {
  if (pts1.length === 0 || pts2.length === 0) return Infinity;

  let sum1 = 0;
  for (let i = 0; i < pts1.length; i++) {
    const p1 = pts1[i];
    let minDistSq = Infinity;
    for (let j = 0; j < pts2.length; j++) {
      const dx = pts2[j].x - p1.x;
      const dy = pts2[j].y - p1.y;
      const dSq = dx * dx + dy * dy;
      if (dSq < minDistSq) {
        minDistSq = dSq;
      }
    }
    sum1 += Math.sqrt(minDistSq);
  }

  // Reverse direction: use the cached per-point minimum if available, else compute.
  let sum2 = 0;
  if (pts2NN) {
    sum2 = pts2NN.reduce((acc, d) => acc + d, 0);
  } else {
    for (let j = 0; j < pts2.length; j++) {
      const p2 = pts2[j];
      let minDistSq = Infinity;
      for (let i = 0; i < pts1.length; i++) {
        const dx = pts1[i].x - p2.x;
        const dy = pts1[i].y - p2.y;
        const dSq = dx * dx + dy * dy;
        if (dSq < minDistSq) {
          minDistSq = dSq;
        }
      }
      sum2 += Math.sqrt(minDistSq);
    }
  }

  return (sum1 / pts1.length + sum2 / pts2.length) / 2;
}

// For each point in `points`, the squared distance to its nearest neighbour in the
// same cloud, stored as sqrt'd values. Used to cache the invariant half of chamfer
// distance when one side of the comparison is a fixed template.
function buildNearestNeighborTable(points: Point[]): Float32Array {
  const n = points.length;
  const table = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let minDistSq = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = points[j].x - points[i].x;
      const dy = points[j].y - points[i].y;
      const dSq = dx * dx + dy * dy;
      if (dSq < minDistSq) {
        minDistSq = dSq;
      }
    }
    table[i] = Math.sqrt(minDistSq);
  }
  return table;
}

/**
 * Rotates a point cloud by `angleRad` radians around the origin.
 */
export function rotatePoints(points: Point[], angleRad: number): Point[] {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return points.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
}

// --- Programmatic Reference Template Builders ---

function generateLinePoints(x1: number, y1: number, x2: number, y2: number, count: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    pts.push({
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    });
  }
  return pts;
}

function generateCirclePoints(cx: number, cy: number, r: number, count: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    pts.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }
  return pts;
}

function generateBezierPoints(
  x1: number, y1: number,
  cp1x: number, cp1y: number,
  cp2x: number, cp2y: number,
  x2: number, y2: number,
  count: number
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const mt = 1 - t;
    const x = mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2;
    const y = mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2;
    pts.push({ x, y });
  }
  return pts;
}

// --- Normalization & matching constants -------------------------------------

/** Point count every template cloud is resampled to. */
const TEMPLATE_POINT_COUNT = 120;
/** Minimum points for a drawn input to be considered a gesture at all. */
const MIN_CLOUD_POINTS = 6;

/**
 * Normalizes raw input (points or strokes) into a balanced, scale/position
 * invariant point cloud: resampled, uniformly scaled, and centered.
 */
export function getNormalizedPointCloud(
  input: Point[] | Stroke[],
  targetCount: number = TEMPLATE_POINT_COUNT
): Point[] {
  let rawPointsList: Point[] = [];

  if (Array.isArray(input) && input.length > 0) {
    const isStrokesArray = 'points' in input[0];
    
    if (isStrokesArray) {
      const strokes = input as Stroke[];
      const validStrokes = strokes.filter(s => s.points && s.points.length > 0);
      
      if (validStrokes.length === 0) return [];

      let totalLen = 0;
      const lengths = validStrokes.map(s => {
        const l = pathLength(s.points);
        totalLen += l;
        return l;
      });

      if (totalLen < 1) {
        validStrokes.forEach(s => rawPointsList.push(...s.points));
      } else {
        validStrokes.forEach((s, idx) => {
          const l = lengths[idx];
          // Proportional allocation of points per stroke, min 14 points
          const count = Math.max(14, Math.round((l / totalLen) * targetCount));
          rawPointsList.push(...resample(s.points, count));
        });
      }
    } else {
      const points = input as Point[];
      rawPointsList = resample(points, targetCount);
    }
  }

  if (rawPointsList.length === 0) return [];
  return translateToCentroid(scaleUniform(rawPointsList));
}

/** A template plus its compiled matching data, derived once at cache-build time. */
interface CompiledTemplate extends GestureTemplate {
  /** Soft occupancy fingerprint of `points` over the normalized space grid. */
  gridDesc: Float32Array;
  /** Per-point nearest-neighbour distances of `points` (chamfer's invariant half). */
  nnTable: Float32Array;
}

/** Static library of programmatically generated glyph templates (circle + core vs full). */
export class GlyphTemplates {
  // Cache holds each template together with data compiled from its immutable
  // cloud (occupancy descriptor, NN table) so both are computed exactly once.
  private static cachedTemplates: CompiledTemplate[] = [];

  /** Lazily builds and caches the compiled template set, then returns it. */
  public static getTemplates(): GestureTemplate[] {
    if (this.cachedTemplates.length > 0) {
      return this.cachedTemplates;
    }

    const templates: GestureTemplate[] = [];

    // Outer framing circle generator
    const circlePoints32 = generateCirclePoints(0, 0, 100, 32);

    // 1. CIRCLE (Pure shield glyph template)
    templates.push({
      name: 'circle',
      points: this.normalizeRawCloud(generateCirclePoints(0, 0, 100, 64)),
    });

    // 2. LIGHT GLYPH (Core glyph component)
    const lightCore: Point[] = [
      ...generateCirclePoints(0, -50, 16.67, 16),
      ...generateLinePoints(-94.3, 33.3, 0, -33.3, 14),
      ...generateLinePoints(0, -33.3, 94.3, 33.3, 14),
      ...generateLinePoints(94.3, 33.3, -94.3, 33.3, 16),
      ...generateLinePoints(0, 100, 0, -33.3, 18),
      ...generateLinePoints(-15.7, -55.6, 0, -100, 12),
      ...generateLinePoints(15.7, -55.6, 0, -100, 12),
      ...generateLinePoints(-15.7, 25, 15.7, 8.3, 10),
      ...generateLinePoints(-15.7, 8.3, 15.7, -8.3, 10),
    ];
    
    // Light Core alone template
    templates.push({
      name: 'light_core',
      points: this.normalizeRawCloud(lightCore),
    });

    // Light Full (Outer framing circle + Core)
    templates.push({
      name: 'light_full',
      points: this.normalizeRawCloud([...circlePoints32, ...lightCore]),
    });

    // 3. ICE GLYPH (Core components)
    const iceCore: Point[] = [
      ...generateBezierPoints(-96.9, 25, -36.6, -8.3, 36.6, -8.3, 96.9, 25, 24),
      ...generateLinePoints(-86.7, 50, 86.7, 50, 18),
      ...generateLinePoints(-12.5, 62.5, 0, 50, 8),
      ...generateLinePoints(0, 50, 12.5, 62.5, 8),
      ...generateLinePoints(12.5, 62.5, 0, 75, 8),
      ...generateLinePoints(0, 75, -12.5, 62.5, 8),
      ...generateLinePoints(0, -100, -37.5, -50, 12),
      ...generateLinePoints(-37.5, -50, 0, 50, 14),
      ...generateLinePoints(0, 50, 37.5, -50, 14),
      ...generateLinePoints(37.5, -50, 0, -100, 12),
      ...generateLinePoints(0, -100, 0, 50, 18),
    ];

    // Ice Core template
    templates.push({
      name: 'ice_core',
      points: this.normalizeRawCloud(iceCore),
    });

    // Ice Full (Framing circle + Core)
    templates.push({
      name: 'ice_full',
      points: this.normalizeRawCloud([...circlePoints32, ...iceCore]),
    });

    // 4. PLANT GLYPH (Core components)
    const plantCore: Point[] = [
      ...generateCirclePoints(0, 50, 16.67, 16),
      ...generateCirclePoints(0, 50, 5.2, 8),
      ...generateLinePoints(0, 25, 0, -37.5, 18),
      ...generateLinePoints(0, 25, -25, 0, 12),
      ...generateLinePoints(0, 25, 25, 0, 12),
      ...generateLinePoints(0, -37.5, -37.5, -75, 14),
      ...generateLinePoints(0, -37.5, 37.5, -75, 14),
      ...generateLinePoints(-18.7, -56.3, 18.7, -56.3, 12),
      ...generateLinePoints(-37.5, -75, 37.5, -75, 14),
    ];

    // Plant Core template
    templates.push({
      name: 'plant_core',
      points: this.normalizeRawCloud(plantCore),
    });

    // Plant Full (Framing circle + Core)
    templates.push({
      name: 'plant_full',
      points: this.normalizeRawCloud([...circlePoints32, ...plantCore]),
    });

    // 5. FIRE GLYPH (Core components)
    const fireCore: Point[] = [
      ...generateCirclePoints(0, 50, 50, 24),
      ...generateCirclePoints(0, 50, 5.2, 8),
      ...generateCirclePoints(0, -30.9, 30.9, 18),
      ...generateBezierPoints(50, 50, 50, 7.3, 31.8, -33.4, 0, -61.8, 20),
      ...generateBezierPoints(0, -61.8, -31.8, -33.4, -50, 7.3, -50, 50, 20),
      ...generateBezierPoints(30.9, -30.9, 30.9, -57.3, 19.7, -82.5, 0, -100, 16),
      ...generateBezierPoints(0, -100, -19.7, -82.5, -30.9, -57.3, -30.9, -30.9, 16),
    ];

    // Fire Core template
    templates.push({
      name: 'fire_core',
      points: this.normalizeRawCloud(fireCore),
    });

    // Fire Full (Framing circle + Core)
    templates.push({
      name: 'fire_full',
      points: this.normalizeRawCloud([...circlePoints32, ...fireCore]),
    });

    this.cachedTemplates = templates.map((template) => ({
      ...template,
      gridDesc: gridDescriptor(template.points),
      nnTable: buildNearestNeighborTable(template.points),
    }));
    return this.cachedTemplates;
  }

  // Helper to scale and center a template's raw geometric segments
  private static normalizeRawCloud(pts: Point[]): Point[] {
    return translateToCentroid(scaleUniform(resample(pts, TEMPLATE_POINT_COUNT)));
  }
}

/**
 * Scoring model (hybrid)
 * ----------------------
 * A drawn cloud is scored against every template with two complementary
 * metrics, each maximized independently over the rotation grid, then fused by
 * geometric mean:
 *
 *  1. Grid occupancy similarity: soft-IoU between the coarse 28x28 ink-smear
 *     buffers of the two clouds. Captures bulk stroke layout; very tolerant of
 *     jitter, sparse sampling and stroke-order differences.
 *  2. Chamfer shape similarity: `chamferDistance` mapped to [0, 1] via
 *     CHAMFER_FULL_SCALE. Captures fine contour alignment.
 *
 * sqrt(gridSim * chamferSim) demands agreement in BOTH bulk layout and fine
 * shape: a scribble that happens to align contours fails the occupancy test
 * and vice versa, while sloppy human traces still clear both bars.
 */

/** Side length of the square occupancy grid painted from a normalized cloud. */
const GRID_SIZE = 28;
/** Ink smear radius, in grid cells, around each sampled point. */
const BRUSH_RADIUS = 2;
/** Chamfer distance that maps to similarity score 0. */
const CHAMFER_FULL_SCALE = 0.22;
/** Minimum hybrid score for a free-draw gesture to be recognized as an element. */
const RECOGNIZE_THRESHOLD = 0.45;
/**
 * Score a LONE stroke must reach to count as a glyph (see recognizeGesture:
 * single-stroke doodles only clear ordinary threshold by area-filling luck).
 */
const SINGLE_STROKE_EXCELLENT_SCORE = 0.63;
/** Rotation search grid (radians), covering ±45° tilt of the drawn glyph. */
const ROTATION_ANGLES = [-0.782, -0.523, -0.261, 0, 0.261, 0.523, 0.782];

// Paints a normalized cloud onto a GRID_SIZE² occupancy buffer: every point
// smears weighted ink over the (2·BRUSH_RADIUS+1)² cells around it with weight
// 1/(1+dx²+dy²), yielding a jitter-tolerant spatial-layout fingerprint.
function gridDescriptor(points: Point[]): Float32Array {
  const desc = new Float32Array(GRID_SIZE * GRID_SIZE);
  for (const p of points) {
    const cx = Math.round((p.x + 0.5) * (GRID_SIZE - 1));
    const cy = Math.round((p.y + 0.5) * (GRID_SIZE - 1));
    for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
      for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= GRID_SIZE || gy >= GRID_SIZE) continue;
        desc[gy * GRID_SIZE + gx] += 1 / (1 + dx * dx + dy * dy);
      }
    }
  }
  return desc;
}

// Soft (weighted) intersection-over-union of two occupancy buffers.
function gridSimilarity(a: Float32Array, b: Float32Array): number {
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += Math.min(a[i], b[i]);
    union += Math.max(a[i], b[i]);
  }
  return union === 0 ? 0 : intersection / union;
}

// Hybrid similarity of the drawn cloud against one compiled template: scans the
// rotation grid for the best occupancy agreement and the best chamfer alignment
// (independently; they need not occur at the same tilt) and returns
// sqrt(bestGridSim * bestChamferSim).
function matchTemplate(normalizedDrawn: Point[], template: CompiledTemplate): number {
  let bestGridSim = 0;
  let bestChamfer = Infinity;

  for (const angle of ROTATION_ANGLES) {
    const rotated = angle === 0 ? normalizedDrawn : rotatePoints(normalizedDrawn, angle);
    const gridSim = gridSimilarity(gridDescriptor(rotated), template.gridDesc);
    const chamfer = chamferDistance(rotated, template.points, template.nnTable);
    if (gridSim > bestGridSim) bestGridSim = gridSim;
    if (chamfer < bestChamfer) bestChamfer = chamfer;
  }

  const chamferSim = Math.max(0, 1 - bestChamfer / CHAMFER_FULL_SCALE);
  return Math.sqrt(bestGridSim * chamferSim);
}

export interface RecognizeOutcome {
  name: string;
  score: number;
  matchedTemplate?: string;
  scores?: Record<string, number>;
}

// Core matcher shared by recognizeGesture (full template pool) and
// scoreAgainstTarget (single-element pool). Resolves the winning element behind
// RECOGNIZE_THRESHOLD and collects per-element max scores for the UI spectrograph.
function classify(
  normalizedDrawn: Point[],
  templates: CompiledTemplate[] = GlyphTemplates.getTemplates() as CompiledTemplate[],
): RecognizeOutcome {
  let bestScore = -Infinity;
  let bestTemplateName = 'unknown';

  const elementMaxScores: Record<string, number> = {
    light: 0,
    ice: 0,
    plant: 0,
    fire: 0,
    circle: 0,
  };

  for (const template of templates) {
    const score = matchTemplate(normalizedDrawn, template);
    const el = elementOfTemplate(template.name);

    if (score > bestScore) {
      bestScore = score;
      bestTemplateName = template.name;
    }
    if (el && score > elementMaxScores[el]) {
      elementMaxScores[el] = score;
    }
  }

  return {
    name: bestScore >= RECOGNIZE_THRESHOLD ? elementOfTemplate(bestTemplateName) ?? 'unknown' : 'unknown',
    score: Math.max(0, bestScore),
    matchedTemplate: bestTemplateName,
    scores: elementMaxScores,
  };
}

function elementOfTemplate(name: string): ElementType | null {
  if (name.startsWith('light_')) return 'light';
  if (name.startsWith('ice_')) return 'ice';
  if (name.startsWith('plant_')) return 'plant';
  if (name.startsWith('fire_')) return 'fire';
  if (name === 'circle') return 'circle';
  return null;
}

// Main classifier function.
//
// Sandbox scribble defense: a single-stroke dense doodle can reach ~0.60 hybrid score by
// filling the same area as a glyph (soft-IoU rewards interior mass). Measured on synthetic
// corpora: legit multi-stroke free-draws score 0.70+, single-stroke scribbles ≤0.62. So a
// lone stroke must be EXCELLENT to count; multiple strokes (ring + triangle + stem, as a
// real glyph drawing looks) pass at the ordinary threshold.
export function recognizeGesture(drawnInput: Point[] | Stroke[]): RecognitionResult {
  const normalizedDrawn = getNormalizedPointCloud(drawnInput, TEMPLATE_POINT_COUNT);
  if (normalizedDrawn.length < MIN_CLOUD_POINTS) {
    return { name: 'unknown', score: 0, scores: { light: 0, ice: 0, plant: 0, fire: 0, circle: 0 } };
  }

  const result = classify(normalizedDrawn);

  const strokeCount = Array.isArray(drawnInput) && drawnInput.length > 0 && 'points' in drawnInput[0]
    ? (drawnInput as Stroke[]).filter((s) => s.points.length > 2).length
    : 1;
  if (strokeCount < 2 && result.score < SINGLE_STROKE_EXCELLENT_SCORE) {
    return { ...result, name: 'unknown' };
  }

  return result;
}

/**
 * Honest "how close is my drawing to THE spell I am tracing" metric.
 * Unlike recognizeGesture (which finds the best-matching class), this compares only
 * against the target's templates and returns raw 0..100% structural similarity with
 * no thresholding. Used for live HUD feedback and final accuracy grading.
 */
export function scoreAgainstTarget(drawnInput: Point[] | Stroke[], targetElement: ElementType): number {
  if (!targetElement || targetElement === 'unknown') return 0;
  const normalizedDrawn = getNormalizedPointCloud(drawnInput, TEMPLATE_POINT_COUNT);
  if (normalizedDrawn.length < MIN_CLOUD_POINTS) return 0;

  const prefix = targetElement + '_';
  const candidates = (GlyphTemplates.getTemplates() as CompiledTemplate[]).filter(
    (template) => template.name === 'circle' || template.name.startsWith(prefix)
  );
  // Raw 0..1 similarity, deliberately without a recognition threshold on this path.
  return classify(normalizedDrawn, candidates).score;
}
