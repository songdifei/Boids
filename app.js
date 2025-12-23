// ===== Game State =====
const gameState = {
    gridSize: 10,
    cellSize: CANVAS_SIZE / 10,
    birds: [],
    foods: [],
    frameCount: 0,
    isPaused: false,
    soundEnabled: true,
    // per-flock home weight (can be tuned via UI)
    homeWeight: HOME_WEIGHT,
    // global speed multiplier for movement
    speedMultiplier: 1.0,
    shapeMode: 0,
    useRandomShapes: false, // Toggle between fixed shape mode and random per-bird shapes
    birdSizeScale: 1.0,
    sepWeight: 1.0,
    aliWeight: 1.0,
    cohWeight: 1.0,
    wordBuffer: 'BIRDS', // default text
    wallBehavior: DEFAULT_WALL_BEHAVIOR,
    // Homing/flocking phase state
    homingPhase: false,
    homingLastToggle: Date.now(),
    homingCycleMs: HOMING_CYCLE_MS,
    homingPhaseStartTime: Date.now(),
    // homing tuning defaults (can be overridden by UI later)
    homingRampMs: HOMING_RAMP_MS,
    homingDamping: HOMING_DAMPING,
    homingNoiseReduction: HOMING_NOISE_REDUCTION,
    homingAlignmentBoost: 1.6,
    mouseX: -1000,
    mouseY: -1000,
    // per-bird random offset range in pixels (applied as +/- range)
    offsetRange: 0,
    // grid display toggle
    showGrid: true,
    renderOffsetY: 0,
    renderGridWidth: 0,
    renderGridHeight: 0,
    spawnOffsetRows: 0
};

let canvas;
// Offscreen mask buffers for JS gooey (pure-black blobs)
let offscreenMask = null;
let offCtxMask = null;
let offscreenMaskBlur = null;
let offCtxMaskBlur = null;
let offscreenComposite = null;
let offCtxComposite = null;
let gooBlur = 0; // default blur in px (0 = no goo effect)

// ===== Bird Audio =====
const birdAudio = {
    ctx: null,
    master: null,
    lastPlay: 0,
    ensureContext() {
        if (this.ctx) return true;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.12;
        this.master.connect(this.ctx.destination);
        return true;
    },
    isReady() {
        if (!this.ctx && !this.ensureContext()) return false;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx.state === 'running';
    },
    playChirp(pan = 0, brightness = 0.5) {
        if (!this.isReady()) return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        if (!Number.isFinite(now) || now < this.lastPlay + 0.02) return;
        this.lastPlay = now;

        // sanitize inputs to avoid non-finite AudioParam writes
        const safePan = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
        const safeBright = Number.isFinite(brightness) ? Math.max(0, Math.min(1, brightness)) : 0.5;

        const base = 1500 + 1200 * safeBright + Math.random() * 400;
        const end = base * (0.55 + Math.random() * 0.15);
        const peak = 0.12 + Math.random() * 0.05;
        if (!Number.isFinite(base) || !Number.isFinite(end) || !Number.isFinite(peak)) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(base, now);
        osc.frequency.exponentialRampToValueAtTime(end, now + 0.09);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

        osc.connect(gain);
        if (panner) {
            panner.pan.setValueAtTime(safePan, now);
            gain.connect(panner);
            panner.connect(this.master);
        } else {
            gain.connect(this.master);
        }

        osc.start(now);
        osc.stop(now + 0.18);
    }
};

function maybeEmitBirdChirp(bird, gameState) {
    if (!gameState.soundEnabled) return;
    if (!birdAudio.isReady()) return;
    const now = performance.now();
    if (!Number.isFinite(now)) return;
    const minGap = 120 + Math.random() * 120;
    if (bird.lastChirpTime && now - bird.lastChirpTime < minGap) return;

    const dims = bird.getGridDimensions ? bird.getGridDimensions(gameState) : null;
    const gridW = dims && Number.isFinite(dims.gridWidth) ? Math.max(1, dims.gridWidth) : 1;
    const rawPan = dims ? ((bird.x / gridW) - 0.5) * 1.4 : 0;
    const speed = Math.hypot(bird.vx || 0, bird.vy || 0);
    const speedEnergy = Number.isFinite(speed) ? Math.max(0, Math.min(1, speed / 4)) : 0;
    const chance = 0.2 + speedEnergy * 0.6;
    if (Math.random() > chance) return;

    bird.lastChirpTime = now;
    birdAudio.playChirp(rawPan, speedEnergy);
}

// ===== Recording State =====
let mediaRecorder = null;
let recordedChunks = [];
let recordingStream = null;
let isRecording = false;
const PREFER_MP4 = true;

