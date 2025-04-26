export const COMMANDS = {
    ACTIVATE: '/ativar',
    DEACTIVATE: '/desativar',
    HELP: '/ajuda'
  };
  
  export const MESSAGES = {
    WELCOME: "Olá! Eu sou Loph Desenvolvido por Nathan Silva. Sigo em processo de desenvolvimento",
    GOODBYE: "Bot desativado. Até logo!",
    PROCESSING: "Processando sua mensagem...",
    ERROR: "Desculpe, ocorreu um erro ao processar sua mensagem."
  };
  
  export const AI_CONFIG = {
    TEMPO_PADRAO: 5, 
    // Endpoints de APIs utilizadas no bot
    BLOOM_URL: "https://api-inference.huggingface.co/models/bigscience/bloom",
    BLIP_URL: "https://api-inference.huggingface.co/models/Salesforce/blip-image-captioning-base",
    GHIBLI_URL: "https://api-inference.huggingface.co/models/nitrosocke/anything-v4-ghibli",
    STABLE_DIFFUSION_URL: "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5",
    OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions",
    OLLAMA_URL: "http://localhost:11434/api/generate"
  };
  