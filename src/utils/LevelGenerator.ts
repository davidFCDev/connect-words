// ============ GENERADOR DE NIVELES ALEATORIOS ============
// Genera niveles con caminos hamiltonianos garantizados
// Las letras se colocan en orden a lo largo del camino

// Representa un segmento de pared entre dos celdas adyacentes
export interface WallSegment {
  // Celda 1 (siempre la de arriba o izquierda)
  cell1: { row: number; col: number };
  // Celda 2 (siempre la de abajo o derecha)
  cell2: { row: number; col: number };
  // Orientación: 'horizontal' = pared entre celdas verticalmente adyacentes
  // 'vertical' = pared entre celdas horizontalmente adyacentes
  orientation: "horizontal" | "vertical";
}

// Un muro completo puede tener 2-3 segmentos conectados (línea recta o esquina)
export interface Wall {
  segments: WallSegment[];
}

export interface LevelConfig {
  word: string;
  grid: string[][];
  startPosition: { row: number; col: number };
  difficulty: number;
  gridCols: number;
  gridRows: number;
  // Mapa de "row,col" -> orden de la letra (1-based)
  letterOrderByPosition: Map<string, number>;
  // Paredes que bloquean el paso (nivel 10+)
  walls: Wall[];
}

interface Position {
  row: number;
  col: number;
}

// Palabras disponibles ordenadas por dificultad (longitud)
// Tier 0: 5 letras (niveles 1-3)
// Tier 1: 6 letras (niveles 4-6)
// Tier 2: 7 letras (niveles 7-9)
// Tier 3: 8+ letras (nivel 10+, rotan)
const WORDS_BY_DIFFICULTY: string[][] = [
  ["REMIX", "GAMES", "TOKEN", "BLOCK", "NODES"], // 5 letras
  ["CRYPTO", "GAMER", "WALLET", "MINING"], // 5-6 letras
  ["STAKING", "REWARDS", "TRADING"], // 7 letras
  ["ETHEREUM", "FARCASTER", "METAVERSE", "BLOCKCHAIN"], // 8-10 letras (rotan nivel 10+)
];

// Secuencia fija de palabras por nivel para evitar repeticiones seguidas
// Cada nivel tiene asignada una palabra específica
const LEVEL_WORD_SEQUENCE: string[] = [
  "REMIX", // Nivel 1
  "GAMES", // Nivel 2
  "TOKEN", // Nivel 3
  "CRYPTO", // Nivel 4
  "WALLET", // Nivel 5
  "GAMER", // Nivel 6
  "STAKING", // Nivel 7
  "TRADING", // Nivel 8
  "REWARDS", // Nivel 9
  // Nivel 10+ rota entre las palabras difíciles
];

// Palabras difíciles para nivel 10+
const HARD_WORDS: string[] = [
  "ETHEREUM",
  "FARCASTER",
  "METAVERSE",
  "BLOCKCHAIN",
];

// Configuración de grid por dificultad
const GRID_CONFIG_BY_DIFFICULTY: { cols: number; rows: number }[] = [
  { cols: 5, rows: 6 }, // Nivel 1-3
  { cols: 6, rows: 7 }, // Nivel 4-6
  { cols: 7, rows: 7 }, // Nivel 7-9
  { cols: 7, rows: 8 }, // Nivel 10+
];

export class LevelGenerator {
  private rng: () => number;

  constructor(seed?: number) {
    // Generador de números aleatorios con seed opcional
    if (seed !== undefined) {
      this.rng = this.seededRandom(seed);
    } else {
      this.rng = Math.random;
    }
  }

  // Generador pseudoaleatorio con seed
  private seededRandom(seed: number): () => number {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  // Generar nivel para una dificultad dada
  generateLevel(difficulty: number): LevelConfig {
    const difficultyTier = Math.min(Math.floor((difficulty - 1) / 3), 3);

    // Seleccionar palabra según el nivel
    let word: string;
    if (difficulty <= LEVEL_WORD_SEQUENCE.length) {
      // Niveles 1-9: usar secuencia fija
      word = LEVEL_WORD_SEQUENCE[difficulty - 1];
    } else {
      // Nivel 10+: rotar entre palabras difíciles
      const hardIndex = (difficulty - 10) % HARD_WORDS.length;
      word = HARD_WORDS[hardIndex];
    }

    // Obtener configuración del grid
    const gridConfig = GRID_CONFIG_BY_DIFFICULTY[difficultyTier];
    let { cols, rows } = gridConfig;

    // Ajustar grid si la palabra es muy larga
    const minCells = word.length * 4;
    while (cols * rows < minCells) {
      if (cols <= rows) {
        cols++;
      } else {
        rows++;
      }
    }

    // Generar nivel válido
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      attempts++;
      const result = this.tryGenerateLevel(word, cols, rows, difficulty);
      if (result) {
        return result;
      }
    }

    // Fallback: generar nivel simple tipo serpiente
    return this.generateFallbackLevel(word, cols, rows, difficulty);
  }

