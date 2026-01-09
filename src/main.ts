import { initRemix } from "@insidethesim/remix-dev";
import GameSettings from "./config/GameSettings";
import { GameScene } from "./scenes/GameScene";
import { PreloadScene } from "./scenes/PreloadScene";

// SDK mock is automatically initialized by the framework (dev-init.ts)

// Game configuration
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: GameSettings.canvas.width,
  height: GameSettings.canvas.height,
  scale: {
    mode: Phaser.Scale.FIT,
    parent: document.body,
    width: GameSettings.canvas.width,
    height: GameSettings.canvas.height,
  },
  backgroundColor: "#000000",
  scene: [PreloadScene, GameScene],
  // Sin motor de física - no se usa y consume recursos
  fps: {
    target: 60,
  },
  pixelArt: false,
  antialias: true,
  // Optimizaciones de rendimiento
  render: {
    powerPreference: "high-performance",
  },
};

// Create the game instance
const game = new Phaser.Game(config);

// Store globally for performance monitoring and HMR cleanup
(window as any).game = game;

// Initialize Remix framework after game is created
game.events.once("ready", () => {
  initRemix(game, {
    multiplayer: false,
  });
});
