import TelegramBot from "node-telegram-bot-api";
/**
 * Initialise the Telegram bot.
 * Supports both polling (dev) and webhook (production) modes.
 */
export declare function initTelegramBot(): TelegramBot;
/**
 * Send a message to a specific chat or the default admin chat.
 * Used by PriceAgent and RiskAgent for alerts.
 */
export declare function sendTelegramMessage(text: string, chatId?: string): Promise<void>;
//# sourceMappingURL=bot.d.ts.map