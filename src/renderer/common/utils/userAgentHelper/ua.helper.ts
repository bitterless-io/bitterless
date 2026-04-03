class UaHelper {
  get platform(): 'mac' | 'win' {
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    
    if (platform.includes('mac') || userAgent.includes('mac os')) {
      return 'mac';
    }
    
    return 'win';
  }

  get isMac(): boolean {
    return this.platform === 'mac';
  }

  get isWindows(): boolean {
    return this.platform === 'win';
  }
}

export const uaHelper = new UaHelper();
