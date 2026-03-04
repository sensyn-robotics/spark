import { PlyWriter, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GUI } from "lil-gui";
import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { getAssetFileURL } from "/examples/js/get-asset-url.js";

// ============================================================================
// Scene Setup
// ============================================================================

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  100000,
);
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Camera controls - TrackballControls for infinite rotation in all directions
const controls = new TrackballControls(camera, renderer.domElement);
controls.rotateSpeed = 1.5;
controls.zoomSpeed = 0.8;
controls.panSpeed = 0.8;
controls.dynamicDampingFactor = 0.1;
controls.target.set(0, 0, 0);
camera.position.set(0, 2, 5);
camera.lookAt(0, 0, 0);

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  controls.handleResize();
}

// ============================================================================
// State Management
// ============================================================================

const state = {
  // Point 1
  point1: null,
  ray1Origin: null,
  ray1Direction: null,
  marker1: null,
  rayLine1: null,

  // Point 2
  point2: null,
  ray2Origin: null,
  ray2Direction: null,
  marker2: null,
  rayLine2: null,

  // Measurement
  distanceLine: null,
  currentDistance: 0,

  // Interaction
  mode: "select1", // 'select1' | 'select2' | 'complete'
  dragging: null, // 'point1' | 'point2' | null

  // Coordinate axes
  axesHelper: null,
  axesVisible: false,
};

let splatMesh = null;
const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.1;

// ============================================================================
// Visual Elements
// ============================================================================

let rayLineLength = 100; // Will be updated based on model size
const MARKER_SCREEN_SIZE = 0.03; // Constant screen-space size (percentage of screen height)
const POINT1_COLOR = 0x00ff00; // Green
const POINT2_COLOR = 0x0088ff; // Blue
const DISTANCE_LINE_COLOR = 0xffff00; // Yellow

function createMarker(color) {
  // Create a group to hold both the sphere and its outline
  // Use unit size - will be scaled dynamically based on camera distance
  const group = new THREE.Group();

  // Inner sphere (unit radius = 1)
  const geometry = new THREE.SphereGeometry(1, 16, 16);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1000;
  group.add(mesh);

  // Outer ring/outline for better visibility
  const ringGeometry = new THREE.RingGeometry(1.2, 1.8, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.renderOrder = 999;
  group.add(ring);

  // Make ring always face camera (billboard)
  group.userData.ring = ring;

  return group;
}

function createRayLine(origin, direction, color) {
  const farPoint = origin
    .clone()
    .add(direction.clone().multiplyScalar(rayLineLength));
  const geometry = new THREE.BufferGeometry().setFromPoints([origin, farPoint]);
  const material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.6,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 998;
  return line;
}

function updateRayLine(line, origin, direction) {
  const positions = line.geometry.attributes.position.array;
  const farPoint = origin
    .clone()
    .add(direction.clone().multiplyScalar(rayLineLength));
  positions[0] = origin.x;
  positions[1] = origin.y;
  positions[2] = origin.z;
  positions[3] = farPoint.x;
  positions[4] = farPoint.y;
  positions[5] = farPoint.z;
  line.geometry.attributes.position.needsUpdate = true;
}

function createDistanceLine() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: DISTANCE_LINE_COLOR,
    depthTest: false,
    linewidth: 2,
  });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 997;
  return line;
}

function updateDistanceLine() {
  if (!state.distanceLine || !state.point1 || !state.point2) return;

  const positions = state.distanceLine.geometry.attributes.position.array;
  positions[0] = state.point1.x;
  positions[1] = state.point1.y;
  positions[2] = state.point1.z;
  positions[3] = state.point2.x;
  positions[4] = state.point2.y;
  positions[5] = state.point2.z;
  state.distanceLine.geometry.attributes.position.needsUpdate = true;
}

// ============================================================================
// Mouse / Touch Utilities
// ============================================================================

