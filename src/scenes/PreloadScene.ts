import { PreloadSceneBase } from "./PreloadSceneBase";

// URLs de música
export const MUSIC_TRACKS = [
  "https://remix.gg/blob/7d79dfc9-98c7-4962-9f7b-fef01ff586cd/music1-weXEnkfskx-KZnMdMaLGXmdB4fzINSwlLEi4j7fOH.mp3?9mWW",
  "https://remix.gg/blob/7d79dfc9-98c7-4962-9f7b-fef01ff586cd/music2-QL3EazFVXB-hgfWchtmQeZ0eHVvnnt5UFX9ogyhGx.mp3?BW3U",
  "https://remix.gg/blob/7d79dfc9-98c7-4962-9f7b-fef01ff586cd/music3-y7ubaNsokI-z3i0Gou8L5vb4a24FMMCvgDZxQ6UNO.mp3?81ct",
];

export class PreloadScene extends PreloadSceneBase {
  private fontLoaded: boolean = false;

  constructor() {
    super("PreloadScene", "Level1Scene");
  }

  protected loadProjectAssets(): void {
    // Cargar la fuente Orbitron usando el FontFace API
    this.loadFont(
      "Orbitron",
      "https://fonts.gstatic.com/s/orbitron/v29/yMJMMIlzdpvBhQQL_SC3X9yhF25-T1nyGy6BoWgz.woff2"
    );
  }

  private loadFont(name: string, url: string): void {
    // Usar FontFace API para precargar la fuente
    const font = new FontFace(name, `url(${url})`);
    font
      .load()
      .then((loadedFont) => {
        document.fonts.add(loadedFont);
        console.log(`[PreloadScene] Font ${name} loaded`);
        this.fontLoaded = true;
        this.checkTransition();
      })
      .catch((error) => {
        console.warn(`[PreloadScene] Could not load font ${name}:`, error);
        // Continuar aunque falle la fuente
        this.fontLoaded = true;
        this.checkTransition();
      });
  }

  protected override checkTransition(): void {
    // Solo transicionar cuando la animación, assets Y fuente estén listos
    if (this.animationComplete && this.assetsLoaded && this.fontLoaded) {
      this.scene.start(this.nextSceneKey);
    }
  }

  protected onAssetsLoaded(): void {
    console.log("[PreloadScene] All assets loaded");
  }
}
