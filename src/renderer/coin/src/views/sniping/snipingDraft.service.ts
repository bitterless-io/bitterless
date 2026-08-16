import type { SnipingJsonObject, SnipingJsonValue } from '@shared/sniping/snipingBridge.type';
import {
  stripDerivedSnipingConfig,
  type SnipingCompiledForm,
} from './snipingSchema.service';

export interface SnipingDraftSnapshot {
  value: SnipingJsonObject;
  json: string;
  jsonError: string | null;
  changed: boolean;
}

const canonicalJson = (value: SnipingJsonObject): string => `${JSON.stringify(value, null, 2)}\n`;

const cloneValue = (value: SnipingJsonObject): SnipingJsonObject => structuredClone(value);

export class SnipingDraftController {
  private baseline: SnipingJsonObject = {};
  private current: SnipingJsonObject = {};
  private advancedJson = '{}\n';
  private error: string | null = null;
  private form: SnipingCompiledForm = {
    supported: false, safeAdvanced: false, groups: [], fields: [], derivedKeys: [], readOnlyKeys: [],
  };

  private preserveReadOnly(value: SnipingJsonObject): SnipingJsonObject {
    const next = stripDerivedSnipingConfig(value, this.form);
    for (const key of this.form.readOnlyKeys) {
      if (Object.hasOwn(this.baseline, key)) next[key] = structuredClone(this.baseline[key]);
      else delete next[key];
    }
    return next;
  }

  get snapshot(): SnipingDraftSnapshot {
    return {
      value: cloneValue(this.current),
      json: this.advancedJson,
      jsonError: this.error,
      changed: canonicalJson(this.current) !== canonicalJson(this.baseline),
    };
  }

  reset(value: SnipingJsonObject, form: SnipingCompiledForm): SnipingDraftSnapshot {
    this.form = form;
    const sanitized = stripDerivedSnipingConfig(value, form);
    this.baseline = cloneValue(sanitized);
    this.current = cloneValue(sanitized);
    this.advancedJson = canonicalJson(sanitized);
    this.error = null;
    return this.snapshot;
  }

  setField(key: string, value: SnipingJsonValue): SnipingDraftSnapshot {
    if (this.form.derivedKeys.includes(key) || this.form.readOnlyKeys.includes(key)) return this.snapshot;
    this.current = { ...this.current, [key]: structuredClone(value) };
    this.advancedJson = canonicalJson(this.current);
    this.error = null;
    return this.snapshot;
  }

  setJson(value: string): SnipingDraftSnapshot {
    this.advancedJson = value;
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      this.current = this.preserveReadOnly(parsed as SnipingJsonObject);
      this.advancedJson = canonicalJson(this.current);
      this.error = null;
    } catch {
      this.error = 'SNIPING_DRAFT_JSON_INVALID';
    }
    return this.snapshot;
  }

  commit(value: SnipingJsonObject): SnipingDraftSnapshot {
    return this.reset(value, this.form);
  }

  payload(): SnipingJsonObject {
    if (this.error) throw new Error(this.error);
    return cloneValue(this.preserveReadOnly(this.current));
  }
}