  // Intentar generar un nivel con camino hamiltoniano aleatorio
  private tryGenerateLevel(
    word: string,
    cols: number,
    rows: number,
    difficulty: number
  ): LevelConfig | null {
    const totalCells = cols * rows;

    // Elegir posición de inicio aleatoria (preferir esquinas y bordes para más complejidad)
    const startPos = this.chooseStartPosition(cols, rows, difficulty);

    // Generar camino hamiltoniano usando algoritmo de Warnsdorff modificado
    const path = this.generateHamiltonianPath(cols, rows, startPos);

    if (!path || path.length !== totalCells) {
      return null; // No se pudo generar camino completo
    }

    // Colocar letras en posiciones estratégicas del camino
    const letterPositions = this.calculateLetterPositions(
      path,
      word,
      difficulty
    );

    // Crear grid y mapa de posición->orden
    const grid = this.createGrid(cols, rows, path, word, letterPositions);
    const letterOrderByPosition = this.createLetterOrderMap(
      path,
      word,
      letterPositions
    );

    // Generar paredes (solo nivel 10+)
    const walls = this.generateWalls(cols, rows, path, difficulty);

    return {
      word,
      grid,
      startPosition: startPos,
      difficulty,
      gridCols: cols,
      gridRows: rows,
      letterOrderByPosition,
      walls,
    };
  }

  // Elegir posición de inicio
  private chooseStartPosition(
    cols: number,
    rows: number,
    difficulty: number
  ): Position {
    // Para mayor dificultad, elegir posiciones menos obvias
    const positions: Position[] = [];

    // Esquinas
    positions.push({ row: 0, col: 0 });
    positions.push({ row: 0, col: cols - 1 });
    positions.push({ row: rows - 1, col: 0 });
    positions.push({ row: rows - 1, col: cols - 1 });

    // Bordes (en dificultades más altas)
    if (difficulty > 3) {
      for (let c = 1; c < cols - 1; c++) {
        positions.push({ row: 0, col: c });
        positions.push({ row: rows - 1, col: c });
      }
      for (let r = 1; r < rows - 1; r++) {
        positions.push({ row: r, col: 0 });
        positions.push({ row: r, col: cols - 1 });
      }
    }

    // Centro (en dificultades muy altas)
    if (difficulty > 7) {
      const centerR = Math.floor(rows / 2);
      const centerC = Math.floor(cols / 2);
      positions.push({ row: centerR, col: centerC });
      positions.push({ row: centerR - 1, col: centerC });
      positions.push({ row: centerR, col: centerC - 1 });
    }

    return positions[Math.floor(this.rng() * positions.length)];
  }

  // Generar camino hamiltoniano usando Warnsdorff con aleatorización
  private generateHamiltonianPath(
    cols: number,
    rows: number,
    start: Position
  ): Position[] | null {
    const visited: boolean[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(false)
    );
    const path: Position[] = [];

    const directions = [
      { dr: -1, dc: 0 }, // arriba
      { dr: 1, dc: 0 }, // abajo
      { dr: 0, dc: -1 }, // izquierda
      { dr: 0, dc: 1 }, // derecha
    ];

    // Función para contar vecinos no visitados
    const countUnvisitedNeighbors = (r: number, c: number): number => {
      let count = 0;
      for (const { dr, dc } of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
          count++;
        }
      }
      return count;
    };

