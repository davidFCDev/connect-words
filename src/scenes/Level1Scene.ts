import type { FarcadeSDK } from "@farcade/game-sdk";
import GameSettings from "../config/GameSettings";
import {
  generateLevel,
  type LevelConfig,
  type Wall,
  type WallSegment,
} from "../utils/LevelGenerator";

declare global {
  interface Window {
    FarcadeSDK: FarcadeSDK;
  }
}

// ============ TIPOS Y CONSTANTES ============

interface Cell {
  row: number;
  col: number;
  type: "dot" | "letter";
  letter?: string;
  letterOrder?: number; // 1=R, 2=E, 3=M, 4=I, 5=X
  isStart: boolean;
  isConnected: boolean;
  graphics: Phaser.GameObjects.Container;
  dotGraphic?: Phaser.GameObjects.Arc;
  letterText?: Phaser.GameObjects.Text;
  letterCircle?: Phaser.GameObjects.Arc; // Circunferencia alrededor de la letra
  shadowOverlay?: Phaser.GameObjects.Graphics;
}

interface ConnectionLine {
  fromCell: Cell;
  toCell: Cell;
  graphics: Phaser.GameObjects.Graphics;
}

// ============ NIVEL CON CAMINO HAMILTONIANO VERIFICADO ============
// Camino serpiente garantizado: todas las celdas se visitan exactamente una vez
// Las letras R→E→M→I→X están colocadas EN ORDEN a lo largo del camino
//
// CAMINO SOLUCIÓN (30 celdas, coordenadas [fila,col]):
// [0,0]→[0,1]→[0,2]→[0,3]→[0,4]→  (fila 0: izq a der)
// [1,4]→[1,3]→[1,2]→[1,1]→[1,0]→  (fila 1: der a izq)
// [2,0]→[2,1]→[2,2]→[2,3]→[2,4]→  (fila 2: izq a der)
// [3,4]→[3,3]→[3,2]→[3,1]→[3,0]→  (fila 3: der a izq)
// [4,0]→[4,1]→[4,2]→[4,3]→[4,4]→  (fila 4: izq a der)
// [5,4]→[5,3]→[5,2]→[5,1]→[5,0]   (fila 5: der a izq) - FIN
//
// Letras en posiciones del camino:
// R en posición 5 del camino  = [0,4]
// E en posición 10 del camino = [1,0]
// M en posición 15 del camino = [2,4]
// I en posición 21 del camino = [3,0]
// X en posición 30 del camino = [5,0] (FINAL)

const VERIFIED_LEVEL_CONFIG = {
  word: "REMIX",
  grid: [
    // Fila 0: → → → → R
    [".", ".", ".", ".", "R"],
    // Fila 1: E ← ← ← ←
    ["E", ".", ".", ".", "."],
    // Fila 2: → → → → M
    [".", ".", ".", ".", "M"],
    // Fila 3: I ← ← ← ←
    ["I", ".", ".", ".", "."],
    // Fila 4: → → → → →
    [".", ".", ".", ".", "."],
    // Fila 5: X ← ← ← ←
    ["X", ".", ".", ".", "."],
  ],
  startPosition: { row: 0, col: 0 },
};

// Usamos la configuración verificada como fallback
const LEVEL_1_CONFIG = VERIFIED_LEVEL_CONFIG;

// Colores neón - Verde lima original del proyecto
const NEON_COLORS = {
  electricBlue: 0xb7ff01,
  electricBlueLight: 0xd4ff66,
  electricWhite: 0xffffff,
  darkBlue: 0x000508,
  darkBg: 0x020304,
  offColor: 0x1a1a24,
  offColorDim: 0x0f0f18,
  glowColor: 0x8acc00,
  letterOff: 0x2a2a3a,
  letterOn: 0xb7ff01,
  lineColor: 0xb7ff01,
  sparkColor: 0xd4ff88,
  // Colores para muros (tonos rojizos/naranjas)
  wallColor: 0xff4444,
  wallGlow: 0xff6666,
  wallCore: 0xff8888,
};

// Configuración base del grid (se ajusta según el nivel)
const BASE_CELL_SIZE = 100;
const CELL_GAP = 8;
const GRID_PADDING = 40;

// Variables dinámicas del grid
let GRID_COLS = 5;
let GRID_ROWS = 6;
let CELL_SIZE = 100;

export class Level1Scene extends Phaser.Scene {
  // Grid y estado del juego
  private cells: Cell[][] = [];
  private path: Cell[] = [];
  private connectionLines: ConnectionLine[] = [];

  // Gráficos
  private gridContainer!: Phaser.GameObjects.Container;
  private linesGraphics!: Phaser.GameObjects.Graphics;
  private wordContainer!: Phaser.GameObjects.Container;
  private wordLetters: Phaser.GameObjects.Text[] = [];

  // UI
  private progressText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerContainer!: Phaser.GameObjects.Container;
  private timerCircle!: Phaser.GameObjects.Graphics;
  private timeRemaining: number = 30; // 30 segundos base
  private maxTime: number = 30; // Tiempo máximo para la barra circular
  private undoButton!: Phaser.GameObjects.Container;
  private gameWon: boolean = false;

  // Score
  private score: number = 0;
  private scoreText!: Phaser.GameObjects.Text;

  // Estado de input
  private isDragging: boolean = false;
  private currentCell: Cell | null = null;

  // Letras y orden
  private letterOrder: Map<string, number> = new Map();
  private nextExpectedLetter: number = 1;
  private totalCells: number = 0;

  // Audio
  private audioContext: AudioContext | null = null;
  private audioInitialized: boolean = false;

  // Shaders y efectos
  private glowPipeline: any = null;
  private time_elapsed: number = 0;

  // Efectos de electricidad
  private electricParticles: Phaser.GameObjects.Arc[] = [];
  private lightningGraphics!: Phaser.GameObjects.Graphics;
  private startCellIndicator!: Phaser.GameObjects.Container;