function getMouseNDC(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function getHitPoint(ndc) {
  if (!splatMesh) return null;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(splatMesh, false);
  if (hits && hits.length > 0) {
    return hits[0].point.clone();
  }
  return null;
}

// ============================================================================
// Point Selection
// ============================================================================

function selectPoint1(hitPoint) {
  state.point1 = hitPoint.clone();
  state.ray1Origin = camera.position.clone();
  state.ray1Direction = raycaster.ray.direction.clone();

  // Create marker
  if (state.marker1) scene.remove(state.marker1);
  state.marker1 = createMarker(POINT1_COLOR);
  state.marker1.position.copy(hitPoint);
  scene.add(state.marker1);

  // Create ray line
  if (state.rayLine1) scene.remove(state.rayLine1);
  state.rayLine1 = createRayLine(
    state.ray1Origin,
    state.ray1Direction,
    POINT1_COLOR,
  );
  scene.add(state.rayLine1);

  state.mode = "select2";
  document.getElementById("distance-display").style.display = "block";
  updateCoordinateDisplay();
  updateInstructions("Left-click to select second measurement point");
}

function selectPoint2(hitPoint) {
  state.point2 = hitPoint.clone();
  state.ray2Origin = camera.position.clone();
  state.ray2Direction = raycaster.ray.direction.clone();

  // Create marker
  if (state.marker2) scene.remove(state.marker2);
  state.marker2 = createMarker(POINT2_COLOR);
  state.marker2.position.copy(hitPoint);
  scene.add(state.marker2);

  // Create ray line
  if (state.rayLine2) scene.remove(state.rayLine2);
  state.rayLine2 = createRayLine(
    state.ray2Origin,
    state.ray2Direction,
    POINT2_COLOR,
  );
  scene.add(state.rayLine2);

  // Create distance line
  if (!state.distanceLine) {
    state.distanceLine = createDistanceLine();
    scene.add(state.distanceLine);
  }
  updateDistanceLine();

  state.mode = "complete";
  calculateDistance();
  updateInstructions(
    "Drag markers to adjust | Right double-click to set origin",
  );
}

// ============================================================================
// Drag Along Ray
// ============================================================================

function closestPointOnRay(viewRay, rayOrigin, rayDir, currentPoint) {
  // Find the point on the selection ray closest to the view ray
  const w0 = rayOrigin.clone().sub(viewRay.origin);
  const a = rayDir.dot(rayDir);
  const b = rayDir.dot(viewRay.direction);
  const c = viewRay.direction.dot(viewRay.direction);
  const d = rayDir.dot(w0);
  const e = viewRay.direction.dot(w0);

  const denom = a * c - b * b;
  if (Math.abs(denom) < 0.0001) {
    // Rays are nearly parallel - keep current point
    return currentPoint.clone();
  }

  const t = (b * e - c * d) / denom;

  // Very minimal clamping - just prevent going behind ray origin or too far
  const minT = 0.01; // Almost at ray origin
  const maxT = rayLineLength * 2; // Allow movement beyond visible ray line
  const clampedT = Math.max(minT, Math.min(maxT, t));
  return rayOrigin.clone().add(rayDir.clone().multiplyScalar(clampedT));
}

function checkMarkerHit(ndc) {
  raycaster.setFromCamera(ndc, camera);

  const objects = [];
  if (state.marker1) objects.push(state.marker1);
  if (state.marker2) objects.push(state.marker2);

  if (objects.length === 0) return null;

  // Use recursive=true to hit children (sphere and ring inside group)
  const hits = raycaster.intersectObjects(objects, true);
  if (hits.length > 0) {
    // Check if the hit object or its parent is marker1 or marker2
    let hitObj = hits[0].object;
    while (hitObj) {
      if (hitObj === state.marker1) return "point1";
      if (hitObj === state.marker2) return "point2";
      hitObj = hitObj.parent;
    }
  }
  return null;
}

// ============================================================================
// Distance Calculation
// ============================================================================

function calculateDistance() {
  if (!state.point1 || !state.point2) {
    state.currentDistance = 0;
    return;
  }

  state.currentDistance = state.point1.distanceTo(state.point2);
  updateDistanceDisplay(state.currentDistance);
  guiParams.measuredDistance = state.currentDistance.toFixed(4);
}

function formatCoord(point, label) {
  return `${label}: (${point.x.toFixed(4)}, ${point.y.toFixed(4)}, ${point.z.toFixed(4)})`;
}

function updateCoordinateDisplay() {
  const el1 = document.getElementById("point1-coords");
  const el2 = document.getElementById("point2-coords");
  el1.textContent = state.point1 ? formatCoord(state.point1, "P1") : "";
  el2.textContent = state.point2 ? formatCoord(state.point2, "P2") : "";
}

function updateDistanceDisplay(distance) {
  const display = document.getElementById("distance-display");
  const value = document.getElementById("distance-value");
  display.style.display = "block";
  value.textContent = distance.toFixed(4);
  updateCoordinateDisplay();
}

// ============================================================================
// Rescaling
// ============================================================================

function rescaleModel(newDistance) {
  if (!splatMesh || state.currentDistance <= 0) {
    console.warn("Cannot rescale: no model or zero distance");
    return;
  }

  const scaleFactor = newDistance / state.currentDistance;

  // Scale all splat centers and scales
  splatMesh.packedSplats.forEachSplat(
    (i, center, scales, quat, opacity, color) => {
      center.multiplyScalar(scaleFactor);
      scales.multiplyScalar(scaleFactor);
      splatMesh.packedSplats.setSplat(i, center, scales, quat, opacity, color);
    },
  );

  splatMesh.packedSplats.needsUpdate = true;

  // Update points and markers
  if (state.point1) {
    state.point1.multiplyScalar(scaleFactor);
    state.marker1.position.copy(state.point1);
    state.ray1Origin.multiplyScalar(scaleFactor);
    updateRayLine(state.rayLine1, state.ray1Origin, state.ray1Direction);
  }

  if (state.point2) {
    state.point2.multiplyScalar(scaleFactor);
    state.marker2.position.copy(state.point2);
    state.ray2Origin.multiplyScalar(scaleFactor);
    updateRayLine(state.rayLine2, state.ray2Origin, state.ray2Direction);
  }

  updateDistanceLine();

  // Scale camera position and controls target
  camera.position.multiplyScalar(scaleFactor);
  controls.target.multiplyScalar(scaleFactor);
  state.currentDistance = newDistance;
  updateDistanceDisplay(newDistance);
  guiParams.measuredDistance = newDistance.toFixed(4);
}

// ============================================================================
// Coordinate Origin Transform
// ============================================================================

function transformOriginTo(newOrigin) {
  if (!splatMesh) return;

  // Calculate translation: move newOrigin to (0,0,0)
  const translation = newOrigin.clone().negate();

  // Transform all splat centers
  splatMesh.packedSplats.forEachSplat(
    (i, center, scales, quat, opacity, color) => {
      center.add(translation);
      splatMesh.packedSplats.setSplat(i, center, scales, quat, opacity, color);
    },
  );
  splatMesh.packedSplats.needsUpdate = true;

  // Axes helper stays at (0,0,0) to mark the new origin
  // No need to move it - it already represents world origin

  // Reset measurements (user preference)
  resetSelection();

  // Transform camera and controls target to maintain view
  camera.position.add(translation);
  controls.target.add(translation);
  controls.update();

  updateInstructions(
    "Origin set! Left-click to measure | Right double-click for new origin",
  );
}

// ============================================================================
// Reset
// ============================================================================

function disposeObject(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (const m of child.material) {
          m.dispose();
        }
      } else {
        child.material.dispose();
      }
    }
  });
}

