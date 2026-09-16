import type { WorkerCommand, WorkerEvent } from './protocol'
interface ParentPort {
  postMessage(message: WorkerEvent): void
  on(event: 'message', listener: (event: { data: WorkerCommand }) => void): void
}
const port = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!port) throw new Error('Workflow worker must be launched by Electron utilityProcess')
export const send = (event: WorkerEvent): void => port.postMessage(event)
export const onCommand = (listener: (message: WorkerCommand) => void): void => { port.on('message', event => listener(event.data)) }
