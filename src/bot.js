import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import dotenv from 'dotenv';
import { COMMANDS, MESSAGES } from '../config/constants.js';
import aiServicePromise from '../services/ai-service.js';
import logger from '../services/logger.js';

dotenv.config();

class WhatsAppBot {
  constructor(aiService) {
    this.aiService = aiService;
    this.activeUsers = new Map();

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    this.initializeEventListeners();
  }

  initializeEventListeners() {
    this.client.on('qr', this.handleQR);
    this.client.on('ready', this.handleReady);
    this.client.on('message', this.handleMessage.bind(this));
    this.client.on('disconnected', this.handleDisconnect);
    this.client.on('error', this.handleError);
  }

  handleQR(qr) {
    logger.info('QR Code gerado');
    qrcode.generate(qr, { small: true });
  }

  handleReady() {
    logger.info('Cliente WhatsApp está pronto!');
  }

  handleDisconnect(reason) {
    logger.warn('Cliente WhatsApp desconectado:', reason);
  }

  handleError(error) {
    logger.error('Erro no cliente WhatsApp:', error);
  }

  async handleCommand(chat, senderId, command) {
    switch (command) {
      case COMMANDS.ACTIVATE:
        this.activeUsers.set(senderId, true);
        await chat.sendMessage(MESSAGES.WELCOME);
        break;
      case COMMANDS.DEACTIVATE:
        this.activeUsers.delete(senderId);
        await chat.sendMessage(MESSAGES.GOODBYE);
        break;
      default:
        return false;
    }
    return true;
  }

  async handleMessage(msg) {
    try {
      if (msg.isGroupMsg) return;

      const chat = await msg.getChat();
      const senderId = msg.from;
      const messageContent = msg.body.toLowerCase();

      if (await this.handleCommand(chat, senderId, messageContent)) return;

      if (!this.activeUsers.get(senderId)) return;

      await this.processUserMessage(chat, senderId, messageContent);
    } catch (error) {
      logger.error('Erro ao processar mensagem:', error);
    }
  }

  async processUserMessage(chat, userId, message) {
    try {
      await chat.sendMessage(MESSAGES.PROCESSING);
      const response = await this.aiService.processWithAllAIs(message, userId);
      await chat.sendMessage(response.finalResponse);
    } catch (error) {
      logger.error('Erro no processamento da mensagem:', error);
      await chat.sendMessage(MESSAGES.ERROR);
    }
  }

  start() {
    this.client.initialize();
  }
}

const startBot = async () => {
  const aiService = await aiServicePromise; 
  const bot = new WhatsAppBot(aiService);
  bot.start();
};

startBot();