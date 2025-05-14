# Slide Machine

[View online](https://bloombar.github.io/slide-machine/)

## Description

Research suggests that slide presentations are an ineffective medium for learning. Yet virtually all teachers spend inumerable hours preparing and refining slides. Those who do not make their own slides usually use preprepared slides made by others, turning lectures into a kind of performative karaoke, parroting the words of others, restricting freedom of speech. Students have come to expect this as normal, to the great detriment of education.

This **slide machine** returns power to the educator! Now you can lecture or blather about whatever you want whenever you want, and the slides will follow. Just make sure your microphone is on and enabled in the web browser. It's a simple web app that will create slides in real-time based on whatever you choose to speak about.

## Usage

1. Open the [slide machine](https://bloombar.github.io/slide-machine/) in Google Chrome.
2. Open the settings by clicking the gear icon in the top right corner.
3. Enter an `OpenAI API key` (requires an [OpenAI API account](https://platform.openai.com/api-keys)).
4. (Optional) Enter your presentation's `title`, `byline`, and a short `description`.
5. (Optional) Upload any images you would like to use in the presentation, and label them with any relevant keywords. If you do not upload any images, the slide machine will find freely-accessible images for you.

## Requirements

- **OpenAI API Key**. You can get create an account and make an API key at [OpenAI](https://platform.openai.com/api-keys).
- **Google Chrome**, since Google only allows their own web browser to use their speech recognition API free of charge. Using a different browser would require paying for the transcription service.
- **Microphone**. The app depends upon speech-to-text conversion. So you will need a microphone to capture your speech.

## How it works

1. The slide machine uses the web browser's [SpeechRecognition API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) to listen to your speech and transcribe it to text every time you pause speaking.
2. Each phrase of that text is then packaged and sent to [OpenAI's API](https://platform.openai.com), where maching learning models are used to deconstruct the speech into its component parts, identifying the main topic of the phrase, and creating concise textual slide content to summarize the main points of your speech.
3. The slide machine then tries to match the speech to an image. If you have uploaded an image and labeled it with a matching term, one of your custom images will be used. Otherwise, the main topic of your speech will be used to search [Wikipedia's API](https://www.mediawiki.org/wiki/API:Main_page) for an image that corresponds with the topic. If no Wikipedia image is found for the topic, a random image is retrieved from [Picsum](https://picsum.photos/).
4. The image and the textual slide content are then combined to create a new slide, which is displayed on the screen. This process continues until you stop speaking.
5. At the end, you are welcome to save the presentation using the browser's `File`->`Save Page` functionality. This will save the presentation as a static `HTML` file. If you would prefer a `PDF`, you can use the browser's `Print` functionality to print to a `PDF` file.

Some settings can be tweaked in the `env.js` file, if self-hosting.

## Future work

The following are features that would be nice to implement, in case you feel the urge:

- A `Start/Stop` button... currently, it starts listening immediately on load.
- A `Pause/Resume` button... currently, you can simply pause speaking.
- Automatic hosting of the compelted presentation on a server with a unique URL.
- Easy post-production editing of slides.
- Export as Markdown + images.
- Retrofit the code to a simple front-end framework, perhaps [Svelte](https://svelte.dev/). Definitely not React.
- Refactor `js` files to be less interdependent.
- Allow user to create custom slide layouts... currently, it alternates among 3 different generic layouts.
- Allow alternatives to OpenAI's API, preferably free or low-cost.