function resetSelection() {
  // Remove and dispose visual elements
  disposeObject(state.marker1);
  state.marker1 = null;
  disposeObject(state.marker2);
  state.marker2 = null;
  disposeObject(state.rayLine1);
  state.rayLine1 = null;
  disposeObject(state.rayLine2);
  state.rayLine2 = null;
  disposeObject(state.distanceLine);
  state.distanceLine = null;

  // Reset state
  state.point1 = null;
  state.point2 = null;
  state.ray1Origin = null;
  state.ray1Direction = null;
  state.ray2Origin = null;
  state.ray2Direction = null;
  state.currentDistance = 0;
  state.mode = "select1";
  state.dragging = null;

  // Update UI
  document.getElementById("distance-display").style.display = "none";
  guiParams.measuredDistance = "0.0000";
  updateInstructions(
    "Left-click to measure distance | Right double-click to set origin",
  );
}

// ============================================================================
// PLY Export
// ============================================================================

function exportPly() {
  if (!splatMesh) {
    console.warn("No model to export");
    return;
  }

  const writer = new PlyWriter(splatMesh.packedSplats);
  writer.downloadAs("rescaled_model.ply");
}

// ============================================================================
// UI Updates
// ============================================================================

function updateInstructions(text) {
  document.getElementById("instructions").textContent = text;
}

