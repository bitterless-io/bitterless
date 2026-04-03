export enum PokerAction {
  FOLD = 'FOLD',
  CHECK = 'CHECK',
  CALL = 'CALL',
  BET = 'BET',
  RAISE = 'RAISE',
  ALL_IN = 'ALL_IN'
}

export enum BettingRound {
  PREFLOP = 'PREFLOP',
  FLOP = 'FLOP',
  TURN = 'TURN',
  RIVER = 'RIVER'
}

export enum Position {
  UTG = 'UTG',
  MP = 'MP',
  CO = 'CO',
  BTN = 'BTN',
  SB = 'SB',
  BB = 'BB'
}

export enum HandStrength {
  NUTS = 'NUTS',
  STRONG = 'STRONG',
  MEDIUM = 'MEDIUM',
  WEAK = 'WEAK',
  BLUFF = 'BLUFF'
}

export interface GameState {
  pot: number;
  effectiveStack: number;
  currentBet: number;
  position: Position;
  round: BettingRound;
  boardTexture: BoardTexture;
  handStrength: HandStrength;
  handEquity: number;
  opponents: number;
}

export interface BoardTexture {
  wetness: number;
  connectivity: number;
  pairedBoard: boolean;
  flushPossible: boolean;
  straightPossible: boolean;
}

export interface ActionFrequency {
  action: PokerAction;
  frequency: number;
  betSize?: number;
}

export interface StrategyRange {
  valueHands: number;
  bluffHands: number;
  semiBluffHands: number;
  totalCombos: number;
}

export interface GTORecommendation {
  primaryAction: ActionFrequency;
  mixedStrategy: ActionFrequency[];
  reasoning: string;
  exploitationAdjustment?: ExploitationAdjustment;
}

export interface ExploitationAdjustment {
  adjustmentType: string;
  frequencyShift: number;
  reasoning: string;
}

export interface OpponentTendency {
  foldToCBet: number;
  foldToRaise: number;
  checkRaiseFrequency: number;
  aggressionFactor: number;
  vpip: number;
  pfr: number;
}
