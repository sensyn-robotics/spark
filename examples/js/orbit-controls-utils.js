/**
 * Utility functions for OrbitControls configuration
 */

/**
 * Configures OrbitControls for infinite rotation without angle limits.
 *
 * @param {OrbitControls} controls - The OrbitControls instance to configure
 * @returns {OrbitControls} The configured controls instance
 *
 * @example
 * import { setupInfiniteRotation } from './orbit-controls-utils.js';
 *
 * const controls = new OrbitControls(camera, renderer.domElement);
 * setupInfiniteRotation(controls);
 */
export function setupInfiniteRotation(controls) {
  // Infinite horizontal rotation (azimuth) — already the default, but be explicit
  controls.minAzimuthAngle = Number.NEGATIVE_INFINITY;
  controls.maxAzimuthAngle = Number.POSITIVE_INFINITY;

  // Full vertical range (polar angle must stay within [0, PI] for spherical coords)
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;

  return controls;
}