// ============================================================================
// Event Handlers
// ============================================================================

let pointerDownPos = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  // Clear any stale dragging state
  if (state.dragging) {
    state.dragging = null;
    controls.enabled = true;
  }

  pointerDownPos = { x: event.clientX, y: event.clientY };

  const ndc = getMouseNDC(event);

  // Check if clicking on a marker to start dragging
  const markerHit = checkMarkerHit(ndc);
  if (markerHit) {
    state.dragging = markerHit;
    controls.enabled = false;
    return;
  }
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;

  const ndc = getMouseNDC(event);
  raycaster.setFromCamera(ndc, camera);

  let newPoint;
  if (state.dragging === "point1") {
    newPoint = closestPointOnRay(
      raycaster.ray,
      state.ray1Origin,
      state.ray1Direction,
      state.point1,
    );
    state.point1.copy(newPoint);
    state.marker1.position.copy(newPoint);
  } else if (state.dragging === "point2") {
    newPoint = closestPointOnRay(
      raycaster.ray,
      state.ray2Origin,
      state.ray2Direction,
      state.point2,
    );
    state.point2.copy(newPoint);
    state.marker2.position.copy(newPoint);
  }

  updateDistanceLine();
  calculateDistance();
  updateCoordinateDisplay();
});

renderer.domElement.addEventListener("pointerup", (event) => {
  // Always restore controls — prevents stuck state
  const wasDragging = state.dragging;
  state.dragging = null;
  controls.enabled = true;

  if (wasDragging) return;

  // Only handle left clicks for measurement points
  if (event.button !== 0) return;

  // Check if it was a click (not a drag)
  if (pointerDownPos) {
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      pointerDownPos = null;
      return; // Was a drag, not a click
    }
  }

  if (!splatMesh) return;

  const ndc = getMouseNDC(event);
  const hitPoint = getHitPoint(ndc);

  if (!hitPoint) return;

  if (state.mode === "select1") {
    selectPoint1(hitPoint);
  } else if (state.mode === "select2") {
    selectPoint2(hitPoint);
  }

  pointerDownPos = null;
});

// Failsafe: clear dragging state if pointer leaves or is cancelled
for (const eventName of ["pointercancel", "pointerleave"]) {
  renderer.domElement.addEventListener(eventName, () => {
    if (state.dragging) {
      state.dragging = null;
      controls.enabled = true;
    }
  });
}

// Right double-click detection using manual timing
let lastRightClickTime = 0;
let lastRightClickPos = null;
const RIGHT_DOUBLE_CLICK_DELAY = 300; // milliseconds

// Track right mouse down position to detect drags
let rightPointerDownPos = null;

renderer.domElement.addEventListener(
  "mousedown",
  (event) => {
    if (event.button !== 2) return; // Only right button
    rightPointerDownPos = { x: event.clientX, y: event.clientY };
  },
  { capture: true },
);