    // Función para obtener vecinos no visitados ordenados por Warnsdorff (menos opciones primero)
    const getNextMoves = (r: number, c: number): Position[] => {
      const moves: { pos: Position; score: number }[] = [];

      for (const { dr, dc } of directions) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
          const score = countUnvisitedNeighbors(nr, nc);
          // Añadir algo de ruido para no ser predecible
          const noise = this.rng() * 0.5;
          moves.push({ pos: { row: nr, col: nc }, score: score + noise });
        }
      }

      // Ordenar por puntuación (Warnsdorff: elegir el que tenga menos opciones)
      moves.sort((a, b) => a.score - b.score);

      return moves.map((m) => m.pos);
    };

    // Comenzar desde la posición inicial
    let current = start;
    visited[current.row][current.col] = true;
    path.push(current);

    const totalCells = cols * rows;

    while (path.length < totalCells) {
      const nextMoves = getNextMoves(current.row, current.col);

      if (nextMoves.length === 0) {
        // Dead end - el algoritmo falló
        return null;
      }

      // Elegir el siguiente movimiento (Warnsdorff ya los ordenó)
      // Con algo de probabilidad, elegir el segundo mejor para añadir variedad
      let nextIdx = 0;
      if (nextMoves.length > 1 && this.rng() < 0.15) {
        nextIdx = 1;
      }

      current = nextMoves[nextIdx];
      visited[current.row][current.col] = true;
      path.push(current);
    }

    return path;
  }

  // Calcular posiciones de letras en el camino
  private calculateLetterPositions(
    path: Position[],
    word: string,
    difficulty: number
  ): number[] {
    const totalCells = path.length;
    const numLetters = word.length;

    // Para palabras largas, distribuir de forma más uniforme
    const positions: number[] = [];

    // Calcular el espaciado base entre letras
    // Dejamos algo de espacio al inicio y al final
    const usableCells = totalCells - 2; // No usar primera ni última celda directamente
    const spacing = usableCells / (numLetters - 1);

    for (let i = 0; i < numLetters; i++) {
      let pos: number;

      if (i === 0) {
        // Primera letra: entre posición 1 y 3
        pos = Math.min(1 + Math.floor(this.rng() * 2), totalCells - numLetters);
      } else if (i === numLetters - 1) {
        // Última letra: siempre al final
        pos = totalCells - 1;
      } else {
        // Letras intermedias: distribuir con algo de variación
        const basePos = Math.floor(1 + i * spacing);
        const variation = Math.floor(this.rng() * 3) - 1; // -1, 0, o 1
        pos = Math.max(positions[i - 1] + 2, basePos + variation);
        pos = Math.min(pos, totalCells - (numLetters - i)); // Dejar espacio para las siguientes
      }

      // Asegurar que no hay colisiones
      if (i > 0 && pos <= positions[i - 1]) {
        pos = positions[i - 1] + 2;
      }

      positions.push(pos);
    }

    // Verificar que todas las posiciones son válidas
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] >= totalCells) {
        positions[i] = totalCells - 1 - (positions.length - 1 - i);
      }
      if (i > 0 && positions[i] <= positions[i - 1]) {
        positions[i] = positions[i - 1] + 1;
      }
    }

    return positions;
  }

  // Crear el grid con las letras colocadas
  private createGrid(
    cols: number,
    rows: number,
    path: Position[],
    word: string,
    letterPositions: number[]
  ): string[][] {
    // Inicializar grid con puntos
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(".")
    );

    // Colocar letras en las posiciones del camino
    for (let i = 0; i < word.length; i++) {
      const pathIdx = letterPositions[i];
      const pos = path[pathIdx];
      grid[pos.row][pos.col] = word[i];
    }

    return grid;
  }

  // Crear mapa de posición -> orden de letra
  private createLetterOrderMap(
    path: Position[],
    word: string,
    letterPositions: number[]
  ): Map<string, number> {
    const map = new Map<string, number>();

    for (let i = 0; i < word.length; i++) {
      const pathIdx = letterPositions[i];
      const pos = path[pathIdx];
      const key = `${pos.row},${pos.col}`;
      map.set(key, i + 1); // 1-based order
    }

    return map;
  }

  // Generar nivel fallback tipo serpiente (siempre funciona)
  private generateFallbackLevel(
    word: string,
    cols: number,
    rows: number,
    difficulty: number
  ): LevelConfig {
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array(cols).fill(".")
    );

    // Crear camino serpiente
    const path: Position[] = [];
    for (let r = 0; r < rows; r++) {
      if (r % 2 === 0) {
        for (let c = 0; c < cols; c++) {
          path.push({ row: r, col: c });
        }
      } else {
        for (let c = cols - 1; c >= 0; c--) {
          path.push({ row: r, col: c });
        }
      }
    }

    // Colocar letras distribuidas
    const letterPositions = this.calculateLetterPositions(
      path,
      word,
      difficulty
    );
    for (let i = 0; i < word.length; i++) {
      const pos = path[letterPositions[i]];
      grid[pos.row][pos.col] = word[i];
    }

    // Crear mapa de posición -> orden
    const letterOrderByPosition = this.createLetterOrderMap(
      path,
      word,
      letterPositions
    );

    // Generar paredes (solo nivel 10+)
    const walls = this.generateWalls(cols, rows, path, difficulty);

    return {
      word,
      grid,
      startPosition: { row: 0, col: 0 },
      difficulty,
      gridCols: cols,
      gridRows: rows,
      letterOrderByPosition,
      walls,
    };
  }

  // Obtener letra del orden para el mapa de letras
  static getLetterOrderMap(word: string): Map<string, number> {
    const map = new Map<string, number>();
    for (let i = 0; i < word.length; i++) {
      map.set(word[i], i + 1);
    }
    return map;
  }

  // Generar paredes que no bloqueen el camino hamiltoniano
  // Las paredes aparecen desde nivel 7 y aumentan progresivamente
  // Cada muro tiene 2-3 segmentos y puede formar líneas rectas o esquinas
  private generateWalls(
    cols: number,
    rows: number,
    path: Position[],
    difficulty: number
  ): Wall[] {
    // Solo generar paredes a partir del nivel 7
    if (difficulty < 7) {
      return [];
    }

    // Crear un conjunto de bordes usados por el camino (para no bloquearlos)
    const pathEdges = new Set<string>();
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const edge = this.normalizeEdge(p1, p2);
      pathEdges.add(edge);
    }

    // Calcular cuántos muros generar basado en la dificultad
    // Nivel 7-8: 1 muro, Nivel 9-10: 2 muros, Nivel 11-13: 3 muros, Nivel 14+: 4 muros
    let numWalls: number;
    if (difficulty <= 8) {
      numWalls = 1;
    } else if (difficulty <= 10) {
      numWalls = 2;
    } else if (difficulty <= 13) {
      numWalls = 3;
    } else {
      numWalls = 4;
    }

    // Recopilar todos los bordes posibles que NO están en el camino
    const availableEdges: WallSegment[] = [];

    // Bordes horizontales (entre celdas verticalmente adyacentes)
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const p1 = { row: r, col: c };
        const p2 = { row: r + 1, col: c };
        const edge = this.normalizeEdge(p1, p2);
        if (!pathEdges.has(edge)) {
          availableEdges.push({
            cell1: p1,
            cell2: p2,
            orientation: "horizontal",
          });
        }
      }
    }

    // Bordes verticales (entre celdas horizontalmente adyacentes)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p1 = { row: r, col: c };
        const p2 = { row: r, col: c + 1 };
        const edge = this.normalizeEdge(p1, p2);
        if (!pathEdges.has(edge)) {
          availableEdges.push({
            cell1: p1,
            cell2: p2,
            orientation: "vertical",
          });
        }
      }
    }

    // Crear mapa de bordes para búsqueda rápida
    const edgeMap = new Map<string, WallSegment>();
    for (const edge of availableEdges) {
      const key = this.normalizeEdge(edge.cell1, edge.cell2);
      edgeMap.set(key, edge);
    }

    // Mezclar aleatoriamente los bordes disponibles
    const shuffledEdges = [...availableEdges];
    for (let i = shuffledEdges.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [shuffledEdges[i], shuffledEdges[j]] = [
        shuffledEdges[j],
        shuffledEdges[i],
      ];
    }

    // Generar muros multi-segmento
    const walls: Wall[] = [];
    const usedEdges = new Set<string>(); // Bordes ya usados en muros

    for (const startEdge of shuffledEdges) {
      if (walls.length >= numWalls) break;

      const startKey = this.normalizeEdge(startEdge.cell1, startEdge.cell2);
      if (usedEdges.has(startKey)) continue;

      // Intentar construir un muro de 2-3 segmentos desde este borde
      const wall = this.buildMultiSegmentWall(
        startEdge,
        edgeMap,
        usedEdges,
        pathEdges
      );

      if (wall && wall.segments.length >= 2) {
        walls.push(wall);
        // Marcar todos los segmentos como usados
        for (const seg of wall.segments) {
          usedEdges.add(this.normalizeEdge(seg.cell1, seg.cell2));
        }
      }
    }

    return walls;
  }

  // Construir un muro de 2-3 segmentos conectados
  private buildMultiSegmentWall(
    startEdge: WallSegment,
    edgeMap: Map<string, WallSegment>,
    usedEdges: Set<string>,
    pathEdges: Set<string>
  ): Wall | null {
    const segments: WallSegment[] = [startEdge];
    const startKey = this.normalizeEdge(startEdge.cell1, startEdge.cell2);

    // Decidir longitud del muro: 2 o 3 segmentos (60% de 2, 40% de 3)
    const targetLength = this.rng() < 0.6 ? 2 : 3;

    // Buscar segmentos conectados
    let currentSegment = startEdge;

    for (let i = 1; i < targetLength; i++) {
      const nextSegment = this.findConnectedSegment(
        currentSegment,
        segments,
        edgeMap,
        usedEdges,
        pathEdges
      );

      if (nextSegment) {
        segments.push(nextSegment);
        currentSegment = nextSegment;
      } else {
        break; // No se puede extender más
      }
    }

    // Retornar solo si tenemos al menos 2 segmentos
    if (segments.length >= 2) {
      return { segments };
    }
    return null;
  }

  // Encontrar un segmento conectado al segmento actual
  private findConnectedSegment(
    current: WallSegment,
    existingSegments: WallSegment[],
    edgeMap: Map<string, WallSegment>,
    usedEdges: Set<string>,
    pathEdges: Set<string>
  ): WallSegment | null {
    // Los extremos del muro actual son las celdas compartidas por segmentos
    // Buscamos bordes que compartan una celda con el segmento actual

    const candidates: WallSegment[] = [];
    const existingKeys = new Set(
      existingSegments.map((s) => this.normalizeEdge(s.cell1, s.cell2))
    );

    // Buscar bordes adyacentes en las 4 celdas del segmento actual
    const cellsToCheck = [current.cell1, current.cell2];

    for (const cell of cellsToCheck) {
      // Buscar bordes que compartan esta celda
      const neighborPositions = [
        { row: cell.row - 1, col: cell.col },
        { row: cell.row + 1, col: cell.col },
        { row: cell.row, col: cell.col - 1 },
        { row: cell.row, col: cell.col + 1 },
      ];

      for (const neighbor of neighborPositions) {
        const edgeKey = this.normalizeEdge(cell, neighbor);
        const segment = edgeMap.get(edgeKey);

        if (
          segment &&
          !existingKeys.has(edgeKey) &&
          !usedEdges.has(edgeKey) &&
          !pathEdges.has(edgeKey)
        ) {
          candidates.push(segment);
        }
      }
    }

    if (candidates.length === 0) return null;

    // Elegir uno al azar
    const idx = Math.floor(this.rng() * candidates.length);
    return candidates[idx];
  }

  // Normalizar un borde para comparación (siempre "menor" celda primero)
  private normalizeEdge(p1: Position, p2: Position): string {
    if (p1.row < p2.row || (p1.row === p2.row && p1.col < p2.col)) {
      return `${p1.row},${p1.col}-${p2.row},${p2.col}`;
    }
    return `${p2.row},${p2.col}-${p1.row},${p1.col}`;
  }
}

