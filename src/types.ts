/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** A single 2D point in canvas space. */
export interface Point {
  x: number;
  y: number;
  /** Optional capture timestamp (ms since epoch), used for speed-based stroke width. */
  t?: number;
}

/** A continuous stroke drawn by the user between pointer down and pointer up. */
export interface Stroke {
  id: string;
  points: Point[];
  color?: string;
  width?: number;
}

/** A registered gesture template for the point-cloud recognizer. */
export interface GestureTemplate {
  name: string;
  points: Point[];
}

/** Primal elemental glyph types the recognizer can classify. */
export type ElementType = 'light' | 'ice' | 'plant' | 'fire' | 'circle' | 'unknown';

/** Result of classifying a drawn gesture against the template library. */
export interface RecognitionResult {
  name: string;
  score: number;
  matchedTemplate?: string;
  /** Per-element best scores, used by the UI resonance spectrograph. */
  scores?: Record<string, number>;
}

/** A spell in the grimoire: a primal glyph or a combinatory array of glyphs. */
export interface Spell {
  id: string;
  name: string;
  type: 'primitive' | 'combinatory';
  primaryElement: ElementType;
  description: string;
  lore: string;
  discovery: string;
  difficulty: 'Novice' | 'Apprentice' | 'Adept' | 'Master' | 'Titan-Level';
  visualDescription: string;
  /** Glyph ingredients for combinatory spells. */
  recipe?: {
    elements: ElementType[];
    layout: string;
  };
  /** Drawing outline or programmatic shape steps. */
  svgPath?: string;
  color: string;
  shadowColor: string;
}

/** A single visual effect particle emitted by a spell. */
export interface MagicParticle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  type:
    | 'flame'
    | 'smoke'
    | 'spark'
    | 'sparkle'
    | 'ice_crack'
    | 'frost'
    | 'leaf'
    | 'flower'
    | 'mist'
    | 'gravity_bubble'
    | 'portal_dust';
  /**
   * Per-effect simulation state. The simulation loop stores effect-specific
   * fields here (joints, velocity, isArm, isVortex, etc.). The value type is
   * `any` because the bag is heterogeneous and hot-path code performs math on
   * numeric fields without narrowing; keeping the key space dynamic avoids
   * unsafe casts at every call site.
   */
  customData?: Record<string, any>;
}

/** A persistent simulation body spawned by a spell cast. */
export interface AmbientEntity {
  id: string;
  type: 'light_sphere' | 'ice_pillar' | 'plant_vine' | 'fireball' | 'portal';
  x: number;
  y: number;
  size: number;
  vx?: number;
  vy?: number;
  life?: number;
  maxLife?: number;
  color: string;
  angle?: number;
  /**
   * Per-entity simulation state (growth height, drag joints, stone flag, etc.).
   * Same pragmatic bag type as MagicParticle.customData.
   */
  customData?: Record<string, any>;
}

/** Config for a single synthesized sound. */
export interface SoundTrack {
  name: string;
  frequency: number;
  type: OscillatorType;
  duration: number;
}