renderer.domElement.addEventListener(
  "mouseup",
  (event) => {
    if (event.button !== 2) return; // Only right button

    // Check if it was a click (not a drag)
    if (rightPointerDownPos) {
      const dx = event.clientX - rightPointerDownPos.x;
      const dy = event.clientY - rightPointerDownPos.y;
      const dragDistance = Math.sqrt(dx * dx + dy * dy);
      if (dragDistance > 5) {
        rightPointerDownPos = null;
        return; // Was a drag, not a click
      }
    }

    const now = Date.now();
    const currentPos = { x: event.clientX, y: event.clientY };

    // Check if this is a double-click (same position, within time limit)
    if (lastRightClickPos) {
      const dx = currentPos.x - lastRightClickPos.x;
      const dy = currentPos.y - lastRightClickPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const timeSinceLastClick = now - lastRightClickTime;

      if (timeSinceLastClick < RIGHT_DOUBLE_CLICK_DELAY && distance < 10) {
        // Right double-click detected!
        event.preventDefault();
        event.stopPropagation();

        if (!splatMesh) {
          console.warn("No model loaded");
          return;
        }

        const ndc = getMouseNDC(event);
        const hitPoint = getHitPoint(ndc);

        if (!hitPoint) {
          lastRightClickTime = 0;
          lastRightClickPos = null;
          rightPointerDownPos = null;
          return;
        }

        transformOriginTo(hitPoint);
        lastRightClickTime = 0;
        lastRightClickPos = null;
        rightPointerDownPos = null;
        return;
      }
    }

    lastRightClickTime = now;
    lastRightClickPos = currentPos;
    rightPointerDownPos = null;
  },
  { capture: true },
);

// Prevent context menu on right-click
renderer.domElement.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Drag and drop handlers
const onDragover = (e) => {
  e.preventDefault();
  // Add visual feedback
  renderer.domElement.style.outline = "3px solid #00ff00";
};

const onDragLeave = (e) => {
  e.preventDefault();
  if (e.target !== renderer.domElement) return;
  renderer.domElement.style.outline = "none";
};

const onDrop = (e) => {
  e.preventDefault();
  renderer.domElement.style.outline = "none";

  const files = e.dataTransfer.files;
  if (files.length > 0) {
    const file = files[0];
    const validExtensions = [".ply", ".spz", ".splat"];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
    if (!validExtensions.includes(ext)) {
      console.warn(
        `Unsupported file type: ${ext}. Expected: ${validExtensions.join(", ")}`,
      );
      return;
    }
    loadSplatFile(file);
  } else {
    console.warn("No files dropped");
  }
};

renderer.domElement.addEventListener("dragover", onDragover);
renderer.domElement.addEventListener("dragleave", onDragLeave);
renderer.domElement.addEventListener("drop", onDrop);

// ============================================================================
// GUI
// ============================================================================

const gui = new GUI();
const guiParams = {
  measuredDistance: "0.0000",
  newDistance: 1.0,
  loadPlyFile: () => {
    // Trigger file input click
    document.getElementById("file-input").click();
  },
  showAxes: false,
  axesLength: 1,
  reset: resetSelection,
  rescale: () => rescaleModel(guiParams.newDistance),
  exportPly: exportPly,
};

// Add load button at the top
gui.add(guiParams, "loadPlyFile").name("Load PLY File");
gui
  .add(guiParams, "showAxes")
  .name("Show Axes")
  .onChange((val) => {
    state.axesVisible = val;
    if (val) {
      createOrUpdateAxes();
    } else if (state.axesHelper) {
      state.axesHelper.visible = false;
    }
  });
gui
  .add(guiParams, "axesLength", 0.01)
  .name("Axes Length [m]")
  .onChange(() => {
    if (state.axesVisible) createOrUpdateAxes();
  });

// Measurement controls
gui
  .add(guiParams, "measuredDistance")
  .name("Measured Distance")
  .listen()
  .disable();
gui.add(guiParams, "newDistance").name("New Distance");
gui.add(guiParams, "rescale").name("Apply Rescale");
gui.add(guiParams, "reset").name("Reset Points");
gui.add(guiParams, "exportPly").name("Export PLY");

// ============================================================================
// File Loading
// ============================================================================

