import type { GameState } from '../types';

export class BetSizingOptimizer {
  public calculateOptimalBetSize(gameState: GameState, spr: number): number {
    const baseBetSize = this.getBaseBetSize(gameState);
    
    const adjustedSize = this.adjustForContext(baseBetSize, gameState, spr);
    
    return Math.min(adjustedSize, gameState.effectiveStack);
  }

  public calculateOptimalRaiseSize(gameState: GameState): number {
    const opponentBet = gameState.currentBet;
    const pot = gameState.pot;
    
    let raiseMultiplier = 2.5;
    
    if (gameState.handStrength === 'NUTS') {
      raiseMultiplier = 3.0;
    } else if (gameState.handStrength === 'BLUFF') {
      raiseMultiplier = 2.2;
    }
    
    const raiseSize = opponentBet * raiseMultiplier;
    
    return Math.min(raiseSize, gameState.effectiveStack);
  }

  private getBaseBetSize(gameState: GameState): number {
    const pot = gameState.pot;
    
    switch (gameState.handStrength) {
      case 'NUTS':
        return this.calculateOverbetSize(pot, gameState);
      case 'STRONG':
        return pot * 0.75;
      case 'MEDIUM':
        return pot * 0.5;
      case 'WEAK':
        return this.calculateBlockBetSize(pot, gameState);
      case 'BLUFF':
        return pot * 0.66;
      default:
        return pot * 0.66;
    }
  }

  public calculateOverbetSize(pot: number, gameState: GameState): number {
    let overbetMultiplier = 1.5;
    
    if (gameState.boardTexture.pairedBoard) {
      overbetMultiplier = 2.0;
    }
    
    if (gameState.boardTexture.wetness < 0.3) {
      overbetMultiplier = 1.75;
    }
    
    const spr = gameState.effectiveStack / pot;
    if (spr < 3) {
      overbetMultiplier = Math.min(spr, overbetMultiplier);
    }
    
    if (gameState.opponents > 1) {
      overbetMultiplier *= 0.8;
    }
    
    return pot * overbetMultiplier;
  }

  public calculateBlockBetSize(pot: number, gameState: GameState): number {
    let blockBetMultiplier = 0.25;
    
    if (gameState.position === 'BB' || gameState.position === 'SB') {
      blockBetMultiplier = 0.33;
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      blockBetMultiplier = 0.4;
    }
    
    if (gameState.handStrength === 'MEDIUM') {
      blockBetMultiplier = 0.33;
    }
    
    return pot * blockBetMultiplier;
  }

  private adjustForContext(
    baseBetSize: number,
    gameState: GameState,
    spr: number
  ): number {
    let adjustedSize = baseBetSize;
    
    if (spr < 2) {
      adjustedSize = Math.min(adjustedSize, gameState.effectiveStack);
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      adjustedSize *= 1.1;
    }
    
    if (gameState.opponents > 2) {
      adjustedSize *= 0.85;
    }
    
    if (gameState.position === 'BTN' || gameState.position === 'CO') {
      adjustedSize *= 1.05;
    }
    
    return adjustedSize;
  }

  public shouldOverbet(gameState: GameState): boolean {
    if (gameState.handStrength !== 'NUTS' && gameState.handStrength !== 'STRONG') {
      return false;
    }
    
    const spr = gameState.effectiveStack / gameState.pot;
    if (spr < 2) {
      return false;
    }
    
    if (gameState.boardTexture.pairedBoard) {
      return true;
    }
    
    if (gameState.boardTexture.wetness < 0.3 && gameState.round === 'RIVER') {
      return true;
    }
    
    if (gameState.opponents === 1 && gameState.position === 'BTN') {
      return true;
    }
    
    return false;
  }

  public shouldBlockBet(gameState: GameState): boolean {
    if (gameState.handStrength === 'NUTS' || gameState.handStrength === 'BLUFF') {
      return false;
    }
    
    if (gameState.round !== 'RIVER') {
      return false;
    }
    
    if (gameState.handStrength === 'MEDIUM' || gameState.handStrength === 'WEAK') {
      return true;
    }
    
    const spr = gameState.effectiveStack / gameState.pot;
    if (spr > 5 && gameState.handEquity > 0.5 && gameState.handEquity < 0.7) {
      return true;
    }
    
    return false;
  }

  public getBetSizingRange(gameState: GameState): {
    small: number;
    medium: number;
    large: number;
    overbet: number;
  } {
    const pot = gameState.pot;
    
    return {
      small: this.calculateBlockBetSize(pot, gameState),
      medium: pot * 0.5,
      large: pot * 0.75,
      overbet: this.calculateOverbetSize(pot, gameState)
    };
  }

  public selectBetSize(
    gameState: GameState,
    handCategory: 'polarized' | 'merged' | 'bluff'
  ): number {
    const sizes = this.getBetSizingRange(gameState);
    
    switch (handCategory) {
      case 'polarized':
        if (this.shouldOverbet(gameState)) {
          return sizes.overbet;
        }
        return sizes.large;
      
      case 'merged':
        return sizes.medium;
      
      case 'bluff':
        if (gameState.boardTexture.wetness > 0.7) {
          return sizes.large;
        }
        return sizes.medium;
      
      default:
        return sizes.medium;
    }
  }

  public calculateGeometricBetSize(
    pot: number,
    stack: number,
    streetsRemaining: number
  ): number {
    if (streetsRemaining === 0) {
      return stack;
    }
    
    const geometricSize = stack / Math.pow(2, streetsRemaining);
    
    return Math.min(geometricSize, pot * 1.5);
  }
}
