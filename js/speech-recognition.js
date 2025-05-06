//   const startRecordingButton = document.getElementById("startRecording");

let subtitleTimeout
let slowdownTimeout
let lastTopic = ''
let lastSpokenContent = ''

function resetSubtitles() {
  const subtitlesText = document.querySelector('.subtitles-text')
  subtitlesText.textContent = '\u00A0' // Non-breaking space
}

function startSubtitleTimeout() {
  clearTimeout(subtitleTimeout)
  subtitleTimeout = setTimeout(resetSubtitles, env.CLEAR_SUBTITLES_AFTER)
}
//   const stopRecordingButton = document.getElementById("stopRecording");
//   const downloadLink = document.getElementById("downloadLink");

//   let mediaRecorder;
//   let recordedChunks = [];

async function startStream(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: true,
    })
    //   videoEl.srcObject = stream;

    // handle audio
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)()
    const speechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (speechRecognition) {
      console.log('Speech recognition is supported.')
      const recognition = new speechRecognition()
      recognition.continuous = true
      recognition.interimResults = false
      recognition.lang = 'en-US'

      const subtitlesContainer = document.querySelector('.subtitles-container')
      const subtitlesText = subtitlesContainer.querySelector('.subtitles-text')

      recognition.onend = () => {
        console.log('Speech recognition ended.')
        recognition.start() // don't end!
        //   startSubtitleTimeout();
      }
      recognition.onstart = () => {
        console.log('Speech recognition started.')
        //   startSubtitleTimeout();
      }
      recognition.onnomatch = event => {
        console.log('Speech recognition did not match any results.')
      }
      recognition.onsoundstart = () => {
        console.log('Sound detected.')
      }
      recognition.onsoundend = () => {
        console.log('Sound ended.')
      }
      recognition.onspeechstart = () => {
        console.log('Speech detected.')
      }
      recognition.onspeechend = () => {
        console.log('Speech ended.')
      }
      recognition.onresult = event => {
        //   const transcript = event.results[0][0].transcript;
        const result = event.results[event.results.length - 1][0] // get latest result
        console.log(
          `Transcript: ${result.transcript}\nConfidence: ${result.confidence}`
        )
        const subtitlesText = document.querySelector('.subtitles-text')
        subtitlesText.textContent = result.transcript
        subtitlesText.scrollTop = subtitlesText.scrollHeight
        startSubtitleTimeout()

        // append to the last spoken content since we fetched an AI response
        lastSpokenContent += result.transcript + ' '

        // get OpenAI response based on last spoken content
        if (!slowdownTimeout) {
          ;(async () => {
            const openAIResponse = await getOpenAIResponse(
              env.OPENAI_API_BASE,
              env.OPENAI_MODEL,
              env.OPENAI_API_KEY,
              lastSpokenContent
            )
            // console.log(`openAIResponse: ${JSON.stringify(openAIResponse, null, 2)}`);

            // remove last spoken content from queue
            lastSpokenContent = ''

            // remove any previous slides from the screen
            const existingSlides = document.querySelectorAll('.slide')
            existingSlides.forEach(slide => slide.remove())

            // get the container
            const slideContainerEl = document.querySelector('.slides')

            // create a new slide on the screen
            const slideEl = document.createElement('article')
            slideEl.classList.add('slide')

            if (openAIResponse.title) {
              const headingEl = document.createElement('h2')
              headingEl.textContent = openAIResponse.title
              slideEl.appendChild(headingEl)
            }

            if (openAIResponse.intro) {
              const paragraphEl = document.createElement('p')
              paragraphEl.textContent = openAIResponse.intro
              slideEl.appendChild(paragraphEl)
            }

            if (
              Array.isArray(openAIResponse.list) &&
              openAIResponse.list.length > 0
            ) {
              const listEl = document.createElement('ul')
              openAIResponse.list.forEach(item => {
                const listItemEl = document.createElement('li')
                listItemEl.textContent = item
                listEl.appendChild(listItemEl)
              })
              slideEl.appendChild(listEl)
            }

            // add slide to container
            slideContainerEl.appendChild(slideEl)

            // get Wikipedia thumbnail image
            if (openAIResponse.topic) {
              const topicThumbnailImageUrl = await getThumbnailImage(
                openAIResponse.topic
              )
              console.log(
                `Wikipedia '${openAIResponse.topic}' page thumbnail image: ${topicThumbnailImageUrl}`
              )
              if (topicThumbnailImageUrl) {
                // remove any existing images
                const existingImages =
                  document.querySelectorAll('.topic-thumbnail')
                existingImages.forEach(image => image.remove())

                // add a new image
                const imageEl = document.createElement('img')
                imageEl.src = topicThumbnailImageUrl
                imageEl.alt = 'Topic Thumbnail'
                imageEl.classList.add('topic-thumbnail') // Optional: Add a class for styling

                // add image to container
                const containerEl = document.querySelector('.container')
                containerEl.appendChild(imageEl)
              } else {
                console.log('No thumbnail image found for the topic.')

                // remove any existing images
                const existingImages =
                  document.querySelectorAll('.topic-thumbnail')
                existingImages.forEach(image => image.remove())

                // add a random image
                const randomImageUrl = 'https://picsum.photos/400'
                const imageEl = document.createElement('img')
                imageEl.src = randomImageUrl
                imageEl.alt = 'Topic Thumbnail'
                imageEl.classList.add('topic-thumbnail') // Optional: Add a class for styling

                // add image to container
                const containerEl = document.querySelector('.container')
                containerEl.appendChild(imageEl)
              }
            } else {
              console.log('No topic found in the OpenAI response.')
            }
          })()

          // Prevent running this part more than once every 5 seconds
          slowdownTimeout = setTimeout(() => {
            clearTimeout(slowdownTimeout)
            slowdownTimeout = null
            console.log('Resetting slowdownTimeout')
          }, env.PAUSE_BETWEEN_SLIDES)
        }

        //   takeScreenshot();
      }

      recognition.onerror = event => {
        console.error('Speech recognition error:', event.error)
      }

      recognition.start()
    } else {
      console.warn('Speech recognition not supported in this browser.')
    }

    //   mediaRecorder = new MediaRecorder(stream);
    //   mediaRecorder.ondataavailable = (event) => {
    //     if (event.data.size > 0) {
    //       recordedChunks.push(event.data);
    //     }
    //   };

    //   mediaRecorder.onstop = () => {
    //     const blob = new Blob(recordedChunks, { type: "video/webm" });
    //     const url = URL.createObjectURL(blob);
    //     downloadLink.href = url;
    //     downloadLink.download = "recording.webm";
    //     downloadLink.style.display = "block";
    //   };
  } catch (error) {
    console.error('Error accessing media devices.', error)
  }
}

//   startRecordingButton.addEventListener("click", () => {
//     recordedChunks = [];
//     mediaRecorder.start();
//     startRecordingButton.disabled = true;
//     stopRecordingButton.disabled = false;
//   });

//   stopRecordingButton.addEventListener("click", () => {
//     mediaRecorder.stop();
//     startRecordingButton.disabled = false;
//     stopRecordingButton.disabled = true;
//   });