async function loadSplatFile(urlOrFile) {
  // Remove existing splat mesh
  if (splatMesh) {
    scene.remove(splatMesh);
    splatMesh = null;
  }

  resetSelection();
  updateInstructions("Loading model...");

  try {
    if (typeof urlOrFile === "string") {
      // Load from URL
      console.log("Loading from URL:", urlOrFile);
      splatMesh = new SplatMesh({ url: urlOrFile });
    } else {
      // Load from File object
      console.log("Loading from file:", urlOrFile.name);
      const arrayBuffer = await urlOrFile.arrayBuffer();
      console.log("File size:", arrayBuffer.byteLength, "bytes");
      splatMesh = new SplatMesh({ fileBytes: new Uint8Array(arrayBuffer) });
    }

    // No fixed rotation applied - users can rotate freely with OrbitControls
    scene.add(splatMesh);

    await splatMesh.initialized;
    console.log(`Loaded ${splatMesh.packedSplats.numSplats} splats`);

    // Auto-center camera on the model
    centerCameraOnModel();

    // Update axes if visible
    if (state.axesVisible) createOrUpdateAxes();

    updateInstructions(
      "Left-click to measure distance | Right double-click to set origin",
    );
  } catch (error) {
    console.error("Error loading splat:", error);
    updateInstructions("Error loading model. Check console for details.");
  }
}

function centerCameraOnModel() {
  if (!splatMesh) {
    console.warn("centerCameraOnModel: no splatMesh");
    return;
  }

  try {
    // Use built-in getBoundingBox method
    const bbox = splatMesh.getBoundingBox(true);
    console.log("Bounding box:", bbox);

    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    console.log(
      "Center:",
      center.x.toFixed(2),
      center.y.toFixed(2),
      center.z.toFixed(2),
    );
    console.log(
      "Size:",
      size.x.toFixed(2),
      size.y.toFixed(2),
      size.z.toFixed(2),
    );
    console.log("Max dimension:", maxDim.toFixed(2));

    if (maxDim === 0 || !Number.isFinite(maxDim)) {
      console.warn("Invalid bounding box size");
      return;
    }

    // Update ray line length based on model scale
    rayLineLength = maxDim * 5; // 5x model size
    console.log("Ray line length:", rayLineLength.toFixed(2));

    // Position camera to see the entire model
    const fov = camera.fov * (Math.PI / 180);
    const cameraDistance = (maxDim / (2 * Math.tan(fov / 2))) * 1.5;

    camera.position.set(center.x, center.y, center.z + cameraDistance);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();

    // Update raycaster threshold based on model size
    raycaster.params.Points.threshold = maxDim * 0.005;

    console.log(
      "Camera position:",
      camera.position.x.toFixed(2),
      camera.position.y.toFixed(2),
      camera.position.z.toFixed(2),
    );
  } catch (error) {
    console.error("Error computing bounding box:", error);
  }
}

function createOrUpdateAxes() {
  // Remove existing axes
  if (state.axesHelper) {
    disposeObject(state.axesHelper);
  }

  state.axesHelper = new THREE.AxesHelper(guiParams.axesLength);
  state.axesHelper.visible = state.axesVisible;
  scene.add(state.axesHelper);
}

// File input handler
document
  .getElementById("file-input")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file) {
      await loadSplatFile(file);
    }
  });

// Load default asset
async function loadDefaultAsset() {
  try {
    const url = await getAssetFileURL("penguin.spz");
    if (url) {
      await loadSplatFile(url);
    }
  } catch (error) {
    console.error("Error loading default asset:", error);
  }
}

loadDefaultAsset();

// ============================================================================
// Render Loop
// ============================================================================

function updateMarkerScale(marker) {
  if (!marker) return;

  // Calculate distance from camera to marker
  const distance = camera.position.distanceTo(marker.position);

  // Calculate scale to maintain constant screen size
  // Based on FOV and desired screen percentage
  const fov = camera.fov * (Math.PI / 180);
  const scale = distance * Math.tan(fov / 2) * MARKER_SCREEN_SIZE;

  marker.scale.setScalar(scale);

  // Billboard: make ring face camera
  if (marker.userData.ring) {
    marker.userData.ring.lookAt(camera.position);
  }
}

renderer.setAnimationLoop(() => {
  controls.update();

  // Update marker scales to maintain constant screen size
  updateMarkerScale(state.marker1);
  updateMarkerScale(state.marker2);

  renderer.render(scene, camera);
});
