let historic_prompts = [] // will store prompt history
const presentationDescription = localStorage.getItem('presentation-description') // custom description of presentation, if available
console.log(`Presentation description: ${presentationDescription}`)

// openAI prompts
const system_prompt = `
You are an assistant creating a slide presentation for a lecture.  ${presentationDescription}

You create slide content in short sentences of simple English based on the main subject or object in the input.  
Return a JSON object for a slide with the following structure.  Return raw JSON, not Markdown.  Make sure JSON arrays are followed by a comma separating them from the following field.
{
    "title": "Slide title, 5 words or less",
    "topic": "The main object in the input, in singular form.",
    "intro": "1 sentence overview of the topic",
    "list": ["list of up to 3 simple English bullet point details for small children"]
    "summary": "A 1-sentence summary of the user input so far.",
}
`
let summary_prompt = '' // no prompt summary at start

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
          // append the new response to the historic prompts
          historic_prompts.push({
            role: 'assistant',
            content: text,
          })

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
