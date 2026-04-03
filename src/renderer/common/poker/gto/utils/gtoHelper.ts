import type { GameState, ActionFrequency } from '../types';
import { PokerAction } from '../types';

export class GTOHelper {
  public static calculatePotOdds(callAmount: number, pot: number): number {
    return callAmount / (pot + callAmount);
  }

  public static calculateImpliedOdds(
    callAmount: number,
    pot: number,
    impliedAmount: number
  ): number {
    return callAmount / (pot + callAmount + impliedAmount);
  }

  public static calculateSPR(stack: number, pot: number): number {
    return stack / pot;
  }

  public static calculateAlpha(betSize: number, pot: number): number {
    return betSize / (pot + betSize);
  }

  public static calculateBreakEvenEquity(betSize: number, pot: number): number {
    return this.calculateAlpha(betSize, pot);
  }

  public static calculateEV(
    winProbability: number,
    potSize: number,
    investmentCost: number
  ): number {
    const winEV = winProbability * potSize;
    const loseEV = (1 - winProbability) * investmentCost;
    return winEV - loseEV;
  }

  public static formatFrequency(frequency: number): string {
    return `${(frequency * 100).toFixed(1)}%`;
  }

  public static formatBetSize(betSize: number, pot: number): string {
    const percentage = (betSize / pot) * 100;
    return `${betSize} (${percentage.toFixed(0)}% pot)`;
  }

  public static getBetSizeCategory(betSize: number, pot: number): string {
    const ratio = betSize / pot;
    
    if (ratio < 0.35) return 'Block Bet';
    if (ratio < 0.55) return 'Small Bet';
    if (ratio < 0.8) return 'Medium Bet';
    if (ratio < 1.2) return 'Pot Bet';
    if (ratio < 1.8) return 'Overbet';
    return 'Large Overbet';
  }

  public static describeStrategy(mixedStrategy: ActionFrequency[]): string {
    const descriptions: string[] = [];
    
    for (const action of mixedStrategy) {
      if (action.frequency < 0.05) continue;
      
      let desc = `${action.action}: ${this.formatFrequency(action.frequency)}`;
      if (action.betSize) {
        desc += ` (${action.betSize})`;
      }
      descriptions.push(desc);
    }
    
    return descriptions.join(', ');
  }

  public static isBalanced(
    valueFrequency: number,
    bluffFrequency: number,
    targetRatio: number,
    tolerance: number = 0.15
  ): boolean {
    if (valueFrequency === 0) return false;
    const actualRatio = bluffFrequency / valueFrequency;
    return Math.abs(actualRatio - targetRatio) <= tolerance;
  }

  public static calculateRangeAdvantage(
    heroEquity: number,
    villainEquity: number
  ): number {
    return heroEquity - villainEquity;
  }

  public static shouldPolarize(gameState: GameState): boolean {
    const spr = this.calculateSPR(gameState.effectiveStack, gameState.pot);
    
    if (spr < 3) return false;
    
    if (gameState.round === 'RIVER') return true;
    
    if (gameState.boardTexture.pairedBoard && gameState.handStrength === 'NUTS') {
      return true;
    }
    
    return false;
  }

  public static shouldMerge(gameState: GameState): boolean {
    const spr = this.calculateSPR(gameState.effectiveStack, gameState.pot);
    
    if (spr < 3) return true;
    
    if (gameState.round === 'FLOP' || gameState.round === 'TURN') {
      return true;
    }
    
    if (gameState.boardTexture.wetness > 0.7) {
      return true;
    }
    
    return false;
  }

  public static getPositionAdvantage(position: string): number {
    const advantages: Record<string, number> = {
      BTN: 1.0,
      CO: 0.8,
      MP: 0.5,
      UTG: 0.3,
      SB: -0.3,
      BB: -0.5
    };
    return advantages[position] || 0;
  }

  public static estimateBoardWetness(boardTexture: any): string {
    if (boardTexture.wetness > 0.7) return 'Very Wet';
    if (boardTexture.wetness > 0.5) return 'Wet';
    if (boardTexture.wetness > 0.3) return 'Medium';
    return 'Dry';
  }

  public static quickMDFLookup(betSizePercent: number): number {
    const lookupTable: Record<number, number> = {
      25: 0.80,
      33: 0.75,
      50: 0.67,
      66: 0.60,
      75: 0.57,
      100: 0.50,
      150: 0.40,
      200: 0.33
    };

    const closest = Object.keys(lookupTable)
      .map(Number)
      .reduce((prev, curr) => 
        Math.abs(curr - betSizePercent) < Math.abs(prev - betSizePercent) ? curr : prev
      );

    return lookupTable[closest];
  }

  public static formatRecommendation(
    action: PokerAction,
    betSize: number | undefined,
    pot: number
  ): string {
    if (action === PokerAction.BET || action === PokerAction.RAISE) {
      return `${action} ${this.formatBetSize(betSize!, pot)}`;
    }
    return action;
  }

  public static calculateCombos(percentage: number, totalCombos: number = 1326): number {
    return Math.round(percentage * totalCombos);
  }

  public static getStreetName(round: string): string {
    const names: Record<string, string> = {
      PREFLOP: 'Pre-flop',
      FLOP: 'Flop',
      TURN: 'Turn',
      RIVER: 'River'
    };
    return names[round] || round;
  }
}

export const GTOConstants = {
  STANDARD_BLUFF_RATIOS: {
    SMALL_BET: 0.25,
    MEDIUM_BET: 0.4,
    POT_BET: 0.5,
    OVERBET: 0.67
  },
  
  MDF_TABLE: {
    25: 0.80,
    33: 0.75,
    50: 0.67,
    66: 0.60,
    75: 0.57,
    100: 0.50,
    150: 0.40,
    200: 0.33
  },
  
  POSITION_MULTIPLIERS: {
    BTN: 1.2,
    CO: 1.1,
    MP: 1.0,
    UTG: 0.9,
    SB: 0.95,
    BB: 1.0
  },
  
  CHECK_RAISE_FREQUENCIES: {
    NUTS: 0.35,
    STRONG: 0.25,
    MEDIUM: 0.12,
    WEAK: 0.05,
    BLUFF: 0.08
  },
  
  BET_SIZING: {
    BLOCK: 0.25,
    SMALL: 0.33,
    MEDIUM: 0.5,
    LARGE: 0.75,
    POT: 1.0,
    OVERBET: 1.5,
    LARGE_OVERBET: 2.0
  }
};
