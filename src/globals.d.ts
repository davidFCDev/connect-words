/**
 * Global type declarations for externally loaded libraries
 */

// Phaser is loaded globally via CDN
declare const Phaser: typeof import('phaser')

// Import the actual SDK types from the package
import type { FarcadeSDK as FarcadeSDKType } from '@farcade/game-sdk'

// Farcade SDK is loaded globally via CDN
declare const FarcadeSDK: FarcadeSDKType

// Extend window for global SDK access
declare global {
  interface Window {
    FarcadeSDK?: FarcadeSDKType
  }
}

export {}
