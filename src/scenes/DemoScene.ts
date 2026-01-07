import type { FarcadeSDK, GameInfo } from '@farcade/game-sdk'
import GameSettings from '../config/GameSettings'

// Extend the Player type from SDK
type Player = GameInfo['players'][number]

// Declare the FarcadeSDK on window
declare global {
  interface Window {
    FarcadeSDK: FarcadeSDK
    debugLogs: string[]
  }
}

interface Ball {
  sprite: Phaser.GameObjects.Arc
  velocityX: number
  velocityY: number
  radius: number
  isPopped: boolean
}

export class DemoScene extends Phaser.Scene {
  private balls: Ball[] = []
  private gameOver: boolean = false
  private elementsCreated: boolean = false

  // Web Audio API for sound effects
  // eslint-disable-next-line no-undef
  private audioContext: AudioContext | null = null
  private audioInitialized: boolean = false
  private isMuted: boolean = false

  // Color values
  private colorValues = {
    green: 0x33ff00,
    blue: 0x0099ff,
    red: 0xff3333,
  }

  // Multiplayer support
  private isMultiplayer: boolean = false
  private players: Player[] = []
  private meId: string = '1'

  // Per-player state (works for both single and multiplayer)
  private playerStates: {
    [playerId: string]: {
      color: 'green' | 'blue' | 'red'
      score: number
    }
  } = {}

  // Turn-based multiplayer state
  private currentTurnPlayerId: string = '1'
  private roundNumber: number = 0
  private lastSentStateId?: string // Track last state we sent to avoid processing our own updates

  // UI Elements
  private player1ScoreText?: Phaser.GameObjects.Text
  private player2ScoreText?: Phaser.GameObjects.Text
  private turnIndicatorText?: Phaser.GameObjects.Text
  private colorSwatches?: Phaser.GameObjects.Container
  private tierIndicators?: Phaser.GameObjects.Container
  private tierCircles: Phaser.GameObjects.Arc[] = []
  private tierLabels: Phaser.GameObjects.Text[] = []

  constructor() {
    super({ key: 'DemoScene' })
  }

  preload(): void {}

  // ========== Web Audio API Sound System ==========

  private initAudio(): void {
    if (this.audioInitialized) return
    try {
      this.audioContext = new window.AudioContext()
      this.audioInitialized = true
    } catch (e) {
      console.warn('[DemoScene] Web Audio API not available:', e)
    }
  }

  /**
   * Play a hollow, airy "whump" bounce sound - like a kickball
   * @param radius - Ball radius (25-60 range expected)
   * @param velocity - Collision velocity magnitude (0-600 range typical)
   * @param baseVolume - Base volume multiplier (0-1), default 0.3
   */
  private playBounceSound(radius: number, velocity: number = 300, baseVolume: number = 0.3): void {
    if (!this.audioContext || this.isMuted) return

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Map radius to base frequency - larger balls = deeper (140-220 Hz range)
    const minRadius = 40
    const maxRadius = 90
    const normalizedRadius = Math.min(
      1,
      Math.max(0, (radius - minRadius) / (maxRadius - minRadius))
    )
    const baseFreq = 220 - normalizedRadius * 80 // 220Hz for small, 140Hz for large

    // Velocity affects volume
    const normalizedVelocity = Math.min(1, Math.max(0, velocity / 600))
    const velocityVolume = 0.4 + normalizedVelocity * 0.6

    // Main thump oscillator - higher frequency, quicker decay
    const thumpOsc = ctx.createOscillator()
    const thumpGain = ctx.createGain()

    thumpOsc.type = 'sine'
    thumpOsc.frequency.setValueAtTime(baseFreq * 1.2, now)
    thumpOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + 0.08)

