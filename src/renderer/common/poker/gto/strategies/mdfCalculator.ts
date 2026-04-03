import type { GameState } from '../types';

export class MDFCalculator {
  public calculateMDF(potOdds: number): number {
    const mdf = 1 - potOdds;
    return Math.max(0, Math.min(mdf, 1));
  }

  public calculateMDFFromBetSize(betSize: number, pot: number): number {
    const potOdds = betSize / (pot + betSize);
    return this.calculateMDF(potOdds);
  }

  public shouldDefend(
    handEquity: number,
    mdf: number,
    gameState: GameState
  ): boolean {
    const adjustedMDF = this.adjustMDFForContext(mdf, gameState);
    
    return handEquity >= adjustedMDF;
  }

  private adjustMDFForContext(baseMDF: number, gameState: GameState): number {
    let adjustedMDF = baseMDF;
    
    if (gameState.position === 'BB' || gameState.position === 'SB') {
      adjustedMDF *= 0.95;
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      adjustedMDF *= 1.05;
    }
    
    if (gameState.opponents > 2) {
      adjustedMDF *= 1.1;
    }
    
    const spr = gameState.effectiveStack / gameState.pot;
    if (spr < 3) {
      adjustedMDF *= 0.9;
    }
    
    return Math.min(adjustedMDF, 0.85);
  }

  public calculateDefenseRange(
    mdf: number,
    gameState: GameState
  ): {
    callRange: number;
    raiseRange: number;
    foldRange: number;
  } {
    const adjustedMDF = this.adjustMDFForContext(mdf, gameState);
    
    const raiseRange = adjustedMDF * 0.25;
    const callRange = adjustedMDF - raiseRange;
    const foldRange = 1 - adjustedMDF;
    
    return {
      callRange,
      raiseRange,
      foldRange
    };
  }

  public calculateBreakEvenEquity(betSize: number, pot: number): number {
    const totalPot = pot + betSize;
    return betSize / totalPot;
  }

  public isDefendingEnough(
    actualDefenseFreq: number,
    mdf: number,
    tolerance: number = 0.05
  ): boolean {
    return actualDefenseFreq >= mdf - tolerance;
  }

  public calculateOptimalFoldFrequency(betSize: number, pot: number): number {
    const mdf = this.calculateMDFFromBetSize(betSize, pot);
    return 1 - mdf;
  }

  public getMDFByBetSizePercent(betSizePercent: number): number {
    const potOdds = betSizePercent / (1 + betSizePercent);
    return this.calculateMDF(potOdds);
  }

  public getMDFTable(): Record<string, number> {
    return {
      '25%': this.getMDFByBetSizePercent(0.25),
      '33%': this.getMDFByBetSizePercent(0.33),
      '50%': this.getMDFByBetSizePercent(0.50),
      '66%': this.getMDFByBetSizePercent(0.66),
      '75%': this.getMDFByBetSizePercent(0.75),
      '100%': this.getMDFByBetSizePercent(1.0),
      '150%': this.getMDFByBetSizePercent(1.5),
      '200%': this.getMDFByBetSizePercent(2.0)
    };
  }

  public calculateMultiStreetMDF(
    currentMDF: number,
    futureStreets: number
  ): number {
    const adjustmentFactor = 1 + (futureStreets * 0.05);
    return Math.min(currentMDF * adjustmentFactor, 0.9);
  }
}
