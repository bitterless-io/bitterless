class ExtraResourceHelper {
  async checkNeedsExtract(): Promise<boolean> {
    return false;
  }

  async startExtract(): Promise<void> {
    return;
  }
}

export const extraResourceHelper = new ExtraResourceHelper();
