import { xpcUtilityProcess } from 'electron-xpc/utilityProcess';

xpcUtilityProcess.handle('test/hello', async () => {
  console.log('[test utility] received test/hello event');
  return 'hello from utility process';
});

console.log('[test utility] process started');