function startRecording() {
    if (!canvas) return;
    if (!('MediaRecorder' in window)) {
        alert('MediaRecorder not supported in this browser. Please try Chrome or Edge.');
        return;
    }
    try {
        // Prefer 60fps; browsers may clamp to supported frame rates
        recordingStream = canvas.captureStream(60);
        const options = getSupportedMediaRecorderOptions();
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(recordingStream, options);
        mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) recordedChunks.push(e.data);
        };
        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.start();
        isRecording = true;
        updateRecordingControls();
    } catch (err) {
        console.error('Failed to start recording:', err);
        alert('Failed to start recording. Check console for details.');
    }
}

function stopRecording() {
    try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    } catch (err) {
        console.error('Failed to stop recording:', err);
    } finally {
        if (recordingStream) {
            const tracks = recordingStream.getTracks ? recordingStream.getTracks() : [];
            tracks.forEach(t => t.stop());
        }
        recordingStream = null;
        isRecording = false;
        updateRecordingControls();
    }
}

async function handleRecordingStop() {
    try {
        if (!recordedChunks || recordedChunks.length === 0) return;
        const blobType = inferBlobTypeFromRecorder(mediaRecorder);
        let blob = new Blob(recordedChunks, { type: blobType });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const isMp4Native = /mp4/i.test(blobType);

        if (PREFER_MP4 && !isMp4Native && window.convertWebMToMP4) {
            // Show converting state on the toggle button
            const recToggleBtn = document.getElementById('recordToggleBtn');
            const prevLabel = recToggleBtn ? recToggleBtn.textContent : '';
            if (recToggleBtn) {
                recToggleBtn.disabled = true;
                recToggleBtn.textContent = 'Converting to MP4…';
            }
            try {
                blob = await window.convertWebMToMP4(blob);
            } catch (convErr) {
                console.warn('FFmpeg conversion failed, falling back to WebM download.', convErr);
            } finally {
                if (recToggleBtn) {
                    recToggleBtn.disabled = false;
                    recToggleBtn.textContent = prevLabel || 'Start Recording';
                }
            }
        }

        // Decide extension by blob.type after potential conversion
        const finalIsMp4 = /mp4/i.test(blob.type);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `boids-recording-${ts}.${finalIsMp4 ? 'mp4' : 'webm'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Failed to save recording:', err);
    } finally {
        recordedChunks = [];
        mediaRecorder = null;
    }
}

function getSupportedMediaRecorderOptions() {
    const candidates = [];
    if (PREFER_MP4) {
        candidates.push(
            { mimeType: 'video/mp4;codecs=h264', videoBitsPerSecond: 8_000_000 },
            { mimeType: 'video/mp4', videoBitsPerSecond: 8_000_000 }
        );
    }
    candidates.push(
        { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8_000_000 },
        { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8_000_000 },
        { mimeType: 'video/webm', videoBitsPerSecond: 8_000_000 }
    );
    for (const opt of candidates) {
        if (!opt.mimeType || MediaRecorder.isTypeSupported(opt.mimeType)) return opt;
    }
    return {};
}

function inferBlobTypeFromRecorder(rec) {
    try {
        if (rec && rec.mimeType) return rec.mimeType;
    } catch {}
    // Fallback common type
    return 'video/webm';
}

function enableSmoothing(ctxObj) {
    if (!ctxObj) return;
    ctxObj.imageSmoothingEnabled = true;
    ctxObj.imageSmoothingQuality = 'high';
}

function getAvailableCanvasSpace() {
    const controlsEl = document.querySelector('.controls');
    const wrapperEl = document.querySelector('.layout-wrapper');
    const controlsWidth = controlsEl ? controlsEl.getBoundingClientRect().width : 0;

    let gap = 20;
    let paddingLeft = 20;
    let paddingRight = 20;
    let paddingTop = 20;
    let paddingBottom = 20;

    if (wrapperEl) {
        const style = getComputedStyle(wrapperEl);
        gap = parseFloat(style.columnGap || style.gap || gap) || gap;
        paddingLeft = parseFloat(style.paddingLeft || paddingLeft) || paddingLeft;
        paddingRight = parseFloat(style.paddingRight || paddingRight) || paddingRight;
        paddingTop = parseFloat(style.paddingTop || paddingTop) || paddingTop;
        paddingBottom = parseFloat(style.paddingBottom || paddingBottom) || paddingBottom;
    }

    const availableWidth = window.innerWidth - controlsWidth - gap - paddingLeft - paddingRight - 10;
    const availableHeight = window.innerHeight - paddingTop - paddingBottom - 10;

    return {
        width: Math.max(200, availableWidth),
        height: Math.max(200, availableHeight)
    };
}

function calculateCanvasSizing(currentState) {
    const layout = computeWordLayout(currentState.wordBuffer || 'A', currentState.gridSize || BASE_SIZE);
    const space = getAvailableCanvasSpace();

    const baseCellSize = Math.max(2, Math.min(space.width / layout.gridWidth, space.height / layout.gridHeight));

    // Expand vertical padding (top/bottom) so the grid can fill the available height while keeping square cells.
    const paddedGridHeight = Math.floor(space.height / baseCellSize);
    const extraRows = Math.max(0, paddedGridHeight - layout.gridHeight);
    const totalGridHeight = layout.gridHeight + extraRows;
    const totalGridWidth = layout.gridWidth;
    const renderOffsetY = 0; // use full vertical range with no pixel shift
    const spawnOffsetRows = Math.floor(extraRows / 2);

    const canvasWidth = Math.max(1, Math.ceil(layout.gridWidth * baseCellSize));
    const canvasHeight = Math.max(1, Math.ceil(totalGridHeight * baseCellSize));

    return { layout, cellSize: baseCellSize, canvasWidth, canvasHeight, renderOffsetY, totalGridHeight, totalGridWidth, spawnOffsetRows };
}

function applyCanvasSizing(sizing) {
    if (!sizing) return;
    const { layout, cellSize, canvasWidth, canvasHeight, renderOffsetY = 0, totalGridHeight, totalGridWidth, spawnOffsetRows = 0 } = sizing;

    gameState.margin = layout.marginPerSide;
    gameState.effectiveGrid = typeof totalGridHeight === 'number' ? totalGridHeight : layout.gridHeight;
    gameState.glyphRegion = layout.glyphRegion;
    gameState.cellSize = cellSize;
    gameState.renderOffsetY = renderOffsetY;
    gameState.renderGridWidth = typeof totalGridWidth === 'number' ? totalGridWidth : layout.gridWidth;
    gameState.renderGridHeight = typeof totalGridHeight === 'number' ? totalGridHeight : layout.gridHeight;
    gameState.spawnOffsetRows = spawnOffsetRows;

    if (canvas) {
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
    }

    if (offscreenMask) {
        offscreenMask.width = canvasWidth;
        offscreenMask.height = canvasHeight;
    }
    if (offscreenMaskBlur) {
        offscreenMaskBlur.width = canvasWidth;
        offscreenMaskBlur.height = canvasHeight;
    }
    if (offscreenComposite) {
        offscreenComposite.width = canvasWidth;
        offscreenComposite.height = canvasHeight;
    }
}

// ===== Setup =====
function setup() {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    // Compute initial sizing based on viewport and word layout
    applyCanvasSizing(calculateCanvasSizing(gameState));

    // offscreen for mask
    offscreenMask = document.createElement('canvas');
    offscreenMask.width = canvas.width;
    offscreenMask.height = canvas.height;
    offCtxMask = offscreenMask.getContext('2d');
    enableSmoothing(offCtxMask);

    offscreenMaskBlur = document.createElement('canvas');
    offscreenMaskBlur.width = canvas.width;
    offscreenMaskBlur.height = canvas.height;
    offCtxMaskBlur = offscreenMaskBlur.getContext('2d');
    enableSmoothing(offCtxMaskBlur);

    // offscreen composite buffer for drawing final bird blobs so we can
    // render grid beneath birds without the globalCompositeOperation
    offscreenComposite = document.createElement('canvas');
    offscreenComposite.width = canvas.width;
    offscreenComposite.height = canvas.height;
    offCtxComposite = offscreenComposite.getContext('2d');
    enableSmoothing(offCtxComposite);

    // main ctx smoothing
    enableSmoothing(ctx);

    // compute grid info (effective grid includes padding/margin)
    computeGridInfo(gameState);
    initBirds(gameState);
    if (!Array.isArray(gameState.birds) || gameState.birds.length === 0) {
        // Fallback: ensure at least one bird exists so the canvas never renders empty
        gameState.birds = [new Bird(0, 0)];
    }

    setupControls();
    setupEventListeners();
    // Keep canvas sizing responsive to window changes
    window.addEventListener('resize', () => {
        computeGridInfo(gameState);
        initBirds(gameState);
        gameState.frameCount = 0;
    });
}

function computeGridInfo(gameState) {
    // Align sizing with viewport so canvas stays responsive
    const sizing = calculateCanvasSizing(gameState);
    applyCanvasSizing(sizing);
}

function updateCanvasSize(gameState) {
    // Calculate and update canvas dimensions based on current word and resolution
    if (!canvas) return;
    computeGridInfo(gameState);
}

function exportCanvasToSVG() {
    if (!canvas) return;
    const pngData = canvas.toDataURL('image/png');
    const w = canvas.width;
    const h = canvas.height;
    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${pngData}" width="100%" height="100%"/></svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'boids-export.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ===== Font Upload → 5x5 Glyphs =====
async function parseUploadedFontToGlyphs(file) {
    const statusEl = document.getElementById('fontStatus');
    try {
        if (!file) {
            if (statusEl) statusEl.textContent = 'No font selected';
            return;
        }

        const blobUrl = URL.createObjectURL(file);
        const familyName = `UploadedFont_${Date.now()}`;
        const fontFace = new FontFace(familyName, `url(${blobUrl})`);
        await fontFace.load();
        document.fonts.add(fontFace);
        // Remember uploaded family and build glyphs at current resolution
        gameState.customFontFamily = familyName;
        await buildGlyphsForResolution(gameState.gridSize, file && file.name);
    } catch (e) {
        console.error('Font parse error', e);
        if (statusEl) statusEl.textContent = 'Failed to parse font';
    }
}

async function buildGlyphsForResolution(targetRes, fileNameForStatus) {
    const statusEl = document.getElementById('fontStatus');
    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const newGlyphs = {};
        const N = Math.max(1, Math.floor(targetRes));
        for (const ch of chars) {
            newGlyphs[ch] = rasterizeCharToGrid(ch, gameState.customFontFamily, N);
        }
        newGlyphs[' '] = new Array(N * N).fill(0);
        for (const key of Object.keys(newGlyphs)) {
            GLYPHS[key] = newGlyphs[key];
        }
        // Build proportional glyph metrics (active column span per glyph)
        const metrics = {};
        const letters = chars.split('');
        letters.push(' ');
        for (const ch of letters) {
            const arr = GLYPHS[ch];
            if (!arr || !arr.length) continue;
            const dim = Math.max(1, Math.round(Math.sqrt(arr.length)));
            let minCol = dim, maxCol = -1;
            for (let x = 0; x < dim; x++) {
                let any = false;
                for (let y = 0; y < dim; y++) {
                    if (arr[y * dim + x]) { any = true; break; }
                }
                if (any) {
                    if (x < minCol) minCol = x;
                    if (x > maxCol) maxCol = x;
                }
            }
            if (maxCol >= minCol) {
                metrics[ch] = { minCol, maxCol, width: (maxCol - minCol + 1), dim };
            } else {
                metrics[ch] = { minCol: 0, maxCol: 0, width: Math.ceil(dim * 0.3), dim };
            }
        }
        gameState.glyphMetrics = metrics;
        if (statusEl) statusEl.textContent = `Parsed ${chars.length} glyphs at ${N}×${N}` + (fileNameForStatus ? ` from ${fileNameForStatus}` : '');
        // Reinitialize with new glyphs
        computeGridInfo(gameState);
        initBirds(gameState);
        updateCanvasSize(gameState);
        gameState.frameCount = 0;
    } catch (e) {
        console.error('Build glyphs error', e);
        if (statusEl) statusEl.textContent = 'Failed building glyphs for resolution';
    }
}

function rasterizeCharToGrid(ch, family, targetDim) {
    const S = 256;
    const off = document.createElement('canvas');
    off.width = S;
    off.height = S;
    const c = off.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#000';
    c.textBaseline = 'alphabetic';

    // Pick a font size that fits well
    const fontSize = 200;
    c.font = `${fontSize}px '${family}'`;
    const m = c.measureText(ch);
    const asc = m.actualBoundingBoxAscent || fontSize * 0.8;
    const desc = m.actualBoundingBoxDescent || fontSize * 0.2;
    const textW = Math.max(1, m.width);
    const textH = asc + desc;
    const x = Math.floor((S - textW) / 2);
    const y = Math.floor((S - textH) / 2 + asc);
    c.fillText(ch, x, y);

    const img = c.getImageData(0, 0, S, S);
    const d = img.data;

    // Find tight bounding box of drawn glyph (non-white)
    let minX = S, minY = S, maxX = -1, maxY = -1;
    for (let py = 0; py < S; py++) {
        for (let px = 0; px < S; px++) {
            const idx = (py * S + px) * 4;
            const r = d[idx], g = d[idx + 1], b = d[idx + 2];
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            if (lum < 250) { // anything not nearly white
                if (px < minX) minX = px;
                if (py < minY) minY = py;
                if (px > maxX) maxX = px;
                if (py > maxY) maxY = py;
            }
        }
    }

    if (maxX < minX || maxY < minY) {
        const N0 = Math.max(1, Math.floor(targetDim));
        return new Array(N0 * N0).fill(0);
    }

    // Expand a tiny bit to avoid clipping
    const pad = 4;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(S - 1, maxX + pad);
    maxY = Math.min(S - 1, maxY + pad);

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;

    // Compute occupancy for an N×N grid within bbox
    const N = Math.max(1, Math.floor(targetDim));
    const out = new Array(N * N).fill(0);
    const thresh = 0.25; // coverage threshold
    for (let gy = 0; gy < N; gy++) {
        for (let gx = 0; gx < N; gx++) {
            const x0 = Math.floor(minX + (gx / N) * bw);
            const x1 = Math.floor(minX + ((gx + 1) / N) * bw);
            const y0 = Math.floor(minY + (gy / N) * bh);
            const y1 = Math.floor(minY + ((gy + 1) / N) * bh);
            const w = Math.max(1, x1 - x0);
            const h = Math.max(1, y1 - y0);

            let dark = 0, total = 0;
            for (let py = y0; py < y0 + h; py++) {
                for (let px = x0; px < x0 + w; px++) {
                    const idx = (py * S + px) * 4;
                    const r = d[idx], g = d[idx + 1], b = d[idx + 2];
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    if (lum < 200) dark++;
                    total++;
                }
            }
            const coverage = dark / Math.max(1, total);
            out[gy * N + gx] = coverage >= thresh ? 1 : 0;
        }
    }
    return out;
}

// Create SVG shape buttons dynamically
async function createSVGShapeButtons() {
    const container = document.getElementById('shapeButtonsContainer');
    if (!container) return;

    // Wait for SVG shapes to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Arrow button (shape 0)
    const arrowBtn = document.createElement('button');
    arrowBtn.className = 'shape-btn active';
    arrowBtn.dataset.shape = '0';
    arrowBtn.style.width = '50px';
    arrowBtn.style.height = '50px';
    arrowBtn.style.padding = '5px';
    arrowBtn.innerHTML = '➤';
    arrowBtn.addEventListener('click', (e) => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        gameState.shapeMode = parseInt(e.target.dataset.shape);
        gameState.useRandomShapes = false;
    });
    container.appendChild(arrowBtn);

    // SVG buttons (shape 1-8)
    for (let i = 0; i < 8; i++) {
        const btn = document.createElement('button');
        btn.className = 'shape-btn';
        btn.dataset.shape = String(i + 1);
        btn.style.width = '50px';
        btn.style.height = '50px';
        btn.style.padding = '5px';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';

        // Create canvas for SVG thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 40;
        const ctx = canvas.getContext('2d');
        
        // Draw SVG shape as thumbnail
        drawSVGThumb(ctx, i, 20, 20, 18, 'black');
        btn.appendChild(canvas);

        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            gameState.shapeMode = parseInt(e.currentTarget.dataset.shape);
            gameState.useRandomShapes = false;
        });

        container.appendChild(btn);
    }

    // Random button replaces old SVG9 slot
    const randomBtn = document.createElement('button');
    randomBtn.className = 'shape-btn';
    randomBtn.dataset.shape = 'random';
    randomBtn.style.width = '50px';
    randomBtn.style.height = '50px';
    randomBtn.style.padding = '5px';
    randomBtn.textContent = 'Random';
    randomBtn.addEventListener('click', (e) => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        gameState.useRandomShapes = true;
        // reassign random shapes to all birds (1-8)
        if (Array.isArray(gameState.birds)) {
            for (let b of gameState.birds) {
                b.shapeType = Math.floor(Math.random() * 8) + 1;
            }
        }
    });
    container.appendChild(randomBtn);
}

// Draw SVG shape as thumbnail
function drawSVGThumb(ctx, assetIndex, cx, cy, size, color) {
    const svgShapeId = assetIndex + 6;
    const svgElement = svgShapes[svgShapeId];
    if (!svgElement) return;

    ctx.save();
    ctx.translate(cx, cy);

    const viewBox = svgElement.getAttribute('viewBox');
    let vbWidth = 100, vbHeight = 100;
    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/);
        if (parts.length >= 4) {
            vbWidth = parseFloat(parts[2]);
            vbHeight = parseFloat(parts[3]);
        }
    }

    const scale = size / Math.max(vbWidth, vbHeight);
    ctx.scale(scale, scale);
    ctx.translate(-vbWidth / 2, -vbHeight / 2);

    ctx.fillStyle = color;

    const paths = svgElement.querySelectorAll('path, rect, circle, polygon');
    for (let el of paths) {
        if (el.tagName === 'path') {
            const d = el.getAttribute('d');
            if (d) {
                const path = new Path2D(d);
                ctx.fill(path);
            }
        } else if (el.tagName === 'rect') {
            const x = parseFloat(el.getAttribute('x') || 0);
            const y = parseFloat(el.getAttribute('y') || 0);
            const w = parseFloat(el.getAttribute('width'));
            const h = parseFloat(el.getAttribute('height'));
            ctx.fillRect(x, y, w, h);
        } else if (el.tagName === 'circle') {
            const cx2 = parseFloat(el.getAttribute('cx') || 0);
            const cy2 = parseFloat(el.getAttribute('cy') || 0);
            const r = parseFloat(el.getAttribute('r'));
            ctx.beginPath();
            ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
            ctx.fill();
        } else if (el.tagName === 'polygon') {
            const points = el.getAttribute('points');
            if (points) {
                const coords = points.split(/[\s,]+/).map(parseFloat);
                ctx.beginPath();
                ctx.moveTo(coords[0], coords[1]);
                for (let i = 2; i < coords.length; i += 2) {
                    ctx.lineTo(coords[i], coords[i + 1]);
                }
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    ctx.restore();
}

function setupControls() {
    // Text input handler for multi-letter words
    const textInput = document.getElementById('textInput');
    const textInputInfo = document.getElementById('textInputInfo');
    if (textInput && textInputInfo) {
        textInput.addEventListener('input', (e) => {
            let text = e.target.value.toUpperCase();
            if (text.length === 0) text = 'A'; // default to 'A' if empty
            gameState.wordBuffer = text;
            textInputInfo.textContent = 'Current: ' + text;
            
            // Automatically adjust grid size for the word
            const newGridSize = calculateGridSizeForWord(text);
            if (newGridSize !== gameState.gridSize) {
                gameState.gridSize = newGridSize;
                computeGridInfo(gameState);
                initBirds(gameState);
            }
            
            // Update canvas size based on new word
            updateCanvasSize(gameState);
        });
        // Initialize
        textInput.value = gameState.wordBuffer;
        textInputInfo.textContent = 'Current: ' + gameState.wordBuffer;
    }

    document.getElementById('resolutionSlider').addEventListener('input', async (e) => {
        let newGridSize = parseInt(e.target.value);
        // Enforce minimum resolution of 5 (5x5 base glyph size)
        // Below 5 pixels per letter, recognizable fonts are nearly impossible to render
        newGridSize = Math.max(BASE_SIZE, newGridSize);
        
        if (newGridSize !== gameState.gridSize) {
            gameState.gridSize = newGridSize;
            if (gameState.customFontFamily) {
                // Rebuild glyphs at this resolution (includes re-init and resize)
                await buildGlyphsForResolution(newGridSize);
            } else {
                computeGridInfo(gameState);
                initBirds(gameState);
                updateCanvasSize(gameState);
            }
        } else if (gameState.customFontFamily) {
            // If same value reported repeatedly while dragging, still ensure rebuild
            await buildGlyphsForResolution(newGridSize);
        }
        document.getElementById('resolutionValue').textContent = newGridSize;
        document.getElementById('resolutionValue2').textContent = newGridSize;
        // Update slider value if it was clamped
        e.target.value = newGridSize;
    });

    document.getElementById('birdSizeSlider').addEventListener('input', (e) => {
        gameState.birdSizeScale = parseFloat(e.target.value);
        document.getElementById('birdSizeValue').textContent = gameState.birdSizeScale.toFixed(2);
    });

    // Home strength slider
    document.getElementById('homeStrengthSlider').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        gameState.homeWeight = v;
        document.getElementById('homeStrengthValue').textContent = v.toFixed(3);
    });

    // Homing period slider (seconds)
    document.getElementById('homingPeriodSlider').addEventListener('input', (e) => {
        const s = parseInt(e.target.value, 10);
        gameState.homingCycleMs = s * 1000;
        document.getElementById('homingPeriodValue').textContent = s + 's';
    });

    // Speed multiplier slider
    document.getElementById('speedMultiplierSlider').addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        gameState.speedMultiplier = v;
        document.getElementById('speedMultiplierValue').textContent = v.toFixed(2) + 'x';
    });

    document.getElementById('sepSlider').addEventListener('input', (e) => {
           gameState.sepWeight = parseFloat(e.target.value);
           document.getElementById('sepValue').textContent = gameState.sepWeight.toFixed(1);
    });

    document.getElementById('aliSlider').addEventListener('input', (e) => {
           gameState.aliWeight = parseFloat(e.target.value);
           document.getElementById('aliValue').textContent = gameState.aliWeight.toFixed(1);
    });

    document.getElementById('cohSlider').addEventListener('input', (e) => {
           gameState.cohWeight = parseFloat(e.target.value);
           document.getElementById('cohValue').textContent = gameState.cohWeight.toFixed(1);
    });

    document.getElementById('feedingBtn').addEventListener('click', () => {
        spawnFood(gameState);
    });

    document.getElementById('playPauseBtn').addEventListener('click', (e) => {
        gameState.isPaused = !gameState.isPaused;
        e.target.textContent = gameState.isPaused ? 'Play' : 'Pause';
    });

    document.getElementById('refreshBtn').addEventListener('click', () => {
        computeGridInfo(gameState);
        initBirds(gameState);
        updateCanvasSize(gameState);
        gameState.frameCount = 0;
    });

    const soundBtn = document.getElementById('soundToggleBtn');
    if (soundBtn) {
        const syncLabel = () => soundBtn.textContent = gameState.soundEnabled ? 'Sound: ON' : 'Sound: OFF';
        soundBtn.addEventListener('click', () => {
            gameState.soundEnabled = !gameState.soundEnabled;
            if (gameState.soundEnabled) birdAudio.isReady();
            syncLabel();
        });
        syncLabel();
    }

    const exportSvgBtn = document.getElementById('exportSvgBtn');
    if (exportSvgBtn) {
        exportSvgBtn.addEventListener('click', () => {
            exportCanvasToSVG();
        });
    }

    // Recording control: single toggle button
    const recToggleBtn = document.getElementById('recordToggleBtn');
    if (recToggleBtn) {
        recToggleBtn.addEventListener('click', () => {
            if (isRecording) stopRecording(); else startRecording();
        });
    }
    updateRecordingControls();

    document.getElementById('gridBtn').addEventListener('click', (e) => {
        gameState.showGrid = !gameState.showGrid;
        e.target.textContent = gameState.showGrid ? 'Grid: ON' : 'Grid: OFF';
    });

    // Gooey strength slider (value > 0 enables goo, 0 disables)
    const gooSlider = document.getElementById('gooBlurSlider');
    const gooVal = document.getElementById('gooBlurValue');
    if (gooSlider && gooVal) {
        const applyGooClass = (val) => {
            if (val > 0) {
                document.body.classList.add('use-goo');
            } else {
                document.body.classList.remove('use-goo');
            }
        };

        gooSlider.addEventListener('input', (e) => {
            const newBlur = parseFloat(e.target.value);
            gooBlur = newBlur;  // update global
            gooVal.textContent = newBlur.toFixed(1);
            applyGooClass(newBlur);
        });
        // initialize display/state (start at 0 => no goo)
        const initBlur = parseFloat(gooSlider.value);
        gooBlur = initBlur;
        gooVal.textContent = initBlur.toFixed(1);
        applyGooClass(initBlur);
    }

    // Per-bird offset slider
    const offsetSlider = document.getElementById('birdOffsetSlider');
    const offsetVal = document.getElementById('birdOffsetValue');
    if (offsetSlider && offsetVal) {
        offsetSlider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            gameState.offsetRange = v;
            offsetVal.textContent = v.toFixed(1);
            // reassign random offsets to existing birds within new range
            if (Array.isArray(gameState.birds)) {
                for (let b of gameState.birds) {
                    b.offsetX = (Math.random() * 2 - 1) * v;
                    b.offsetY = (Math.random() * 2 - 1) * v;
                }
            }
        });
        // initialize
        const initOffset = parseFloat(offsetSlider.value);
        gameState.offsetRange = initOffset;
        offsetVal.textContent = initOffset.toFixed(1);
    }

    // Generate SVG shape buttons dynamically (includes Random option)
    createSVGShapeButtons();

    // Font upload handlers
    const fontFileEl = document.getElementById('fontFile');
    const fontBtn = document.getElementById('fontParseBtn');
    if (fontBtn) {
        fontBtn.addEventListener('click', async () => {
            if (!fontFileEl || !fontFileEl.files || fontFileEl.files.length === 0) {
                const statusEl = document.getElementById('fontStatus');
                if (statusEl) statusEl.textContent = 'Please choose a font file first';
                return;
            }
            fontBtn.disabled = true;
            const prevLabel = fontBtn.textContent;
            fontBtn.textContent = 'Parsing...';
            await parseUploadedFontToGlyphs(fontFileEl.files[0]);
            fontBtn.textContent = prevLabel;
            fontBtn.disabled = false;
        });
    }

    // Initialize displayed slider values from gameState
    document.getElementById('resolutionValue').textContent = gameState.gridSize;
    document.getElementById('resolutionValue2').textContent = gameState.gridSize;
    document.getElementById('birdSizeValue').textContent = gameState.birdSizeScale.toFixed(2);
    document.getElementById('sepValue').textContent = gameState.sepWeight.toFixed(1);
    document.getElementById('aliValue').textContent = gameState.aliWeight.toFixed(1);
    document.getElementById('cohValue').textContent = gameState.cohWeight.toFixed(1);
    document.getElementById('homeStrengthValue').textContent = gameState.homeWeight.toFixed(3);
    document.getElementById('homingPeriodValue').textContent = Math.round((gameState.homingCycleMs || HOMING_CYCLE_MS) / 1000) + 's';
    document.getElementById('speedMultiplierValue').textContent = gameState.speedMultiplier.toFixed(2) + 'x';

}

function updateRecordingControls() {
    const recToggleBtn = document.getElementById('recordToggleBtn');
    if (recToggleBtn) {
        recToggleBtn.textContent = isRecording ? 'Stop Recording' : 'Start Recording';
    }
}

function setupEventListeners() {
    canvas.addEventListener('mousemove', (e) => {
        let rect = canvas.getBoundingClientRect();
        gameState.mouseX = e.clientX - rect.left;
        gameState.mouseY = e.clientY - rect.top;
    });

    canvas.addEventListener('mouseleave', () => {
        gameState.mouseX = -1000;
        gameState.mouseY = -1000;
    });
}

// ===== Animation Loop =====
function animate() {
    try {
    // Toggle homingPhase periodically so flock alternates between roaming and returning
    const now = Date.now();
    if (now - gameState.homingLastToggle > (gameState.homingCycleMs || HOMING_CYCLE_MS)) {
        gameState.homingPhase = !gameState.homingPhase;
        gameState.homingLastToggle = now;
        if (gameState.homingPhase) {
            // record start time for ramping
            gameState.homingPhaseStartTime = now;
        }
    }
    // update phase label if present
    const phaseLabelEl = document.getElementById('phaseLabel');
    if (phaseLabelEl) phaseLabelEl.textContent = gameState.homingPhase ? 'HOMING' : 'ROAMING';

    // Clear canvas — transparent when goo is active, white otherwise
    const gooEnabled = gooBlur > 0;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    
    if (gooEnabled) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    } else {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    }

    // Save a reference to the main drawing context for compositing later
    const mainCtx = ctx;

    // Draw grid and food first so they sit beneath the birds.
    // We keep them crisp by drawing them directly to the main context.
    ctx = mainCtx;
    drawGrid(gameState);
    drawFood(gameState);

    // Update birds and frame counter
    if (!gameState.isPaused) {
        gameState.frameCount++;
        if (!Array.isArray(gameState.birds) || gameState.birds.length === 0) {
            initBirds(gameState);
            if (!Array.isArray(gameState.birds) || gameState.birds.length === 0) {
                gameState.birds = [new Bird(0, 0)];
            }
        }
        shuffle(gameState.birds);

        let occupiedAlive = new Set();
        for (let b of gameState.birds) {
            if (b.health > 0) {
                occupiedAlive.add(b.x + "," + b.y);
            }
        }

        let sepW = gameState.sepWeight;
        let aliW = gameState.aliWeight;
        let cohW = gameState.cohWeight;

        for (let b of gameState.birds) {
            b.update(gameState.birds, occupiedAlive, sepW, aliW, cohW, gameState.foods, gameState);
        }

        // Eat food
        for (let b of gameState.birds) {
            for (let i = gameState.foods.length - 1; i >= 0; i--) {
                let f = gameState.foods[i];
                if (f.x === b.x && f.y === b.y) {
                    b.health = Math.min(1.0, b.health + 1);
                    gameState.foods.splice(i, 1);
                    break;
                }
            }
        }
    }

    // Determine whether gooey pipeline is active (slider 0 disables effect)
    const gooActive = gooEnabled && offCtxMask && offCtxMaskBlur;

    // Draw birds or gooey black blobs when enabled
    if (gooActive) {
        // 1) render white shapes into offscreen mask
        ctx = offCtxMask;
        offCtxMask.clearRect(0, 0, canvasWidth, canvasHeight);
        drawBirds(gameState, true); // mask=true draws white shapes

        // 2) blur mask into offscreenMaskBlur
        const blurPx = Math.max(1, gooBlur * 1.35 + 1.5);
        offCtxMaskBlur.clearRect(0, 0, canvasWidth, canvasHeight);
        offCtxMaskBlur.save();
        offCtxMaskBlur.filter = `blur(${blurPx}px)`;
        offCtxMaskBlur.drawImage(offscreenMask, 0, 0);
        offCtxMaskBlur.filter = 'none';
        offCtxMaskBlur.restore();

        // 3) optional threshold to harden mask — low threshold keeps more
        try {
            const MASK_THRESHOLD = 4; // lower threshold -> smoother edges
            let img = offCtxMaskBlur.getImageData(0, 0, canvasWidth, canvasHeight);
            let d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
                d[i + 3] = (l > MASK_THRESHOLD) ? 255 : 0;
            }
            offCtxMaskBlur.putImageData(img, 0, 0);
        } catch (e) {
            console.warn('Mask threshold failed', e);
        }

        // 4) composite into an offscreen composite buffer so we don't
        // affect the already-drawn grid/food on the main canvas.
        offCtxComposite.clearRect(0, 0, canvasWidth, canvasHeight);
        offCtxComposite.save();
        offCtxComposite.fillStyle = 'black';
        offCtxComposite.fillRect(0, 0, canvasWidth, canvasHeight);
        offCtxComposite.globalCompositeOperation = 'destination-in';
        offCtxComposite.drawImage(offscreenMaskBlur, 0, 0);
        offCtxComposite.restore();

        // Draw the composited bird blobs on top of the grid/food
        ctx = mainCtx;
        mainCtx.drawImage(offscreenComposite, 0, 0);
    } else {
        // Normal rendering: draw birds directly to main
        ctx = mainCtx;
        drawBirds(gameState);
    }

    // Draw frame counter last so it's always readable
    drawFrameCounter(gameState.frameCount);
    } catch (err) {
        console.error('Animate loop error', err);
    }
    requestAnimationFrame(animate);
}

// ===== Start =====
window.addEventListener('DOMContentLoaded', () => {
    try {
        // Attempt early audio init (may still be blocked by browser policies)
        birdAudio.ensureContext();
        setup();
        animate();
    } catch (err) {
        console.error('Startup error', err);
    }
});