// Singleton para uso fácil
let generatorInstance: LevelGenerator | null = null;

export function generateLevel(difficulty: number, seed?: number): LevelConfig {
  if (!generatorInstance || seed !== undefined) {
    generatorInstance = new LevelGenerator(seed);
  }
  return generatorInstance.generateLevel(difficulty);
}

export function generateLevelWithWord(
  word: string,
  difficulty: number,
  seed?: number
): LevelConfig {
  const generator = new LevelGenerator(seed);
  const difficultyTier = Math.min(Math.floor((difficulty - 1) / 3), 3);
  const gridConfig = GRID_CONFIG_BY_DIFFICULTY[difficultyTier];

  // Ajustar grid si la palabra es muy larga
  let { cols, rows } = gridConfig;
  const minCells = word.length * 4; // Necesitamos al menos 4 celdas por letra

  while (cols * rows < minCells) {
    if (cols <= rows) {
      cols++;
    } else {
      rows++;
    }
  }

  // Generar nivel
  let attempts = 0;
  while (attempts < 100) {
    attempts++;
    const startPos = generator["chooseStartPosition"](cols, rows, difficulty);
    const path = generator["generateHamiltonianPath"](cols, rows, startPos);

    if (path && path.length === cols * rows) {
      const letterPositions = generator["calculateLetterPositions"](
        path,
        word,
        difficulty
      );
      const grid = generator["createGrid"](
        cols,
        rows,
        path,
        word,
        letterPositions
      );
      const letterOrderByPosition = generator["createLetterOrderMap"](
        path,
        word,
        letterPositions
      );
      const walls = generator["generateWalls"](cols, rows, path, difficulty);

      return {
        word,
        grid,
        startPosition: startPos,
        difficulty,
        gridCols: cols,
        gridRows: rows,
        letterOrderByPosition,
        walls,
      };
    }
  }

  // Fallback
  return generator["generateFallbackLevel"](word, cols, rows, difficulty);
}
