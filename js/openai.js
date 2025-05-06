async function getOpenAIResponse(apiBaseUrl, apiModel, apiKey, user_prompt) {
  const system_prompt = `
You are an assistant creating a slide presentation for children about what it's like to be a university professor of computer science.  
You create slide content in short sentences of simple English based on the main subject or object in the input.  
Return a JSON object for a slide with the following structure.  Return raw JSON, not Markdown.
{
    "title": "Slide title, 5 words or less",
    "topic": "The main object in the input, in singular form.",
    "intro": "1 sentence overview of the topic",
    "list": ["list of up to 3 simple English bullet point details for small children"]
}`

  const background_prompt = `
The following is some background context about this user:
- Who or what inspired me to go into this profession? I ended up in this field somewhat accidentally by following my interests.
- When growing up, was this your dream profession or field of study? I never had any dream profession.  I never really understood what a profession was.
- Did certain passions or interests guide you towards this career? I learned to program computers when I was around 12 years old with help from my father.
- Who helped you along the way? My father introduced me to programming, but I am mostly self-taught.
- What type of education is needed and how long does it take to enter this career?  I never studied computer science.  I studied neuroscience and psychology and later studied technology art.
- How long were/have you been in this field? I've been a professor for 12 years, although I have taught part time for 20 years.
- What do you enjoy about this profession the most? Flexibilty, lack of a boss, and the ability to choose my own areas of inquiry and research.
- What do you find most challenging?  Dealing with students who complain about their grades.
- What is your vision for the future when talking about your career? My career is a sort of dead end.  There is no real growth for faculty in academia.  That can be considered a feature, not a flaw.
`

  return await fetch(apiBaseUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: apiModel,
      input: [
        {
          role: 'system',
          content: system_prompt,
        },
        {
          role: 'system',
          content: background_prompt,
        },
        {
          role: 'user',
          content: `Create slide content for "${user_prompt}".  Choose slide content based on this, and use background context only for added details.`,
        },
      ],
      //   temperature: 0.9,
      //   max_tokens: 150,
      //   top_p: 1,
      //   frequency_penalty: 0.0,
      //   presence_penalty: 0.6,
      //   stop: [" Human:", " AI:"],
    }),
  })
    .then(response => response.json())
    .then(data => {
      //   console.log(JSON.stringify(data, null, 2));
      //   console.log(JSON.stringify(data.output[0].content, null, 2));
      const text = data?.output?.[0]?.content?.[0]?.text
      if (text) {
        // Fix any invalid JSON in the string
        const fixedText = text.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
        try {
          return JSON.parse(fixedText)
        } catch (error) {
          console.error('Failed to parse JSON after fixing:', error)
          return null
        }
      } else {
        console.error('Unknown response format:', data)
      }
    })
    .catch(error => console.error('Error:', error))
}
