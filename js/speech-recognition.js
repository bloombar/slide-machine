//   const startRecordingButton = document.getElementById("startRecording");

// let subtitleTimeout
let slowdownTimeout
let lastSpokenContent = ''
let presenting = false
let slideLayoutClass = 'image-right' // alternatives are 'image-left' and 'image-behind'
let slideCounter = 0

// function resetSubtitles() {
//   const subtitlesText = document.querySelector('.subtitles-text')
//   subtitlesText.textContent = '\u00A0' // Non-breaking space
// }

// function startSubtitleTimeout() {
//   clearTimeout(subtitleTimeout)
//   subtitleTimeout = setTimeout(resetSubtitles, env.CLEAR_SUBTITLES_AFTER)
// }
//   const stopRecordingButton = document.getElementById("stopRecording");
//   const downloadLink = document.getElementById("downloadLink");

//   let mediaRecorder;
//   let recordedChunks = [];
function stopStream() {
  presenting = false // unset the flag
}
async function startStream(/*videoEl*/) {
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
      presenting = true
      console.log('Speech recognition is supported.')
      const recognition = new speechRecognition()
      recognition.continuous = true
      recognition.interimResults = false
      recognition.lang = 'en-US'

      // const subtitlesContainer = document.querySelector('.subtitles-container')
      // const subtitlesText = subtitlesContainer.querySelector('.subtitles-text')

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
        if (!presenting) return // don't process results if not presenting
        //   const transcript = event.results[0][0].transcript;
        const result = event.results[event.results.length - 1][0] // get latest result
        console.log(
          `Transcript: ${result.transcript}\nConfidence: ${result.confidence}`
        )
        // const subtitlesText = document.querySelector('.subtitles-text')
        // subtitlesText.textContent = result.transcript
        // subtitlesText.scrollTop = subtitlesText.scrollHeight
        // startSubtitleTimeout()

        // append to the last spoken content since we fetched an AI response
        lastSpokenContent += result.transcript + ' '

        // get OpenAI response based on last spoken content, along with system and historic prompt summary
        if (!slowdownTimeout) {
          // create a new slide
          createNewSlide(lastSpokenContent, slideLayoutClass)
          slideCounter++
          lastSpokenContent = '' // reset the last spoken content
          slideLayoutClass =
            slideLayoutClass === 'image-right' ? 'image-left' : 'image-right' // alternative layouts each slide
          if (slideCounter % env.VARY_LAYOUT_EVERY == 0) {
            slideLayoutClass = 'image-behind' // every 5th slide, use this layout
          }

          // Prevent running this part more than once every 5 seconds
          slowdownTimeout = setTimeout(() => {
            // create a new slide, in case there's spoken content that has not yet been processed
            slideCounter++
            createNewSlide(lastSpokenContent, slideLayoutClass).then(() => {
              // reset the timeout
              clearTimeout(slowdownTimeout)
              slowdownTimeout = null
              console.log('Resetting slowdownTimeout')
            })
            lastSpokenContent = '' // reset the last spoken content
            slideLayoutClass =
              slideLayoutClass === 'image-right' ? 'image-left' : 'image-right' // alternative layouts each slide
            if (slideCounter % env.VARY_LAYOUT_EVERY == 0) {
              slideLayoutClass = 'image-behind' // every 5th slide, use this layout
            }
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
