import type {
  GameState,
  ActionFrequency,
  GTORecommendation,
  StrategyRange,
  OpponentTendency
} from './types';
import { PokerAction } from './types';
import { BluffOptimizer } from './strategies/bluffOptimizer';
import { CheckRaiseCalculator } from './strategies/checkRaiseCalculator';
import { MDFCalculator } from './strategies/mdfCalculator';
import { BetSizingOptimizer } from './strategies/betSizingOptimizer';
import { FrequencyMixer } from './strategies/frequencyMixer';
import { ExploitationEngine } from './exploitation/exploitationEngine';

export class GTOEngine {
  private bluffOptimizer: BluffOptimizer;
  private checkRaiseCalculator: CheckRaiseCalculator;
  private mdfCalculator: MDFCalculator;
  private betSizingOptimizer: BetSizingOptimizer;
  private frequencyMixer: FrequencyMixer;
  private exploitationEngine: ExploitationEngine;

  constructor() {
    this.bluffOptimizer = new BluffOptimizer();
    this.checkRaiseCalculator = new CheckRaiseCalculator();
    this.mdfCalculator = new MDFCalculator();
    this.betSizingOptimizer = new BetSizingOptimizer();
    this.frequencyMixer = new FrequencyMixer();
    this.exploitationEngine = new ExploitationEngine();
  }

  public getRecommendation(
    gameState: GameState,
    opponentTendency?: OpponentTendency
  ): GTORecommendation {
    const baseStrategy = this.calculateBaseGTOStrategy(gameState);
    
    if (opponentTendency) {
      const exploitationAdjustment = this.exploitationEngine.calculateAdjustment(
        gameState,
        baseStrategy,
        opponentTendency
      );
      
      return {
        ...baseStrategy,
        exploitationAdjustment
      };
    }
    
    return baseStrategy;
  }

  private calculateBaseGTOStrategy(gameState: GameState): GTORecommendation {
    const potOdds = this.calculatePotOdds(gameState);
    const spr = gameState.effectiveStack / gameState.pot;
    
    if (gameState.currentBet > 0) {
      return this.calculateDefenseStrategy(gameState, potOdds);
    } else {
      return this.calculateBettingStrategy(gameState, spr);
    }
  }

  private calculateDefenseStrategy(
    gameState: GameState,
    potOdds: number
  ): GTORecommendation {
    const mdf = this.mdfCalculator.calculateMDF(potOdds);
    const checkRaiseFreq = this.checkRaiseCalculator.calculateCheckRaiseFrequency(
      gameState,
      mdf
    );
    
    const mixedStrategy: ActionFrequency[] = [];
    
    if (gameState.handEquity >= mdf) {
      if (checkRaiseFreq > 0 && Math.random() < checkRaiseFreq) {
        const raiseSize = this.betSizingOptimizer.calculateOptimalRaiseSize(gameState);
        mixedStrategy.push({
          action: PokerAction.RAISE,
          frequency: checkRaiseFreq,
          betSize: raiseSize
        });
      }
      
      mixedStrategy.push({
        action: PokerAction.CALL,
        frequency: mdf - checkRaiseFreq
      });
    }
    
    mixedStrategy.push({
      action: PokerAction.FOLD,
      frequency: 1 - mdf
    });
    
    const primaryAction = this.frequencyMixer.selectAction(mixedStrategy, gameState);
    
    return {
      primaryAction,
      mixedStrategy,
      reasoning: `MDF: ${(mdf * 100).toFixed(1)}%, Check-raise: ${(checkRaiseFreq * 100).toFixed(1)}%`
    };
  }

  private calculateBettingStrategy(
    gameState: GameState,
    spr: number
  ): GTORecommendation {
    const optimalBetSize = this.betSizingOptimizer.calculateOptimalBetSize(
      gameState,
      spr
    );
    
    const strategyRange = this.buildStrategyRange(gameState);
    const bluffRatio = this.bluffOptimizer.calculateOptimalBluffRatio(
      optimalBetSize,
      gameState
    );
    
    const bettingFrequency = this.calculateBettingFrequency(
      gameState,
      strategyRange,
      bluffRatio
    );
    
    const mixedStrategy: ActionFrequency[] = [];
    
    if (bettingFrequency > 0) {
      mixedStrategy.push({
        action: PokerAction.BET,
        frequency: bettingFrequency,
        betSize: optimalBetSize
      });
    }
    
    mixedStrategy.push({
      action: PokerAction.CHECK,
      frequency: 1 - bettingFrequency
    });
    
    const primaryAction = this.frequencyMixer.selectAction(mixedStrategy, gameState);
    
    return {
      primaryAction,
      mixedStrategy,
      reasoning: `Bet frequency: ${(bettingFrequency * 100).toFixed(1)}%, Bluff ratio: ${bluffRatio.toFixed(2)}:1`
    };
  }

  private buildStrategyRange(gameState: GameState): StrategyRange {
    const totalCombos = 100;
    let valueHands = 0;
    let bluffHands = 0;
    let semiBluffHands = 0;
    
    switch (gameState.handStrength) {
      case 'NUTS':
        valueHands = 15;
        semiBluffHands = 5;
        bluffHands = 0;
        break;
      case 'STRONG':
        valueHands = 25;
        semiBluffHands = 10;
        bluffHands = 5;
        break;
      case 'MEDIUM':
        valueHands = 10;
        semiBluffHands = 15;
        bluffHands = 10;
        break;
      case 'WEAK':
        valueHands = 5;
        semiBluffHands = 10;
        bluffHands = 15;
        break;
      case 'BLUFF':
        valueHands = 0;
        semiBluffHands = 5;
        bluffHands = 20;
        break;
    }
    
    return {
      valueHands,
      bluffHands,
      semiBluffHands,
      totalCombos
    };
  }

  private calculateBettingFrequency(
    gameState: GameState,
    strategyRange: StrategyRange,
    bluffRatio: number
  ): number {
    const valueFrequency = strategyRange.valueHands / strategyRange.totalCombos;
    const bluffFrequency = valueFrequency * bluffRatio;
    
    const totalBettingFrequency = Math.min(
      valueFrequency + bluffFrequency,
      0.85
    );
    
    const positionMultiplier = this.getPositionMultiplier(gameState.position);
    const boardTextureMultiplier = this.getBoardTextureMultiplier(gameState.boardTexture);
    
    return totalBettingFrequency * positionMultiplier * boardTextureMultiplier;
  }

  private getPositionMultiplier(position: string): number {
    const multipliers: Record<string, number> = {
      BTN: 1.2,
      CO: 1.1,
      MP: 1.0,
      UTG: 0.9,
      SB: 0.95,
      BB: 1.0
    };
    return multipliers[position] || 1.0;
  }

  private getBoardTextureMultiplier(boardTexture: any): number {
    let multiplier = 1.0;
    
    if (boardTexture.wetness > 0.7) {
      multiplier *= 1.15;
    } else if (boardTexture.wetness < 0.3) {
      multiplier *= 0.9;
    }
    
    if (boardTexture.pairedBoard) {
      multiplier *= 0.95;
    }
    
    return multiplier;
  }

  private calculatePotOdds(gameState: GameState): number {
    const callAmount = gameState.currentBet;
    const totalPot = gameState.pot + callAmount;
    return callAmount / totalPot;
  }
}
