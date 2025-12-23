// ===== Bird Class =====
class Bird {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.health = 1.0;
        // initial home position (each bird remembers where it started)
        this.homeX = x;
        this.homeY = y;
        // per-bird pixel offset (applied when drawing). Set by initBirds or slider.
        this.offsetX = 0;
        this.offsetY = 0;
        // per-bird random shape (1-8 for SVG Asset 1-8)
        this.shapeType = Math.floor(Math.random() * 8) + 1; // Random shape from 1-8
        // last movement heading (used for orientation when velocity is tiny)
        this.hx = 0;
        this.hy = -1;
        // throttle chirps per bird
        this.lastChirpTime = 0;
    }

    // Helper method to get actual grid dimensions based on word and resolution
    getGridDimensions(gameState) {
        const gridWidth = gameState.renderGridWidth || gameState.gridSize || 10;
        const gridHeight = gameState.renderGridHeight || gameState.gridSize || 10;
        return { gridWidth, gridHeight };
    }

    tryPush(dx, dy, occupiedAlive, gameState, depth, birdsArr) {
        // Attempt to push this bird in direction (dx,dy) by one cell.
        // If target cell is free, move here. If occupied, recursively push.
        depth = depth || 0;
        if (depth > 3) return false; // avoid deep recursion

        const G = gameState.effectiveGrid || gameState.gridSize;
        const targetX = this.x + dx;
        const targetY = this.y + dy;

        if (targetX < 0 || targetX >= G || targetY < 0 || targetY >= G) return false;

        const targetKey = targetX + "," + targetY;

        if (!occupiedAlive.has(targetKey)) {
            // free: move this bird there
            const oldKey = this.x + "," + this.y;
            occupiedAlive.delete(oldKey);
            this.x = targetX;
            this.y = targetY;
            occupiedAlive.add(targetKey);
            return true;
        }

        // occupied: find occupant bird object using provided birds array if available
        let occ = null;
        const searchArray = Array.isArray(birdsArr) ? birdsArr : (typeof globalThis !== 'undefined' && Array.isArray(globalThis.birds) ? globalThis.birds : []);
        for (let b of searchArray) {
            if (b.x === targetX && b.y === targetY && b.health > 0) {
                occ = b;
                break;
            }
        }

        if (!occ) return false;

        // Try to push occupant further in same direction
        if (occ.tryPush(dx, dy, occupiedAlive, gameState, depth + 1, searchArray)) {
            // after occupant moved, move this bird into its space
            const oldKey = this.x + "," + this.y;
            const newKey = targetKey;
            occupiedAlive.delete(oldKey);
            this.x = targetX;
            this.y = targetY;
            occupiedAlive.add(newKey);
            return true;
        }

        return false;
    }

    hasNearFood(foods, radius, gameState) {
        const dims = this.getGridDimensions(gameState);
        for (let f of foods) {
            let dx = Math.abs(this.x - f.x);
            let dy = Math.abs(this.y - f.y);
            dx = Math.min(dx, dims.gridWidth - dx);
            dy = Math.min(dy, dims.gridHeight - dy);
            let d = dx + dy;
            if (d <= radius) return true;
        }
        return false;
    }

    update(birds, occupiedAlive, sepW, aliW, cohW, foods, gameState) {
        // Boids rules
        const separation = this.separate(birds, gameState);
        const alignment = this.align(birds, gameState);
        const cohesion = this.cohere(birds, gameState);

        // Food attraction
            let foodForce = this.foodForce(foods, gameState);
        const G = gameState.effectiveGrid || gameState.gridSize;
        const FOOD_WEIGHT = G * FOOD_WEIGHT_SCALE;

        // Predator avoidance
        let predatorForce = this.predatorForce(gameState);
        let predMag = Math.sqrt(
            predatorForce.x * predatorForce.x +
            predatorForce.y * predatorForce.y
        );

        // use effective grid for distance/weights
        let R = this.getPredatorRadius(G);
        let weightScale = G * PREDATOR_WEIGHT_SCALE;
        const PREDATOR_WEIGHT = PREDATOR_BASE_WEIGHT * weightScale;

        let predatorActive = predMag > PREDATOR_FORCE_THRESHOLD;
        let inPanic = predMag > PANIC_THRESHOLD;

        // Force priority
        let fx = 0, fy = 0;

        // During homing, override all boids rules and make home force dominant
        if (gameState.homingPhase) {
            const now = Date.now();
            const lastToggle = gameState.homingLastToggle || 0;
            // No per-bird delay; all birds start homing immediately when phase activates
            let dxh = this.homeX - this.x;
            let dyh = this.homeY - this.y;
            // spring-like force: F = k * displacement
            // ramp k from 0->homeWeight over HOMING_RAMP_MS to produce a rally effect
            const rampStart = gameState.homingPhaseStartTime || lastToggle;
            const rampMs = gameState.homingRampMs || HOMING_RAMP_MS;
            const rampT = Math.max(0, Math.min(1, (now - rampStart) / rampMs));

            let homeW = (typeof gameState.homeWeight === 'number') ? gameState.homeWeight : HOME_WEIGHT;
            let bias = (typeof this.homeBias === 'number') ? this.homeBias : 1.0;

            // apply spring force proportional to displacement (primary during homing)
            fx = dxh * homeW * bias * rampT;
            fy = dyh * homeW * bias * rampT;

            // also slightly boost alignment during homing for group coherence
            if (alignment && (typeof gameState.homingAlignmentBoost === 'number')) {
                fx += alignment.x * (gameState.homingAlignmentBoost - 1.0) * (gameState.aliWeight || 1.0) * rampT;
                fy += alignment.y * (gameState.homingAlignmentBoost - 1.0) * (gameState.aliWeight || 1.0) * rampT;
            }
        } else if (predatorActive) {
            // Priority 1: Escape from predator
            fx = predatorForce.x * PREDATOR_WEIGHT;
            fy = predatorForce.y * PREDATOR_WEIGHT;
        } else {
            let foodMag = Math.sqrt(foodForce.x * foodForce.x + foodForce.y * foodForce.y);

            if (foodMag > 0.001) {
                // Priority 2: Hunt food
                fx = foodForce.x * FOOD_WEIGHT
                    + separation.x * sepW * 0.3
                    + alignment.x * aliW * 0.3
                    + cohesion.x * cohW * 0.3;

                fy = foodForce.y * FOOD_WEIGHT
                    + separation.y * sepW * 0.3
                    + alignment.y * aliW * 0.3
                    + cohesion.y * cohW * 0.3;
            } else {
                // Priority 3: Pure boids behavior
                fx = separation.x * sepW
                    + alignment.x * aliW
                    + cohesion.x * cohW;

                fy = separation.y * sepW
                    + alignment.y * aliW
                    + cohesion.y * cohW;
            }
        }

            this.vx += fx;
            this.vy += fy;

            // Wall behavior: repel or bounce
            if (gameState.wallBehavior === 'repel') {
                let wf = this.wallForce(gameState);
                this.vx += wf.x * WALL_REPEL_WEIGHT;
                this.vy += wf.y * WALL_REPEL_WEIGHT;
            }

        // Calculate movement direction
        let moveX = 0, moveY = 0;
        if (Math.abs(this.vx) > Math.abs(this.vy)) {
            moveX = this.vx > 0 ? 1 : -1;
        } else {
            moveY = this.vy > 0 ? 1 : -1;
        }

        let nearFood = this.hasNearFood(foods, FOOD_HUNT_RADIUS, gameState);
        let moveChance;

        if (gameState.homingPhase) {
            // During homing, always move toward home (guaranteed movement)
            moveChance = 1.0;
        } else if (predatorActive) {
            moveChance = 1.0;
        } else if (nearFood) {
            moveChance = 1.0;
        } else {
            moveChance = 0.5;
        }

        let step = inPanic ? 2 : 1;
        // During homing, keep step size to 1 for smoother, more controlled movement
        // and scale step by global speed multiplier
        const speedMultiplier = (typeof gameState.speedMultiplier === 'number') ? gameState.speedMultiplier : 1.0;
        step = Math.max(1, Math.round(step * speedMultiplier));

        if (Math.random() < moveChance && (moveX !== 0 || moveY !== 0)) {
            const gridDims = this.getGridDimensions(gameState);
            const G2 = gridDims.gridWidth;  // Use actual grid width
            let targetX, targetY;
            let hxCandidate = moveX;
            let hyCandidate = moveY;
            let didMove = false;

            // During homing, override direction to move directly toward home
            if (gameState.homingPhase) {
                // Calculate toroidal distance (wrapping around edges)
                let dxh = this.homeX - this.x;
                let dyh = this.homeY - this.y;
                
                // Toroidal wrapping: find shortest path considering wrapping
                if (Math.abs(dxh) > G2 / 2) {
                    dxh = dxh > 0 ? dxh - G2 : dxh + G2;
                }
                if (Math.abs(dyh) > gridDims.gridHeight / 2) {
                    dyh = dyh > 0 ? dyh - gridDims.gridHeight : dyh + gridDims.gridHeight;
                }
                
                // Greedy movement: move toward home, but if already very close, snap to exact home position
                const distToHome = Math.max(Math.abs(dxh), Math.abs(dyh));
                if (distToHome <= step) {
                    // Already close enough: snap to exact home position
                    targetX = this.homeX;
                    targetY = this.homeY;
                } else if (Math.abs(dxh) > Math.abs(dyh)) {
                    // Move horizontally
                    hxCandidate = dxh > 0 ? 1 : -1;
                    hyCandidate = 0;
                    targetX = this.x + (dxh > 0 ? step : -step);
                    targetY = this.y;
                } else if (Math.abs(dyh) > 0) {
                    // Move vertically
                    hxCandidate = 0;
                    hyCandidate = dyh > 0 ? 1 : -1;
                    targetX = this.x;
                    targetY = this.y + (dyh > 0 ? step : -step);
                } else {
                    // Already at home
                    targetX = this.x;
                    targetY = this.y;
                }
                
                // Apply toroidal wrapping to target position
                targetX = ((targetX % G2) + G2) % G2;
                targetY = ((targetY % gridDims.gridHeight) + gridDims.gridHeight) % gridDims.gridHeight;
            } else {
                // Non-homing: normal boids movement with toroidal wrapping
                targetX = this.x + moveX * step;
                targetY = this.y + moveY * step;
                
                // Apply toroidal wrapping
                const gridDims = this.getGridDimensions(gameState);
                targetX = ((targetX % gridDims.gridWidth) + gridDims.gridWidth) % gridDims.gridWidth;
                targetY = ((targetY % gridDims.gridHeight) + gridDims.gridHeight) % gridDims.gridHeight;
            }

            // store heading based on chosen move (homing uses dxh/dyh)
            this.hx = hxCandidate;
            this.hy = hyCandidate;

            let oldKey = this.x + "," + this.y;
            let newKey = targetX + "," + targetY;

            // Bounce: if about to move outside bounds invert velocity (disabled for toroidal wrapping)
            // if (gameState.wallBehavior === 'bounce' && !gameState.homingPhase) {
            //     const G3 = gameState.effectiveGrid || gameState.gridSize;
            //     if (targetX <= 0 || targetX >= G3 - 1) this.vx *= -1;
            //     if (targetY <= 0 || targetY >= G3 - 1) this.vy *= -1;
            // }

            if (!occupiedAlive.has(newKey)) {
                // empty -> move
                occupiedAlive.delete(oldKey);
                this.x = targetX;
                this.y = targetY;
                occupiedAlive.add(newKey);
                didMove = true;
            } else {
                // occupied: during homing, try harder to push; during roaming, only push at edges
                let shouldPush = gameState.homingPhase; // always try to push during homing
                if (!shouldPush) {
                    const gridDims = this.getGridDimensions(gameState);
                    const edgeThresh = Math.max(1, Math.floor((gameState.margin || 1) / 2));
                    shouldPush = (this.x < edgeThresh || this.x >= (gridDims.gridWidth - edgeThresh) || 
                                 this.y < edgeThresh || this.y >= (gridDims.gridHeight - edgeThresh));
                }
                
                if (shouldPush) {
                    // find occupant bird
                    let occ = null;
                    for (let b of birds) {
                        if (b !== this && b.x === targetX && b.y === targetY && b.health > 0) {
                            occ = b;
                            break;
                        }
                    }
                    if (occ) {
                        // try to push occupant in same direction
                        if (occ.tryPush(moveX, moveY, occupiedAlive, gameState, 0, birds)) {
                            // push succeeded, now move into freed cell
                            occupiedAlive.delete(oldKey);
                            this.x = targetX;
                            this.y = targetY;
                            occupiedAlive.add(newKey);
                            didMove = true;
                        }
                    }
                }
            }

            if (didMove && typeof maybeEmitBirdChirp === 'function') {
                maybeEmitBirdChirp(this, gameState);
            }
        }

        // Damping with homing-aware ramp (interpolate between normal damping and homing damping)
        let finalDamp = DAMPING;
        if (gameState.homingPhase) {
            const now3 = Date.now();
            const rampStart2 = gameState.homingPhaseStartTime || gameState.homingLastToggle || 0;
            const rampMs2 = gameState.homingRampMs || HOMING_RAMP_MS;
            const rampFactor2 = Math.max(0, Math.min(1, (now3 - rampStart2) / rampMs2));
            finalDamp = DAMPING * (1 - rampFactor2) + (typeof gameState.homingDamping === 'number' ? gameState.homingDamping : HOMING_DAMPING) * rampFactor2;
        }
        this.vx *= finalDamp;
        this.vy *= finalDamp;

        // Noise (reduced during homing ramp)
        let noiseAmp = 1.0;
        if (gameState.homingPhase) {
            const now4 = Date.now();
            const rampStart3 = gameState.homingPhaseStartTime || gameState.homingLastToggle || 0;
            const rampMs3 = gameState.homingRampMs || HOMING_RAMP_MS;
            const rampFactor3 = Math.max(0, Math.min(1, (now4 - rampStart3) / rampMs3));
            const noiseReduction = (typeof gameState.homingNoiseReduction === 'number') ? gameState.homingNoiseReduction : HOMING_NOISE_REDUCTION;
            noiseAmp = 1.0 * (1 - rampFactor3) + noiseReduction * rampFactor3;
        }
        this.vx += (Math.random() * 2 - 1) * noiseAmp;
        this.vy += (Math.random() * 2 - 1) * noiseAmp;
    }

    separate(birds, gameState) {
        let steer = { x: 0, y: 0 };
        let count = 0;
        let desired = SEPARATION_NEIGHBOR;

        const dims = this.getGridDimensions(gameState);
        for (let b of birds) {
            if (b === this) continue;
            let dx = Math.abs(this.x - b.x);
            let dy = Math.abs(this.y - b.y);
            dx = Math.min(dx, dims.gridWidth - dx);
            dy = Math.min(dy, dims.gridHeight - dy);
            let d = dx + dy;

            if (d > 0 && d < desired) {
                let diff = { x: this.x - b.x, y: this.y - b.y };
                let scale = (desired - d + 1);
                steer.x += diff.x * scale;
                steer.y += diff.y * scale;
                count++;
            }
        }

        if (count > 0) {
            steer.x /= count;
            steer.y /= count;
        }
        return steer;
    }

    align(birds, gameState) {
        let sum = { x: 0, y: 0 };
        let count = 0;
        let neighbor = ALIGNMENT_NEIGHBOR;

        const dims = this.getGridDimensions(gameState);
        for (let b of birds) {
            if (b === this) continue;
            let dx = Math.abs(this.x - b.x);
            let dy = Math.abs(this.y - b.y);
            dx = Math.min(dx, dims.gridWidth - dx);
            dy = Math.min(dy, dims.gridHeight - dy);
            let d = dx + dy;

            if (d > 0 && d < neighbor) {
                sum.x += b.vx;
                sum.y += b.vy;
                count++;
            }
        }

        if (count > 0) {
            sum.x /= count;
            sum.y /= count;
        }
        return sum;
    }

    cohere(birds, gameState) {
        let sum = { x: 0, y: 0 };
        let count = 0;
        let neighbor = COHESION_NEIGHBOR;

        const dims = this.getGridDimensions(gameState);
        for (let b of birds) {
            if (b === this) continue;
            let dx = Math.abs(this.x - b.x);
            let dy = Math.abs(this.y - b.y);
            dx = Math.min(dx, dims.gridWidth - dx);
            dy = Math.min(dy, dims.gridHeight - dy);
            let d = dx + dy;

            if (d > 0 && d < neighbor) {
                sum.x += b.x;
                sum.y += b.y;
                count++;
            }
        }

        if (count > 0) {
            sum.x /= count;
            sum.y /= count;
            return {
                x: (sum.x - this.x) * 0.05,
                y: (sum.y - this.y) * 0.05
            };
        }
        return { x: 0, y: 0 };
    }

    foodForce(foods, gameState) {
        if (!foods || foods.length === 0) return { x: 0, y: 0 };

        const dims = this.getGridDimensions(gameState);

        let closest = null;
        let minD = Infinity;

        for (let f of foods) {
            let dx = Math.abs(this.x - f.x);
            let dy = Math.abs(this.y - f.y);
            dx = Math.min(dx, dims.gridWidth - dx);
            dy = Math.min(dy, dims.gridHeight - dy);
            const d = dx + dy;

            if (d > FOOD_SENSE_RADIUS) continue;

            if (d < minD) {
                minD = d;
                closest = f;
            }
        }

        if (!closest || minD === Infinity) return { x: 0, y: 0 };

        let dx = closest.x - this.x;
        let dy = closest.y - this.y;
        if (Math.abs(dx) > dims.gridWidth / 2) dx = dx > 0 ? dx - dims.gridWidth : dx + dims.gridWidth;
        if (Math.abs(dy) > dims.gridHeight / 2) dy = dy > 0 ? dy - dims.gridHeight : dy + dims.gridHeight;

        return {
            x: dx * FOOD_ATTRACTION_K,
            y: dy * FOOD_ATTRACTION_K
        };
    }

    predatorForce(gameState) {
        const dims = this.getGridDimensions(gameState);
        const offsetY = gameState.renderOffsetY || 0;
        let px = Math.floor(gameState.mouseX / gameState.cellSize);
        let py = Math.floor((gameState.mouseY - offsetY) / gameState.cellSize);

        // wrap mouse coords into grid
        px = ((px % dims.gridWidth) + dims.gridWidth) % dims.gridWidth;
        py = ((py % dims.gridHeight) + dims.gridHeight) % dims.gridHeight;

        let dx = this.x - px;
        let dy = this.y - py;
        if (Math.abs(dx) > dims.gridWidth / 2) dx = dx > 0 ? dx - dims.gridWidth : dx + dims.gridWidth;
        if (Math.abs(dy) > dims.gridHeight / 2) dy = dy > 0 ? dy - dims.gridHeight : dy + dims.gridHeight;

        let distSq = dx * dx + dy * dy;
        if (distSq === 0) {
            return {
                x: Math.random() * 2 - 1,
                y: Math.random() * 2 - 1
            };
        }

        let dist = Math.sqrt(distSq);
        let R = this.getPredatorRadius(Math.max(dims.gridWidth, dims.gridHeight));
        if (dist > R) {
            return { x: 0, y: 0 };
        }

        let strength = (R - dist + 1) / R;
        return {
            x: (dx / dist) * strength,
            y: (dy / dist) * strength
        };
    }

    wallForce(gameState) {
        // compute a small repulsion vector away from nearby walls
        const gridWidth = gameState.renderGridWidth || gameState.gridSize || 10;
        const gridHeight = gameState.renderGridHeight || gameState.gridSize || 10;
        
        // threshold (in cells) for repulsion (scale with BASE_SIZE)
        const thresh = Math.max(2, Math.round(BASE_SIZE * 0.5));

        let fx = 0, fy = 0;
        // left
        let dl = this.x - 0;
        if (dl < thresh) fx += (thresh - dl) / thresh;
        // right
        let dr = (gridWidth - 1) - this.x;
        if (dr < thresh) fx -= (thresh - dr) / thresh;
        // top
        let dt = this.y - 0;
        if (dt < thresh) fy += (thresh - dt) / thresh;
        // bottom
        let db = (gridHeight - 1) - this.y;
        if (db < thresh) fy -= (thresh - db) / thresh;

        // normalize a bit
        const mag = Math.sqrt(fx * fx + fy * fy) + 1e-6;
        return { x: fx / mag, y: fy / mag };
    }

    getPredatorRadius(gridSize) {
        let t = Math.max(0, Math.min(1, (gridSize - PREDATOR_RADIUS_MIN_GRID) / 
            (PREDATOR_RADIUS_MAX_GRID - PREDATOR_RADIUS_MIN_GRID)));
        return PREDATOR_RADIUS_MAX * (1 - t) + PREDATOR_RADIUS_MIN * t;
    }

    display(gameState, cellSize, mask = false) {
        let cx = this.x * cellSize + cellSize / 2 + (this.offsetX || 0);
        const offsetY = gameState.renderOffsetY || 0;
        let cy = this.y * cellSize + cellSize / 2 + (this.offsetY || 0) + offsetY;
        let size = cellSize * gameState.birdSizeScale;

        // Determine which shape to use: per-bird shape or global shape mode
        let shapeMode = gameState.useRandomShapes ? this.shapeType : gameState.shapeMode;

        // Use last heading for orientation; fall back to velocity if heading is zero
        const ox = (Math.abs(this.hx) > 0 || Math.abs(this.hy) > 0) ? this.hx : this.vx;
        const oy = (Math.abs(this.hx) > 0 || Math.abs(this.hy) > 0) ? this.hy : this.vy;

        if (mask) {
            // draw white opaque shape for mask generation
            drawShape(shapeMode, cx, cy, size, 'rgb(255,255,255)', ox, oy);
            return;
        }

        drawShape(shapeMode, cx, cy, size, 'rgb(0,0,0)', ox, oy);
    }
}
