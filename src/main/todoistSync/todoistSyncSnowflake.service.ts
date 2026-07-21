import { Snowflake } from '@sapphire/snowflake';
import { TODOIST_SYNC_ENTITY_ID_PATTERN } from '@shared/todoistSync/todoistSync.contract';

export const TODOIST_SYNC_SNOWFLAKE_EPOCH = new Date('2024-01-01T00:00:00.000Z');

export const assertTodoistSyncEntityId = (value: unknown, label = 'id'): string => {
  if (typeof value !== 'string' || !TODOIST_SYNC_ENTITY_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a 20-character decimal Snowflake string`);
  }
  return value;
};

export class TodoistSyncSnowflakeService {
  private snowflake: Snowflake | null = null;
  private nodeId: number | null = null;

  constructor(nodeId: number | null = null) {
    if (nodeId !== null) this.setNodeId(nodeId);
  }

  setNodeId(nodeId: number): void {
    if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId > 1023) {
      throw new Error('snowflake_node_id must be an integer from 0 to 1023');
    }
    if (this.nodeId !== null && this.nodeId !== nodeId) {
      throw new Error('[todoist sync] server changed this device Snowflake node');
    }
    const snowflake = new Snowflake(TODOIST_SYNC_SNOWFLAKE_EPOCH);
    snowflake.workerId = nodeId >> 5;
    snowflake.processId = nodeId & 31;
    this.nodeId = nodeId;
    this.snowflake = snowflake;
  }

  getNodeId(): number | null {
    return this.nodeId;
  }

  generate(): string {
    if (!this.snowflake) {
      throw new Error('[todoist sync] first sync must assign this device a Snowflake node before creating Todo data');
    }
    const value = this.snowflake.generate().toString().padStart(20, '0');
    return assertTodoistSyncEntityId(value);
  }
}
