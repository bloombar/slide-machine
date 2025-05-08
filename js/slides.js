let lastTopic = '' // keep track of each topic
let lastTitle = ''

function updateStartSlide() {
  const title = localStorage.getItem('presentation-title')
  const byline = localStorage.getItem('presentation-byline')
  const description = localStorage.getItem('presentation-description')
  const titleEl = document.querySelector('.presentation-text-title')
  const bylineEl = document.querySelector('.presentation-text-byline')
  // const descriptionEl = document.querySelector('.presentation-text-description')
  titleEl.innerText = title
  bylineEl.innerText = byline
  // descriptionEl.innerText = description
}

function createNewSlide(user_prompt) {
  if (!user_prompt) {
    console.log('No user prompt content to process.')
    return
  }

  // check if the last spoken content is the same as the last topic
  ;(async () => {
    const openAIResponse = await getOpenAIResponse(
      env.OPENAI_API_BASE,
      env.OPENAI_MODEL,
      env.OPENAI_API_KEY,
      system_prompt,
      summary_prompt,
      user_prompt,
      env.OPENAI_HISTORY_DEPTH
    )
    // console.log(`openAIResponse: ${JSON.stringify(openAIResponse, null, 2)}`);

    // ignore titles that are the same
    if (!openAIResponse.title || openAIResponse.title === lastTitle) {
      return
    }

    // get the slide container
    const slideContainerEl = document.querySelector('.slides')

    // remove any previous slides from the visible screen
    // const existingSlides = slideContainerEl.querySelectorAll('.slide')
    // existingSlides.forEach(slide => slide.classList.add('hidden'))

    // create a new slide on the screen
    const slideEl = document.createElement('article')
    slideEl.classList.add('slide')

    // create two child elements: .slide-text and .slide-image
    const slideTextEl = document.createElement('div')
    slideTextEl.classList.add('slide-text')
    const slideImageEl = document.createElement('div')
    slideImageEl.classList.add('slide-image')

    // make updates to the slides
    if (openAIResponse.summary) {
      summary_prompt = openAIResponse.summary
      console.log(`OpenAI Summary: ${summary_prompt}`)
    }
    if (openAIResponse.title) {
      const headingEl = document.createElement('h2')
      headingEl.textContent = openAIResponse.title
      slideTextEl.appendChild(headingEl)
    }
    if (openAIResponse.intro) {
      const paragraphEl = document.createElement('p')
      paragraphEl.textContent = openAIResponse.intro
      slideTextEl.appendChild(paragraphEl)
    }
    if (Array.isArray(openAIResponse.list) && openAIResponse.list.length > 0) {
      const listEl = document.createElement('ul')
      openAIResponse.list.forEach(item => {
        const listItemEl = document.createElement('li')
        listItemEl.textContent = item
        listEl.appendChild(listItemEl)
      })
      slideTextEl.appendChild(listEl)
    }

    // add slide to container
    slideEl.appendChild(slideTextEl)
    slideEl.appendChild(slideImageEl)
    slideContainerEl.appendChild(slideEl)

    // get Wikipedia thumbnail image or random image
    let imageUrl = ''
    if (openAIResponse.topic && openAIResponse.topic !== lastTopic) {
      imageUrl = await getThumbnailImage(openAIResponse.topic)
      console.log(
        `Wikipedia '${openAIResponse.topic}' page thumbnail image: ${imageUrl}`
      )
    } else {
      console.log('No new topic.')
    }

    // if no image set yet, get a random image
    if (!imageUrl) {
      console.log('No thumbnail image found for the topic.')
      imageUrl = 'https://picsum.photos/400?random=' + Math.random()
    }

    // create an image element and add to the .slide-image container
    const imageEl = document.createElement('img')
    imageEl.src = imageUrl
    imageEl.alt = openAIResponse.topic
    slideImageEl.appendChild(imageEl)

    // keep track of this topic and title to compare to next slide
    lastTopic = openAIResponse.topic
    lastTitle = openAIResponse.title

    // scroll to top of the last .slide element in the .slides container
    const lastSlide = slideContainerEl.querySelector('.slide:last-child')
    lastSlide.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    })
  })()
}
