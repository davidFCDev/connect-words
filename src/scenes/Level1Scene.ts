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
  cellBg?: Phaser.GameObjects.Graphics; // Fondo de la celda para iluminación
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

// Importar URLs de música desde PreloadScene
import { MUSIC_TRACKS } from "./PreloadScene";

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
  // Color para celdas recorridas (cian eléctrico)
  pathColor: 0x00ffcc,
  pathColorLight: 0x66ffd9,
  // Colores para muros (cian eléctrico brillante)
  wallColor: 0x00ffcc,
  wallGlow: 0x66ffd9,
  wallCore: 0x99ffe6,
};

// Configuración base del grid (se ajusta según el nivel)
const BASE_CELL_SIZE = 85;
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
  private static isMuted: boolean = false; // Estado de mute (static para persistir)
  private isGameOver: boolean = false; // Para evitar múltiples llamadas a gameOver

  // Tutorial overlay
  private tutorialOverlay: Phaser.GameObjects.Container | null = null;
  private static tutorialCompleted: boolean = false; // Static para persistir entre niveles
  private gamePaused: boolean = true; // Empieza pausado hasta cerrar tutorial

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
  private backgroundMusic: HTMLAudioElement | null = null;
  private static musicStarted: boolean = false; // Static para persistir entre niveles
  private musicEndedHandler: (() => void) | null = null; // Handler para limpiar correctamente

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

  // Sistema de Perfect y Streak
  private usedUndo: boolean = false; // Si usó marcha atrás
  private static perfectStreak: number = 0; // Racha de perfects (persistente)
  private streakText!: Phaser.GameObjects.Text; // Texto del multiplicador
  private currentCellPulseTween: Phaser.Tweens.Tween | null = null; // Pulso celda actual

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
    this.isGameOver = false;
    this.lastDisplayedTime = -1;
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
    this.gamePaused = true; // Siempre empezar pausado, checkFirstTimePlayer lo despausa
    this.usedUndo = false; // Resetear para el nuevo nivel
    this.currentCellPulseTween = null;
    // Calcular tiempo según dificultad: 20s base + bonus por nivel
    // Nivel 1-3: 20s, Nivel 4-6: 23s, Nivel 7-9: 26s, Nivel 10-11: 32s, Nivel 12+: 40s
    let levelTime: number;
    if (this.currentLevel >= 12) {
      levelTime = 40;
    } else if (this.currentLevel >= 10) {
      levelTime = 32;
    } else {
      const difficultyTier = Math.min(
        Math.floor((this.currentLevel - 1) / 3),
        3
      );
      levelTime = 20 + difficultyTier * 3;
    }
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
    // Limpiar todos los tweens pendientes del nivel anterior
    this.tweens.killAll();

    this.initAudio();
    this.initSDK(); // Inicializar handlers del SDK
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

    // Verificar si es la primera vez que juega
    this.checkFirstTimePlayer();
  }

  private async checkFirstTimePlayer(): Promise<void> {
    // Solo mostrar tutorial en el nivel 1 y si no se ha completado antes
    if (this.currentLevel !== 1 || Level1Scene.tutorialCompleted) {
      this.gamePaused = false;
      return;
    }

    try {
      // El SDK carga el gameState automáticamente después de ready()
      // Se accede directamente via sdk.gameState (no hay getGameState)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = window.FarcadeSDK as any;

      // Si no hay SDK (local), mostrar tutorial inmediatamente
      if (!sdk || typeof sdk.ready !== "function") {
        this.showTutorialOverlay();
        return;
      }

      // Timeout muy corto - si el SDK no responde rápido, mostrar tutorial
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SDK timeout")), 300)
      );

      await Promise.race([sdk.ready(), timeoutPromise]);

      // Acceder al gameState directamente
      const gameState = sdk?.gameState;
      const tutorialDone = gameState?.tutorialCompleted === true;

      if (tutorialDone) {
        // Ya vio el tutorial en una sesión anterior
        Level1Scene.tutorialCompleted = true;
        this.gamePaused = false;
      } else {
        // Primera vez, mostrar tutorial
        this.showTutorialOverlay();
      }
    } catch (e) {
      // Si hay error con el SDK, mostrar tutorial de todos modos (primera vez)
      this.showTutorialOverlay();
    }
  }

  private showTutorialOverlay(): void {
    const { width, height } = GameSettings.canvas;

    this.tutorialOverlay = this.add.container(0, 0);
    this.tutorialOverlay.setDepth(500);
    this.tutorialOverlay.setAlpha(0); // Empieza invisible para fade in

    // Overlay oscuro semi-transparente
    const overlay = this.add.graphics();
    overlay.fillStyle(0x000000, 0.75);
    overlay.fillRect(0, 0, width, height);
    overlay.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, width, height),
      Phaser.Geom.Rectangle.Contains
    );
    overlay.once("pointerdown", () => {
      this.closeTutorialOverlay();
    });
    this.tutorialOverlay.add(overlay);

    // Título "HOW TO PLAY" - más grande y centrado
    const title = this.add.text(width / 2, height / 2 - 140, "HOW TO PLAY", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "42px",
      color: "#b7ff01",
      fontStyle: "bold",
    });
    title.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(title);

    // Texto destacado "FILL ALL CELLS!" en cian neón grande
    const fillAllText = this.add.text(
      width / 2,
      height / 2 - 70,
      "✦ FILL ALL CELLS! ✦",
      {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "32px",
        color: "#00ffcc",
        fontStyle: "bold",
        shadow: {
          offsetX: 0,
          offsetY: 0,
          color: "#00ffcc",
          blur: 15,
          fill: true,
        },
      }
    );
    fillAllText.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(fillAllText);

    // Animación de pulso para el texto destacado
    this.tweens.add({
      targets: fillAllText,
      scale: { from: 1, to: 1.08 },
      alpha: { from: 1, to: 0.85 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Instrucciones principales - más grandes y centradas
    const instructions = this.add.text(
      width / 2,
      height / 2 + 10,
      "Drag the energy to spell the word.\nConnect letters in order!",
      {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "24px",
        color: "#ffffff",
        align: "center",
        lineSpacing: 12,
      }
    );
    instructions.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(instructions);

    // Texto "TAP TO START" - debajo de las instrucciones, centrado
    const tapText = this.add.text(width / 2, height / 2 + 100, "TAP TO START", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "24px",
      color: "#666677",
    });
    tapText.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(tapText);

    // Animación de parpadeo
    this.tweens.add({
      targets: tapText,
      alpha: 0.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
    });

    // Calcular posiciones exactas de los badges (igual que en createWordDisplay)
    const word = this.currentLevelConfig.word;
    const letterSpacing = Math.min(50, 300 / word.length);
    const wordWidth = (word.length - 1) * letterSpacing + 50;
    const bgWidth = Math.max(300, wordWidth + 40);
    const undoButtonWidth = 80;
    const wordCenterX = width / 2 - (undoButtonWidth + 12) / 2;
    const undoButtonX = wordCenterX + bgWidth / 2 + 12 + undoButtonWidth / 2;
    const badgesY = height - 80;
    const arrowY = badgesY - 70;

    // Texto WORD ORDER encima del badge de palabra
    const orderText = this.add.text(wordCenterX, arrowY - 25, "WORD ORDER", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "18px",
      color: "#b7ff01",
    });
    orderText.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(orderText);

    // Flecha apuntando hacia abajo al badge de palabra
    const orderArrow = this.add.text(wordCenterX, arrowY + 10, "↓", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "32px",
      color: "#b7ff01",
    });
    orderArrow.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(orderArrow);

    // Animación de la flecha hacia abajo
    this.tweens.add({
      targets: orderArrow,
      y: arrowY + 18,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Texto UNDO encima del botón undo
    const undoText = this.add.text(undoButtonX, arrowY - 25, "UNDO", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "18px",
      color: "#b7ff01",
    });
    undoText.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(undoText);

    // Flecha apuntando hacia abajo al botón undo
    const undoArrow = this.add.text(undoButtonX, arrowY + 10, "↓", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "32px",
      color: "#b7ff01",
    });
    undoArrow.setOrigin(0.5, 0.5);
    this.tutorialOverlay.add(undoArrow);

    // Animación de la flecha undo hacia abajo
    this.tweens.add({
      targets: undoArrow,
      y: arrowY + 18,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Fade in suave del overlay
    this.tweens.add({
      targets: this.tutorialOverlay,
      alpha: 1,
      duration: 400,
      ease: "Sine.easeOut",
    });
  }

  private closeTutorialOverlay(): void {
    if (this.tutorialOverlay) {
      // Animación de fade out
      this.tweens.add({
        targets: this.tutorialOverlay,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          this.tutorialOverlay?.destroy();
          this.tutorialOverlay = null;
        },
      });
    }

    // Iniciar el juego
    this.gamePaused = false;
    Level1Scene.tutorialCompleted = true;

    // Guardar que ya vio el tutorial
    try {
      // Según la documentación: saveGameState({ gameState: {...} })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdk = window.FarcadeSDK?.singlePlayer?.actions as any;
      sdk?.saveGameState?.({ gameState: { tutorialCompleted: true } });
    } catch (e) {
      console.warn("[Level1Scene] Could not save tutorial state:", e);
    }
  }

  // Cache para evitar recálculos del timer
  private lastDisplayedTime: number = -1;

  update(time: number, delta: number): void {
    // No actualizar nada si el juego está pausado (tutorial)
    if (this.gamePaused) {
      return;
    }

    this.time_elapsed += delta;
    this.frameCount++;

    // Actualizar timer (solo redibujar cuando cambia el segundo mostrado)
    if (!this.gameWon && !this.isGameOver && this.timeRemaining > 0) {
      this.timeRemaining -= delta / 1000;
      if (this.timeRemaining < 0) this.timeRemaining = 0;

      const displayTime = Math.floor(this.timeRemaining);
      if (displayTime !== this.lastDisplayedTime) {
        this.lastDisplayedTime = displayTime;
        this.updateTimerDisplay();
      }

      // Detectar game over cuando el tiempo llega a 0
      if (this.timeRemaining <= 0 && !this.isGameOver) {
        this.handleGameOver();
      }
    }

    // Redibujar líneas solo cuando es necesario
    if (this.needsLineRedraw) {
      this.redrawConnectionLines();
      this.needsLineRedraw = false;
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

      // Iniciar música de fondo solo la primera vez
      if (!Level1Scene.musicStarted) {
        this.startBackgroundMusic();
        Level1Scene.musicStarted = true;
      }
    } catch (e) {
      console.warn("[Level1Scene] Web Audio API not available:", e);
    }
  }

  private startBackgroundMusic(): void {
    // Primera vez: reproducir music1 (índice 0)
    // Después: aleatorio (gestionado en el evento 'ended')
    this.playMusicTrack(0);
  }

  private playMusicTrack(index: number): void {
    // Limpiar audio anterior si existe
    if (this.backgroundMusic) {
      // Eliminar listener anterior para evitar acumulación
      if (this.musicEndedHandler) {
        this.backgroundMusic.removeEventListener(
          "ended",
          this.musicEndedHandler
        );
        this.musicEndedHandler = null;
      }
      this.backgroundMusic.pause();
      this.backgroundMusic.src = ""; // Liberar recursos
      this.backgroundMusic = null;
    }

    // Crear nuevo elemento de audio
    this.backgroundMusic = new Audio(MUSIC_TRACKS[index]);
    this.backgroundMusic.volume = 0.3; // Volumen moderado

    // Aplicar estado de mute actual
    this.backgroundMusic.muted = Level1Scene.isMuted;

    // Crear handler para cuando termine la canción
    this.musicEndedHandler = () => {
      // Verificar que la escena sigue activa
      if (this.scene && this.scene.isActive()) {
        const nextIndex = Math.floor(Math.random() * MUSIC_TRACKS.length);
        this.playMusicTrack(nextIndex);
      }
    };

    // Añadir listener
    this.backgroundMusic.addEventListener("ended", this.musicEndedHandler);

    // Reproducir
    this.backgroundMusic.play().catch((e) => {
      console.warn("[Level1Scene] Could not play music:", e);
    });
  }

  private initSDK(): void {
    // Handler para play again - reiniciar el juego desde nivel 1
    if (window.FarcadeSDK?.onPlayAgain) {
      window.FarcadeSDK.onPlayAgain(() => {
        // Reiniciar streak de perfects al empezar de nuevo
        Level1Scene.perfectStreak = 0;
        this.scene.restart({ level: 1, score: 0 });
      });
    }

    // Handler para mute/unmute - REQUERIDO por el SDK
    if (window.FarcadeSDK?.onToggleMute) {
      window.FarcadeSDK.onToggleMute((data) => {
        Level1Scene.isMuted = data.isMuted;
        // Aplicar mute a la música de fondo
        if (this.backgroundMusic) {
          this.backgroundMusic.muted = data.isMuted;
        }
      });
    }

    // Aplicar estado de mute actual (por si viene de nivel anterior)
    if (this.backgroundMusic) {
      this.backgroundMusic.muted = Level1Scene.isMuted;
    }
  }

  private handleGameOver(): void {
    if (this.isGameOver) return;
    this.isGameOver = true;

    // Enviar score al SDK - el SDK gestiona la pantalla de game over
    // Enviar mínimo 1 punto para que quede registrado en Farcade
    const finalScore = Math.max(1, this.score);
    if (window.FarcadeSDK?.singlePlayer?.actions?.gameOver) {
      window.FarcadeSDK.singlePlayer.actions.gameOver({ score: finalScore });
    }

    // Haptic feedback para indicar game over
    if (window.FarcadeSDK?.hapticFeedback) {
      window.FarcadeSDK.hapticFeedback();
    }
  }

  private createBackground(): void {
    const { width, height } = GameSettings.canvas;

    // Fondo muy oscuro - casi negro (una sola capa, sin viñetas múltiples)
    const bg = this.add.graphics();
    bg.fillStyle(0x010103, 1);
    bg.fillRect(0, 0, width, height);
    bg.setDepth(-10); // Fondo en el nivel más bajo

    // Rayas diagonales cyberpunk aleatorias
    this.createCyberpunkStripes(width, height);
  }

  private createCyberpunkStripes(width: number, height: number): void {
    const stripes = this.add.graphics();
    stripes.setDepth(-5); // Por encima del fondo pero debajo del resto

    // Generar rayas aleatorias en diferentes zonas
    const stripeConfigs = [
      // Zona superior izquierda
      { x: -50, y: 60, count: 5, maxWidth: 220 },
      // Zona superior derecha
      { x: width - 200, y: 100, count: 5, maxWidth: 200 },
      // Zona inferior derecha
      { x: width - 150, y: height - 250, count: 4, maxWidth: 180 },
      // Zona media izquierda
      { x: -40, y: height / 2 + 80, count: 4, maxWidth: 140 },
    ];

    for (const config of stripeConfigs) {
      let currentY = config.y;

      for (let i = 0; i < config.count; i++) {
        // Variación aleatoria en grosor - algunas más gruesas
        const isThick = Math.random() > 0.6;
        const thickness = isThick
          ? 8 + Math.random() * 10
          : 2 + Math.random() * 5;
        const stripeWidth = 40 + Math.random() * config.maxWidth;
        const gap = 6 + Math.random() * 12;

        // Color con variación de opacidad (muy sutil, gruesas un poco más visibles)
        const alpha = isThick
          ? 0.06 + Math.random() * 0.04
          : 0.03 + Math.random() * 0.05;

        // Dibujar raya diagonal (45 grados)
        stripes.lineStyle(thickness, NEON_COLORS.electricBlue, alpha);
        stripes.beginPath();
        stripes.moveTo(config.x, currentY);
        stripes.lineTo(config.x + stripeWidth, currentY - stripeWidth);
        stripes.strokePath();

        currentY += gap + thickness;
      }
    }

    // Añadir algunas rayas más cortas y brillantes como acento
    const accentStripes = [
      { x: 50, y: 150, length: 40, thick: false },
      { x: 80, y: 200, length: 25, thick: true },
      { x: width - 80, y: height - 120, length: 50, thick: false },
      { x: width - 120, y: 160, length: 35, thick: true },
      { x: 30, y: height / 2 + 180, length: 35, thick: false },
      { x: 20, y: height / 2 + 220, length: 55, thick: true },
    ];

    for (const accent of accentStripes) {
      const lineWidth = accent.thick ? 6 : 2;
      const alpha = accent.thick ? 0.08 : 0.1;
      stripes.lineStyle(lineWidth, NEON_COLORS.electricBlue, alpha);
      stripes.beginPath();
      stripes.moveTo(accent.x, accent.y);
      stripes.lineTo(accent.x + accent.length, accent.y - accent.length);
      stripes.strokePath();
    }
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

    // Fondo de la celda - visible en móviles
    const cellBg = this.add.graphics();
    cellBg.fillStyle(0x14141e, 1);
    cellBg.lineStyle(1, NEON_COLORS.offColor, 0.5);
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

    // Overlay de sombra para celdas no conectadas (muy sutil)
    // La celda de inicio no tiene sombra porque ya está iluminada
    const shadowOverlay = this.add.graphics();
    shadowOverlay.fillStyle(0x000000, 0.15);
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
      letterCircle.setStrokeStyle(2, 0x4a4a58, 0.7);
      container.add(letterCircle);

      // Es una letra - estilo moderno, visible cuando apagada
      letterText = this.add.text(0, 0, letter, {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "40px",
        color: "#4a4a5a",
        fontStyle: "bold",
      });
      letterText.setOrigin(0.5, 0.5);
      container.add(letterText);
    } else {
      // Es un punto - iluminado si es inicio, visible si no
      dotGraphic = this.add.circle(
        0,
        0,
        8,
        isStart ? NEON_COLORS.electricBlue : 0x2a2a38
      );
      if (!isStart) {
        dotGraphic.setStrokeStyle(1, 0x3a3a48, 0.7);
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
      cellBg,
    };

    // Hacer la celda interactiva
    container.setSize(CELL_SIZE, CELL_SIZE);
    container.setInteractive();

    return cell;
  }

  private createStartIndicator(container: Phaser.GameObjects.Container): void {
    // Efecto de foco de energía/electricidad
    this.createEnergyFocusEffect(container);
  }

  private createEnergyFocusEffect(
    container: Phaser.GameObjects.Container
  ): void {
    // === CAPA 1: Halo exterior difuso (estático, no consume GPU) ===
    const outerHalo = this.add.graphics();
    outerHalo.fillStyle(NEON_COLORS.electricBlue, 0.05);
    outerHalo.fillCircle(0, 0, 32);
    outerHalo.fillStyle(NEON_COLORS.electricBlue, 0.08);
    outerHalo.fillCircle(0, 0, 24);
    container.add(outerHalo);

    // === CAPA 2: Anillo de energía (solo 1 animación) ===
    const ring1 = this.add.circle(0, 0, 18);
    ring1.setStrokeStyle(2, NEON_COLORS.electricBlue, 0.4);
    ring1.setFillStyle(0x000000, 0);
    container.add(ring1);

    // Un solo tween más lento para el anillo
    this.tweens.add({
      targets: ring1,
      scaleX: { from: 0.9, to: 1.15 },
      scaleY: { from: 0.9, to: 1.15 },
      alpha: { from: 0.3, to: 0.6 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // === CAPA 3: Núcleo de energía brillante (estático, sin animación) ===
    const coreGlow = this.add.circle(0, 0, 10, NEON_COLORS.electricBlue, 0.35);
    container.add(coreGlow);

    const core = this.add.circle(0, 0, 6, NEON_COLORS.electricWhite, 0.9);
    container.add(core);

    // Guardar referencias para cleanup
    container.setData("plasmaCore", core);
    container.setData("plasmaRing", ring1);
    container.setData("coreGlow", coreGlow);
    container.setData("outerHalo", outerHalo);
    container.setData("isPlasmaSource", true);
  }

  private addPlasmaEffect(container: Phaser.GameObjects.Container): void {
    // Añadir efecto de bombilla encendida a una celda
    if (container.getData("plasmaGlow") || container.getData("plasmaInner"))
      return; // Ya tiene efecto

    // Para letras: crear glow simplificado (2 capas en vez de 4)
    if (container.getData("cellType") === "letter") {
      // Una sola capa de glow exterior
      const glowOuter = this.add.graphics();
      glowOuter.fillStyle(NEON_COLORS.electricBlue, 0.12);
      glowOuter.fillCircle(0, 0, 46);
      container.addAt(glowOuter, 0);

      // Anillo brillante simplificado
      const ringGlow = this.add.graphics();
      ringGlow.lineStyle(4, NEON_COLORS.electricBlue, 0.4);
      ringGlow.strokeCircle(0, 0, 34);
      ringGlow.lineStyle(1.5, NEON_COLORS.electricWhite, 0.6);
      ringGlow.strokeCircle(0, 0, 34);
      container.add(ringGlow);

      // Almacenar referencia al glow
      container.setData("plasmaGlow", [glowOuter, ringGlow]);

      // Animación de onda de encendido (una sola onda)
      this.createLightUpWave(container);

      return;
    }

    // Para puntos: efecto simple de glow
    const glow = this.add.graphics();
    glow.fillStyle(NEON_COLORS.electricBlue, 0.15);
    glow.fillCircle(0, 0, 18);
    container.addAt(glow, 0);

    const core = this.add.circle(0, 0, 5, NEON_COLORS.electricWhite, 0.85);
    container.add(core);

    container.setData("plasmaGlow", [glow]);
    container.setData("plasmaCore", core);

    // Animación de onda de encendido
    this.createLightUpWave(container);
  }

  private createLightUpWave(container: Phaser.GameObjects.Container): void {
    // Crear una sola onda expansiva de encendido (optimizado)
    const wave = this.add.graphics();
    wave.lineStyle(2.5, NEON_COLORS.electricBlue, 0.7);
    wave.strokeCircle(0, 0, 10);
    container.add(wave);

    // Animar la onda expandiéndose y desvaneciéndose
    this.tweens.add({
      targets: wave,
      scaleX: 3.5,
      scaleY: 3.5,
      alpha: 0,
      duration: 300,
      ease: "Quad.easeOut",
      onComplete: () => {
        wave.destroy();
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

    // Nuevos elementos del efecto de foco de energía
    const energyRing2 = container.getData("energyRing2") as
      | Phaser.GameObjects.Arc
      | undefined;
    const coreGlow = container.getData("coreGlow") as
      | Phaser.GameObjects.Arc
      | undefined;
    const outerHalo = container.getData("outerHalo") as
      | Phaser.GameObjects.Graphics
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
      this.tweens.killTweensOf(ring);
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

    // Limpiar nuevos elementos del efecto de foco de energía
    if (energyRing2) {
      this.tweens.killTweensOf(energyRing2);
      energyRing2.destroy();
      container.setData("energyRing2", undefined);
    }

    if (coreGlow) {
      this.tweens.killTweensOf(coreGlow);
      coreGlow.destroy();
      container.setData("coreGlow", undefined);
    }

    if (outerHalo) {
      outerHalo.clear();
      outerHalo.destroy();
      container.setData("outerHalo", undefined);
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

    // Fondo visible para las letras
    const bgBar = this.add.graphics();
    bgBar.fillStyle(0x16161f, 0.95);
    bgBar.fillRoundedRect(-bgWidth / 2, -40, bgWidth, 80, 16);
    this.wordContainer.add(bgBar);

    for (let i = 0; i < word.length; i++) {
      const letter = word[i];
      const x = startX + i * letterSpacing;

      // Efecto de glow detrás
      const glow = this.add.text(x, 0, letter, {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "38px",
        color: "#b7ff01",
        fontStyle: "bold",
      });
      glow.setOrigin(0.5, 0.5);
      glow.setAlpha(0);
      this.wordContainer.add(glow);

      // Letra principal - estilo moderno
      const letterText = this.add.text(x, 0, letter, {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "38px",
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
    bgCircle.lineStyle(lineWidth, 0x2a2a38, 1);
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
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "32px",
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

    // Indicador de nivel a la izquierda del timer - fuente Orbitron
    const levelText = this.add.text(
      width / 2 - 110,
      70,
      `LV.${this.currentLevel.toString().padStart(2, "0")}`,
      {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "28px",
        color: "#666677",
        fontStyle: "bold",
      }
    );
    levelText.setOrigin(1, 0.5);

    // Contenedor para el score estilo marcador digital
    const scoreContainer = this.add.container(width / 2 + 110, 70);

    // Tamaño fijo para el badge del score (5 dígitos max)
    const fixedWidth = 95;
    const paddingH = 18;
    const paddingV = 8;

    // Fondo del marcador digital - tamaño fijo
    const scoreBg = this.add.graphics();
    scoreBg.fillStyle(0x16161f, 0.95);
    scoreBg.fillRoundedRect(
      -paddingH,
      -22 - paddingV,
      fixedWidth + paddingH * 2,
      44 + paddingV * 2,
      10
    );
    scoreContainer.add(scoreBg);

    // Efecto de segmentos "apagados" estilo LCD
    const dimDigits = this.add.text(fixedWidth / 2, 0, "00000", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "26px",
      color: "#2a2a38",
      fontStyle: "bold",
    });
    dimDigits.setOrigin(0.5, 0.5);
    scoreContainer.add(dimDigits);

    // Score real encima
    this.scoreText = this.add.text(
      fixedWidth / 2,
      0,
      this.score.toString().padStart(5, "0"),
      {
        fontFamily: '"Orbitron", sans-serif',
        fontSize: "26px",
        color: "#b7ff01",
        fontStyle: "bold",
      }
    );
    this.scoreText.setOrigin(0.5, 0.5);
    scoreContainer.add(this.scoreText);

    // Texto de streak/multiplicador (solo visible si hay streak >= 2)
    this.streakText = this.add.text(fixedWidth + paddingH + 8, 0, "", {
      fontFamily: '"Orbitron", sans-serif',
      fontSize: "18px",
      color: "#00ffcc",
      fontStyle: "bold",
    });
    this.streakText.setOrigin(0, 0.5);
    this.streakText.setAlpha(0);
    scoreContainer.add(this.streakText);

    // Mostrar streak si existe
    if (Level1Scene.perfectStreak >= 2) {
      this.streakText.setText(`x${Level1Scene.perfectStreak}`);
      this.streakText.setAlpha(1);
    }
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
    bg.fillStyle(0x16161f, 0.95);
    bg.fillRoundedRect(
      -buttonWidth / 2,
      -buttonHeight / 2,
      buttonWidth,
      buttonHeight,
      16
    );
    this.undoButton.add(bg);

    // Icono de refresh clásico - flechas circulares apuntando una hacia la otra
    const icon = this.add.graphics();
    const r = 14;

    // Glow
    icon.lineStyle(7, NEON_COLORS.electricBlue, 0.15);
    // Arco superior (de izquierda a derecha)
    icon.beginPath();
    icon.arc(0, 0, r, Math.PI, 0, false);
    icon.strokePath();
    // Arco inferior (de derecha a izquierda)
    icon.beginPath();
    icon.arc(0, 0, r, 0, Math.PI, false);
    icon.strokePath();

    // Arcos principales
    icon.lineStyle(2.5, NEON_COLORS.electricBlue, 1);
    // Arco superior
    icon.beginPath();
    icon.arc(0, 0, r, Math.PI + 0.4, -0.4, false);
    icon.strokePath();
    // Arco inferior
    icon.beginPath();
    icon.arc(0, 0, r, 0.4, Math.PI - 0.4, false);
    icon.strokePath();

    // Flecha superior derecha (pico más grande)
    icon.lineStyle(2.5, NEON_COLORS.electricBlue, 1);
    icon.beginPath();
    icon.moveTo(r + 2, 0); // punta
    icon.lineTo(r - 8, 6); // brazo izquierdo
    icon.strokePath();
    icon.beginPath();
    icon.moveTo(r + 2, 0); // punta
    icon.lineTo(r, 10); // brazo abajo
    icon.strokePath();

    // Flecha inferior izquierda (pico más grande)
    icon.beginPath();
    icon.moveTo(-r - 2, 0); // punta
    icon.lineTo(-r + 8, -6); // brazo derecho
    icon.strokePath();
    icon.beginPath();
    icon.moveTo(-r - 2, 0); // punta
    icon.lineTo(-r, -10); // brazo arriba
    icon.strokePath();

    this.undoButton.add(icon);

    // Hacer interactivo
    this.undoButton.setSize(buttonWidth, buttonHeight);
    this.undoButton.setInteractive({ useHandCursor: true });

    this.undoButton.on("pointerover", () => {
      bg.clear();
      bg.fillStyle(0x202030, 0.95);
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
      bg.fillStyle(0x0c0c14, 0.95);
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

      // Si es la última letra, verificar que todas las celdas estén conectadas
      const wordLength = this.currentLevelConfig.word.length;
      if (cell.letterOrder === wordLength) {
        // Contamos las celdas que estarían conectadas después de añadir esta
        const cellsAfterThis = this.path.length + 1;
        if (cellsAfterThis < this.totalCells) {
          // No se han completado todas las celdas, mostrar error
          this.showWrongLetterFeedback(cell);
          return;
        }
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

    // Detener pulso anterior y crear uno nuevo en la celda actual
    if (this.currentCellPulseTween) {
      this.currentCellPulseTween.stop();
      // Restaurar escala de la celda anterior
      const prevTargets = this.currentCellPulseTween.targets;
      if (prevTargets && prevTargets.length > 0) {
        (prevTargets[0] as Phaser.GameObjects.Graphics).setScale(1);
      }
    }
    // Pulso suave en la celda actual (escala mínima para no afectar FPS)
    this.currentCellPulseTween = this.tweens.add({
      targets: cell.graphics,
      scaleX: { from: 1, to: 1.04 },
      scaleY: { from: 1, to: 1.04 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Efectos visuales
    this.animateCellActivation(cell);

    // Sonido solo para celdas con letra
    if (cell.type === "letter") {
      this.playConnectSound();
      // Haptic feedback al conectar una letra
      if (window.FarcadeSDK?.hapticFeedback) {
        window.FarcadeSDK.hapticFeedback();
      }
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

    // Marcar que usó marcha atrás (pierde el perfect)
    this.usedUndo = true;

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

    // Mover el pulso a la nueva celda actual
    if (this.currentCellPulseTween) {
      this.currentCellPulseTween.stop();
      // Restaurar escala de la celda anterior
      cell.graphics.setScale(1);
    }
    if (this.currentCell) {
      this.currentCellPulseTween = this.tweens.add({
        targets: this.currentCell.graphics,
        scaleX: { from: 1, to: 1.04 },
        scaleY: { from: 1, to: 1.04 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else {
      this.currentCellPulseTween = null;
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
    // Bloquear input durante el tutorial
    if (this.gamePaused) return;

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
    // Bloquear input durante el tutorial
    if (this.gamePaused) return;

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
        duration: 180,
        ease: "Power2",
      });
    }

    // Iluminar el fondo de la celda con un brillo suave
    if (cell.cellBg) {
      cell.cellBg.clear();
      // Fondo con brillo azul eléctrico suave
      cell.cellBg.fillStyle(NEON_COLORS.electricBlue, 0.08);
      cell.cellBg.fillRoundedRect(
        -CELL_SIZE / 2,
        -CELL_SIZE / 2,
        CELL_SIZE,
        CELL_SIZE,
        12
      );
      cell.cellBg.lineStyle(1.5, NEON_COLORS.electricBlue, 0.3);
      cell.cellBg.strokeRoundedRect(
        -CELL_SIZE / 2,
        -CELL_SIZE / 2,
        CELL_SIZE,
        CELL_SIZE,
        12
      );
    }

    if (cell.type === "letter" && cell.letterText) {
      // Animar letra con brillo intenso verde lima
      cell.letterText.setColor("#B7FF01");

      // Iluminar la circunferencia
      if (cell.letterCircle) {
        cell.letterCircle.setStrokeStyle(2, NEON_COLORS.electricBlue, 0.9);
      }

      // Escala suave de la letra
      this.tweens.add({
        targets: cell.letterText,
        scale: 1.15,
        duration: 120,
        yoyo: true,
        ease: "Sine.easeOut",
      });
    } else if (cell.dotGraphic) {
      // Animar punto - más brillante con color cian
      cell.dotGraphic.setFillStyle(NEON_COLORS.pathColor);
      cell.dotGraphic.setStrokeStyle(2, NEON_COLORS.pathColorLight, 0.8);

      // Escala suave del punto
      this.tweens.add({
        targets: cell.dotGraphic,
        scale: 1.4,
        duration: 120,
        yoyo: true,
        ease: "Sine.easeOut",
      });
    }

    // Animación de ondulación suave: movimiento flotante más pronunciado con escala
    this.tweens.add({
      targets: cell.graphics,
      y: cell.graphics.y - 6,
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 180,
      yoyo: true,
      ease: "Sine.easeOut",
    });
  }

  private animateCellDeactivation(cell: Cell): void {
    // Restaurar fondo original (sin iluminación)
    if (cell.cellBg) {
      cell.cellBg.clear();
      cell.cellBg.fillStyle(0x14141e, 1);
      cell.cellBg.lineStyle(1, NEON_COLORS.offColor, 0.5);
      cell.cellBg.fillRoundedRect(
        -CELL_SIZE / 2,
        -CELL_SIZE / 2,
        CELL_SIZE,
        CELL_SIZE,
        12
      );
      cell.cellBg.strokeRoundedRect(
        -CELL_SIZE / 2,
        -CELL_SIZE / 2,
        CELL_SIZE,
        CELL_SIZE,
        12
      );
    }

    // Restaurar sombra de oscuridad (muy sutil)
    if (cell.shadowOverlay) {
      this.tweens.add({
        targets: cell.shadowOverlay,
        alpha: 0.15,
        duration: 200,
      });
    }

    if (cell.type === "letter" && cell.letterText) {
      cell.letterText.setColor("#4a4a5a");
      // Apagar la circunferencia
      if (cell.letterCircle) {
        cell.letterCircle.setStrokeStyle(2, 0x4a4a58, 0.7);
      }
    } else if (cell.dotGraphic) {
      cell.dotGraphic.setFillStyle(0x2a2a38);
      cell.dotGraphic.setStrokeStyle(1, 0x3a3a48, 0.7);
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
    // El nuevo efecto de foco de energía usa tweens automáticos
    // No se necesita ninguna actualización manual
  }

  private animatePlasmaContainer(
    container: Phaser.GameObjects.Container | undefined,
    isEndPoint: boolean = false
  ): void {
    // El nuevo efecto de foco de energía usa tweens automáticos
    // Esta función ya no necesita hacer nada manualmente
    if (!container) return;
    // Los tweens manejan toda la animación automáticamente
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

    // Haptic feedback por completar el nivel
    if (window.FarcadeSDK?.hapticFeedback) {
      window.FarcadeSDK.hapticFeedback();
    }

    // Detener pulso de celda actual
    if (this.currentCellPulseTween) {
      this.currentCellPulseTween.stop();
      this.currentCellPulseTween = null;
    }

    // Determinar si fue perfect (sin usar undo)
    const isPerfect = !this.usedUndo;

    // Actualizar racha de perfects
    if (isPerfect) {
      Level1Scene.perfectStreak++;
    } else {
      Level1Scene.perfectStreak = 0;
    }

    // Calcular puntos ganados:
    // Base: 100 puntos
    // Multiplicador por tiempo: 1.0 a 2.0 según tiempo restante
    // Bonus por streak: +25% por cada perfect consecutivo
    const basePoints = 100;
    const timeMultiplier = 1 + this.timeRemaining / this.maxTime; // 1.0 a 2.0
    const streakMultiplier =
      isPerfect && Level1Scene.perfectStreak >= 2
        ? 1 + (Level1Scene.perfectStreak - 1) * 0.25
        : 1;
    const pointsEarned = Math.round(
      basePoints * timeMultiplier * streakMultiplier
    );
    this.score += pointsEarned;

    // Actualizar display del score
    if (this.scoreText) {
      this.scoreText.setText(this.score.toString().padStart(5, "0"));
    }

    // Actualizar display del streak
    if (this.streakText) {
      if (Level1Scene.perfectStreak >= 2) {
        this.streakText.setText(`x${Level1Scene.perfectStreak}`);
        this.streakText.setVisible(true);
        // Animación del streak
        this.tweens.add({
          targets: this.streakText,
          scale: { from: 1.5, to: 1 },
          duration: 300,
          ease: "Back.easeOut",
        });
      } else {
        this.streakText.setVisible(false);
      }
    }

    // Mostrar texto PERFECT si aplica
    if (isPerfect) {
      this.showPerfectText();
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

    // Animación de onda de vibración suave de celdas (de abajo hacia arriba)
    this.createVictoryWaveAnimation();

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
    // Evitar múltiples llamadas
    if (this.isGameOver) return;
    this.isGameOver = true; // Reutilizar flag para prevenir doble transición

    const nextLevel = this.currentLevel + 1;
    const currentScore = this.score;

    // Fade out
    this.cameras.main.fadeOut(500, 0, 0, 0);

    // Variable para evitar doble restart
    let transitioned = false;

    const doRestart = () => {
      if (transitioned) return;
      transitioned = true;
      this.scene.restart({ level: nextLevel, score: currentScore });
    };

    // Escuchar el evento de fade completado
    this.cameras.main.once("camerafadeoutcomplete", doRestart);

    // Fallback: si el evento no se dispara en 1 segundo, forzar la transición
    this.time.delayedCall(1000, doRestart);
  }

  // Animación de onda suave de vibración de celdas (de abajo hacia arriba)
  private createVictoryWaveAnimation(): void {
    // Onda suave de abajo hacia arriba - iteramos por filas
    for (let row = GRID_ROWS - 1; row >= 0; row--) {
      // Delay basado en la distancia desde abajo (fila más baja = row más alto = primero)
      const rowDelay = (GRID_ROWS - 1 - row) * 80;

      for (let col = 0; col < GRID_COLS; col++) {
        if (this.cells[row] && this.cells[row][col]) {
          const cell = this.cells[row][col];
          const originalY = cell.graphics.y;

          // Onda hacia arriba suave
          this.tweens.add({
            targets: cell.graphics,
            y: originalY - 6,
            duration: 200,
            delay: rowDelay,
            ease: "Sine.easeOut",
            yoyo: true,
            onComplete: () => {
              cell.graphics.y = originalY; // Asegurar posición original
            },
          });

          // Scale sutil sincronizado
          this.tweens.add({
            targets: cell.graphics,
            scaleX: 1.04,
            scaleY: 1.04,
            duration: 180,
            delay: rowDelay + 20,
            ease: "Sine.easeInOut",
            yoyo: true,
          });
        }
      }
    }
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

  private showPerfectText(): void {
    const { width, height } = GameSettings.canvas;

    // Texto PERFECT grande y centrado
    const perfectText = this.add.text(width / 2, height / 2 - 50, "PERFECT!", {
      fontFamily: "Arial Black, Arial",
      fontSize: "48px",
      color: "#b7ff01",
      stroke: "#000000",
      strokeThickness: 4,
    });
    perfectText.setOrigin(0.5);
    perfectText.setDepth(1001);
    perfectText.setAlpha(0);
    perfectText.setScale(0.3);

    // Animación de entrada
    this.tweens.add({
      targets: perfectText,
      alpha: 1,
      scale: 1.2,
      duration: 250,
      ease: "Back.easeOut",
      onComplete: () => {
        // Pulso y salida
        this.tweens.add({
          targets: perfectText,
          scale: 1,
          duration: 150,
          yoyo: true,
          repeat: 1,
          onComplete: () => {
            // Fade out hacia arriba
            this.tweens.add({
              targets: perfectText,
              y: perfectText.y - 80,
              alpha: 0,
              duration: 400,
              ease: "Power2",
              onComplete: () => perfectText.destroy(),
            });
          },
        });
      },
    });

    // Mostrar multiplicador de streak si aplica
    if (Level1Scene.perfectStreak >= 2) {
      const bonusText = this.add.text(
        width / 2,
        height / 2 + 10,
        `STREAK x${Level1Scene.perfectStreak}!`,
        {
          fontFamily: "Arial Black, Arial",
          fontSize: "28px",
          color: "#00ffcc",
          stroke: "#000000",
          strokeThickness: 3,
        }
      );
      bonusText.setOrigin(0.5);
      bonusText.setDepth(1001);
      bonusText.setAlpha(0);

      this.tweens.add({
        targets: bonusText,
        alpha: 1,
        scale: { from: 0.5, to: 1 },
        duration: 300,
        delay: 200,
        ease: "Back.easeOut",
        onComplete: () => {
          this.time.delayedCall(600, () => {
            this.tweens.add({
              targets: bonusText,
              y: bonusText.y - 50,
              alpha: 0,
              duration: 300,
              onComplete: () => bonusText.destroy(),
            });
          });
        },
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
