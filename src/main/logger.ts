import { EventEmitter } from 'node:events'
import { appendFile } from 'node:fs/promises'
import { mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { logsDir } from './paths'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_LINES = 3000

class Logger extends EventEmitter {
  readonly file = join(logsDir, 'app.log')
  private queue: Promise<void> = Promise.resolve()
  private lines: string[] = []

  init(): void {
    try {
      mkdirSync(logsDir, { recursive: true })
      const size = statSync(this.file, { throwIfNoEntry: false })?.size ?? 0
      if (size > MAX_BYTES) {
        renameSync(this.file, join(logsDir, 'app.1.log'))
      }
    } catch {
      return
    }
  }

  write(scope: string, message: string): string {
    const line = `${new Date().toISOString()} [${scope}] ${message}`
    this.lines.push(line)
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES)
    this.queue = this.queue.then(() => appendFile(this.file, `${line}\n`, 'utf8')).catch(() => undefined)
    this.emit('line', line)
    return line
  }

  scoped(scope: string): (message: string) => void {
    return (message) => {
      this.write(scope, message)
    }
  }

  recent(): string[] {
    return [...this.lines]
  }

  async flush(): Promise<void> {
    await this.queue
  }
}

export const logger = new Logger()
export type LogFn = (message: string) => void
