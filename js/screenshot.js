function takeScreenshot() {
  const screenshotsDir = './screenshots' // change to whatever
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  canvas.width = document.body.clientWidth
  canvas.height = document.body.clientHeight
  context.drawImage(document.body, 0, 0, canvas.width, canvas.height)

  canvas.toBlob(blob => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${screenshotsDir}/screenshot-${timestamp}.png`

    // Save the screenshot to the screenshots directory
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = fileName
    a.click()
  }, 'image/png')
}
