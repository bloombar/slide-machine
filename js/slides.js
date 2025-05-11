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

  document.title = `${title} - ${byline} | Slide machine`
}

function createNewSlide(user_prompt, className = '') {
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
    // if a custom class name is specified, apply it to the .slide element
    if (className) {
      slideEl.classList.add(className)
    }

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

    // decide which image to show
    let imgUrl = ''
    let imgCaption = ''

    // load any images saved in local storage
    const savedImages = JSON.parse(localStorage.getItem('images')) || {}
    const imageKeys = Object.keys(savedImages)

    // Check if any saved image's caption contains the topic identified by OpenAI
    if (openAIResponse.topic) {
      const matchingImageKeys = imageKeys.filter(
        key =>
          savedImages[key].caption &&
          savedImages[key].caption
            .toLowerCase()
            .includes(openAIResponse.topic.toLowerCase())
      )
      if (matchingImageKeys.length > 0) {
        const randomMatchingKey =
          matchingImageKeys[
            Math.floor(Math.random() * matchingImageKeys.length)
          ]
        imgUrl = savedImages[randomMatchingKey].url
        imgCaption = savedImages[randomMatchingKey].caption
        console.log(
          `Using local storage image with matching caption: ${randomMatchingKey} - '${savedImages[randomMatchingKey].caption}'`
        )
      }
    }

    // get Wikipedia thumbnail image or random image
    if (!imgUrl && openAIResponse.topic && openAIResponse.topic !== lastTopic) {
      imgUrl = await getThumbnailImage(openAIResponse.topic)
      console.log(
        `Wikipedia '${openAIResponse.topic}' page thumbnail image: ${imgUrl}`
      )
    }

    // if no image set yet, we need to pick something random
    const useLocalImage = Math.random() < env.LOCAL_IMAGE_CHANCE // 50% chance to use local image

    if (!imgUrl && useLocalImage) {
      const savedImages = JSON.parse(localStorage.getItem('images')) || {}
      const imageKeys = Object.keys(savedImages)
      if (imageKeys.length > 0) {
        const randomImageKey =
          imageKeys[Math.floor(Math.random() * imageKeys.length)]
        imgUrl = savedImages[randomImageKey].url
        imgCaption = savedImages[randomImageKey].caption
        console.log(
          `Using local storage image ${randomImageKey} - '${imgCaption}'`
        )
      }
    }

    // if no image set yet, get a random image
    if (!imgUrl) {
      console.log('No thumbnail image found for the topic.')
      imgUrl = 'https://picsum.photos/400?random=' + Math.random()
    }

    // create an image element and add to the .slide-image container
    const imageEl = document.createElement('img')
    imageEl.src = imgUrl
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
