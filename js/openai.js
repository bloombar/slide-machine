async function getOpenAIResponse(apiBaseUrl, apiModel, apiKey, user_prompt) {
  const system_prompt = `
You are an assistant creating a slide presentation for children in Ms. Glynn's 3rd grade class about what it's like to be a university professor of computer science.  
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
- Who or what inspired me to go into this profession? I ended up in this field somewhat accidentally by following my interests.  I found it fun to program when I was a kid, forgot about it, then rediscovered it again when I was in college.
- When growing up, was this your dream profession or field of study? I never had any dream profession.  I never really understood what a profession was and had no idea what I wanted to do or even how to think about that.
- Did certain passions or interests guide you towards this career? I learned to program computers when I was around 12 years old with help from my father.  I suppose being a bit of a homebody and introvert helped me.
- Who helped you along the way? My father introduced me to programming - he was an early adopter of computers at his workplace and in personal life, but I am mostly self-taught.  I only ever took one computer science class on artificial intelligence in college.  I am otherwise entirely self-taught.
- What type of education is needed and how long does it take to enter this career?  The traditional background would be to go to undergrad for computer science or math and then to graduate school and a PhD for the same.  However, I never studied computer science.  I studied neuroscience and psychology and later studied tech-related art and creativity, but I worked as a software engineer for many years before becoming a professor.
- How long were/have you been in this field? I've been a professor for 12 years.  Before becoming a professor, I worked as a software engineer and technology consultant for 15 years.  I started teaching at university part-time on weekends mostly because I found it interesting and pleasant to help people, which was different from my usual jobs work at the time.
- What do you enjoy about this profession the most? Faculty I work with are extremely smart and very nice.  Flexibilty. I have no boss.  I can choose my own areas of inquiry and research.  I decide what I do most days.  Continually thinking and learning are part of the job.  Did I mention not having a boss?!
- What do you find most challenging?  Dealing with students who complain about their grades.  Grading is really a challenge, because it is often unfair and somewhat arbitrary.  In some cases, we know that students who cheat to do perfect work get better grades than students who do their own imperfect work.
- What is your vision for the future when talking about your career? A professor's career is a sort of dead end.  There is no real room for growth for faculty in academia.  There is more room for growth in administration.  However, that means there is no really a "rat race" where people are constantly trying to get ahead, although that does happen in some cases.  Most people I work with are highly intelligent and very nice.
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
