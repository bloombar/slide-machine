const loadEnv = () => {
  return {
    OPENAI_API_KEY:
      localStorage.getItem('openai-api-key') || 'your_open_ai_api_key_here',
    OPENAI_API_BASE:
      localStorage.getItem('openai-api-base') ||
      'https://api.openai.com/v1/responses',
    OPENAI_MODEL: localStorage.getItem('openai-api-model') || 'gpt-4.1', //'gpt-3.5-turbo', //o4-mini
    OPENAI_HISTORY_DEPTH: localStorage.getItem('openai-history-depth') || 10,
    PAUSE_BETWEEN_SLIDES: localStorage.getItem('pause-between-slides') || 12000,
    CLEAR_SUBTITLES_AFTER: localStorage.getItem('pause-between-slides') || 2000,
    VARY_LAYOUT_EVERY: localStorage.getItem('vary-layout-every') || 7,
  }
}