  // Sistema de iluminación
  private lightingOverlay!: Phaser.GameObjects.Graphics;
  private sparks: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    alpha: number;
  }[] = [];
  private currentEndPlasma: Phaser.GameObjects.Container | null = null;

  // Optimización de rendimiento
  private needsLineRedraw: boolean = false;
  private frameCount: number = 0;

  // Posición del grid para detección de celdas
  private gridStartX: number = 0;
  private gridStartY: number = 0;

  // Control de animación de electricidad
  private electricityFrame: number = 0;

  // Sistema de paredes (nivel 10+)
  private walls: Wall[] = [];
  private wallsGraphics!: Phaser.GameObjects.Graphics;
  private wallBlockedEdges: Set<string> = new Set(); // "row1,col1-row2,col2"

  // Nivel actual y configuración dinámica
  private currentLevel: number = 1;
  private currentLevelConfig!: LevelConfig;

  constructor() {
    super({ key: "Level1Scene" });
  }

  init(data?: { level?: number; score?: number }): void {
    // Obtener nivel de los datos pasados o usar 1
    this.currentLevel = data?.level ?? 1;
    // Preservar score entre niveles
    this.score = data?.score ?? 0;

    // IMPORTANTE: Resetear todas las variables de estado para el nuevo nivel
    this.cells = [];
    this.path = [];
    this.connectionLines = [];
    this.wordLetters = [];
    this.gameWon = false;
    this.isDragging = false;
    this.currentCell = null;
    this.nextExpectedLetter = 1;
    this.totalCells = 0;
    this.time_elapsed = 0;
    this.electricParticles = [];
    this.sparks = [];
    this.currentEndPlasma = null;
    this.needsLineRedraw = false;
    this.frameCount = 0;
    this.electricityFrame = 0;
    this.walls = [];
    this.wallBlockedEdges = new Set();
    // Calcular tiempo según dificultad: 20s base + 3s por cada tier de dificultad
    // Nivel 1-3: 20s, Nivel 4-6: 23s, Nivel 7-9: 26s, Nivel 10-14: 32s, Nivel 15+: 40s
    const difficultyTier = Math.min(Math.floor((this.currentLevel - 1) / 3), 3);
    const levelTime =
      20 +
      difficultyTier * 3 +
      (this.currentLevel >= 10 ? 6 : 0) +
      (this.currentLevel >= 15 ? 8 : 0);
    this.timeRemaining = levelTime;
    this.maxTime = levelTime;

    // Generar nivel aleatorio
    this.currentLevelConfig = generateLevel(this.currentLevel);

    // Actualizar configuración del grid
    GRID_COLS = this.currentLevelConfig.gridCols;
    GRID_ROWS = this.currentLevelConfig.gridRows;

    // Ajustar tamaño de celda según el grid
    const { width, height } = GameSettings.canvas;
    const availableWidth = width - GRID_PADDING * 2;
    const availableHeight = height - 280; // Espacio para UI
    const maxCellWidth =
      (availableWidth - (GRID_COLS - 1) * CELL_GAP) / GRID_COLS;
    const maxCellHeight =
      (availableHeight - (GRID_ROWS - 1) * CELL_GAP) / GRID_ROWS;
    CELL_SIZE = Math.min(BASE_CELL_SIZE, maxCellWidth, maxCellHeight);

    // El mapa de orden de letras ahora viene del generador por posición
    // (ya no usamos this.letterOrder basado en la letra, sino letterOrderByPosition)

    // Almacenar las paredes del nivel y crear el set de bordes bloqueados
    this.walls = this.currentLevelConfig.walls || [];
    this.buildWallBlockedEdges();
  }

  // Construye el set de bordes bloqueados por paredes para búsqueda rápida
  private buildWallBlockedEdges(): void {
    this.wallBlockedEdges.clear();
    for (const wall of this.walls) {
      // Cada muro tiene múltiples segmentos
      for (const segment of wall.segments) {
        const edge = this.normalizeEdge(
          segment.cell1.row,
          segment.cell1.col,
          segment.cell2.row,
          segment.cell2.col
        );
        this.wallBlockedEdges.add(edge);
      }
    }
  }

  // Normaliza un borde para comparación consistente
  private normalizeEdge(
    r1: number,
    c1: number,
    r2: number,
    c2: number
  ): string {
    if (r1 < r2 || (r1 === r2 && c1 < c2)) {
      return `${r1},${c1}-${r2},${c2}`;
    }
    return `${r2},${c2}-${r1},${c1}`;
  }

  create(): void {
    this.initAudio();
    this.createBackground();
    this.createLightingSystem();
    this.createGlowShader();
    this.createTimer();
    this.createLevelIndicator();
    this.createGrid();
    this.createWalls(); // Renderizar paredes después del grid
    this.createWordDisplay();
    this.setupInput();
    this.createInstructions();

    // Iniciar el camino desde la celda de inicio
    const startCell =
      this.cells[this.currentLevelConfig.startPosition.row][
        this.currentLevelConfig.startPosition.col
      ];
    this.activateCell(startCell);
  }

  // Cache para evitar recálculos del timer
  private lastDisplayedTime: number = -1;

  update(time: number, delta: number): void {
    this.time_elapsed += delta;
    this.frameCount++;

    // Actualizar timer (solo redibujar cuando cambia el segundo mostrado)
    if (!this.gameWon && this.timeRemaining > 0) {
      this.timeRemaining -= delta / 1000;
      if (this.timeRemaining < 0) this.timeRemaining = 0;

      const displayTime = Math.floor(this.timeRemaining);
      if (displayTime !== this.lastDisplayedTime) {
        this.lastDisplayedTime = displayTime;
        this.updateTimerDisplay();
      }
    }

    // Redibujar líneas solo cuando es necesario
    if (this.needsLineRedraw) {
      this.redrawConnectionLines();
      this.needsLineRedraw = false;
    }

    // Efectos de plasma cada 8 frames (reducido de 4)
    if (this.frameCount % 8 === 0) {
      this.updatePlasmaRays();
    }

    // Física de chispas solo si hay chispas
    if (this.sparks.length > 0) {
      this.updateSparks(delta);

      // Overlay de iluminación solo cada 4 frames y si hay chispas
      if (this.frameCount % 4 === 0) {
        this.updateLighting();
      }
    }
  }

  // ============ INICIALIZACIÓN ============

  private initAudio(): void {
    if (this.audioInitialized) return;
    try {
      this.audioContext = new window.AudioContext();
      this.audioInitialized = true;
    } catch (e) {
      console.warn("[Level1Scene] Web Audio API not available:", e);
    }
  }

  private createBackground(): void {
    const { width, height } = GameSettings.canvas;

    // Fondo muy oscuro - casi negro (una sola capa, sin viñetas múltiples)
    const bg = this.add.graphics();
    bg.fillStyle(0x010103, 1);
    bg.fillRect(0, 0, width, height);
  }

  private createLightingSystem(): void {
    // Overlay para iluminación dinámica - se dibuja encima de todo
    // pero NO bloquea el input
    this.lightingOverlay = this.add.graphics();
    this.lightingOverlay.setDepth(1000);
    this.lightingOverlay.setBlendMode(Phaser.BlendModes.ADD);
  }

  private createGlowShader(): void {
    // Sistema de glow mediante capas de graphics
  }

  private createGrid(): void {
    const { width, height } = GameSettings.canvas;

    // Calcular posición del grid centrado
    const gridWidth = GRID_COLS * CELL_SIZE + (GRID_COLS - 1) * CELL_GAP;
    const gridHeight = GRID_ROWS * CELL_SIZE + (GRID_ROWS - 1) * CELL_GAP;
    const startX = (width - gridWidth) / 2;
    // Centrar verticalmente considerando la barra de palabra abajo
    const startY = (height - gridHeight - 180) / 2 + 80;

    // Guardar para detección de celdas
    this.gridStartX = startX;
    this.gridStartY = startY;

    this.gridContainer = this.add.container(0, 0);
    this.linesGraphics = this.add.graphics();

    this.cells = [];
    this.totalCells = 0;

    const levelGrid = this.currentLevelConfig.grid;
    const startPos = this.currentLevelConfig.startPosition;

    for (let row = 0; row < GRID_ROWS; row++) {
      this.cells[row] = [];
      for (let col = 0; col < GRID_COLS; col++) {
        const cellConfig = levelGrid[row][col];
        const isLetter = cellConfig !== ".";
        const isStart = row === startPos.row && col === startPos.col;

        const x = startX + col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
        const y = startY + row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;

        const cell = this.createCell(
          row,
          col,
          x,
          y,
          isLetter ? cellConfig : undefined,
          isStart
        );
        this.cells[row][col] = cell;
        this.totalCells++;
      }
    }
  }

  // Renderizar las paredes que bloquean el movimiento
  private createWalls(): void {
    if (this.walls.length === 0) return;

    this.wallsGraphics = this.add.graphics();

    const cellTotalSize = CELL_SIZE + CELL_GAP;
    const wallThickness = 5; // Más fino
    const wallLength = CELL_SIZE + CELL_GAP; // Ocupa todo el ancho entre celdas

    for (const wall of this.walls) {
      // Renderizar cada segmento del muro
      for (const segment of wall.segments) {
        this.renderWallSegment(
          segment,
          cellTotalSize,
          wallThickness,
          wallLength
        );
      }
    }
  }

  // Renderizar un segmento individual de muro
  private renderWallSegment(
    segment: WallSegment,
    cellTotalSize: number,
    wallThickness: number,
    wallLength: number
  ): void {
    // Calcular posición del centro entre las dos celdas
    const cell1X =
      this.gridStartX + segment.cell1.col * cellTotalSize + CELL_SIZE / 2;
    const cell1Y =
      this.gridStartY + segment.cell1.row * cellTotalSize + CELL_SIZE / 2;
    const cell2X =
      this.gridStartX + segment.cell2.col * cellTotalSize + CELL_SIZE / 2;
    const cell2Y =
      this.gridStartY + segment.cell2.row * cellTotalSize + CELL_SIZE / 2;

    const centerX = (cell1X + cell2X) / 2;
    const centerY = (cell1Y + cell2Y) / 2;

    // Dibujar glow sutil
    this.wallsGraphics.fillStyle(NEON_COLORS.wallColor, 0.25);
    if (segment.orientation === "horizontal") {
      // Pared horizontal (bloquea movimiento vertical)
      this.wallsGraphics.fillRoundedRect(
        centerX - wallLength / 2 - 2,
        centerY - wallThickness / 2 - 2,
        wallLength + 4,
        wallThickness + 4,
        2
      );
    } else {
      // Pared vertical (bloquea movimiento horizontal)
      this.wallsGraphics.fillRoundedRect(
        centerX - wallThickness / 2 - 2,
        centerY - wallLength / 2 - 2,
        wallThickness + 4,
        wallLength + 4,
        2
      );
    }

    // Dibujar la pared principal (sólida)
    this.wallsGraphics.fillStyle(NEON_COLORS.wallColor, 1);
    if (segment.orientation === "horizontal") {
      this.wallsGraphics.fillRoundedRect(
        centerX - wallLength / 2,
        centerY - wallThickness / 2,
        wallLength,
        wallThickness,
        2
      );
    } else {
      this.wallsGraphics.fillRoundedRect(
        centerX - wallThickness / 2,
        centerY - wallLength / 2,
        wallThickness,
        wallLength,
        2
      );
    }
  }

  private createCell(
    row: number,
    col: number,
    x: number,
    y: number,
    letter?: string,
    isStart: boolean = false
  ): Cell {
    const container = this.add.container(x, y);
    container.setData("cellType", letter ? "letter" : "dot");

    // Fondo de la celda - muy oscuro
    const cellBg = this.add.graphics();
    cellBg.fillStyle(0x050508, 0.95);
    cellBg.lineStyle(1, NEON_COLORS.offColor, 0.3);
    cellBg.fillRoundedRect(
      -CELL_SIZE / 2,
      -CELL_SIZE / 2,
      CELL_SIZE,
      CELL_SIZE,
      12
    );
    cellBg.strokeRoundedRect(
      -CELL_SIZE / 2,
      -CELL_SIZE / 2,
      CELL_SIZE,
      CELL_SIZE,
      12
    );
    container.add(cellBg);

    // Overlay de sombra para celdas no conectadas (efecto de oscuridad)
    // La celda de inicio no tiene sombra porque ya está iluminada
    const shadowOverlay = this.add.graphics();
    shadowOverlay.fillStyle(0x000000, 0.7);
    shadowOverlay.fillRoundedRect(
      -CELL_SIZE / 2,
      -CELL_SIZE / 2,
      CELL_SIZE,
      CELL_SIZE,
      12
    );
    if (isStart) {
      shadowOverlay.setAlpha(0); // Sin sombra en la celda inicial
    }
    container.add(shadowOverlay);

    let dotGraphic: Phaser.GameObjects.Arc | undefined;
    let letterText: Phaser.GameObjects.Text | undefined;
    let letterCircle: Phaser.GameObjects.Arc | undefined;

    if (letter) {
      // Circunferencia alrededor de la letra (para conectar líneas)
      letterCircle = this.add.circle(0, 0, 32);
      letterCircle.setStrokeStyle(2, NEON_COLORS.offColor, 0.3);
      container.add(letterCircle);

      // Es una letra - estilo moderno, muy tenue cuando apagada
      letterText = this.add.text(0, 0, letter, {
        fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        fontSize: "44px",
        color: "#1a1a2a",
        fontStyle: "bold",
      });
      letterText.setOrigin(0.5, 0.5);
      container.add(letterText);
    } else {
      // Es un punto - iluminado si es inicio, tenue si no
      dotGraphic = this.add.circle(
        0,
        0,
        8,
        isStart ? NEON_COLORS.electricBlue : 0x0a0a12
      );
      if (!isStart) {
        dotGraphic.setStrokeStyle(1, NEON_COLORS.offColorDim, 0.5);
      } else {
        dotGraphic.setStrokeStyle(2, NEON_COLORS.electricWhite, 0.8);
      }
      container.add(dotGraphic);

      // Si es la celda de inicio, añadir efecto de plasma
      if (isStart) {
        this.createStartIndicator(container);
      }
    }

    this.gridContainer.add(container);

    // Obtener el orden de la letra por posición (soporta letras repetidas)
    const positionKey = `${row},${col}`;
    const letterOrder = letter
      ? this.currentLevelConfig.letterOrderByPosition.get(positionKey)
      : undefined;

    const cell: Cell = {
      row,
      col,
      type: letter ? "letter" : "dot",
      letter,
      letterOrder,
      isStart,
      isConnected: false,
      graphics: container,
      dotGraphic,
      letterText,
      letterCircle,
      shadowOverlay,
    };

    // Hacer la celda interactiva
    container.setSize(CELL_SIZE, CELL_SIZE);
    container.setInteractive();

    return cell;
  }

  private createStartIndicator(container: Phaser.GameObjects.Container): void {
    // Efecto de bola de plasma con rayos internos
    this.createPlasmaEffect(container);
  }

  private createPlasmaEffect(container: Phaser.GameObjects.Container): void {
    // Núcleo brillante central
    const core = this.add.circle(0, 0, 8, NEON_COLORS.electricWhite, 0.9);
    container.add(core);

    // Anillo interior pulsante
    const innerRing = this.add.circle(0, 0, 20);
    innerRing.setStrokeStyle(1, NEON_COLORS.electricBlue, 0.6);
    innerRing.setFillStyle(NEON_COLORS.electricBlue, 0.1);
    container.add(innerRing);

    // Animación del núcleo - más rápida y pulsante
    this.tweens.add({
      targets: core,
      scale: { from: 0.6, to: 1.4 },
      alpha: { from: 0.5, to: 1 },
      duration: 120,
      yoyo: true,
      repeat: -1,
      ease: "Quad.easeInOut",
    });

    // Crear rayos de plasma que salen del centro (reducido de 6 a 3)
    const plasmaRays: Phaser.GameObjects.Graphics[] = [];
    for (let i = 0; i < 3; i++) {
      const ray = this.add.graphics();
      ray.setData("angle", (i / 3) * Math.PI * 2);
      ray.setData("offset", Math.random() * Math.PI);
      plasmaRays.push(ray);
      container.add(ray);
    }

    // Guardar referencia para animar
    container.setData("plasmaRays", plasmaRays);
    container.setData("plasmaCore", core);
    container.setData("plasmaRing", innerRing);
    container.setData("isPlasmaSource", true);
  }

  private addPlasmaEffect(container: Phaser.GameObjects.Container): void {
    // Añadir efecto de bombilla encendida a una celda
    if (container.getData("plasmaGlow") || container.getData("plasmaInner"))
      return; // Ya tiene efecto

    // Para letras: crear glow estático de bombilla
    if (container.getData("cellType") === "letter") {
      // Crear múltiples capas de glow para efecto de bombilla
      const glowOuter = this.add.graphics();
      glowOuter.fillStyle(NEON_COLORS.electricBlue, 0.1);
      glowOuter.fillCircle(0, 0, 54);
      container.addAt(glowOuter, 0);

      const glowMid = this.add.graphics();
      glowMid.fillStyle(NEON_COLORS.electricBlue, 0.15);
      glowMid.fillCircle(0, 0, 46);
      container.addAt(glowMid, 1);

      const glowInner = this.add.graphics();
      glowInner.fillStyle(NEON_COLORS.electricBlue, 0.2);
      glowInner.fillCircle(0, 0, 40);
      container.addAt(glowInner, 2);

      // Anillo brillante alrededor de la circunferencia (simula el borde encendido)
      const ringGlow = this.add.graphics();
      // Capa exterior del anillo (glow difuso)
      ringGlow.lineStyle(8, NEON_COLORS.electricBlue, 0.25);
      ringGlow.strokeCircle(0, 0, 34);
      // Capa media del anillo
      ringGlow.lineStyle(4, NEON_COLORS.electricBlue, 0.5);
      ringGlow.strokeCircle(0, 0, 34);
      // Núcleo brillante del anillo
      ringGlow.lineStyle(2, NEON_COLORS.electricWhite, 0.7);
      ringGlow.strokeCircle(0, 0, 34);
      container.add(ringGlow);

      // Almacenar referencia al glow
      container.setData("plasmaGlow", [
        glowOuter,
        glowMid,
        glowInner,
        ringGlow,
      ]);

      // Animación de onda de encendido
      this.createLightUpWave(container);

      return;
    }

    // Para puntos: efecto simple de glow
    const glow = this.add.graphics();
    glow.fillStyle(NEON_COLORS.electricBlue, 0.15);
    glow.fillCircle(0, 0, 20);
    container.addAt(glow, 0);

    const core = this.add.circle(0, 0, 6, NEON_COLORS.electricWhite, 0.9);
    container.add(core);

    container.setData("plasmaGlow", [glow]);
    container.setData("plasmaCore", core);

    // Animación de onda de encendido
    this.createLightUpWave(container);
  }

  private createLightUpWave(container: Phaser.GameObjects.Container): void {
    // Crear onda expansiva de encendido
    const wave = this.add.graphics();
    wave.lineStyle(3, NEON_COLORS.electricBlue, 0.8);
    wave.strokeCircle(0, 0, 10);
    container.add(wave);

    // Animar la onda expandiéndose y desvaneciéndose
    this.tweens.add({
      targets: wave,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 400,
      ease: "Quad.easeOut",
      onComplete: () => {
        wave.destroy();
      },
    });

    // Segunda onda más pequeña con delay
    const wave2 = this.add.graphics();
    wave2.lineStyle(2, NEON_COLORS.electricWhite, 0.6);
    wave2.strokeCircle(0, 0, 8);
    container.add(wave2);

    this.tweens.add({
      targets: wave2,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 350,
      delay: 80,
      ease: "Quad.easeOut",
      onComplete: () => {
        wave2.destroy();
      },
    });
  }

  private removePlasmaEffect(container: Phaser.GameObjects.Container): void {
    const plasmaRays = container.getData("plasmaRays") as
      | Phaser.GameObjects.Graphics[]
      | undefined;
    const core = container.getData("plasmaCore") as
      | Phaser.GameObjects.Arc
      | undefined;
    const ring = container.getData("plasmaRing") as
      | Phaser.GameObjects.Arc
      | undefined;
    const inner = container.getData("plasmaInner") as
      | Phaser.GameObjects.Graphics
      | undefined;
    const plasmaGlow = container.getData("plasmaGlow") as
      | Phaser.GameObjects.Graphics[]
      | undefined;

    if (plasmaRays) {
      plasmaRays.forEach((ray) => {
        ray.clear();
        ray.destroy();
      });
      container.setData("plasmaRays", undefined);
    }

    if (core) {
      this.tweens.killTweensOf(core);
      core.destroy();
      container.setData("plasmaCore", undefined);
    }

    if (ring) {
      ring.destroy();
      container.setData("plasmaRing", undefined);
    }

    if (inner) {
      inner.clear();
      inner.destroy();
      container.setData("plasmaInner", undefined);
    }

    if (plasmaGlow) {
      plasmaGlow.forEach((glow) => {
        glow.clear();
        glow.destroy();
      });
      container.setData("plasmaGlow", undefined);
    }
  }

  private createWordDisplay(): void {
    const { width, height } = GameSettings.canvas;
    const word = this.currentLevelConfig.word;

    // Letras más pequeñas y espaciado reducido
    const letterSpacing = Math.min(50, 300 / word.length);
    const wordWidth = (word.length - 1) * letterSpacing + 50;
    const bgWidth = Math.max(300, wordWidth + 40);

    // Tamaño del botón undo (mismo alto que el fondo de la palabra)
    const undoButtonWidth = 80;
    const totalWidth = bgWidth + 12 + undoButtonWidth; // 12px gap

    // Posicionar el contenedor de palabra a la izquierda del centro
    const wordCenterX = width / 2 - (undoButtonWidth + 12) / 2;

    this.wordContainer = this.add.container(wordCenterX, height - 80);
    this.wordLetters = [];

    const startX = -((word.length - 1) * letterSpacing) / 2;

    // Fondo sutil para las letras
    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x0a0a14, 0.8);
    bgBar.fillRoundedRect(-bgWidth / 2, -40, bgWidth, 80, 16);
    this.wordContainer.add(bgBar);

    for (let i = 0; i < word.length; i++) {
      const letter = word[i];
      const x = startX + i * letterSpacing;

      // Efecto de glow detrás
      const glow = this.add.text(x, 0, letter, {
        fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        fontSize: "42px",
        color: "#b7ff01",
        fontStyle: "bold",
      });
      glow.setOrigin(0.5, 0.5);
      glow.setAlpha(0);
      this.wordContainer.add(glow);

      // Letra principal - estilo moderno
      const letterText = this.add.text(x, 0, letter, {
        fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        fontSize: "42px",
        color: "#2a2a3a",
        fontStyle: "bold",
      });
      letterText.setOrigin(0.5, 0.5);
      letterText.setData("glow", glow);
      letterText.setData("order", i + 1);
      letterText.setData("isLit", false);
      this.wordContainer.add(letterText);
      this.wordLetters.push(letterText);
    }

    // Crear botón de undo a la derecha de la palabra
    this.createUndoButton(
      wordCenterX + bgWidth / 2 + 12 + undoButtonWidth / 2,
      height - 80,
      undoButtonWidth
    );
  }

  private createTimer(): void {
    const { width } = this.cameras.main;

    // Contenedor del timer centrado arriba - más abajo para dar espacio
    this.timerContainer = this.add.container(width / 2, 70);

    // Radio del círculo de progreso
    const circleRadius = 38;
    const lineWidth = 6;

    // Fondo del círculo (gris oscuro)
    const bgCircle = this.add.graphics();
    bgCircle.lineStyle(lineWidth, 0x1a1a24, 1);
    bgCircle.beginPath();
    bgCircle.arc(0, 0, circleRadius, 0, Math.PI * 2, false);
    bgCircle.strokePath();
    this.timerContainer.add(bgCircle);

    // Círculo de progreso (verde neón)
    this.timerCircle = this.add.graphics();
    this.drawTimerCircle();
    this.timerContainer.add(this.timerCircle);

    // Texto del timer - solo segundos en grande
    this.timerText = this.add.text(
      0,
      0,
      Math.floor(this.timeRemaining).toString(),
      {
        fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        fontSize: "36px",
        color: "#b7ff01",
        fontStyle: "bold",
      }
    );
    this.timerText.setOrigin(0.5, 0.5);
    this.timerContainer.add(this.timerText);

    this.timerContainer.setDepth(100);
  }

  private drawTimerCircle(): void {
    if (!this.timerCircle) return;

    this.timerCircle.clear();

    const circleRadius = 38;
    const lineWidth = 6;
    const progress = this.timeRemaining / this.maxTime;

    // Color verde neón siempre
    const color = 0xb7ff01;

    this.timerCircle.lineStyle(lineWidth, color, 1);
    this.timerCircle.beginPath();

    // El arco empieza arriba (-PI/2) y va en sentido horario
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * progress;

    this.timerCircle.arc(0, 0, circleRadius, startAngle, endAngle, false);
    this.timerCircle.strokePath();
  }

  private formatTime(seconds: number): string {
    return Math.floor(seconds).toString();
  }

  private createLevelIndicator(): void {
    const { width } = this.cameras.main;

    // Indicador de nivel a la izquierda del timer
    const levelText = this.add.text(
      width / 2 - 110,
      70,
      `Level ${this.currentLevel}`,
      {
        fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
        fontSize: "28px",
        color: "#666677",
        fontStyle: "bold",
      }
    );
    levelText.setOrigin(1, 0.5);

    // Score a la derecha del timer (solo el número, más grande)
    this.scoreText = this.add.text(width / 2 + 110, 70, `${this.score}`, {
      fontFamily: '"SF Pro Display", "Helvetica Neue", Arial, sans-serif',
      fontSize: "28px",
      color: "#b7ff01",
      fontStyle: "bold",
    });
    this.scoreText.setOrigin(0, 0.5);
  }

  private createUndoButton(
    x: number,
    y: number,
    buttonWidth: number = 80
  ): void {
    this.undoButton = this.add.container(x, y);

    // Fondo rectangular con bordes redondeados (mismo estilo que el fondo de la palabra)
    const buttonHeight = 80;
    const bg = this.add.graphics();
    bg.fillStyle(0x0a0a14, 0.8);
    bg.fillRoundedRect(
      -buttonWidth / 2,
      -buttonHeight / 2,
      buttonWidth,
      buttonHeight,
      16
    );
    this.undoButton.add(bg);

    // Icono de refresh/reload (círculo con flecha) en color neón
    const icon = this.add.graphics();

    // Dibujar círculo de refresh con glow neón
    // Capa de glow
    icon.lineStyle(6, NEON_COLORS.electricBlue, 0.3);
    icon.beginPath();
    icon.arc(0, 2, 14, -Math.PI * 0.4, Math.PI * 1.1, false);
    icon.strokePath();

    // Línea principal del círculo
    icon.lineStyle(3, NEON_COLORS.electricBlue, 1);
    icon.beginPath();
    icon.arc(0, 2, 14, -Math.PI * 0.4, Math.PI * 1.1, false);
    icon.strokePath();

    // Punta de flecha (apuntando hacia la derecha/arriba)
    icon.lineStyle(3, NEON_COLORS.electricBlue, 1);
    icon.beginPath();
    // Flecha en el extremo del arco (arriba-derecha)
    icon.moveTo(10, -8);
    icon.lineTo(14, -2);
    icon.moveTo(10, -8);
    icon.lineTo(5, -4);
    icon.strokePath();

    this.undoButton.add(icon);

    // Hacer interactivo
    this.undoButton.setSize(buttonWidth, buttonHeight);
    this.undoButton.setInteractive({ useHandCursor: true });

    this.undoButton.on("pointerover", () => {
      bg.clear();
      bg.fillStyle(0x151520, 0.9);
      bg.fillRoundedRect(
        -buttonWidth / 2,
        -buttonHeight / 2,
        buttonWidth,
        buttonHeight,
        16
      );
      bg.lineStyle(2, NEON_COLORS.electricBlue, 0.5);
      bg.strokeRoundedRect(
        -buttonWidth / 2,
        -buttonHeight / 2,
        buttonWidth,
        buttonHeight,
        16
      );
    });

    this.undoButton.on("pointerout", () => {
      bg.clear();
      bg.fillStyle(0x0a0a14, 0.8);
      bg.fillRoundedRect(
        -buttonWidth / 2,
        -buttonHeight / 2,
        buttonWidth,
        buttonHeight,
        16
      );
    });

    this.undoButton.on("pointerdown", () => {
      this.resetBoard();
    });

    this.undoButton.setDepth(100);
  }

  private resetBoard(): void {
    if (this.gameWon || this.path.length <= 1) return;

    // Guardar la celda de inicio
    const startCell = this.path[0];

    // Desactivar todas las celdas excepto la de inicio
    while (this.path.length > 1) {
      const cell = this.path.pop()!;
      this.deactivateCell(cell);
    }

    // Resetear el contador de letras
    this.nextExpectedLetter = 1;

    // Apagar todas las letras del display
    for (const letterText of this.wordLetters) {
      letterText.setColor("#2a2a3a");
      letterText.setData("isLit", false);
      const glow = letterText.getData("glow") as Phaser.GameObjects.Text;
      if (glow) glow.setAlpha(0);
    }

    // Limpiar líneas
    this.needsLineRedraw = true;

    // Actualizar celda actual
    this.currentCell = startCell;

    // Reproducir sonido
    this.playUndoSound();
  }

  private updateTimerDisplay(): void {
    if (this.timerText) {
      this.timerText.setText(this.formatTime(this.timeRemaining));

      // Actualizar la barra circular
      this.drawTimerCircle();
    }
  }

  private createInstructions(): void {
    // Sin UI de texto - el progreso se ve en las celdas iluminadas
  }

  private updateProgressText(): void {
    // Sin texto de progreso
  }

  private setupInput(): void {
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("pointerup", this.onPointerUp, this);
  }

  // ============ LÓGICA DEL JUEGO ============

  private activateCell(cell: Cell): void {
    if (cell.isConnected || this.gameWon) return;

    // Verificar orden de letras
    if (cell.type === "letter" && cell.letterOrder !== undefined) {
      if (cell.letterOrder !== this.nextExpectedLetter) {
        // Letra incorrecta, mostrar feedback
        this.showWrongLetterFeedback(cell);
        return;
      }
      this.nextExpectedLetter++;
      this.lightUpWordLetter(cell.letterOrder);
    }

    // Quitar efecto plasma del punto anterior SOLO si es un punto (no letra)
    // Las letras mantienen su efecto de "bombilla encendida"
    if (
      this.currentCell &&
      !this.currentCell.isStart &&
      this.currentCell.type !== "letter"
    ) {
      this.removePlasmaEffect(this.currentCell.graphics);
    }

    cell.isConnected = true;
    this.path.push(cell);
    this.currentCell = cell;

    // Añadir efecto plasma al nuevo punto actual (si no es el inicio)
    if (!cell.isStart) {
      this.addPlasmaEffect(cell.graphics);
    }

    // Efectos visuales
    this.animateCellActivation(cell);

    // Sonido solo para celdas con letra
    if (cell.type === "letter") {
      this.playConnectSound();
    }

    // Marcar para redibujar líneas
    this.needsLineRedraw = true;

    // Actualizar progreso
    this.updateProgressText();

    // Verificar victoria
    this.checkWinCondition();
  }

  private deactivateCell(cell: Cell): void {
    if (!cell.isConnected || cell === this.path[0]) return;

    // Si es una letra, decrementar el contador
    if (cell.type === "letter" && cell.letterOrder !== undefined) {
      this.nextExpectedLetter--;
      this.dimWordLetter(cell.letterOrder);
    }

    // Quitar efecto plasma de la celda que estamos desactivando
    if (!cell.isStart) {
      this.removePlasmaEffect(cell.graphics);
    }

    cell.isConnected = false;

    // Quitar del path
    const index = this.path.indexOf(cell);
    if (index > -1) {
      this.path.splice(index, 1);
    }

    // Actualizar celda actual
    this.currentCell = this.path[this.path.length - 1] || null;

    // Añadir plasma al nuevo punto actual (si existe y no es el inicio)
    if (this.currentCell && !this.currentCell.isStart) {
      this.addPlasmaEffect(this.currentCell.graphics);
    }

    // Efectos visuales
    this.animateCellDeactivation(cell);
    this.playUndoSound();

    // Marcar para redibujar líneas
    this.needsLineRedraw = true;

    // Actualizar progreso
    this.updateProgressText();
  }

  private isAdjacent(cell1: Cell, cell2: Cell): boolean {
    const rowDiff = Math.abs(cell1.row - cell2.row);
    const colDiff = Math.abs(cell1.col - cell2.col);

    // Solo adyacentes ortogonales (no diagonales)
    const isOrthogonallyAdjacent =
      (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);

    if (!isOrthogonallyAdjacent) return false;

    // Verificar si hay una pared bloqueando el paso
    const edge = this.normalizeEdge(cell1.row, cell1.col, cell2.row, cell2.col);
    if (this.wallBlockedEdges.has(edge)) {
      return false; // Hay una pared, no son adyacentes para el movimiento
    }

    return true;
  }

  private getCellAtPosition(x: number, y: number): Cell | null {
    // Usar coordenadas fijas del grid para detección precisa
    const cellTotalSize = CELL_SIZE + CELL_GAP;

    // Calcular columna y fila basándose en la posición del grid
    const relX = x - this.gridStartX;
    const relY = y - this.gridStartY;

    // Si está fuera del grid, retornar null
    if (relX < 0 || relY < 0) return null;

    const col = Math.floor(relX / cellTotalSize);
    const row = Math.floor(relY / cellTotalSize);

    // Verificar que está dentro de los límites
    if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) {
      return null;
    }

    // Verificar que está dentro de la celda y no en el gap
    const cellLocalX = relX - col * cellTotalSize;
    const cellLocalY = relY - row * cellTotalSize;

    if (cellLocalX > CELL_SIZE || cellLocalY > CELL_SIZE) {
      return null;
    }

    return this.cells[row][col];
  }

  private checkWinCondition(): void {
    // Verificar que todas las celdas están conectadas
    if (this.path.length !== this.totalCells) return;

    // Verificar que la última celda es la última letra de la palabra
    const lastCell = this.path[this.path.length - 1];
    const word = this.currentLevelConfig.word;
    const lastLetter = word[word.length - 1];
    if (lastCell.letter !== lastLetter) return;

    // Verificar que todas las letras se conectaron en orden
    if (this.nextExpectedLetter !== word.length + 1) return;

    // ¡Victoria!
    this.showVictory();
  }

  // ============ INPUT HANDLERS ============

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const cell = this.getCellAtPosition(pointer.x, pointer.y);

    // Siempre activamos el drag cuando hacemos click
    this.isDragging = true;

    if (!cell) return;

    // Si la celda ya está conectada
    if (cell.isConnected) {
      // Si es la penúltima, hacer undo
      if (this.path.length >= 2 && cell === this.path[this.path.length - 2]) {
        this.deactivateCell(this.currentCell!);
      }
      // Si es la celda actual o de inicio, simplemente permitimos arrastrar
      return;
    }

    // Si la celda es adyacente a la actual y no está conectada, activarla
    if (this.currentCell && this.isAdjacent(this.currentCell, cell)) {
      this.activateCell(cell);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isDragging || !this.currentCell) return;

    const cell = this.getCellAtPosition(pointer.x, pointer.y);
    if (!cell) return;

    // Si es la misma celda actual, ignorar
    if (cell === this.currentCell) return;

    // Undo: si volvemos a la celda anterior
    if (this.path.length >= 2 && cell === this.path[this.path.length - 2]) {
      this.deactivateCell(this.currentCell);
      return;
    }

    // Conectar nueva celda si es adyacente y no está conectada
    if (this.isAdjacent(this.currentCell, cell) && !cell.isConnected) {
      this.activateCell(cell);
    }
  }

  private onPointerUp(): void {
    this.isDragging = false;
  }

  // ============ EFECTOS VISUALES ============

  private animateCellActivation(cell: Cell): void {
    // Quitar sombra de oscuridad - revelar la celda
    if (cell.shadowOverlay) {
      this.tweens.add({
        targets: cell.shadowOverlay,
        alpha: 0,
        duration: 200,
        ease: "Power2",
      });
    }

    if (cell.type === "letter" && cell.letterText) {
      // Animar letra con brillo intenso verde lima
      cell.letterText.setColor("#B7FF01");

      // Iluminar la circunferencia
      if (cell.letterCircle) {
        cell.letterCircle.setStrokeStyle(2, NEON_COLORS.electricBlue, 0.9);
      }

      this.tweens.add({
        targets: cell.letterText,
        scale: 1.2,
        duration: 150,
        yoyo: true,
        ease: "Back.easeOut",
      });
    } else if (cell.dotGraphic) {
      // Animar punto - más brillante
      cell.dotGraphic.setFillStyle(NEON_COLORS.electricBlue);
      cell.dotGraphic.setStrokeStyle(2, NEON_COLORS.electricWhite, 0.8);

      this.tweens.add({
        targets: cell.dotGraphic,
        scale: 1.6,
        duration: 150,
        yoyo: true,
        ease: "Back.easeOut",
      });
    }

    // Pulse en el container
    this.tweens.add({
      targets: cell.graphics,
      scale: 1.05,
      duration: 100,
      yoyo: true,
      ease: "Power2",
    });
  }

  private animateCellDeactivation(cell: Cell): void {
    // Restaurar sombra de oscuridad
    if (cell.shadowOverlay) {
      this.tweens.add({
        targets: cell.shadowOverlay,
        alpha: 0.7,
        duration: 200,
      });
    }

    if (cell.type === "letter" && cell.letterText) {
      cell.letterText.setColor("#1a1a2a");
      // Apagar la circunferencia
      if (cell.letterCircle) {
        cell.letterCircle.setStrokeStyle(2, NEON_COLORS.offColor, 0.3);
      }
    } else if (cell.dotGraphic) {
      cell.dotGraphic.setFillStyle(0x0a0a12);
      cell.dotGraphic.setStrokeStyle(1, NEON_COLORS.offColorDim, 0.5);
    }
  }

  private redrawConnectionLines(): void {
    this.linesGraphics.clear();

    if (this.path.length < 2) return;

    // Efecto neón con múltiples capas de glow

    // Capa 1: Glow exterior muy suave
    this.linesGraphics.lineStyle(20, NEON_COLORS.electricBlue, 0.08);
    this.drawPath();

    // Capa 2: Glow exterior
    this.linesGraphics.lineStyle(14, NEON_COLORS.electricBlue, 0.12);
    this.drawPath();

    // Capa 3: Glow medio
    this.linesGraphics.lineStyle(8, NEON_COLORS.electricBlue, 0.25);
    this.drawPath();

    // Capa 4: Línea principal brillante
    this.linesGraphics.lineStyle(4, NEON_COLORS.electricBlue, 0.9);
    this.drawPath();

    // Capa 5: Núcleo blanco brillante
    this.linesGraphics.lineStyle(1.5, NEON_COLORS.electricWhite, 1);
    this.drawPath();
  }

  private drawLightningBolts(): void {
    if (this.path.length < 2) return;

    const time = this.time_elapsed * 0.001;
    const LETTER_CIRCLE_RADIUS = 32;

    for (let i = 0; i < this.path.length - 1; i++) {
      const cell1 = this.path[i];
      const cell2 = this.path[i + 1];

      // Usar coordenadas fijas del grid
      const cx1 =
        this.gridStartX + cell1.col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const cy1 =
        this.gridStartY + cell1.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const cx2 =
        this.gridStartX + cell2.col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const cy2 =
        this.gridStartY + cell2.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;

      // Calcular dirección
      const dx = cx2 - cx1;
      const dy = cy2 - cy1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;

      // Ajustar por circunferencias de letras
      let x1 = cx1,
        y1 = cy1,
        x2 = cx2,
        y2 = cy2;
      if (cell1.type === "letter") {
        x1 = cx1 + nx * LETTER_CIRCLE_RADIUS;
        y1 = cy1 + ny * LETTER_CIRCLE_RADIUS;
      }
      if (cell2.type === "letter") {
        x2 = cx2 - nx * LETTER_CIRCLE_RADIUS;
        y2 = cy2 - ny * LETTER_CIRCLE_RADIUS;
      }

      // Rayos dinámicos suaves
      const phase = Math.sin(time * 8 + i * 2);
      if (phase > 0.3) {
        this.drawSingleLightningBolt(x1, y1, x2, y2, 0.5 + phase * 0.3, i);
      }
    }
  }

  private drawSingleLightningBolt(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    alpha: number = 0.7,
    seed: number = 0
  ): void {
    const segments = 6;
    const dx = (x2 - x1) / segments;
    const dy = (y2 - y1) / segments;
    const perpX = -dy * 0.2;
    const perpY = dx * 0.2;
    const time = this.time_elapsed * 0.004;

    // Glow del rayo
    this.linesGraphics.lineStyle(5, NEON_COLORS.electricBlue, alpha * 0.3);
    this.linesGraphics.beginPath();
    this.linesGraphics.moveTo(x1, y1);

    const points: { x: number; y: number }[] = [{ x: x1, y: y1 }];

    for (let j = 1; j < segments; j++) {
      // Usar sine waves suaves en lugar de random
      const offset =
        Math.sin(time * 3 + seed + j * 1.5) * Math.cos(time * 2 + j);
      const px = x1 + dx * j + perpX * offset;
      const py = y1 + dy * j + perpY * offset;
      points.push({ x: px, y: py });
      this.linesGraphics.lineTo(px, py);
    }

    points.push({ x: x2, y: y2 });
    this.linesGraphics.lineTo(x2, y2);
    this.linesGraphics.strokePath();

    // Línea principal del rayo
    this.linesGraphics.lineStyle(2, NEON_COLORS.electricBlueLight, alpha);
    this.linesGraphics.beginPath();
    this.linesGraphics.moveTo(x1, y1);
    for (let j = 1; j < points.length; j++) {
      this.linesGraphics.lineTo(points[j].x, points[j].y);
    }
    this.linesGraphics.strokePath();

    // Núcleo brillante
    this.linesGraphics.lineStyle(1, NEON_COLORS.electricWhite, alpha);
    this.linesGraphics.beginPath();
    this.linesGraphics.moveTo(x1, y1);
    for (let j = 1; j < points.length; j++) {
      this.linesGraphics.lineTo(points[j].x, points[j].y);
    }
    this.linesGraphics.strokePath();

    // Ramificaciones aleatorias
    if (Math.random() > 0.5 && points.length > 2) {
      const branchPoint = points[Math.floor(points.length / 2)];
      const branchAngle = Math.random() * Math.PI - Math.PI / 2;
      const branchLen = 15 + Math.random() * 20;
      const branchEndX = branchPoint.x + Math.cos(branchAngle) * branchLen;
      const branchEndY = branchPoint.y + Math.sin(branchAngle) * branchLen;

      this.linesGraphics.lineStyle(
        1,
        NEON_COLORS.electricBlueLight,
        alpha * 0.6
      );
      this.linesGraphics.beginPath();
      this.linesGraphics.moveTo(branchPoint.x, branchPoint.y);
      this.linesGraphics.lineTo(branchEndX, branchEndY);
      this.linesGraphics.strokePath();
    }
  }

  private drawPath(): void {
    if (this.path.length < 2) return;

    const LETTER_CIRCLE_RADIUS = 32;

    // Dibujar segmentos entre cada par de celdas
    for (let i = 0; i < this.path.length - 1; i++) {
      const cell1 = this.path[i];
      const cell2 = this.path[i + 1];

      // Obtener centros de las celdas
      const x1 =
        this.gridStartX + cell1.col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const y1 =
        this.gridStartY + cell1.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const x2 =
        this.gridStartX + cell2.col * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;
      const y2 =
        this.gridStartY + cell2.row * (CELL_SIZE + CELL_GAP) + CELL_SIZE / 2;

      // Calcular dirección
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / dist;
      const ny = dy / dist;

      // Ajustar puntos de inicio/fin si hay letras (conectar al borde del círculo)
      let startX = x1;
      let startY = y1;
      let endX = x2;
      let endY = y2;

      if (cell1.type === "letter") {
        startX = x1 + nx * LETTER_CIRCLE_RADIUS;
        startY = y1 + ny * LETTER_CIRCLE_RADIUS;
      }

      if (cell2.type === "letter") {
        endX = x2 - nx * LETTER_CIRCLE_RADIUS;
        endY = y2 - ny * LETTER_CIRCLE_RADIUS;
      }

      // Dibujar línea
      this.linesGraphics.beginPath();
      this.linesGraphics.moveTo(startX, startY);
      this.linesGraphics.lineTo(endX, endY);
      this.linesGraphics.strokePath();
    }
  }

  private lightUpWordLetter(order: number): void {
    const letterText = this.wordLetters[order - 1];
    if (!letterText) return;

    letterText.setData("isLit", true);
    letterText.setColor("#B7FF01");

    const glow = letterText.getData("glow") as Phaser.GameObjects.Text;
    if (glow) {
      glow.setColor("#B7FF01");
      glow.setAlpha(0.4);
    }

    this.tweens.add({
      targets: letterText,
      scale: 1.15,
      duration: 200,
      yoyo: true,
      ease: "Back.easeOut",
    });
  }

  private dimWordLetter(order: number): void {
    const letterText = this.wordLetters[order - 1];
    if (!letterText) return;

    letterText.setData("isLit", false);
    letterText.setColor("#2a2a3a");

    const glow = letterText.getData("glow") as Phaser.GameObjects.Text;
    if (glow) {
      glow.setAlpha(0);
    }
  }

  private updateElectricityEffects(): void {
    // Efecto simple de parpadeo - sin recalcular cada celda
    for (const cell of this.path) {
      if (cell.type === "letter" && cell.letterText) {
        const shadowBlur = 10 + Math.sin(this.time_elapsed * 0.005) * 3;
        cell.letterText.setShadow(0, 0, "#B7FF01", shadowBlur, true, true);
      }
    }
  }

  private updateWordGlow(): void {
    // Sin animación - las letras mantienen su estado fijo
  }

  private updatePlasmaRays(): void {
    // Animar rayos de plasma en el inicio
    const startPos = this.currentLevelConfig.startPosition;
    this.animatePlasmaContainer(
      this.cells[startPos.row]?.[startPos.col]?.graphics
    );

    // Animar TODAS las celdas conectadas (letras desbloqueadas)
    for (const cell of this.path) {
      if (cell.type === "letter" && cell.isConnected) {
        this.animatePlasmaContainer(cell.graphics, cell === this.currentCell);
      }
    }
  }

  private animatePlasmaContainer(
    container: Phaser.GameObjects.Container | undefined,
    isEndPoint: boolean = false
  ): void {
    if (!container) return;

    // Letras: glow estático sin animación para mejor rendimiento
    if (container.getData("cellType") === "letter") {
      // Las letras mantienen glow estático, no necesitan animación cada frame
      return;
    }

    const plasmaRays = container.getData("plasmaRays") as
      | Phaser.GameObjects.Graphics[]
      | undefined;
    if (!plasmaRays) return;

    const time = this.time_elapsed * 0.002; // Velocidad más lenta

    for (let i = 0; i < plasmaRays.length; i++) {
      const ray = plasmaRays[i];
      const baseAngle = ray.getData("angle") as number;
      const offset = ray.getData("offset") as number;

      ray.clear();

      // Ángulo con rotación suave
      const angle = baseAngle + time * 0.3;

      // Longitud con pulso simple
      const pulse = Math.sin(time * 2 + offset);
      const length = 16 + pulse * 5;

      // Rayo simplificado - solo 2 segmentos
      const endX = Math.cos(angle) * length;
      const endY = Math.sin(angle) * length;

      // Solo una capa de dibujo (en lugar de 3)
      const alpha = 0.7 + pulse * 0.2;
      ray.lineStyle(3, NEON_COLORS.electricBlue, alpha);
      ray.beginPath();
      ray.moveTo(0, 0);
      ray.lineTo(endX, endY);
      ray.strokePath();

      // Destello en la punta
      ray.fillStyle(NEON_COLORS.electricWhite, alpha * 0.8);
      ray.fillCircle(endX, endY, 2);
    }
  }

  private createSpark(x: number, y: number): void {
    const angle = Math.random() * Math.PI * 2;
    const speed = 50 + Math.random() * 80; // Velocidad moderada

    this.sparks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 300 + Math.random() * 200, // Vida más larga para ver el efecto
      alpha: 1,
    });

    // Limitar número de chispas para rendimiento
    if (this.sparks.length > 25) {
      this.sparks.shift();
    }
  }

  private updateSparks(delta: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const spark = this.sparks[i];

      // Física realista con gravedad
      spark.x += spark.vx * delta * 0.001;
      spark.y += spark.vy * delta * 0.001;
      spark.vy += 80 * delta * 0.001; // Gravedad moderada
      spark.vx *= 0.98;
      spark.vy *= 0.98;
      spark.life -= delta;
      spark.alpha = Math.max(0, spark.life / 350);

      // Eliminar chispas muertas
      if (spark.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
    }
  }

  private updateLighting(): void {
    this.lightingOverlay.clear();

    // Dibujar chispas simplificadas (solo núcleo + glow)
    for (const spark of this.sparks) {
      // Glow simple
      this.lightingOverlay.fillStyle(
        NEON_COLORS.electricBlue,
        spark.alpha * 0.4
      );
      this.lightingOverlay.fillCircle(spark.x, spark.y, 4);

      // Núcleo brillante
      this.lightingOverlay.fillStyle(NEON_COLORS.electricWhite, spark.alpha);
      this.lightingOverlay.fillCircle(spark.x, spark.y, 2);
    }
  }

  private showWrongLetterFeedback(cell: Cell): void {
    // Solo flash rojo, sin animación de movimiento
    if (cell.letterText) {
      cell.letterText.setColor("#ff4444");
      this.time.delayedCall(300, () => {
        if (cell.letterText && !cell.isConnected) {
          cell.letterText.setColor("#444455");
        }
      });
    }

    this.playErrorSound();
  }

  private showVictory(): void {
    this.gameWon = true;
    const { width, height } = GameSettings.canvas;

    // Calcular puntos ganados:
    // Base: 100 puntos
    // Multiplicador por tiempo: 1.0 a 2.0 según tiempo restante
    const basePoints = 100;
    const timeMultiplier = 1 + this.timeRemaining / this.maxTime; // 1.0 a 2.0
    const pointsEarned = Math.round(basePoints * timeMultiplier);
    this.score += pointsEarned;

    // Actualizar display del score con animación
    if (this.scoreText) {
      this.scoreText.setText(`${this.score}`);
      this.tweens.add({
        targets: this.scoreText,
        scale: 1.3,
        duration: 200,
        yoyo: true,
        ease: "Back.easeOut",
      });
    }

    // Explosión de chispas desde todas las celdas
    for (const cell of this.path) {
      const bounds = cell.graphics.getBounds();
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;

      for (let i = 0; i < 8; i++) {
        this.time.delayedCall(i * 50, () => {
          this.createSpark(cx, cy);
        });
      }
    }

    // Efecto de flash más intenso
    const flash = this.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      0x00ffff,
      0
    );
    flash.setDepth(1000);
    this.tweens.add({
      targets: flash,
      alpha: 0.5,
      duration: 150,
      yoyo: true,
      repeat: 3,
      onComplete: () => flash.destroy(),
    });

    // Onda expansiva
    const ring = this.add.circle(width / 2, height / 2, 50, 0x00ffff, 0);
    ring.setStrokeStyle(8, NEON_COLORS.electricBlue, 1);
    ring.setDepth(999);
    this.tweens.add({
      targets: ring,
      radius: 600,
      alpha: 0,
      duration: 800,
      ease: "Power2",
      onComplete: () => ring.destroy(),
    });

    // Animar todas las letras de la palabra con más energía
    for (let i = 0; i < this.wordLetters.length; i++) {
      this.time.delayedCall(i * 100, () => {
        const letter = this.wordLetters[i];
        this.tweens.add({
          targets: letter,
          scale: 1.5,
          duration: 150,
          yoyo: true,
          ease: "Back.easeOut",
        });
      });
    }

    // Efecto de electricidad final
    this.createVictoryElectricity();

    this.playVictorySound();

    // Transición al siguiente nivel después de 2 segundos
    this.time.delayedCall(2000, () => {
      this.goToNextLevel();
    });
  }

  private goToNextLevel(): void {
    // Fade out
    this.cameras.main.fadeOut(500, 0, 0, 0);

    this.cameras.main.once("camerafadeoutcomplete", () => {
      // Reiniciar la escena con el siguiente nivel y el score acumulado
      this.scene.restart({ level: this.currentLevel + 1, score: this.score });
    });
  }

  private createVictoryElectricity(): void {
    // Crear partículas de electricidad más intensas
    const { width, height } = GameSettings.canvas;

    // Más partículas
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;

      const particle = this.add.circle(
        x,
        y,
        2 + Math.random() * 3,
        NEON_COLORS.electricBlue
      );
      particle.setAlpha(0);
      particle.setBlendMode(Phaser.BlendModes.ADD);
      particle.setDepth(998);

      this.tweens.add({
        targets: particle,
        alpha: 1,
        scale: { from: 0.5, to: 2.5 },
        y: y - 50 - Math.random() * 100,
        duration: 600,
        delay: i * 25,
        ease: "Power2",
        yoyo: true,
        onComplete: () => particle.destroy(),
      });
    }

    // Chispas adicionales desde las celdas conectadas (sin rayos estáticos)
    for (let i = 0; i < this.path.length; i++) {
      const cell = this.path[i];
      const bounds = cell.graphics.getBounds();
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;

      this.time.delayedCall(i * 30, () => {
        for (let j = 0; j < 3; j++) {
          this.createSpark(cx, cy);
        }
      });
    }
  }

  // ============ SONIDOS ============

  private playConnectSound(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(800 + this.path.length * 50, now);
    osc.frequency.exponentialRampToValueAtTime(
      1200 + this.path.length * 50,
      now + 0.1
    );

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  private playUndoSound(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.12);
  }

  private playErrorSound(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.setValueAtTime(150, now + 0.1);

    gain.gain.setValueAtTime(0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  private playVictorySound(): void {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Acorde mayor ascendente
    const frequencies = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0, now + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.15, now + i * 0.1 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.5);
    });
  }
}