    const thumpVol = baseVolume * velocityVolume * 0.35
    thumpGain.gain.setValueAtTime(thumpVol, now)
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)

    thumpOsc.connect(thumpGain)
    thumpGain.connect(ctx.destination)

    thumpOsc.start(now)
    thumpOsc.stop(now + 0.1)

    // Airy noise layer for hollow quality
    const noiseLength = 0.08
    const bufferSize = Math.floor(ctx.sampleRate * noiseLength)
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    const noiseGain = ctx.createGain()
    const noiseFilter = ctx.createBiquadFilter()

    noise.buffer = noiseBuffer
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.setValueAtTime(baseFreq * 4, now)
    noiseFilter.Q.setValueAtTime(1.5, now)

    const noiseVol = baseVolume * velocityVolume * 0.12
    noiseGain.gain.setValueAtTime(noiseVol, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)

    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + noiseLength)
  }

  /**
   * Play a dramatic pop sound - satisfying burst with harmonic richness
   * @param radius - Ball radius (25-60 range expected)
   */
  private playPopSound(radius: number): void {
    if (!this.audioContext || this.isMuted) return

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Map radius to base frequency (smaller = higher pitch)
    const minRadius = 40
    const maxRadius = 90
    const normalizedRadius = (radius - minRadius) / (maxRadius - minRadius)
    const baseFreq = 900 - normalizedRadius * 500 // 900-400 Hz

    // Layer 1: Main pop with dramatic pitch drop
    const mainOsc = ctx.createOscillator()
    const mainGain = ctx.createGain()

    mainOsc.type = 'sine'
    mainOsc.frequency.setValueAtTime(baseFreq * 2, now)
    mainOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.25, now + 0.2)

    mainGain.gain.setValueAtTime(0.4, now)
    mainGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)

    mainOsc.connect(mainGain)
    mainGain.connect(ctx.destination)
    mainOsc.start(now)
    mainOsc.stop(now + 0.2)

    // Layer 2: Higher harmonic for brightness
    const highOsc = ctx.createOscillator()
    const highGain = ctx.createGain()

    highOsc.type = 'sine'
    highOsc.frequency.setValueAtTime(baseFreq * 3.5, now)
    highOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.1)

    highGain.gain.setValueAtTime(0.2, now)
    highGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1)

    highOsc.connect(highGain)
    highGain.connect(ctx.destination)
    highOsc.start(now)
    highOsc.stop(now + 0.1)

    // Layer 3: Filtered noise burst for "air release" texture
    const noiseLength = 0.1
    const bufferSize = Math.floor(ctx.sampleRate * noiseLength)
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = noiseBuffer.getChannelData(0)
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1
    }

    const noise = ctx.createBufferSource()
    const noiseGain = ctx.createGain()
    const noiseFilter = ctx.createBiquadFilter()

    noise.buffer = noiseBuffer
    noiseFilter.type = 'highpass'
    noiseFilter.frequency.setValueAtTime(baseFreq * 2, now)
    noiseFilter.frequency.exponentialRampToValueAtTime(baseFreq * 6, now + 0.05)

    noiseGain.gain.setValueAtTime(0.25, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08)

    noise.connect(noiseFilter)
    noiseFilter.connect(noiseGain)
    noiseGain.connect(ctx.destination)
    noise.start(now)
    noise.stop(now + noiseLength)

    // Layer 4: Sub-thump for impact feel
    const subOsc = ctx.createOscillator()
    const subGain = ctx.createGain()

    subOsc.type = 'sine'
    subOsc.frequency.setValueAtTime(baseFreq * 0.5, now)
    subOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.15, now + 0.15)

    subGain.gain.setValueAtTime(0.3, now)
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15)

    subOsc.connect(subGain)
    subGain.connect(ctx.destination)
    subOsc.start(now)
    subOsc.stop(now + 0.15)
  }

  /**
   * Play a UI click sound - sharp, percussive click for buttons/swatches
   */
  private playUIClickSound(): void {
    if (!this.audioContext || this.isMuted) return

    const ctx = this.audioContext
    const now = ctx.currentTime

    // Sharp attack click using short noise burst
    const clickLength = 0.015
    const bufferSize = Math.floor(ctx.sampleRate * clickLength)
    const clickBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const output = clickBuffer.getChannelData(0)

    // Create a sharp transient - starts loud, decays quickly
    for (let i = 0; i < bufferSize; i++) {
      const envelope = Math.exp(-i / (bufferSize * 0.1))
      output[i] = (Math.random() * 2 - 1) * envelope
    }

    const click = ctx.createBufferSource()
    const clickGain = ctx.createGain()
    const clickFilter = ctx.createBiquadFilter()

    click.buffer = clickBuffer

    // High-pass filter for crisp click
    clickFilter.type = 'highpass'
    clickFilter.frequency.setValueAtTime(2000, now)

    clickGain.gain.setValueAtTime(0.3, now)

    click.connect(clickFilter)
    clickFilter.connect(clickGain)
    clickGain.connect(ctx.destination)

    click.start(now)

    // Add a subtle tonal element for satisfying feedback
    const toneOsc = ctx.createOscillator()
    const toneGain = ctx.createGain()

    toneOsc.type = 'sine'
    toneOsc.frequency.setValueAtTime(1800, now)
    toneOsc.frequency.exponentialRampToValueAtTime(1200, now + 0.03)

    toneGain.gain.setValueAtTime(0.08, now)
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03)

    toneOsc.connect(toneGain)
    toneGain.connect(ctx.destination)

    toneOsc.start(now)
    toneOsc.stop(now + 0.03)
  }

  /**
   * Play a quick flash of light at collision point
   */
  private playCollisionFlash(x: number, y: number, intensity: number = 1, color?: number): void {
    // Use provided color or current player color
    const flashColor = color ?? this.colorValues[this.getMyState().color]
    const flash = this.add.circle(x, y, 12, flashColor)
    flash.setDepth(200)
    flash.setAlpha(intensity)
    flash.setBlendMode(Phaser.BlendModes.ADD)

    this.tweens.add({
      targets: flash,
      scale: { from: 1, to: 4 },
      alpha: { from: intensity, to: 0 },
      duration: 60,
      ease: 'Quad.easeOut',
      onComplete: () => {
        flash.destroy()
      },
    })
  }

  // ========== Helper Methods ==========

  private initializePlayerState(playerId: string): void {
    if (!this.playerStates[playerId]) {
      // In multiplayer, assign fixed colors based on player order
      let assignedColor: 'green' | 'blue' | 'red' = 'green'
      if (this.isMultiplayer && this.players.length >= 2) {
        // Player 1 (players[0]) = green, Player 2 (players[1]) = red
        const playerIndex = this.players.findIndex((p) => p.id === playerId)
        assignedColor = playerIndex === 1 ? 'red' : 'green'
      }

      this.playerStates[playerId] = {
        color: assignedColor,
        score: 0,
      }
    }
  }

  private getMyState() {
    this.initializePlayerState(this.meId)
    return this.playerStates[this.meId]
  }

  private getPlayerState(playerId: string) {
    this.initializePlayerState(playerId)
    return this.playerStates[playerId]
  }

  private isMyTurn(): boolean {
    return !this.isMultiplayer || this.currentTurnPlayerId === this.meId
  }

  private getOtherPlayerId(): string | null {
    if (!this.isMultiplayer || this.players.length < 2) return null
    return this.players.find((p) => p.id !== this.meId)?.id || null
  }

  private switchTurn(): void {
    if (!this.isMultiplayer) return

    const otherPlayerId = this.getOtherPlayerId()
    if (otherPlayerId) {
      this.currentTurnPlayerId = otherPlayerId
      this.roundNumber++
    }
  }

  private getTurnText(): string {
    if (!this.isMultiplayer) return ''
    const currentPlayer = this.players.find((p) => p.id === this.currentTurnPlayerId)
    return this.isMyTurn() ? '⭐ YOUR TURN ⭐' : `${currentPlayer?.name || 'Opponent'}'s Turn`
  }

  private updateUI(): void {
    if (this.isMultiplayer && this.players.length >= 2) {
      const player1 = this.players[0]
      const player2 = this.players[1]

      if (this.player1ScoreText) {
        const p1State = this.getPlayerState(player1.id)
        this.player1ScoreText.setText(`${player1.name}\nScore: ${p1State.score}/3`)
      }

      if (this.player2ScoreText) {
        const p2State = this.getPlayerState(player2.id)
        this.player2ScoreText.setText(`${player2.name}\nScore: ${p2State.score}/3`)
      }

      if (this.turnIndicatorText) {
        this.turnIndicatorText.setText(this.getTurnText())
      }
    } else if (this.player1ScoreText) {
      this.player1ScoreText.setText(`Score: ${this.getMyState().score}/3`)
    }
  }

  private loadStateFromData(state: any): void {
    if (!state) return

    if (this.isMultiplayer) {
      // Multiplayer: load per-player states and turn info
      if (state.playerStates) {
        this.playerStates = state.playerStates
      }
      if (state.currentTurnPlayerId) {
        this.currentTurnPlayerId = state.currentTurnPlayerId
      }
      if (typeof state.roundNumber === 'number') {
        this.roundNumber = state.roundNumber
      }
      if (typeof state.gameOver === 'boolean') {
        this.gameOver = state.gameOver
      }
    } else {
      // Single-player: load only color preference (score always starts at 0)
      const myState = this.getMyState()
      if (state.color) {
        myState.color = state.color
      }
    }
  }

  private updateBallColors(): void {
    // Update ball colors to match current player's color
    const myColor = this.getMyState().color
    const colorValue = this.colorValues[myColor]

    this.balls.forEach((ball) => {
      if (!ball.isPopped) {
        ball.sprite.setFillStyle(colorValue)
      }
    })
  }

  create(): void {
    // Initialize SDK first and wait for it to be ready before creating game elements
    this.initializeSDK()
  }

  private createGameElements(): void {
    // Prevent double creation
    if (this.elementsCreated) {
      return
    }
    this.elementsCreated = true

    console.log(
      '[DemoScene] Creating game elements, isMultiplayer:',
      this.isMultiplayer,
      'players:',
      this.players.length
    )

    // Initialize my player state
    this.initializePlayerState(this.meId)

    // Add title
    const title = this.add
      .text(
        GameSettings.canvas.width / 2,
        GameSettings.canvas.height / 2 - 100,
        this.isMultiplayer ? 'Turn-Based Demo' : 'Remix SDK Demo',
        {
          fontSize: '64px',
          color: '#ffffff',
          fontFamily: 'Arial',
        }
      )
      .setOrigin(0.5)
      .setDepth(100)

    // Instruction text
    const instruction = this.add
      .text(
        GameSettings.canvas.width / 2,
        GameSettings.canvas.height / 2 - 20,
        this.isMultiplayer
          ? 'Take turns popping balls!\nFirst to 3 wins!'
          : 'Pop 3 balls to trigger Game Over!',
        {
          fontSize: '32px',
          color: '#ffffff',
          fontFamily: 'Arial',
          align: 'center',
        }
      )
      .setOrigin(0.5)
      .setDepth(100)

    if (this.isMultiplayer && this.players.length >= 2) {
      // Multiplayer: Show both players' scores
      const player1 = this.players.find((p) => p.id === '1') || this.players[0]
      const player2 = this.players.find((p) => p.id === '2') || this.players[1]

      // Initialize both player states
      this.initializePlayerState(player1.id)
      this.initializePlayerState(player2.id)

      // Player 1 score (left side)
      this.player1ScoreText = this.add
        .text(50, 50, `${player1.name}\nScore: ${this.getPlayerState(player1.id).score}/3`, {
          fontSize: '28px',
          color: player1.id === this.meId ? '#00ff00' : '#ffffff',
          fontFamily: 'Arial',
        })
        .setOrigin(0, 0.5)
        .setDepth(100)

      // Player 2 score (right side)
      this.player2ScoreText = this.add
        .text(
          GameSettings.canvas.width - 50,
          50,
          `${player2.name}\nScore: ${this.getPlayerState(player2.id).score}/3`,
          {
            fontSize: '28px',
            color: player2.id === this.meId ? '#00ff00' : '#ffffff',
            fontFamily: 'Arial',
            align: 'right',
          }
        )
        .setOrigin(1, 0.5)
        .setDepth(100)

      // Turn indicator (center top)
      this.turnIndicatorText = this.add
        .text(GameSettings.canvas.width / 2, 40, this.getTurnText(), {
          fontSize: '32px',
          color: '#ffff00',
          fontFamily: 'Arial',
        })
        .setOrigin(0.5)
        .setDepth(100)
    } else {
      // Single player: Show one score
      this.player1ScoreText = this.add
        .text(50, 50, `Score: ${this.getMyState().score}/3`, {
          fontSize: '36px',
          color: '#ffffff',
          fontFamily: 'Arial',
        })
        .setOrigin(0, 0.5)
        .setDepth(100)
    }

    // Create color swatch selector in top right (single-player only)
    if (!this.isMultiplayer) {
      this.createColorSwatches()
    }

    // Create tier indicators at the bottom
    this.createTierIndicators()

    // Create bouncing balls - fewer, bigger balls
    this.createBalls(8)

    // Initialize audio on first user interaction (browser policy requires user gesture)
    this.input.once('pointerdown', () => {
      this.initAudio()
    })

    // Add global click handler for background clicks (in multiplayer)
    if (this.isMultiplayer) {
      this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        // Only process if it's your turn and game is not over
        if (!this.gameOver && this.isMyTurn()) {
          // Check if we clicked on a ball by seeing if any ball was clicked
          let clickedBall = false
          this.balls.forEach((ball) => {
            const distance = Phaser.Math.Distance.Between(
              pointer.x,
              pointer.y,
              ball.sprite.x,
              ball.sprite.y
            )
            if (distance <= ball.radius && !ball.isPopped) {
              clickedBall = true
            }
          })

          // If we didn't click a ball, it's a miss - still counts as turn
          if (!clickedBall) {
            this.handleMiss()
          }
        }
      })
    }
  }

  private createBalls(count: number): void {
    for (let i = 0; i < count; i++) {
      const radius = Phaser.Math.Between(40, 90)
      const x = Phaser.Math.Between(radius, GameSettings.canvas.width - radius)
      const y = Phaser.Math.Between(radius, GameSettings.canvas.height - radius)

      // Use my player's selected color
      const myColor = this.getMyState().color
      const color = this.colorValues[myColor]
      const ball = this.add.circle(x, y, radius, color)
      ball.setStrokeStyle(2, 0x000000)
      ball.setInteractive()

      const ballData: Ball = {
        sprite: ball,
        velocityX: Phaser.Math.Between(-300, 300),
        velocityY: Phaser.Math.Between(-300, 300),
        radius: radius,
        isPopped: false,
      }

      // Add click handler to this specific ball
      ball.on('pointerdown', () => {
        if (!this.gameOver && !ballData.isPopped) {
          // In multiplayer, only allow clicks on your turn
          if (this.isMultiplayer && !this.isMyTurn()) {
            // Visual feedback that it's not your turn
            this.cameras.main.shake(100, 0.002)
            return
          }
          this.popBall(ballData)
        }
      })

      this.balls.push(ballData)
    }
  }

  update(_time: number, deltaTime: number): void {
    const dt = deltaTime / 1000

    this.balls.forEach((ball) => {
      if (!ball.isPopped) {
        // Update position
        ball.sprite.x += ball.velocityX * dt
        ball.sprite.y += ball.velocityY * dt

        // Bounce off edges
        if (
          ball.sprite.x - ball.radius <= 0 ||
          ball.sprite.x + ball.radius >= GameSettings.canvas.width
        ) {
          // Calculate velocity magnitude before bounce for sound
          const velocity = Math.abs(ball.velocityX)
          const wasLeft = ball.sprite.x - ball.radius <= 0
          ball.velocityX *= -1
          ball.sprite.x = Phaser.Math.Clamp(
            ball.sprite.x,
            ball.radius,
            GameSettings.canvas.width - ball.radius
          )
          // Wall bounce sound - velocity affects volume/pitch
          this.playBounceSound(ball.radius, velocity, 0.25)
          // Subtle wall flash
          const flashX = wasLeft ? ball.radius : GameSettings.canvas.width - ball.radius
          this.playCollisionFlash(
            flashX,
            ball.sprite.y,
            Math.min(0.6, velocity / 500),
            ball.sprite.fillColor
          )
        }

        if (
          ball.sprite.y - ball.radius <= 0 ||
          ball.sprite.y + ball.radius >= GameSettings.canvas.height
        ) {
          // Calculate velocity magnitude before bounce for sound
          const velocity = Math.abs(ball.velocityY)
          const wasTop = ball.sprite.y - ball.radius <= 0
          ball.velocityY *= -1
          ball.sprite.y = Phaser.Math.Clamp(
            ball.sprite.y,
            ball.radius,
            GameSettings.canvas.height - ball.radius
          )
          // Wall bounce sound - velocity affects volume/pitch
          this.playBounceSound(ball.radius, velocity, 0.25)
          // Subtle wall flash
          const flashY = wasTop ? ball.radius : GameSettings.canvas.height - ball.radius
          this.playCollisionFlash(
            ball.sprite.x,
            flashY,
            Math.min(0.6, velocity / 500),
            ball.sprite.fillColor
          )
        }
      }
    })

    // Check ball-to-ball collisions
    this.checkBallCollisions()
  }

  private checkBallCollisions(): void {
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const ball1 = this.balls[i]
        const ball2 = this.balls[j]

        // Skip popped balls
        if (ball1.isPopped || ball2.isPopped) continue

        const dx = ball2.sprite.x - ball1.sprite.x
        const dy = ball2.sprite.y - ball1.sprite.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        const minDistance = ball1.radius + ball2.radius

        if (distance < minDistance) {
          // Calculate relative velocity for sound before modifying velocities
          const relativeVx = ball1.velocityX - ball2.velocityX
          const relativeVy = ball1.velocityY - ball2.velocityY
          const relativeVelocity = Math.sqrt(relativeVx * relativeVx + relativeVy * relativeVy)

          // Collision detected - separate balls
          const overlap = minDistance - distance
          const separationX = (dx / distance) * (overlap / 2)
          const separationY = (dy / distance) * (overlap / 2)

          ball1.sprite.x -= separationX
          ball1.sprite.y -= separationY
          ball2.sprite.x += separationX
          ball2.sprite.y += separationY

          // Calculate collision response
          const angle = Math.atan2(dy, dx)
          const sin = Math.sin(angle)
          const cos = Math.cos(angle)

          // Rotate velocities to collision normal
          const vx1 = ball1.velocityX * cos + ball1.velocityY * sin
          const vy1 = ball1.velocityY * cos - ball1.velocityX * sin
          const vx2 = ball2.velocityX * cos + ball2.velocityY * sin
          const vy2 = ball2.velocityY * cos - ball2.velocityX * sin

          // Apply conservation of momentum (assuming equal mass)
          const newVx1 = vx2
          const newVx2 = vx1

          // Rotate velocities back
          ball1.velocityX = newVx1 * cos - vy1 * sin
          ball1.velocityY = vy1 * cos + newVx1 * sin
          ball2.velocityX = newVx2 * cos - vy2 * sin
          ball2.velocityY = vy2 * cos + newVx2 * sin

          // Ball-to-ball collision sound - use average radius and relative velocity
          const avgRadius = (ball1.radius + ball2.radius) / 2
          this.playBounceSound(avgRadius, relativeVelocity, 0.4)

          // Collision flash at contact point (midpoint between balls)
          const contactX = (ball1.sprite.x + ball2.sprite.x) / 2
          const contactY = (ball1.sprite.y + ball2.sprite.y) / 2
          const flashIntensity = Math.min(1, relativeVelocity / 400)
          this.playCollisionFlash(contactX, contactY, flashIntensity, ball1.sprite.fillColor)
        }
      }
    }
  }

  private async initializeSDK(): Promise<void> {
    if (!window.FarcadeSDK) {
      // No SDK, create elements immediately
      this.createGameElements()
      return
    }

    // Verify SDK has the expected structure
    const hasValidAPI =
      typeof window.FarcadeSDK.on === 'function' && window.FarcadeSDK.singlePlayer?.actions?.ready

    if (!hasValidAPI) {
      console.warn('FarcadeSDK found but has unexpected structure, starting game without SDK')
      this.createGameElements()
      return
    }

    // Determine multiplayer mode based on build configuration
    // GAME_MULTIPLAYER_MODE is set by vite-plugin based on package.json
    // @ts-ignore - This is defined by Vite's define config
    this.isMultiplayer =
      typeof GAME_MULTIPLAYER_MODE !== 'undefined' ? GAME_MULTIPLAYER_MODE : false
    console.log('[DemoScene] Multiplayer mode:', this.isMultiplayer)

    // Set up SDK event listeners
    window.FarcadeSDK.on('play_again', () => {
      console.log('[DemoScene] play_again event received, isMultiplayer:', this.isMultiplayer)
      // In single-player, handle reset locally
      if (!this.isMultiplayer) {
        console.log('[DemoScene] Single-player mode, calling restartGame()')
        this.restartGame()
      } else {
        console.log('[DemoScene] Multiplayer mode, waiting for game_state_updated(null)')
      }
      // In multiplayer, the SDK mock will send game_state_updated(null)
      // which triggers setupNewGame() via the game_state_updated listener
    })

    window.FarcadeSDK.on('toggle_mute', (data: { isMuted: boolean }) => {
      // Track mute state for audio engine
      this.isMuted = data.isMuted
      // Send toggle_mute event back to parent to update SDK flag
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(
          {
            type: 'remix_sdk_event',
            event: { type: 'toggle_mute', data: { isMuted: data.isMuted } },
          },
          '*'
        )
      }
    })

    // Listen for purchase completion to update tier indicators
    window.FarcadeSDK.on('purchase_complete', (data) => {
      console.log('[DemoScene] purchase_complete event received:', data)
      console.log('[DemoScene] Current purchasedItems:', window.FarcadeSDK.purchasedItems)
      this.updateTierIndicators()
    })

    if (this.isMultiplayer) {
      // Multiplayer setup - Set up listeners BEFORE calling ready
      window.FarcadeSDK.on('game_state_updated', (gameState: any) => {
        console.log('[DemoScene] game_state_updated event received:', gameState)
        // Handle it exactly like chess.js does
        if (!gameState) {
          console.log('[DemoScene] Null state received, calling setupNewGame()')
          this.setupNewGame()
        } else {
          this.handleGameStateUpdate(gameState)
        }
      })

      // State updates come through game_state_updated event only

      // Call multiplayer ready and await the response
      try {
        const gameInfo = await window.FarcadeSDK.multiplayer.actions.ready()

        // gameInfo structure: { players, player, viewContext, initialGameState }
        // Extract player data from gameInfo
        if (gameInfo.players) {
          this.players = gameInfo.players
        }
        if (gameInfo.player?.id) {
          this.meId = gameInfo.player.id
        }

        // Load initial game state if it exists
        if (gameInfo.initialGameState?.gameState) {
          const state = gameInfo.initialGameState.gameState
          // Check if state is from wrong mode (single-player state in multiplayer)
          if (!state.playerStates && state.color) {
            console.log('[DemoScene] Detected single-player state in multiplayer mode, ignoring...')
            // Don't load it, will send fresh multiplayer state below
            this.currentTurnPlayerId = this.players[0]?.id || '1'
          } else {
            this.loadStateFromData(state)
          }
        } else {
          // No existing state - Player 1 starts first turn
          this.currentTurnPlayerId = this.players[0]?.id || '1'
        }

        // Now create game elements after state is loaded
        this.createGameElements()

        // Only Player 0 (first player) sends initial state to avoid infinite loops
        // Other players will receive the state via game_state_updated event
        if (gameInfo.initialGameState === null && this.meId === this.players[0]?.id) {
          // No existing state and I'm Player 0 - send initial state
          setTimeout(() => {
            this.sendGameState()
          }, 100)
        }
      } catch (error) {
        console.error('Failed to initialize multiplayer SDK:', error)
        // Create game elements anyway if there's an error
        this.createGameElements()
      }
    } else {
      // Single player - call ready and await it
      try {
        const gameInfo = await window.FarcadeSDK.singlePlayer.actions.ready()

        // gameInfo structure: { players, player, viewContext, initialGameState }
        // initialGameState is the GameStateEnvelope or null
        if (gameInfo.initialGameState?.gameState) {
          const state = gameInfo.initialGameState.gameState
          // Check if state is from wrong mode (multiplayer state in single-player)
          if (state.playerStates || state.currentTurnPlayerId) {
            console.log('[DemoScene] Detected multiplayer state in single-player mode, clearing...')
            // Don't load it, send fresh single-player state instead
            setTimeout(() => {
              this.saveGameState()
            }, 100)
          } else {
            this.loadStateFromData(state)
          }
        } else {
          // No initial state - send our default state
          setTimeout(() => {
            this.saveGameState()
          }, 100)
        }
      } catch (error) {
        console.error('Failed to initialize single player SDK:', error)
      }

      // Always create game elements, regardless of SDK response
      this.createGameElements()
    }
  }

  private sendGameState(): void {
    if (!this.isMultiplayer || !window.FarcadeSDK) return

    // Wait until we have player info before sending state
    if (!this.players || this.players.length === 0) {
      return
    }

    const otherPlayerId = this.getOtherPlayerId()

    // Complete game state with per-player data and turn information
    // IMPORTANT: Deep clone to avoid reference issues
    const stateData = {
      playerStates: JSON.parse(JSON.stringify(this.playerStates)),
      currentTurnPlayerId: this.currentTurnPlayerId,
      roundNumber: this.roundNumber,
      gameOver: this.gameOver,
    }

    console.log('[DemoScene] Sending state:', stateData)

    // Use saveGameState instead of updateGameState (this is the SDK 0.2 pattern)
    // alertUserIds tells the SDK to notify the other player
    window.FarcadeSDK.multiplayer.actions.saveGameState({
      gameState: stateData,
      alertUserIds: otherPlayerId ? [otherPlayerId] : [],
    })

    // Store the state data signature to detect our own updates
    this.lastSentStateId = JSON.stringify(stateData)
  }

  private setupNewGame(): void {
    console.log('[DemoScene] setupNewGame called')
    this.restartGame()
    // Send initial state
    if (this.isMultiplayer) {
      console.log(
        '[DemoScene] Multiplayer: checking if should send initial state, meId:',
        this.meId,
        'player0:',
        this.players[0]?.id
      )
      // Only Player 1 sends initial state
      if (this.meId === this.players[0]?.id) {
        console.log('[DemoScene] I am Player 1, sending initial state')
        this.sendGameState()
      } else {
        console.log('[DemoScene] I am not Player 1, waiting for state from Player 1')
      }
    }
  }

  private handleGameStateUpdate(envelope: any): void {
    // Handle state updates from other players
    if (!envelope) {
      this.setupNewGame()
      return
    }

    // The envelope structure is: { id, gameState, alertUserIds }
    const { id, gameState } = envelope

    if (!gameState) {
      this.setupNewGame()
      return
    }

    // Ignore our own state updates (prevents infinite loops)
    const incomingStateSignature = JSON.stringify(gameState)
    if (incomingStateSignature === this.lastSentStateId) {
      console.log('[DemoScene] Ignoring own state update')
      return
    }

    console.log('[DemoScene] Processing state update from other player:', gameState)

    // Check for game over BEFORE loading state (otherwise this.gameOver will already be true)
    const wasGameOver = this.gameOver
    const incomingGameOver = gameState.gameOver === true

    // Check if this is a reset state (all scores at 0, gameOver false, round 0)
    const isResetState =
      gameState.gameOver === false &&
      gameState.roundNumber === 0 &&
      Object.values(gameState.playerStates || {}).every((state: any) => state.score === 0)

    if (isResetState) {
      console.log('[DemoScene] Received reset state from play_again')
      // Don't just load state - fully restart to ensure balls and UI are reset
      this.restartGame()
      return
    }

    // Load the state
    this.loadStateFromData(gameState)

    // Update UI to reflect new state
    this.updateUI()

    // Update ball colors based on current player's color
    this.updateBallColors()

    // Trigger game over if incoming state has game over and we didn't already have it
    if (incomingGameOver && !wasGameOver) {
      this.triggerGameOver()
    }
  }

  private handleClick(): void {
    // Increment current player's score
    const myState = this.getMyState()
    myState.score++

    // Check if this click triggers game over
    if (myState.score >= 3) {
      // Set game over state BEFORE sending state update
      this.gameOver = true

      // Update UI (score changed, game over)
      this.updateUI()

      // Send final state with gameOver = true
      if (this.isMultiplayer) {
        this.sendGameState()
      }

      // Small delay to ensure state is sent before triggering SDK game over
      setTimeout(() => {
        this.triggerGameOver()
      }, 50)
    } else {
      // Normal click - switch turns and send updated state
      if (this.isMultiplayer) {
        this.switchTurn()
      }

      // Update UI AFTER switching turns (so turn indicator shows correct player)
      this.updateUI()

      // Send state update to other player
      if (this.isMultiplayer) {
        this.sendGameState()
      }
    }
  }

  private handleMiss(): void {
    // Missing a ball counts as a turn in multiplayer
    if (!this.isMultiplayer) return

    // Visual feedback for miss
    this.cameras.main.flash(100, 255, 100, 100)

    // Switch turns
    this.switchTurn()

    // Update UI
    this.updateUI()

    // Send state update
    this.sendGameState()
  }

  private triggerGameOver(): void {
    if (!window.FarcadeSDK) return

    if (this.isMultiplayer) {
      // Build scores array for multiplayer
      const scores: Array<{ playerId: string; score: number }> = []

      // Get scores for all players
      if (this.players && this.players.length >= 2) {
        this.players.forEach((player) => {
          scores.push({
            playerId: player.id,
            score: this.getPlayerState(player.id).score,
          })
        })
      }

      window.FarcadeSDK.multiplayer.actions.gameOver({ scores })
    } else {
      // Single player
      window.FarcadeSDK.singlePlayer.actions.gameOver({ score: this.getMyState().score })
    }
  }

  private restartGame(): void {
    // Reset all player states
    Object.keys(this.playerStates).forEach((playerId) => {
      // In multiplayer, preserve assigned colors (Player 1 = green, Player 2 = red)
      let assignedColor: 'green' | 'blue' | 'red' = 'green'
      if (this.isMultiplayer && this.players.length >= 2) {
        const playerIndex = this.players.findIndex((p) => p.id === playerId)
        assignedColor = playerIndex === 1 ? 'red' : 'green'
      } else {
        // Single player - keep current color
        assignedColor = this.playerStates[playerId]?.color || 'green'
      }

      this.playerStates[playerId] = {
        color: assignedColor,
        score: 0,
      }
    })

    this.gameOver = false
    this.roundNumber = 0

    // Player 1 starts first
    if (this.isMultiplayer && this.players.length >= 2) {
      this.currentTurnPlayerId = this.players[0].id
    }

    // Update UI
    this.updateUI()

    // Reset all balls to new positions and unpop them
    this.balls.forEach((ball) => {
      ball.isPopped = false
      ball.sprite.setVisible(true)
      ball.sprite.setAlpha(1)
      ball.sprite.setScale(1)
      ball.sprite.x = Phaser.Math.Between(ball.radius, GameSettings.canvas.width - ball.radius)
      ball.sprite.y = Phaser.Math.Between(ball.radius, GameSettings.canvas.height - ball.radius)
      ball.velocityX = Phaser.Math.Between(-300, 300)
      ball.velocityY = Phaser.Math.Between(-300, 300)
    })

    // Update ball colors
    this.updateBallColors()

    // Focus the canvas to enable keyboard input
    this.game.canvas.focus()
  }

  private createTierIndicators(): void {
    // Container for tier indicators at bottom center
    this.tierIndicators = this.add.container(
      GameSettings.canvas.width / 2,
      GameSettings.canvas.height - 80
    )
    this.tierIndicators.setDepth(101)

    // Title label
    const title = this.add
      .text(0, -45, 'TIER REWARDS TEST', {
        fontSize: '18px',
        color: '#aaaaaa',
        fontFamily: 'Arial',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
    this.tierIndicators.add(title)

    this.tierCircles = []
    this.tierLabels = []

    // Tier config with tier slugs for purchases
    const tierConfig = [
      { slug: 'reward-1', tierSlug: 'tier-1', label: 'Reward 1', activeColor: 0x22c55e },
      { slug: 'reward-2', tierSlug: 'tier-2', label: 'Reward 2', activeColor: 0xa855f7 },
      { slug: 'reward-3', tierSlug: 'tier-3', label: 'Reward 3', activeColor: 0xec4899 },
    ]

    const pillWidth = 130
    const pillHeight = 50
    const spacing = 16
    const totalWidth = tierConfig.length * pillWidth + (tierConfig.length - 1) * spacing
    const startX = -totalWidth / 2 + pillWidth / 2

    tierConfig.forEach((tier, index) => {
      const x = startX + index * (pillWidth + spacing)

      // Pill background (using graphics for rounded rect)
      const pill = this.add.graphics()
      pill.setData('index', index)
      pill.setData('tierSlug', tier.tierSlug)
      pill.setData('rewardSlug', tier.slug)
      this.tierIndicators?.add(pill)
      this.tierCircles.push(pill as unknown as Phaser.GameObjects.Arc) // Store for updates

      // Label
      const label = this.add
        .text(x, 0, tier.label, {
          fontSize: '22px',
          color: '#666666',
          fontFamily: 'Arial',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
      this.tierIndicators?.add(label)
      this.tierLabels.push(label)

      // Create invisible hit zone for click detection
      const hitZone = this.add.rectangle(x, 0, pillWidth, pillHeight, 0x000000, 0)
      hitZone.setInteractive({ useHandCursor: true })
      hitZone.setData('tierSlug', tier.tierSlug)
      hitZone.setData('rewardSlug', tier.slug)
      this.tierIndicators?.add(hitZone)

      // Click handler - trigger purchase for locked tiers
      hitZone.on('pointerdown', () => {
        if (!window.FarcadeSDK) return

        const isOwned = window.FarcadeSDK.hasItem(tier.slug)
        if (!isOwned) {
          // Play UI click sound
          this.playUIClickSound()
          // Trigger purchase event - this opens the boost tiers panel in the dashboard
          console.log('[DemoScene] Requesting purchase for tier:', tier.tierSlug)
          // Use SDK purchase() method - triggers boost modal in production, boost panel in dev
          window.FarcadeSDK.purchase({ item: tier.tierSlug })
        }
      })

      // Hover effect for locked tiers
      hitZone.on('pointerover', () => {
        if (!window.FarcadeSDK) return
        const isOwned = window.FarcadeSDK.hasItem(tier.slug)
        if (!isOwned) {
          label.setScale(1.05)
        }
      })

      hitZone.on('pointerout', () => {
        label.setScale(1.0)
      })
    })

    // Initial update
    this.updateTierIndicators()
  }

  private drawPill(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    width: number,
    height: number,
    fillColor: number,
    fillAlpha: number,
    strokeColor: number,
    strokeAlpha: number
  ): void {
    graphics.clear()
    const radius = height / 2

    // Fill
    graphics.fillStyle(fillColor, fillAlpha)
    graphics.fillRoundedRect(x - width / 2, y - height / 2, width, height, radius)

    // Stroke
    graphics.lineStyle(1.5, strokeColor, strokeAlpha)
    graphics.strokeRoundedRect(x - width / 2, y - height / 2, width, height, radius)
  }

  private updateTierIndicators(): void {
    if (!window.FarcadeSDK || !this.tierCircles.length) return

    // Check for actual reward slugs, not tier slugs
    const rewardSlugs = ['reward-1', 'reward-2', 'reward-3']
    const tierConfig = [
      { activeColor: 0x22c55e, activeBorder: 0x4ade80 },
      { activeColor: 0xa855f7, activeBorder: 0xc084fc },
      { activeColor: 0xec4899, activeBorder: 0xf472b6 },
    ]

    const pillWidth = 130
    const pillHeight = 50
    const spacing = 16
    const totalWidth = rewardSlugs.length * pillWidth + (rewardSlugs.length - 1) * spacing
    const startX = -totalWidth / 2 + pillWidth / 2

    rewardSlugs.forEach((slug, index) => {
      const graphics = this.tierCircles[index] as unknown as Phaser.GameObjects.Graphics
      const label = this.tierLabels[index]
      if (!graphics || !label) return

      const x = startX + index * (pillWidth + spacing)
      const isOwned = window.FarcadeSDK.hasItem(slug)

      if (isOwned) {
        this.drawPill(
          graphics,
          x,
          0,
          pillWidth,
          pillHeight,
          tierConfig[index].activeColor,
          1,
          tierConfig[index].activeBorder,
          1
        )
        label.setColor('#ffffff')
      } else {
        this.drawPill(graphics, x, 0, pillWidth, pillHeight, 0x000000, 0.4, 0x444444, 0.6)
        label.setColor('#666666')
      }
    })
  }

  private createColorSwatches(): void {
    // Container for color swatches
    this.colorSwatches = this.add.container(GameSettings.canvas.width - 150, 50)
    this.colorSwatches.setDepth(101)

    const colors: Array<'green' | 'blue' | 'red'> = ['green', 'blue', 'red']
    colors.forEach((colorName, index) => {
      const x = index * 45

      // Create circle swatch
      const swatch = this.add.circle(x, 0, 18, this.colorValues[colorName])
      const myColor = this.getMyState().color
      swatch.setStrokeStyle(3, colorName === myColor ? 0xffffff : 0x666666)
      swatch.setInteractive()
      swatch.setData('color', colorName)

      // Add click handler with stop propagation
      swatch.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.playUIClickSound()
        this.selectColor(colorName)
        pointer.event.stopPropagation()
      })

      // Add hover effect
      swatch.on('pointerover', () => {
        swatch.setScale(1.1)
      })

      swatch.on('pointerout', () => {
        swatch.setScale(1.0)
      })

      this.colorSwatches?.add(swatch)
    })
  }

  private selectColor(color: 'green' | 'blue' | 'red'): void {
    // Update my player's color
    const myState = this.getMyState()
    myState.color = color

    // Update swatch borders to show selection
    if (this.colorSwatches) {
      this.colorSwatches.list.forEach((obj: any) => {
        const swatch = obj as Phaser.GameObjects.Arc
        const swatchColor = swatch.getData('color')
        swatch.setStrokeStyle(3, swatchColor === color ? 0xffffff : 0x666666)
      })
    }

    // Update all existing balls to new color
    this.updateBallColors()

    // Save state after color change
    this.saveGameState()
  }

  private saveGameState(): void {
    // Save state through SDK only - no localStorage
    if (this.isMultiplayer) {
      // Multiplayer: save full per-player state with turn info
      const gameState = {
        playerStates: this.playerStates,
        currentTurnPlayerId: this.currentTurnPlayerId,
        roundNumber: this.roundNumber,
        timestamp: Date.now(),
      }

      if (window.FarcadeSDK?.multiplayer?.actions?.saveGameState) {
        const otherPlayerId = this.getOtherPlayerId()
        window.FarcadeSDK.multiplayer.actions.saveGameState({
          gameState,
          alertUserIds: otherPlayerId ? [otherPlayerId] : [],
        })
      }
    } else {
      // Single-player: save only color preference (score is session-only)
      const myState = this.getMyState()
      const gameState = {
        color: myState.color,
        timestamp: Date.now(),
      }

      if (window.FarcadeSDK?.singlePlayer?.actions?.saveGameState) {
        window.FarcadeSDK.singlePlayer.actions.saveGameState({ gameState })
      }
    }
  }

  private popBall(ball: Ball): void {
    if (ball.isPopped) return

    ball.isPopped = true
    const x = ball.sprite.x
    const y = ball.sprite.y
    const color = ball.sprite.fillColor
    const radius = ball.radius

    // Play pop sound
    this.playPopSound(radius)

    // Create multiple small circles as particle effect
    for (let i = 0; i < 20; i++) {
      const particle = this.add.circle(x, y, Phaser.Math.Between(2, 6), color)
      particle.setDepth(99)

      // Random velocity with gravity effect
      const angle = (Phaser.Math.Between(0, 360) * Math.PI) / 180
      const speed = Phaser.Math.Between(100, 400)
      const vx = Math.cos(angle) * speed
      const vy = Math.sin(angle) * speed - 200 // Initial upward bias

      // Animate particle with physics-like motion
      let currentVY = vy
      const gravity = 800

      this.tweens.add({
        targets: particle,
        x: x + vx * 0.8,
        y: {
          value: () => {
            return particle.y
          },
          duration: 800,
        },
        alpha: { from: 1, to: 0 },
        scale: { from: 1, to: 0.2 },
        duration: 800,
        onUpdate: (tween) => {
          const delta = 1 / 60 // Assume 60 FPS
          currentVY += gravity * delta
          particle.y += currentVY * delta
        },
        onComplete: () => {
          particle.destroy()
        },
      })
    }

    // Fade out and destroy ball
    this.tweens.add({
      targets: ball.sprite,
      alpha: 0,
      scale: 1.5,
      duration: 200,
      ease: 'Power2',
      onComplete: () => {
        ball.sprite.setVisible(false)
      },
    })

    // Handle click count
    this.handleClick()
  }

  // --- Scene Shutdown Logic ---
  shutdown() {}
}
