//   const startRecordingButton = document.getElementById("startRecording");

// let subtitleTimeout
let slowdownTimeout
let lastSpokenContent = ''
let presenting = false
let slideLayoutClass = 'image-right' // alternatives are 'image-left' and 'image-behind'
let slideCounter = 0

// const background_prompt = `
// The following is some background context about this user:
// - Who or what inspired me to go into this profession? I ended up in this field accidentally by following my interests.  I learned to program for fun when I was a kid, forgot about it, then rediscovered it again when I was in college.
// - When growing up, was this your dream profession or field of study? I never had any dream profession.  I never really understood what a profession was and had no idea what I wanted to do or even how to think about that.
// - Did certain passions or interests guide you towards this career? I learned to program computers when I was around 12 years old with help from my father.  I suppose being a bit of a homebody and introvert helped me.
// - Who helped you along the way? My father introduced me to programming - he was an early adopter of computers at his workplace and in personal life, but I am mostly self-taught.  I only ever took one computer science class on artificial intelligence in college.  I am otherwise entirely self-taught.
// - What type of education is needed and how long does it take to enter this career?  The traditional background would be to go to undergrad for computer science or math and then to graduate school and a PhD for the same.  However, I never studied computer science.  I studied neuroscience and psychology and later studied tech-related art and creativity, but I worked as a software engineer for many years before becoming a professor.
// - How long were/have you been in this field? I've been a professor for 12 years.  Before becoming a professor, I worked as a software engineer and technology consultant for 15 years.  I started teaching at university part-time on weekends mostly because I found it interesting and pleasant to help people, which was different from my usual jobs work at the time.
// - What do you enjoy about this profession the most? Faculty I work with are extremely smart and very nice.  Flexibilty. I have no boss.  I can choose my own areas of inquiry and research.  I decide what I do most days.  Continually thinking and learning are part of the job.  Did I mention not having a boss?!
// - What do you find most challenging?  Dealing with students who complain about their grades.  Grading is really a challenge, because it is often unfair and somewhat arbitrary.  In some cases, we know that students who cheat to do perfect work get better grades than students who do their own imperfect work.
// - What is your vision for the future when talking about your career? A professor's career is a sort of dead end.  There is no real room for growth for faculty in academia.  There is more room for growth in administration.  However, that means there is no really a "rat race" where people are constantly trying to get ahead, although that does happen in some cases.  Most people I work with are highly intelligent and very nice.
//`

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
            clearTimeout(slowdownTimeout)
            slowdownTimeout = null
            console.log('Resetting slowdownTimeout')
            // create a new slide, in case there's spoken content that has not yet been processed
            slideCounter++
            createNewSlide(lastSpokenContent, slideLayoutClass)
            lastSpokenContent = '' // reset the last spoken content
            slideLayoutClass =
              slideLayoutClass === 'image-right' ? 'image-left' : 'image-right' // alternative layouts each slide
            if (slideCounter % VARY_LAYOUT_EVERY == 0) {
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
