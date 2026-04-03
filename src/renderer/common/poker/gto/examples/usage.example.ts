import { GTOEngine } from '../gtoEngine';
import type { GameState, OpponentTendency } from '../types';
import { Position, BettingRound, HandStrength } from '../types';

export class GTOUsageExample {
  private engine: GTOEngine;

  constructor() {
    this.engine = new GTOEngine();
  }

  public exampleDefenseScenario(): void {
    const gameState: GameState = {
      pot: 100,
      effectiveStack: 500,
      currentBet: 66,
      position: Position.BB,
      round: BettingRound.FLOP,
      boardTexture: {
        wetness: 0.7,
        connectivity: 0.8,
        pairedBoard: false,
        flushPossible: true,
        straightPossible: true
      },
      handStrength: HandStrength.MEDIUM,
      handEquity: 0.55,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('=== Defense Scenario ===');
    console.log('Pot:', gameState.pot);
    console.log('Bet to call:', gameState.currentBet);
    console.log('Primary action:', recommendation.primaryAction.action);
    console.log('Bet size:', recommendation.primaryAction.betSize);
    console.log('Reasoning:', recommendation.reasoning);
    console.log('\nMixed strategy:');
    for (const action of recommendation.mixedStrategy) {
      console.log(`  ${action.action}: ${(action.frequency * 100).toFixed(1)}%`);
    }
  }

  public exampleBettingScenario(): void {
    const gameState: GameState = {
      pot: 150,
      effectiveStack: 600,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.TURN,
      boardTexture: {
        wetness: 0.4,
        connectivity: 0.5,
        pairedBoard: true,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.STRONG,
      handEquity: 0.75,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('\n=== Betting Scenario ===');
    console.log('Pot:', gameState.pot);
    console.log('Position:', gameState.position);
    console.log('Primary action:', recommendation.primaryAction.action);
    console.log('Bet size:', recommendation.primaryAction.betSize);
    console.log('Reasoning:', recommendation.reasoning);
    console.log('\nMixed strategy:');
    for (const action of recommendation.mixedStrategy) {
      console.log(`  ${action.action}: ${(action.frequency * 100).toFixed(1)}%`);
      if (action.betSize) {
        console.log(`    Size: ${action.betSize}`);
      }
    }
  }

  public exampleExploitationScenario(): void {
    const gameState: GameState = {
      pot: 200,
      effectiveStack: 800,
      currentBet: 0,
      position: Position.CO,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.3,
        connectivity: 0.4,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.WEAK,
      handEquity: 0.35,
      opponents: 1
    };

    const opponentTendency: OpponentTendency = {
      foldToCBet: 0.75,
      foldToRaise: 0.70,
      checkRaiseFrequency: 0.08,
      aggressionFactor: 1.5,
      vpip: 0.30,
      pfr: 0.20
    };

    const recommendation = this.engine.getRecommendation(gameState, opponentTendency);
    
    console.log('\n=== Exploitation Scenario ===');
    console.log('Opponent folds to c-bet:', (opponentTendency.foldToCBet * 100).toFixed(0) + '%');
    console.log('Opponent aggression factor:', opponentTendency.aggressionFactor);
    console.log('\nPrimary action:', recommendation.primaryAction.action);
    console.log('Bet size:', recommendation.primaryAction.betSize);
    console.log('Reasoning:', recommendation.reasoning);
    
    if (recommendation.exploitationAdjustment) {
      console.log('\nExploitation adjustment:');
      console.log('  Type:', recommendation.exploitationAdjustment.adjustmentType);
      console.log('  Frequency shift:', (recommendation.exploitationAdjustment.frequencyShift * 100).toFixed(1) + '%');
      console.log('  Reasoning:', recommendation.exploitationAdjustment.reasoning);
    }
  }

  public exampleOverbetScenario(): void {
    const gameState: GameState = {
      pot: 300,
      effectiveStack: 1000,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.2,
        connectivity: 0.3,
        pairedBoard: true,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.NUTS,
      handEquity: 0.95,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('\n=== Overbet Scenario ===');
    console.log('Hand strength: NUTS');
    console.log('Board: Paired, dry');
    console.log('Primary action:', recommendation.primaryAction.action);
    console.log('Bet size:', recommendation.primaryAction.betSize);
    console.log('Bet size as % of pot:', ((recommendation.primaryAction.betSize! / gameState.pot) * 100).toFixed(0) + '%');
    console.log('Reasoning:', recommendation.reasoning);
  }

  public exampleBlockBetScenario(): void {
    const gameState: GameState = {
      pot: 250,
      effectiveStack: 900,
      currentBet: 0,
      position: Position.BB,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.6,
        connectivity: 0.7,
        pairedBoard: false,
        flushPossible: true,
        straightPossible: true
      },
      handStrength: HandStrength.MEDIUM,
      handEquity: 0.58,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('\n=== Block Bet Scenario ===');
    console.log('Hand strength: Medium showdown value');
    console.log('Position: Out of position');
    console.log('Primary action:', recommendation.primaryAction.action);
    console.log('Bet size:', recommendation.primaryAction.betSize);
    console.log('Bet size as % of pot:', ((recommendation.primaryAction.betSize! / gameState.pot) * 100).toFixed(0) + '%');
    console.log('Reasoning:', recommendation.reasoning);
  }

  public runAllExamples(): void {
    this.exampleDefenseScenario();
    this.exampleBettingScenario();
    this.exampleExploitationScenario();
    this.exampleOverbetScenario();
    this.exampleBlockBetScenario();
  }
}

export function demonstrateGTOEngine(): void {
  const examples = new GTOUsageExample();
  examples.runAllExamples();
}
