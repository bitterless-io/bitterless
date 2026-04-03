import type { GameState } from '../types';

export class BluffOptimizer {
  public calculateOptimalBluffRatio(betSize: number, gameState: GameState): number {
    const potOdds = betSize / (gameState.pot + betSize);
    const alpha = potOdds;
    const optimalBluffRatio = alpha / (1 - alpha);
    
    const adjustedRatio = this.adjustForGameContext(
      optimalBluffRatio,
      gameState
    );
    
    return adjustedRatio;
  }

  public calculateBluffFrequency(
    valueFrequency: number,
    betSize: number,
    pot: number
  ): number {
    const bluffRatio = this.calculateOptimalBluffRatio(betSize, { pot } as GameState);
    return valueFrequency * bluffRatio;
  }

  public shouldBluff(
    handStrength: string,
    bluffFrequency: number,
    gameState: GameState
  ): boolean {
    if (handStrength === 'NUTS' || handStrength === 'STRONG') {
      return false;
    }
    
    const bluffScore = this.calculateBluffScore(gameState);
    const threshold = 1 - bluffFrequency;
    
    return bluffScore > threshold;
  }

  private calculateBluffScore(gameState: GameState): number {
    let score = 0;
    
    if (gameState.handEquity > 0.3) {
      score += 0.3;
    }
    
    if (gameState.boardTexture.wetness > 0.6) {
      score += 0.2;
    }
    
    if (gameState.boardTexture.flushPossible || gameState.boardTexture.straightPossible) {
      score += 0.15;
    }
    
    const positionBonus = this.getPositionBluffBonus(gameState.position);
    score += positionBonus;
    
    if (gameState.opponents === 1) {
      score += 0.15;
    } else if (gameState.opponents > 2) {
      score -= 0.2;
    }
    
    return Math.min(score, 1.0);
  }

  private adjustForGameContext(baseRatio: number, gameState: GameState): number {
    let adjustedRatio = baseRatio;
    
    if (gameState.boardTexture.pairedBoard) {
      adjustedRatio *= 0.85;
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      adjustedRatio *= 1.15;
    }
    
    if (gameState.opponents > 2) {
      adjustedRatio *= 0.7;
    }
    
    const spr = gameState.effectiveStack / gameState.pot;
    if (spr < 3) {
      adjustedRatio *= 0.8;
    } else if (spr > 10) {
      adjustedRatio *= 1.1;
    }
    
    return Math.max(0.1, Math.min(adjustedRatio, 2.0));
  }

  private getPositionBluffBonus(position: string): number {
    const bonuses: Record<string, number> = {
      BTN: 0.2,
      CO: 0.15,
      MP: 0.1,
      UTG: 0.05,
      SB: 0.08,
      BB: 0.12
    };
    return bonuses[position] || 0.1;
  }

  public calculatePolarizedRange(
    totalRange: number,
    betSize: number,
    pot: number
  ): { value: number; bluff: number } {
    const bluffRatio = this.calculateOptimalBluffRatio(betSize, { pot } as GameState);
    
    const valuePercent = totalRange / (1 + bluffRatio);
    const bluffPercent = valuePercent * bluffRatio;
    
    return {
      value: valuePercent,
      bluff: bluffPercent
    };
  }
}
