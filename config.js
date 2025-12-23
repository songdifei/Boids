// ===== Configuration =====
// Use 5×5 bitmap glyphs for the font
const BASE_SIZE = 5;
const CANVAS_SIZE = 600;

// Glyphs are provided in `glyphs.js`

// Boids parameters
const FOOD_WEIGHT_SCALE = 4.0;
const PREDATOR_BASE_WEIGHT = 10.0;
const PREDATOR_WEIGHT_SCALE = 50;
const PANIC_THRESHOLD = 0.8;
const SEPARATION_NEIGHBOR = 3;
const ALIGNMENT_NEIGHBOR = 3;
const COHESION_NEIGHBOR = 6;
const FOOD_SENSE_RADIUS = 8;
const FOOD_HUNT_RADIUS = 2;
const FOOD_ATTRACTION_K = 0.1;
const DAMPING = 0.85;
// Slow down health decay (reduce by ~4x)
const HEALTH_DECAY_MIN = 0.0002;
const HEALTH_DECAY_MAX = 0.005;

// Wall behavior: 'repel' (continuous repulsion) or 'bounce' (invert velocity on collision)
// Default to 'bounce' as requested.
const DEFAULT_WALL_BEHAVIOR = 'bounce';
// Wall repulsion strength (tweakable)
const WALL_REPEL_WEIGHT = 0.8;

// Predator radius calculation
const PREDATOR_RADIUS_MIN_GRID = 5;
const PREDATOR_RADIUS_MAX_GRID = 100;
const PREDATOR_RADIUS_MIN = 2;
const PREDATOR_RADIUS_MAX = 5;
const PREDATOR_FORCE_THRESHOLD = 0.01;

// Homing / return-to-home behavior
// Weight applied when birds try to return home (tunable)
const HOME_WEIGHT = 0.06;
// How often the flock toggles between roaming and homing (ms)
const HOMING_CYCLE_MS = 10000;
// How quickly the homing force ramps from 0->1 when homing starts (ms)
const HOMING_RAMP_MS = 2000;
// During homing, reduce random noise by this factor (0..1)
const HOMING_NOISE_REDUCTION = 0.2;
// During homing, apply stronger damping to reduce overshoot
const HOMING_DAMPING = 0.6;
