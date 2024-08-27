// logger.ts
// Aug 2024 by Rino, eMotionGraphics Inc.

import joplin from 'api';

export enum LogLevel {
    ErrorOnly = 'error',
    ErrorsAndWarnings = 'warn',
    Debug = 'debug'
}

class Logger {
    private async getLogLevel(): Promise<LogLevel> {
        return await joplin.settings.value('logLevel') as LogLevel;
    }

    async error(...args: any[]): Promise<void> {
        console.error(...args);
    }

    async warn(...args: any[]): Promise<void> {
        const level = await this.getLogLevel();
        if (level === LogLevel.ErrorsAndWarnings || level === LogLevel.Debug) {
            console.warn(...args);
        }
    }

    async info(...args: any[]): Promise<void> {
        const level = await this.getLogLevel();
        if (level === LogLevel.Debug) {
            console.log(...args);
        }
    }

    async debug(...args: any[]): Promise<void> {
        const level = await this.getLogLevel();
        if (level === LogLevel.Debug) {
            console.log('DEBUG:', ...args);
        }
    }
}

export const logger = new Logger();
