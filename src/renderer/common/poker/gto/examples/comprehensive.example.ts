import { GTOEngine } from '../gtoEngine';
import { GTOHelper, GTOConstants } from '../utils/gtoHelper';
import type { GameState, OpponentTendency } from '../types';
import { Position, BettingRound, HandStrength, PokerAction } from '../types';

export class ComprehensiveGTOExample {
  private engine: GTOEngine;

  constructor() {
    this.engine = new GTOEngine();
  }

  public demonstrateFullHand(): void {
    console.log('=== 完整牌局演示 ===\n');

    console.log('场景：单挑，你在 BTN 位置');
    console.log('筹码：双方各 1000BB\n');

    this.playFlop();
    this.playTurn();
    this.playRiver();
  }

  private playFlop(): void {
    console.log('--- FLOP: K♠ 7♥ 3♦ (干燥牌面) ---');
    
    const gameState: GameState = {
      pot: 30,
      effectiveStack: 970,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.FLOP,
      boardTexture: {
        wetness: 0.3,
        connectivity: 0.2,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.STRONG,
      handEquity: 0.75,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('你的手牌强度：强牌 (75% 权益)');
    console.log(`推荐动作：${recommendation.primaryAction.action}`);
    if (recommendation.primaryAction.betSize) {
      console.log(`下注尺度：${GTOHelper.formatBetSize(recommendation.primaryAction.betSize, gameState.pot)}`);
      console.log(`下注类型：${GTOHelper.getBetSizeCategory(recommendation.primaryAction.betSize, gameState.pot)}`);
    }
    console.log(`策略说明：${recommendation.reasoning}`);
    console.log('\n混合策略分布：');
    for (const action of recommendation.mixedStrategy) {
      console.log(`  ${action.action}: ${GTOHelper.formatFrequency(action.frequency)}`);
    }
    console.log('');
  }

  private playTurn(): void {
    console.log('--- TURN: K♠ 7♥ 3♦ 2♣ ---');
    console.log('对手跟注了你的翻牌圈下注\n');
    
    const gameState: GameState = {
      pot: 80,
      effectiveStack: 920,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.TURN,
      boardTexture: {
        wetness: 0.3,
        connectivity: 0.3,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.STRONG,
      handEquity: 0.78,
      opponents: 1
    };

    const recommendation = this.engine.getRecommendation(gameState);
    
    console.log('你的手牌强度：强牌 (78% 权益)');
    console.log(`推荐动作：${recommendation.primaryAction.action}`);
    if (recommendation.primaryAction.betSize) {
      console.log(`下注尺度：${GTOHelper.formatBetSize(recommendation.primaryAction.betSize, gameState.pot)}`);
      
      const spr = GTOHelper.calculateSPR(gameState.effectiveStack, gameState.pot);
      console.log(`当前 SPR：${spr.toFixed(1)}`);
    }
    console.log(`策略说明：${recommendation.reasoning}\n`);
  }

  private playRiver(): void {
    console.log('--- RIVER: K♠ 7♥ 3♦ 2♣ 9♠ ---');
    console.log('对手再次跟注\n');
    
    const gameState: GameState = {
      pot: 200,
      effectiveStack: 800,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.25,
        connectivity: 0.3,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.NUTS,
      handEquity: 0.95,
      opponents: 1
    };

    console.log('场景 1：GTO 策略');
    const gtoRecommendation = this.engine.getRecommendation(gameState);
    console.log(`推荐动作：${gtoRecommendation.primaryAction.action}`);
    if (gtoRecommendation.primaryAction.betSize) {
      console.log(`下注尺度：${GTOHelper.formatBetSize(gtoRecommendation.primaryAction.betSize, gameState.pot)}`);
      console.log(`下注类型：${GTOHelper.getBetSizeCategory(gtoRecommendation.primaryAction.betSize, gameState.pot)}`);
    }
    console.log(`策略说明：${gtoRecommendation.reasoning}\n`);

    console.log('场景 2：剥削被动对手');
    const passiveOpponent: OpponentTendency = {
      foldToCBet: 0.45,
      foldToRaise: 0.55,
      checkRaiseFrequency: 0.05,
      aggressionFactor: 1.2,
      vpip: 0.35,
      pfr: 0.18
    };

    const exploitRecommendation = this.engine.getRecommendation(gameState, passiveOpponent);
    console.log(`推荐动作：${exploitRecommendation.primaryAction.action}`);
    if (exploitRecommendation.primaryAction.betSize) {
      console.log(`下注尺度：${GTOHelper.formatBetSize(exploitRecommendation.primaryAction.betSize, gameState.pot)}`);
    }
    if (exploitRecommendation.exploitationAdjustment) {
      console.log(`剥削调整：${exploitRecommendation.exploitationAdjustment.reasoning}`);
    }
    console.log('');
  }

  public demonstrateDefenseScenarios(): void {
    console.log('\n=== 防守场景演示 ===\n');

    this.defendAgainstSmallBet();
    this.defendAgainstPotBet();
    this.defendAgainstOverbet();
  }

  private defendAgainstSmallBet(): void {
    console.log('--- 场景 1：对手下注 33% 底池 ---');
    
    const gameState: GameState = {
      pot: 100,
      effectiveStack: 600,
      currentBet: 33,
      position: Position.BB,
      round: BettingRound.FLOP,
      boardTexture: {
        wetness: 0.6,
        connectivity: 0.7,
        pairedBoard: false,
        flushPossible: true,
        straightPossible: false
      },
      handStrength: HandStrength.MEDIUM,
      handEquity: 0.50,
      opponents: 1
    };

    const mdf = GTOHelper.quickMDFLookup(33);
    console.log(`MDF：${GTOHelper.formatFrequency(mdf)}`);
    console.log(`你的权益：${GTOHelper.formatFrequency(gameState.handEquity)}`);
    
    const recommendation = this.engine.getRecommendation(gameState);
    console.log(`推荐动作：${recommendation.primaryAction.action}`);
    console.log(`策略说明：${recommendation.reasoning}\n`);
  }

  private defendAgainstPotBet(): void {
    console.log('--- 场景 2：对手下注 100% 底池 ---');
    
    const gameState: GameState = {
      pot: 150,
      effectiveStack: 700,
      currentBet: 150,
      position: Position.BB,
      round: BettingRound.TURN,
      boardTexture: {
        wetness: 0.5,
        connectivity: 0.5,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: true
      },
      handStrength: HandStrength.MEDIUM,
      handEquity: 0.45,
      opponents: 1
    };

    const mdf = GTOHelper.quickMDFLookup(100);
    console.log(`MDF：${GTOHelper.formatFrequency(mdf)}`);
    console.log(`你的权益：${GTOHelper.formatFrequency(gameState.handEquity)}`);
    
    const recommendation = this.engine.getRecommendation(gameState);
    console.log(`推荐动作：${recommendation.primaryAction.action}`);
    console.log(`策略说明：${recommendation.reasoning}\n`);
  }

  private defendAgainstOverbet(): void {
    console.log('--- 场景 3：对手超水下注 150% 底池 ---');
    
    const gameState: GameState = {
      pot: 200,
      effectiveStack: 800,
      currentBet: 300,
      position: Position.BB,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.2,
        connectivity: 0.3,
        pairedBoard: true,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.WEAK,
      handEquity: 0.35,
      opponents: 1
    };

    const mdf = GTOHelper.quickMDFLookup(150);
    console.log(`MDF：${GTOHelper.formatFrequency(mdf)}`);
    console.log(`你的权益：${GTOHelper.formatFrequency(gameState.handEquity)}`);
    
    const recommendation = this.engine.getRecommendation(gameState);
    console.log(`推荐动作：${recommendation.primaryAction.action}`);
    console.log(`策略说明：${recommendation.reasoning}\n`);
  }

  public demonstrateExploitation(): void {
    console.log('\n=== 剥削策略演示（无历史数据） ===\n');

    this.exploitNit();
    this.exploitCallingStation();
    this.exploitManiac();
  }

  private exploitNit(): void {
    console.log('--- 剥削紧弱玩家 (Nit) ---');
    
    const gameState: GameState = {
      pot: 80,
      effectiveStack: 600,
      currentBet: 0,
      position: Position.CO,
      round: BettingRound.FLOP,
      boardTexture: {
        wetness: 0.4,
        connectivity: 0.4,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.WEAK,
      handEquity: 0.30,
      opponents: 1
    };

    const nitTendency: OpponentTendency = {
      foldToCBet: 0.80,
      foldToRaise: 0.85,
      checkRaiseFrequency: 0.03,
      aggressionFactor: 0.8,
      vpip: 0.15,
      pfr: 0.12
    };

    console.log('对手特征：');
    console.log(`  弃牌率：${GTOHelper.formatFrequency(nitTendency.foldToCBet)}`);
    console.log(`  侵略因子：${nitTendency.aggressionFactor}`);
    
    const recommendation = this.engine.getRecommendation(gameState, nitTendency);
    console.log(`\n推荐动作：${recommendation.primaryAction.action}`);
    if (recommendation.exploitationAdjustment) {
      console.log(`剥削类型：${recommendation.exploitationAdjustment.adjustmentType}`);
      console.log(`频率调整：${GTOHelper.formatFrequency(recommendation.exploitationAdjustment.frequencyShift)}`);
      console.log(`说明：${recommendation.exploitationAdjustment.reasoning}`);
    }
    console.log('');
  }

  private exploitCallingStation(): void {
    console.log('--- 剥削跟注站 (Calling Station) ---');
    
    const gameState: GameState = {
      pot: 120,
      effectiveStack: 700,
      currentBet: 0,
      position: Position.BTN,
      round: BettingRound.TURN,
      boardTexture: {
        wetness: 0.5,
        connectivity: 0.5,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: true
      },
      handStrength: HandStrength.STRONG,
      handEquity: 0.75,
      opponents: 1
    };

    const callingStationTendency: OpponentTendency = {
      foldToCBet: 0.25,
      foldToRaise: 0.30,
      checkRaiseFrequency: 0.05,
      aggressionFactor: 0.6,
      vpip: 0.45,
      pfr: 0.15
    };

    console.log('对手特征：');
    console.log(`  弃牌率：${GTOHelper.formatFrequency(callingStationTendency.foldToCBet)}`);
    console.log(`  侵略因子：${callingStationTendency.aggressionFactor}`);
    
    const recommendation = this.engine.getRecommendation(gameState, callingStationTendency);
    console.log(`\n推荐动作：${recommendation.primaryAction.action}`);
    if (recommendation.exploitationAdjustment) {
      console.log(`剥削类型：${recommendation.exploitationAdjustment.adjustmentType}`);
      console.log(`说明：${recommendation.exploitationAdjustment.reasoning}`);
    }
    console.log('');
  }

  private exploitManiac(): void {
    console.log('--- 剥削疯狂玩家 (Maniac) ---');
    
    const gameState: GameState = {
      pot: 200,
      effectiveStack: 800,
      currentBet: 150,
      position: Position.BB,
      round: BettingRound.RIVER,
      boardTexture: {
        wetness: 0.4,
        connectivity: 0.5,
        pairedBoard: false,
        flushPossible: false,
        straightPossible: false
      },
      handStrength: HandStrength.MEDIUM,
      handEquity: 0.55,
      opponents: 1
    };

    const maniacTendency: OpponentTendency = {
      foldToCBet: 0.35,
      foldToRaise: 0.40,
      checkRaiseFrequency: 0.30,
      aggressionFactor: 4.5,
      vpip: 0.55,
      pfr: 0.40
    };

    console.log('对手特征：');
    console.log(`  侵略因子：${maniacTendency.aggressionFactor}`);
    console.log(`  Check-raise 频率：${GTOHelper.formatFrequency(maniacTendency.checkRaiseFrequency)}`);
    
    const recommendation = this.engine.getRecommendation(gameState, maniacTendency);
    console.log(`\n推荐动作：${recommendation.primaryAction.action}`);
    if (recommendation.exploitationAdjustment) {
      console.log(`剥削类型：${recommendation.exploitationAdjustment.adjustmentType}`);
      console.log(`说明：${recommendation.exploitationAdjustment.reasoning}`);
    }
    console.log('');
  }

  public runAllDemonstrations(): void {
    this.demonstrateFullHand();
    this.demonstrateDefenseScenarios();
    this.demonstrateExploitation();
    
    console.log('\n=== 演示完成 ===');
    console.log('\n核心要点：');
    console.log('1. ✅ 虚张平衡：根据下注尺度自动计算最优虚张比例');
    console.log('2. ✅ Check-raise：根据位置和牌面动态调整频率');
    console.log('3. ✅ MDF 防守：确保不被无限虚张');
    console.log('4. ✅ 超水下注：在合适场景最大化价值');
    console.log('5. ✅ 阻断下注：保护中等摊牌价值');
    console.log('6. ✅ 混合频率：所有策略都使用频率混合');
    console.log('7. ✅ 剥削调整：无需历史数据也能进行剥削');
  }
}

export function runComprehensiveDemo(): void {
  const demo = new ComprehensiveGTOExample();
  demo.runAllDemonstrations();
}
