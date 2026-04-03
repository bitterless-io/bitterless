import type { GameState } from '../types';

export class CheckRaiseCalculator {
  public calculateCheckRaiseFrequency(gameState: GameState, mdf: number): number {
    const baseFrequency = this.calculateBaseCheckRaiseFrequency(gameState);
    
    const adjustedFrequency = this.adjustForPosition(baseFrequency, gameState);
    
    const finalFrequency = this.adjustForBoardTexture(adjustedFrequency, gameState);
    
    const cappedFrequency = Math.min(finalFrequency, mdf * 0.4);
    
    return Math.max(0, cappedFrequency);
  }

  private calculateBaseCheckRaiseFrequency(gameState: GameState): number {
    const spr = gameState.effectiveStack / gameState.pot;
    
    let baseFrequency = 0;
    
    switch (gameState.handStrength) {
      case 'NUTS':
        baseFrequency = 0.35;
        break;
      case 'STRONG':
        baseFrequency = 0.25;
        break;
      case 'MEDIUM':
        baseFrequency = 0.12;
        break;
      case 'WEAK':
        baseFrequency = 0.05;
        break;
      case 'BLUFF':
        baseFrequency = 0.08;
        break;
    }
    
    if (spr < 3) {
      baseFrequency *= 0.7;
    } else if (spr > 8) {
      baseFrequency *= 1.2;
    }
    
    return baseFrequency;
  }

  private adjustForPosition(frequency: number, gameState: GameState): number {
    const positionMultipliers: Record<string, number> = {
      BB: 1.3,
      SB: 1.1,
      BTN: 0.7,
      CO: 0.8,
      MP: 0.9,
      UTG: 0.85
    };
    
    const multiplier = positionMultipliers[gameState.position] || 1.0;
    return frequency * multiplier;
  }

  private adjustForBoardTexture(frequency: number, gameState: GameState): number {
    let multiplier = 1.0;
    
    if (gameState.boardTexture.wetness > 0.7) {
      multiplier *= 1.25;
    } else if (gameState.boardTexture.wetness < 0.3) {
      multiplier *= 0.85;
    }
    
    if (gameState.boardTexture.pairedBoard) {
      multiplier *= 1.15;
    }
    
    if (gameState.boardTexture.flushPossible && gameState.boardTexture.straightPossible) {
      multiplier *= 1.3;
    }
    
    if (gameState.opponents > 2) {
      multiplier *= 0.6;
    }
    
    return frequency * multiplier;
  }

  public calculateCheckRaiseSize(gameState: GameState): number {
    const pot = gameState.pot;
    const opponentBet = gameState.currentBet;
    
    let raiseMultiplier = 2.5;
    
    if (gameState.handStrength === 'NUTS') {
      raiseMultiplier = 3.0;
    } else if (gameState.handStrength === 'BLUFF') {
      raiseMultiplier = 2.2;
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      raiseMultiplier += 0.5;
    }
    
    const raiseSize = opponentBet * raiseMultiplier;
    const maxRaise = gameState.effectiveStack;
    
    return Math.min(raiseSize, maxRaise);
  }

  public shouldCheckRaise(
    gameState: GameState,
    checkRaiseFrequency: number
  ): boolean {
    const random = Math.random();
    
    if (random > checkRaiseFrequency) {
      return false;
    }
    
    if (gameState.effectiveStack < gameState.pot * 2) {
      return gameState.handStrength === 'NUTS' || gameState.handStrength === 'STRONG';
    }
    
    const equityThreshold = this.getEquityThreshold(gameState);
    return gameState.handEquity >= equityThreshold;
  }

  private getEquityThreshold(gameState: GameState): number {
    const baseThreshold = 0.55;
    
    if (gameState.boardTexture.wetness > 0.7) {
      return baseThreshold - 0.05;
    }
    
    if (gameState.opponents > 2) {
      return baseThreshold + 0.1;
    }
    
    return baseThreshold;
  }

  public calculateCheckRaiseRange(gameState: GameState): {
    valueRange: number;
    bluffRange: number;
    semiBluffRange: number;
  } {
    const totalCheckRaiseFreq = this.calculateCheckRaiseFrequency(gameState, 0.67);
    
    const valueRange = totalCheckRaiseFreq * 0.6;
    const semiBluffRange = totalCheckRaiseFreq * 0.25;
    const bluffRange = totalCheckRaiseFreq * 0.15;
    
    return {
      valueRange,
      bluffRange,
      semiBluffRange
    };
  }
}
