// ===== Utility Functions =====

// Shared layout helper so grid math stays consistent across sampling, spawning, and sizing.
function computeWordLayout(wordInput, resolutionInput) {
    const word = (wordInput && wordInput.length > 0) ? wordInput.toUpperCase() : 'A';
    const resolution = (resolutionInput && resolutionInput > 0) ? resolutionInput : BASE_SIZE;

    const glyphRegion = resolution;
    const marginPerSide = Math.floor(glyphRegion / 2);
    const spacingUnits = Math.round(glyphRegion * 0.2);

    const n = word.length;
    const letterWidths = [];
    const letterStarts = [];
    let contentWidth = 0;

    // Use proportional metrics if a custom font is active
    const useMetrics = (typeof gameState !== 'undefined' && gameState && gameState.customFontFamily && gameState.glyphMetrics);

    for (let i = 0; i < n; i++) {
        const ch = word[i];
        let w = glyphRegion;
        if (useMetrics) {
            try {
                const m = gameState.glyphMetrics && gameState.glyphMetrics[ch];
                if (m && typeof m.width === 'number' && m.width > 0) {
                    w = Math.min(glyphRegion, Math.max(1, Math.round(m.width)));
                }
            } catch (e) {}
        }
        letterStarts.push(contentWidth);
        letterWidths.push(w);
        contentWidth += w;
        if (i < n - 1) contentWidth += spacingUnits;
    }

    const contentHeight = glyphRegion;
    const gridWidth = Math.ceil(contentWidth + marginPerSide * 2);
    const gridHeight = Math.ceil(contentHeight + marginPerSide * 2);

    // Provide legacy fields for monospace fallback code paths
    const letterWidthUnits = glyphRegion;
    const letterWidthWithSpacing = letterWidthUnits + spacingUnits;

    return {
        word,
        resolution,
        glyphRegion,
        marginPerSide,
        spacingUnits,
        letterWidths,
        letterStarts,
        contentWidth,
        contentHeight,
        gridWidth,
        gridHeight,
        letterWidthUnits,
        letterWidthWithSpacing,
        useMetrics: !!useMetrics
    };
}

