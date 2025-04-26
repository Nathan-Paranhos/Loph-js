import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { performance } from 'perf_hooks';
import { JSDOM } from 'jsdom';
import { Client } from 'whatsapp-web.js';
import * as math from 'mathjs';
import * as tf from '@tensorflow/tfjs';
import * as brain from 'brain.js';
import * as d3 from 'd3';
import { JSHINT as jshint } from 'jshint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function timeoutPromise(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    )
  ]);
}

function isMathExpression(prompt) {
  const mathRegex = /^[-+/*()\d\s^.]+$/;
  return mathRegex.test(prompt.trim());
}

function isImageGenerationRequest(prompt) {
  const lower = prompt.toLowerCase();
  return lower.startsWith('gerar foto') || lower.startsWith('criar imagem') || lower.startsWith('gerar imagem');
}

function isImageReadingRequest(prompt) {
  const lower = prompt.toLowerCase();
  return lower.startsWith('ler foto') || lower.startsWith('descrever foto') || lower.startsWith('legendar foto');
}

function isTechnicalRequest(prompt) {
  const lower = prompt.toLowerCase();
  return lower.includes('programa') || lower.includes('código') || lower.includes('física') || lower.includes('matemática');
}

class AIService {
  constructor(whatsappClient) {
    this.whatsappClient = whatsappClient;

    this.math = math;
    this.tf = tf;
    this.brain = brain;
    this.d3 = d3;
    this.jshint = jshint;

    const requiredEnv = ['HUGGINGFACE_API_KEY', 'OPENROUTER_API_KEY'];
    for (const key of requiredEnv) {
      if (!process.env[key]) {
        throw new Error(`A variável ${key} está ausente no arquivo .env`);
      }
    }

    this.huggingfaceApi = axios.create({
      baseURL: 'https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base',
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'json'
    });

    this.ghibliApi = axios.create({
      baseURL: 'https://api-inference.huggingface.co/models/nitrosocke/anything-v4-ghibli',
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer'
    });

    this.openrouterApi = axios.create({
      baseURL: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'json'
    });

    this.generationApi = axios.create({
      baseURL: 'https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5',
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer'
    });
    
    // Endpoint para modelos locais (via Ollama) neste caso é necessário rodar na máquina local
    this.ollamaUrl = "http://localhost:11434/api/generate";

    this.memory = new Map();
  }
  
  async initialize() {
  }
  
  _updateMemory(userId, prompt, response) {
    const now = Date.now();
    if (!this.memory.has(userId)) this.memory.set(userId, []);
    const userMem = this.memory.get(userId);
    userMem.push({ prompt, response, timestamp: now });
    this.memory.set(userId, userMem.filter(m => now - m.timestamp <= 60000));
  }
  
  getUserMemory(userId = 'default') {
    const now = Date.now();
    return (this.memory.get(userId) || []).filter(m => now - m.timestamp <= 60000);
  }
  
  async processHuggingFace(prompt, userId = 'default') {
    try {
      const response = await timeoutPromise(
        axios.post(
          'https://api-inference.huggingface.co/models/bigscience/bloom',
          { inputs: `Responda de forma clara e completa: ${prompt}` },
          { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
        ),
        5000
      );
      const output = response.data[0]?.generated_text || 'Sem resposta do HuggingFace.';
      this._updateMemory(userId, prompt, output);
      logger.info('Resposta de HuggingFace obtida.');
      return output;
    } catch (err) {
      const errorDetails = err.response
        ? `Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`
        : err.message;
      logger.error(`Erro ao processar HuggingFace: ${errorDetails}`);
      throw new Error(`Erro ao processar HuggingFace: ${errorDetails}`);
    }
  }
  
  async processOpenRouter(prompt, userId = 'default') {
    try {
      let modifiedPrompt = prompt;
      if (isTechnicalRequest(prompt)) {
        modifiedPrompt = `Explique de forma clara e detalhada: ${prompt}`;
      }
      const response = await timeoutPromise(
        this.openrouterApi.post('', {
          model: 'mistralai/mixtral-8x7b-instruct',
          messages: [
            { role: 'system', content: 'Responda de forma natural, clara e completa em português brasileiro.' },
            { role: 'user', content: modifiedPrompt }
          ]
        }),
        10000
      );
      const output = response.data.choices[0].message.content;
      this._updateMemory(userId, prompt, output);
      logger.info('Resposta de OpenRouter obtida.');
      return output;
    } catch (err) {
      const errorDetails = err.response
        ? JSON.stringify(err.response.data)
        : err.message;
      logger.error(`Erro ao processar OpenRouter: ${errorDetails}`);
      throw new Error(`Erro ao processar OpenRouter: ${errorDetails}`);
    }
  }
  
  async processLocalModelWith(model, prompt, userId = 'default') {
    try {
      const response = await timeoutPromise(
        axios.post(this.ollamaUrl, {
          model,
          prompt: `Responda de forma clara e em português brasileiro:\n${prompt}`,
          stream: false
        }),
        5000
      );
      const output = response.data.response;
      this._updateMemory(userId, prompt, output);
      logger.info(`Resposta de ollama_local:${model} obtida.`);
      return output;
    } catch (err) {
      logger.error(`Erro ao processar modelo local ${model}: ${err.message}`);
      throw new Error(`Erro ao processar modelo local ${model}: ${err.message}`);
    }
  }
  
  async generateImage(prompt, userId = 'default') {
    try {
      const response = await timeoutPromise(
        this.generationApi.post('', { inputs: prompt }),
        10000
      );
      const outputPath = `./generated_${Date.now()}.png`;
      fs.writeFileSync(outputPath, response.data);
      logger.info('Imagem gerada com sucesso.');
      this._updateMemory(userId, prompt, `Imagem gerada: ${outputPath}`);
      return { finalResponse: `Imagem gerada: ${outputPath}`, metadata: { imageGeneration: true } };
    } catch (err) {
      const errorDetails = err.response
        ? `Status: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`
        : err.message;
      logger.error(`Erro ao gerar imagem: ${errorDetails}`);
      throw new Error(`Erro ao gerar imagem: ${errorDetails}`);
    }
  }
  
  async readImage(base64Image, userId = 'default') {
    try {
      const cleanedBase64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
      const binaryImage = Buffer.from(cleanedBase64, 'base64');
      const response = await timeoutPromise(
        this.huggingfaceApi.post('', binaryImage, {
          headers: {
            Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
            'Content-Type': 'image/jpeg'
          }
        }),
        5000
      );
      const caption = response.data[0]?.generated_text || 'Sem legenda para a imagem.';
      logger.info('Imagem lida com sucesso.');
      return { finalResponse: caption, metadata: { imageReading: true } };
    } catch (err) {
      logger.error(`Erro ao ler imagem: ${err.message}`);
      throw new Error(`Erro ao ler imagem: ${err.message}`);
    }
  }
  
  async transformToGhibli(base64Image, outputPath = 'saida.png', userId = 'default') {
    try {
      const response = await timeoutPromise(
        this.ghibliApi.post('', { inputs: base64Image }),
        5000
      );
      fs.writeFileSync(outputPath, response.data);
      logger.info('Imagem transformada para estilo Ghibli.');
      this._updateMemory(userId, 'transformToGhibli', `Imagem transformada: ${outputPath}`);
      return { finalResponse: `Imagem transformada: ${outputPath}`, metadata: { transformGhibli: true } };
    } catch (err) {
      logger.error(`Erro ao transformar imagem para estilo Ghibli: ${err.message}`);
      return { finalResponse: 'Erro ao transformar imagem para estilo Ghibli.', metadata: {} };
    }
  }
  
  async processPDF(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`Arquivo PDF não encontrado: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  
  async processDocx(filePath) {
    if (!fs.existsSync(filePath)) throw new Error(`Arquivo DOCX não encontrado: ${filePath}`);
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  
  async processDocumentation(text) {
    const prompt = `Leia o seguinte texto técnico e explique de forma simples em português:\n\n${text}`;
    return await this.processWithAllAIs(prompt);
  }
  
  async calculateMath(expression) {
    try {
      return this.math.evaluate(expression).toString();
    } catch {
      return 'Expressão matemática inválida.';
    }
  }
  
  async processWithAllAIs(prompt, userId = 'default') {
    if (isMathExpression(prompt)) {
      const result = await this.calculateMath(prompt);
      return { finalResponse: result, metadata: { math: true } };
    }
    if (isImageGenerationRequest(prompt)) {
      return await this.generateImage(prompt, userId);
    }
    if (isImageReadingRequest(prompt)) {
      const base64Image = prompt.split(':')[1]?.trim();
      if (!base64Image) {
        throw new Error('Nenhuma imagem fornecida para leitura.');
      }
      return await this.readImage(base64Image, userId);
    }
    try {
      const openRouterResponse = await timeoutPromise(
        this.processOpenRouter(prompt, userId),
        10000
      );
      this._send_to_meta(openRouterResponse);
      return { finalResponse: openRouterResponse, metadata: { respondedModel: 'openrouter' } };
    } catch (err) {
      logger.warn(`Falha no OpenRouter: ${err.message}`);
      try {
        const hfResponse = await timeoutPromise(
          this.processHuggingFace(prompt, userId),
          5000
        );
        this._send_to_meta(hfResponse);
        return { finalResponse: hfResponse, metadata: { respondedModel: 'huggingface' } };
      } catch (err2) {
        logger.warn(`Falha no HuggingFace: ${err2.message}`);
        const localModels = ['llama3', 'mistral', 'gemma', 'dolphin-mistral', 'codellama'];
        for (const model of localModels) {
          try {
            const localResponse = await timeoutPromise(
              this.processLocalModelWith(model, prompt, userId),
              5000
            );
            this._send_to_meta(localResponse);
            return { finalResponse: localResponse, metadata: { respondedModel: `ollama_local:${model}` } };
          } catch (errLocal) {
            logger.warn(`Falha com modelo local ${model}: ${errLocal.message}`);
          }
        }
        throw new Error('Nenhuma IA conseguiu responder.');
      }
    }
  }
  
  gerarAjuda() {
    return `
🤖 *Loph IA - Assistente de WhatsApp*

*Comandos principais:*
/ativar - Ativa a IA.
/desativar - Desativa a IA.

A IA responde de forma natural, utilizando modelos de IA online e locais, realizando cálculos, gerando e lendo imagens, e muito mais.
    `.trim();
  }
}

AIService.prototype._send_to_meta = function(response) {

};

export default (async () => {
  const client = new Client();
  client.on('qr', (qr) => {
    logger.info('Por favor, escaneie o QR code gerado no console para fazer login no WhatsApp.');
  });
  client.on('ready', () => {
    logger.info('Cliente WhatsApp pronto!');
  });
  await client.initialize();
  
  const aiService = new AIService(client);
  if (aiService.initialize) await aiService.initialize();
  return aiService;
})();

