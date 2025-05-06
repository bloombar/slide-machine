const loadEnv = () => {
  return {
    OPENAI_API_KEY: 'your_open_ai_api_key_here',
    OPENAI_API_BASE: 'https://api.openai.com/v1',
    OPENAI_MODEL: 'gpt-4o', //'gpt-3.5-turbo', //or other, e.g. o4-mini
    PAUSE_BETWEEN_SLIDES: 8000,
    CLEAR_SUBTITLES_AFTER: 2000,
  }
}
