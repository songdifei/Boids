// ===== Shape Drawing Functions =====
let ctx; // Set by app.js

// SVG cache: loaded SVG data for shapes 6-14 (Asset 1-9)
let svgShapes = {};

// Load SVG shapes from files
async function loadSVGShapes() {
    const svgFiles = [
        'SVG/Asset%201.svg',
        'SVG/Asset%202.svg',
        'SVG/Asset%203.svg',
        'SVG/Asset%204.svg',
        'SVG/Asset%205.svg',
        'SVG/Asset%206.svg',
        'SVG/Asset%207.svg',
        'SVG/Asset%208.svg',
        'SVG/Asset%209.svg'
    ];
    
    for (let i = 0; i < svgFiles.length; i++) {
        try {
            const response = await fetch(svgFiles[i]);
            const svgText = await response.text();
            const parser = new DOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
            svgShapes[i + 6] = svgDoc.documentElement;
        } catch (e) {
            console.warn(`Failed to load ${svgFiles[i]}:`, e);
        }
    }
}

// Call this on page load
loadSVGShapes();

function drawShape(shapeMode, cx, cy, size, color, vx, vy) {
    // Only SVG shapes (1-8) and Arrow (0 for backward compatibility)
    if (shapeMode === 0) {
        // Arrow shape - always rotates with bird direction
        drawArrow(cx, cy, size, color, vx, vy);
    } else if (shapeMode >= 1 && shapeMode <= 8) {
        // SVG shapes 1-8 (Asset 1-8)
        drawSVGShape(shapeMode - 1, cx, cy, size, color, vx, vy);
    } else {
        // Fallback to Arrow
        drawArrow(cx, cy, size, color, vx, vy);
    }
}

function drawSVGShape(assetIndex, cx, cy, size, color, vx, vy) {
    // assetIndex: 0-7 (Asset 1-8)
    const svgShapeId = assetIndex + 6; // Maps to 6-13 in svgShapes
    const svgElement = svgShapes[svgShapeId];
    if (!svgElement) {
        // Fallback to Arrow if SVG not loaded
        drawArrow(cx, cy, size, color, vx, vy);
        return;
    }

    ctx.save();
    ctx.translate(cx, cy);
    
    // Only Asset 8? Wait: originally 9 rotated; now only use last asset (index 7, id 13)
    let angle = 0;
    if (assetIndex === 7 && (Math.abs(vx) > 0.0001 || Math.abs(vy) > 0.0001)) {
        angle = Math.atan2(vy, vx);
        ctx.rotate(angle);
    }

    // Get viewBox dimensions
    const viewBox = svgElement.getAttribute('viewBox');
    let vbWidth = 100, vbHeight = 100;
    if (viewBox) {
        const parts = viewBox.split(/[\s,]+/);
        if (parts.length >= 4) {
            vbWidth = parseFloat(parts[2]);
            vbHeight = parseFloat(parts[3]);
        }
    }

    // Scale to fit the desired size
    const scale = size / Math.max(vbWidth, vbHeight);
    ctx.scale(scale, scale);
    ctx.translate(-vbWidth / 2, -vbHeight / 2);

    // Set fill color
    ctx.fillStyle = color;

    // Draw paths from the SVG
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
            const cx = parseFloat(el.getAttribute('cx') || 0);
            const cy = parseFloat(el.getAttribute('cy') || 0);
            const r = parseFloat(el.getAttribute('r'));
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
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

function drawArrow(cx, cy, size, color, vx, vy) {
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(cx, cy);

    // Calculate rotation angle based on velocity
    let angle;
    if (Math.abs(vx) < 0.0001 && Math.abs(vy) < 0.0001) {
        angle = -Math.PI / 2;
    } else {
        angle = Math.atan2(vy, vx);
    }
    ctx.rotate(angle);

    let len = size;
    let w = size * 0.4;
    ctx.beginPath();
    ctx.moveTo(-len * 0.4, -w * 0.3);
    ctx.lineTo(0, -w * 0.3);
    ctx.lineTo(0, -w);
    ctx.lineTo(len * 0.6, 0);
    ctx.lineTo(0, w);
    ctx.lineTo(0, w * 0.3);
    ctx.lineTo(-len * 0.4, w * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawGrid(gameState) {
    if (!gameState.showGrid) return;
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const cellSize = gameState.cellSize;
    const offsetY = gameState.renderOffsetY || 0;
    
    // Draw vertical grid lines (spanning full canvas width)
    const numVerticalLines = Math.ceil(canvasWidth / cellSize) + 1;
    for (let i = 0; i <= numVerticalLines; i++) {
        const x = i * cellSize;
        if (x <= canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvasHeight);
            ctx.stroke();
        }
    }
    
    // Draw horizontal grid lines (spanning full canvas height)
    const numHorizontalLines = Math.ceil(canvasHeight / cellSize) + 1;
    for (let i = 0; i <= numHorizontalLines; i++) {
        const y = i * cellSize;
        if (y <= canvasHeight) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvasWidth, y);
            ctx.stroke();
        }
    }
}

function drawFood(gameState) {
    ctx.fillStyle = 'black';
    const offsetY = gameState.renderOffsetY || 0;
    for (let f of gameState.foods) {
        const cx = f.x * gameState.cellSize + gameState.cellSize / 2;
        const cy = f.y * gameState.cellSize + gameState.cellSize / 2 + offsetY;
        ctx.beginPath();
        ctx.arc(cx, cy, gameState.cellSize / 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBirds(gameState, mask = false) {
    for (let b of gameState.birds) {
        b.display(gameState, gameState.cellSize, mask);
    }
}

function drawFrameCounter(frameCount) {
    ctx.fillStyle = 'black';
    ctx.font = '14px Arial';
    ctx.fillText('Frame: ' + frameCount, 10, 20);
}
