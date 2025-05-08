let historic_prompts = [] // will store prompt history

async function getOpenAIResponse(
  apiBaseUrl,
  apiModel,
  apiKey,
  system_prompt = '',
  summary_prompt = '',
  user_prompt,
  history_depth = 5,
  temperature = 0.9
) {
  // assemble the contents of the request
  request_body = JSON.stringify({
    model: apiModel,
    input: [
      {
        role: 'system',
        content: system_prompt,
      },
      {
        role: 'system',
        content: `conversation summary: ${summary_prompt}`,
      },
      ...historic_prompts.slice(-history_depth), // Destructure only the last 5 user prompts
      {
        role: 'user',
        content: user_prompt,
      },
    ],
    temperature: temperature,
    //   top_p: 1,
    //   frequency_penalty: 0.0,
    //   presence_penalty: 0.6,
    //   stop: [" Human:", " AI:"],
  })
  console.log('Request body to OpenAI:', request_body)

  return await fetch(apiBaseUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: request_body,
  })
    .then(response => response.json())
    .then(data => {
      //   console.log(JSON.stringify(data, null, 2));
      //   console.log(JSON.stringify(data.output[0].content, null, 2));
      let text = data?.output?.[0]?.content?.[0]?.text
      if (text) {
        console.log('OpenAI response:', text)
        // Fix any invalid JSON in the string
        const jsonStart = text.indexOf('{')
        const jsonEnd = text.lastIndexOf('}')
        if (jsonStart !== -1 && jsonEnd !== -1) {
          text = text.substring(jsonStart, jsonEnd + 1)
        }
        // Ensure proper JSON formatting by fixing trailing commas
        text = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')

        // Ensure the "summary" field is preceded by a comma followed by optional whitespace
        const summaryRegex = /(?<!\s),\s*"summary"/g
        text = text.replace(summaryRegex, ', "summary"')

        // console.log('OpenAI response fixed text:', fixedText)
        try {
          return JSON.parse(text)
        } catch (error) {
          console.error('Failed to parse JSON:', error)
          return null
        }
      } else {
        console.error('Unknown response format:', data)
      }
    })
    .catch(error => console.error('Error:', error))
    .finally(() => {
      // append the new user_prompt to the historic prompts
      if (user_prompt) {
        historic_prompts.push({
          role: 'user',
          content: user_prompt,
        })
      }
      //   console.log(
      //     'Historic prompts:',
      //     JSON.stringify(historic_prompts, null, 2)
      //   )
    })
}
