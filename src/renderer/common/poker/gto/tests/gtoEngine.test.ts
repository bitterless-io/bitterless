import { GTOEngine } from '../gtoEngine';
import { BluffOptimizer } from '../strategies/bluffOptimizer';
import { MDFCalculator } from '../strategies/mdfCalculator';
import { BetSizingOptimizer } from '../strategies/betSizingOptimizer';
import type { GameState, OpponentTendency } from '../types';
import { Position, BettingRound, HandStrength, PokerAction } from '../types';

describe('GTOEngine', () => {
  let engine: GTOEngine;

  beforeEach(() => {
    engine = new GTOEngine();
  });

  describe('Bluff Optimization', () => {
    it('should calculate optimal bluff ratio for 66% pot bet', () => {
      const bluffOptimizer = new BluffOptimizer();
      const betSize = 66;
      const gameState = { pot: 100 } as GameState;
      
      const ratio = bluffOptimizer.calculateOptimalBluffRatio(betSize, gameState);
      
      expect(ratio).toBeCloseTo(0.4, 1);
    });

    it('should adjust bluff frequency based on opponent count', () => {
      const bluffOptimizer = new BluffOptimizer();
      const gameState: GameState = {
        pot: 100,
        effectiveStack: 500,
        currentBet: 0,
        position: Position.BTN,
        round: BettingRound.FLOP,
        boardTexture: {
          wetness: 0.5,
          connectivity: 0.5,
          pairedBoard: false,
          flushPossible: false,
          straightPossible: false
        },
        handStrength: HandStrength.WEAK,
        handEquity: 0.3,
        opponents: 3
      };

      const ratio = bluffOptimizer.calculateOptimalBluffRatio(66, gameState);
      
      expect(ratio).toBeLessThan(0.4);
    });
  });

  describe('MDF Calculations', () => {
    it('should calculate correct MDF for 66% pot bet', () => {
      const mdfCalculator = new MDFCalculator();
      const betSize = 66;
      const pot = 100;
      
      const mdf = mdfCalculator.calculateMDFFromBetSize(betSize, pot);
      
      expect(mdf).toBeCloseTo(0.6, 1);
    });

    it('should provide MDF table for common bet sizes', () => {
      const mdfCalculator = new MDFCalculator();
      const table = mdfCalculator.getMDFTable();
      
      expect(table['50%']).toBeCloseTo(0.667, 2);
      expect(table['66%']).toBeCloseTo(0.6, 1);
      expect(table['100%']).toBeCloseTo(0.5, 1);
    });
  });

  describe('Defense Strategy', () => {
    it('should recommend calling with equity above MDF', () => {
      const gameState: GameState = {
        pot: 100,
        effectiveStack: 500,
        currentBet: 66,
        position: Position.BB,
        round: BettingRound.FLOP,
        boardTexture: {
          wetness: 0.5,
          connectivity: 0.5,
          pairedBoard: false,
          flushPossible: false,
          straightPossible: false
        },
        handStrength: HandStrength.MEDIUM,
        handEquity: 0.65,
        opponents: 1
      };

      const recommendation = engine.getRecommendation(gameState);
      
      expect(recommendation.mixedStrategy.some(a => a.action === PokerAction.CALL)).toBe(true);
      expect(recommendation.mixedStrategy.some(a => a.action === PokerAction.FOLD)).toBe(true);
    });

    it('should include check-raise in defense strategy', () => {
      const gameState: GameState = {
        pot: 100,
        effectiveStack: 800,
        currentBet: 50,
        position: Position.BB,
        round: BettingRound.FLOP,
        boardTexture: {
          wetness: 0.8,
          connectivity: 0.9,
          pairedBoard: false,
          flushPossible: true,
          straightPossible: true
        },
        handStrength: HandStrength.STRONG,
        handEquity: 0.75,
        opponents: 1
      };

      const recommendation = engine.getRecommendation(gameState);
      
      const hasRaise = recommendation.mixedStrategy.some(a => a.action === PokerAction.RAISE);
      expect(hasRaise).toBe(true);
    });
  });

  describe('Betting Strategy', () => {
    it('should recommend betting with strong hands', () => {
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
        handEquity: 0.8,
        opponents: 1
      };

      const recommendation = engine.getRecommendation(gameState);
      
      const betAction = recommendation.mixedStrategy.find(a => a.action === PokerAction.BET);
      expect(betAction).toBeDefined();
      expect(betAction!.frequency).toBeGreaterThan(0.5);
    });

    it('should use larger bet sizes with nuts on paired boards', () => {
      const betSizingOptimizer = new BetSizingOptimizer();
      const gameState: GameState = {
        pot: 200,
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

      const shouldOverbet = betSizingOptimizer.shouldOverbet(gameState);
      expect(shouldOverbet).toBe(true);

      const overbetSize = betSizingOptimizer.calculateOverbetSize(gameState.pot, gameState);
      expect(overbetSize).toBeGreaterThan(gameState.pot * 1.5);
    });

    it('should use block bets with medium strength on river', () => {
      const betSizingOptimizer = new BetSizingOptimizer();
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

      const shouldBlockBet = betSizingOptimizer.shouldBlockBet(gameState);
      expect(shouldBlockBet).toBe(true);

      const blockBetSize = betSizingOptimizer.calculateBlockBetSize(gameState.pot, gameState);
      expect(blockBetSize).toBeLessThan(gameState.pot * 0.5);
    });
  });

  describe('Exploitation Strategy', () => {
    it('should increase bluff frequency against overfolding opponents', () => {
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

      const recommendation = engine.getRecommendation(gameState, opponentTendency);
      
      expect(recommendation.exploitationAdjustment).toBeDefined();
      expect(recommendation.exploitationAdjustment!.adjustmentType).toBe('INCREASE_BLUFF_FREQUENCY');
      expect(recommendation.exploitationAdjustment!.frequencyShift).toBeGreaterThan(0);
    });

    it('should decrease bluff frequency against overcalling opponents', () => {
      const gameState: GameState = {
        pot: 200,
        effectiveStack: 800,
        currentBet: 0,
        position: Position.BTN,
        round: BettingRound.TURN,
        boardTexture: {
          wetness: 0.5,
          connectivity: 0.5,
          pairedBoard: false,
          flushPossible: false,
          straightPossible: false
        },
        handStrength: HandStrength.MEDIUM,
        handEquity: 0.55,
        opponents: 1
      };

      const opponentTendency: OpponentTendency = {
        foldToCBet: 0.30,
        foldToRaise: 0.35,
        checkRaiseFrequency: 0.08,
        aggressionFactor: 1.8,
        vpip: 0.40,
        pfr: 0.25
      };

      const recommendation = engine.getRecommendation(gameState, opponentTendency);
      
      expect(recommendation.exploitationAdjustment).toBeDefined();
      expect(recommendation.exploitationAdjustment!.adjustmentType).toBe('DECREASE_BLUFF_FREQUENCY');
      expect(recommendation.exploitationAdjustment!.frequencyShift).toBeLessThan(0);
    });
  });

  describe('Mixed Frequency Strategy', () => {
    it('should normalize frequencies to sum to 1', () => {
      const gameState: GameState = {
        pot: 100,
        effectiveStack: 500,
        currentBet: 0,
        position: Position.BTN,
        round: BettingRound.FLOP,
        boardTexture: {
          wetness: 0.5,
          connectivity: 0.5,
          pairedBoard: false,
          flushPossible: false,
          straightPossible: false
        },
        handStrength: HandStrength.MEDIUM,
        handEquity: 0.6,
        opponents: 1
      };

      const recommendation = engine.getRecommendation(gameState);
      
      const totalFrequency = recommendation.mixedStrategy.reduce(
        (sum, action) => sum + action.frequency,
        0
      );
      
      expect(totalFrequency).toBeCloseTo(1.0, 2);
    });

    it('should provide reasoning for recommendations', () => {
      const gameState: GameState = {
        pot: 100,
        effectiveStack: 500,
        currentBet: 50,
        position: Position.BB,
        round: BettingRound.FLOP,
        boardTexture: {
          wetness: 0.5,
          connectivity: 0.5,
          pairedBoard: false,
          flushPossible: false,
          straightPossible: false
        },
        handStrength: HandStrength.MEDIUM,
        handEquity: 0.6,
        opponents: 1
      };

      const recommendation = engine.getRecommendation(gameState);
      
      expect(recommendation.reasoning).toBeDefined();
      expect(recommendation.reasoning.length).toBeGreaterThan(0);
    });
  });
});