function getLetterPixel(i, j, gridSize) {
    // Support for multi-letter words with week-6 nearest-neighbor resampling
    let word = '';
    let resolution = gridSize;
    try {
        if (typeof gameState !== 'undefined') {
            if (typeof gameState.wordBuffer === 'string') {
                word = gameState.wordBuffer;
            }
            if (typeof gameState.gridSize === 'number') {
                resolution = gameState.gridSize;
            }
        }
    } catch (e) {
        // ignore
    }

    const layout = computeWordLayout(word, resolution);

    // Reject points that fall in the outer margins
    if (i < layout.marginPerSide || i >= layout.gridHeight - layout.marginPerSide ||
        j < layout.marginPerSide || j >= layout.gridWidth - layout.marginPerSide) {
        return 0;
    }

    // Local coords inside content area
    const localI = i - layout.marginPerSide;
    const localJ = j - layout.marginPerSide;

    // Figure out which letter and the position within that letter (supports variable widths)
    let letterIndex = -1;
    let posInLetter = 0;
    if (layout.useMetrics && layout.letterStarts && layout.letterWidths) {
        for (let idx = 0; idx < layout.word.length; idx++) {
            const start = layout.letterStarts[idx];
            const w = layout.letterWidths[idx];
            if (localJ >= start && localJ < start + w) {
                letterIndex = idx;
                posInLetter = localJ - start;
                break;
            }
        }
        if (letterIndex === -1) return 0; // in spacing gap
    } else {
        // Monospace fallback
        letterIndex = Math.floor(localJ / layout.letterWidthWithSpacing);
        posInLetter = localJ - letterIndex * layout.letterWidthWithSpacing;
        if (posInLetter >= layout.letterWidthUnits) return 0; // spacing
    }
    if (letterIndex >= layout.word.length) return 0;
    if (localI < 0 || localI >= layout.glyphRegion) return 0;

    // Lookup glyph bitmap
    const letter = layout.word[letterIndex];
    let glyphArray = null;
    try {
        if (typeof GLYPHS !== 'undefined' && GLYPHS[letter]) {
            glyphArray = GLYPHS[letter];
        }
    } catch (e) {
        // ignore
    }
    if (!glyphArray) return 0;

    // Map from target glyphRegion to the source glyph bitmap resolution dynamically.
    const glyphDim = Math.max(1, Math.round(Math.sqrt(glyphArray.length)));
    const denomI = Math.max(1, layout.glyphRegion - 1);
    const sy = (glyphDim - 1) / denomI;

    let srcI = Math.round(localI * sy);
    srcI = Math.max(0, Math.min(glyphDim - 1, srcI));

    let srcJ;
    if (layout.useMetrics && typeof gameState !== 'undefined' && gameState.glyphMetrics && gameState.glyphMetrics[letter]) {
        const m = gameState.glyphMetrics[letter];
        const w = Math.max(1, layout.letterWidths[letterIndex]);
        const activeW = Math.max(1, m.width);
        const denomJ = Math.max(1, w - 1);
        const t = denomJ > 0 ? (posInLetter / denomJ) : 0;
        const jWithin = Math.round(t * (activeW - 1));
        srcJ = Math.max(0, Math.min(glyphDim - 1, m.minCol + jWithin));
    } else {
        const denomJ = Math.max(1, layout.glyphRegion - 1);
        const sx = (glyphDim - 1) / denomJ;
        srcJ = Math.round(posInLetter * sx);
        srcJ = Math.max(0, Math.min(glyphDim - 1, srcJ));
    }

    return glyphArray[srcI * glyphDim + srcJ] ? 1 : 0;
}

function calculateGridSizeForWord(word) {
    const layout = computeWordLayout(word, BASE_SIZE);
    return Math.ceil(Math.max(layout.gridWidth, layout.gridHeight));
}

function initBirds(gameState) {
    gameState.birds = [];
    gameState.foods = [];

    const layout = computeWordLayout(gameState.wordBuffer || 'A', gameState.gridSize || BASE_SIZE);
    const yOffset = gameState.spawnOffsetRows || 0;

    for (let i = 0; i < layout.gridHeight; i++) {
        for (let j = 0; j < layout.gridWidth; j++) {
            if (getLetterPixel(i, j, layout.gridHeight) === 1) {
                const b = new Bird(j, i + yOffset);
                const or = (typeof gameState.offsetRange === 'number') ? gameState.offsetRange : 0;
                b.offsetX = (Math.random() * 2 - 1) * or;
                b.offsetY = (Math.random() * 2 - 1) * or;
                b.homeBias = 0.9 + Math.random() * 0.2;
                gameState.birds.push(b);
            }
        }
    }
}

function spawnFood(gameState) {
    gameState.foods = [];

    const layout = computeWordLayout(gameState.wordBuffer || 'A', gameState.gridSize || BASE_SIZE);
    const yOffset = gameState.spawnOffsetRows || 0;

    for (let i = 0; i < layout.gridHeight; i++) {
        for (let j = 0; j < layout.gridWidth; j++) {
            if (getLetterPixel(i, j, layout.gridHeight) === 1) {
                gameState.foods.push({ x: j, y: i + yOffset });
            }
        }
    }
}

function calculateCanvasWidth(word, resolution, canvasHeight) {
    if (!canvasHeight || canvasHeight < 1) canvasHeight = 600;

    const layout = computeWordLayout(word, resolution);
    // Match cell size to what computeGridInfo sets: CANVAS_SIZE / (gridSize + 2*margin)
    const pixelSize = canvasHeight / layout.gridHeight;
    const canvasWidth = layout.gridWidth * pixelSize;

    return Math.ceil(canvasWidth);
}

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        let j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

