import type { ActionFrequency, GameState } from '../types';
import { PokerAction } from '../types';

export class FrequencyMixer {
  public selectAction(
    mixedStrategy: ActionFrequency[],
    gameState: GameState
  ): ActionFrequency {
    const normalizedStrategy = this.normalizeFrequencies(mixedStrategy);
    
    const random = Math.random();
    let cumulativeFrequency = 0;
    
    for (const action of normalizedStrategy) {
      cumulativeFrequency += action.frequency;
      if (random <= cumulativeFrequency) {
        return action;
      }
    }
    
    return normalizedStrategy[normalizedStrategy.length - 1];
  }

  private normalizeFrequencies(strategy: ActionFrequency[]): ActionFrequency[] {
    const total = strategy.reduce((sum, action) => sum + action.frequency, 0);
    
    if (Math.abs(total - 1.0) < 0.001) {
      return strategy;
    }
    
    return strategy.map(action => ({
      ...action,
      frequency: action.frequency / total
    }));
  }

  public mixStrategies(
    strategy1: ActionFrequency[],
    strategy2: ActionFrequency[],
    weight1: number
  ): ActionFrequency[] {
    const weight2 = 1 - weight1;
    const actionMap = new Map<PokerAction, ActionFrequency>();
    
    for (const action of strategy1) {
      actionMap.set(action.action, {
        action: action.action,
        frequency: action.frequency * weight1,
        betSize: action.betSize
      });
    }
    
    for (const action of strategy2) {
      const existing = actionMap.get(action.action);
      if (existing) {
        existing.frequency += action.frequency * weight2;
      } else {
        actionMap.set(action.action, {
          action: action.action,
          frequency: action.frequency * weight2,
          betSize: action.betSize
        });
      }
    }
    
    return Array.from(actionMap.values());
  }

  public createMixedFrequencyStrategy(
    actions: Array<{ action: PokerAction; frequency: number; betSize?: number }>
  ): ActionFrequency[] {
    return this.normalizeFrequencies(actions);
  }

  public shouldMixAction(
    primaryFrequency: number,
    threshold: number = 0.8
  ): boolean {
    return primaryFrequency < threshold;
  }

  public calculateActionDistribution(
    strategy: ActionFrequency[]
  ): Record<string, number> {
    const distribution: Record<string, number> = {};
    
    for (const action of strategy) {
      distribution[action.action] = action.frequency;
    }
    
    return distribution;
  }

  public getHighestFrequencyAction(strategy: ActionFrequency[]): ActionFrequency {
    return strategy.reduce((max, action) => 
      action.frequency > max.frequency ? action : max
    );
  }

  public filterLowFrequencyActions(
    strategy: ActionFrequency[],
    threshold: number = 0.05
  ): ActionFrequency[] {
    return strategy.filter(action => action.frequency >= threshold);
  }

  public createPolarizedStrategy(
    valueFrequency: number,
    bluffFrequency: number,
    betSize: number
  ): ActionFrequency[] {
    const bettingFrequency = valueFrequency + bluffFrequency;
    
    return this.normalizeFrequencies([
      {
        action: PokerAction.BET,
        frequency: bettingFrequency,
        betSize
      },
      {
        action: PokerAction.CHECK,
        frequency: 1 - bettingFrequency
      }
    ]);
  }

  public createMergedStrategy(
    bettingFrequency: number,
    betSize: number
  ): ActionFrequency[] {
    return this.normalizeFrequencies([
      {
        action: PokerAction.BET,
        frequency: bettingFrequency,
        betSize
      },
      {
        action: PokerAction.CHECK,
        frequency: 1 - bettingFrequency
      }
    ]);
  }

  public balanceRange(
    valueHands: number,
    bluffHands: number,
    targetRatio: number
  ): { adjustedValue: number; adjustedBluff: number } {
    const currentRatio = bluffHands / valueHands;
    
    if (Math.abs(currentRatio - targetRatio) < 0.1) {
      return { adjustedValue: valueHands, adjustedBluff: bluffHands };
    }
    
    const adjustedBluff = valueHands * targetRatio;
    
    return {
      adjustedValue: valueHands,
      adjustedBluff: Math.min(adjustedBluff, bluffHands * 1.5)
    };
  }
}
