window.addEventListener('load', () => {
  const openSettingsIcon = document.getElementById('open-settings-icon')
  // const closeSettingsIcon = document.getElementById('close-settings-icon')

  const settingsScreen = document.getElementById('settings-screen')
  // const closeSettings = document.getElementById('close-settings')

  // // close settings panel
  // closeSettings.addEventListener('click', e => {
  //   settingsScreen.style.display = 'none'
  //   document.querySelector('.settings-form').submit()
  // })

  // hide settings panel when clicking outside of it
  document.addEventListener('click', e => {
    if (!settingsScreen.contains(e.target) && e.target !== openSettingsIcon) {
      if (settingsScreen.style.display === 'block') {
        settingsScreen.style.display = 'none'
        document.querySelector('.settings-form').submit()
      }
    }
  })

  // open settings panel
  openSettingsIcon.addEventListener('click', e => {
    if (settingsScreen.style.display === 'block') {
      settingsScreen.style.display = 'none'
      document.querySelector('.settings-form').submit()
    } else {
      settingsScreen.style.display = 'block'
    }
    e.stopPropagation()
  })

  // when any of the form field inputs are changed, save the new value in local storage with the same name as the field
  const formFields = document.querySelectorAll(
    '.settings-form input, .settings-form textarea'
  )
  formFields.forEach(field => {
    // console.log(`Adding change listener to: ${field.name}`)
    field.addEventListener('change', e => {
      const fieldName = field.name
      const fieldValue = field.value
      localStorage.setItem(fieldName, fieldValue)
      console.log(`Saved ${fieldName} to local storage: ${fieldValue}`)
    })
  })
  // load settings from local storage
  formFields.forEach(field => {
    const fieldName = field.name
    const savedValue = localStorage.getItem(fieldName)
    if (savedValue) {
      field.value = savedValue
      field.dispatchEvent(new Event('input'))
      //   console.log(`Loaded ${fieldName} from local storage: ${savedValue}`)
    }
  })

  /* BEGIN IMAGE UPLOAD */
  const dropZone = document.getElementById('drop-zone')
  const fileInput = document.getElementById('file-input')
  const imageThumbnails = document.getElementById('image-thumbnails')

  dropZone.addEventListener('click', () => fileInput.click())

  dropZone.addEventListener('dragover', e => {
    e.preventDefault()
    dropZone.classList.add('drag-over')
  })

  dropZone.addEventListener('dragleave', () =>
    dropZone.classList.remove('drag-over')
  )

  dropZone.addEventListener('drop', e => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    handleFiles(e.dataTransfer.files)
  })

  function createImageThumbnail(imageId, url, caption) {
    const thumbnail = document.createElement('div')
    thumbnail.classList.add('thumbnail')
    thumbnail.innerHTML = `
                <img src="${url}" alt="Uploaded Image" />
                <input type="text" placeholder="Enter caption" class="caption-input" value="${caption}" />
            `
    const captionInput = thumbnail.querySelector('.caption-input')
    captionInput.addEventListener('input', () => {
      saveCaptionToLocalStorage(imageId, captionInput.value)
    })
    const deleteButton = document.createElement('button')
    deleteButton.classList.add('delete-button')
    deleteButton.textContent = 'Delete'
    deleteButton.addEventListener('click', () => {
      thumbnail.remove()
      deleteImageFromLocalStorage(imageId)
    })
    thumbnail.appendChild(deleteButton)

    thumbnail.addEventListener('mouseenter', () => {
      deleteButton.style.display = 'block'
    })

    thumbnail.addEventListener('mouseleave', () => {
      deleteButton.style.display = 'none'
    })
    return thumbnail
  }

  // Load images from local storage and display their thumbnails
  const savedImages = JSON.parse(localStorage.getItem('images')) || {}
  Object.entries(savedImages).forEach(([imageId, { url, caption }]) => {
    const thumbnail = createImageThumbnail(imageId, url, caption)
    imageThumbnails.appendChild(thumbnail)
  })

  function deleteImageFromLocalStorage(id) {
    const images = JSON.parse(localStorage.getItem('images')) || {}
    delete images[id]
    localStorage.setItem('images', JSON.stringify(images))
  }

  fileInput.addEventListener('change', () => handleFiles(fileInput.files))

  function handleFiles(files) {
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onload = () => {
          const imageUrl = reader.result
          const imageId = `image-${Date.now()}`
          saveImageToLocalStorage(imageId, imageUrl)

          const thumbnail = createImageThumbnail(imageId, imageUrl, '')
          imageThumbnails.appendChild(thumbnail)
        }
        reader.readAsDataURL(file)
      }
    })
  }

  function saveImageToLocalStorage(id, url) {
    const images = JSON.parse(localStorage.getItem('images')) || {}
    images[id] = { url, caption: '' }
    localStorage.setItem('images', JSON.stringify(images))
  }

  function saveCaptionToLocalStorage(id, caption) {
    console.log(`Saving caption for image ${id}: ${caption}`)
    const images = JSON.parse(localStorage.getItem('images')) || {}
    if (images[id]) {
      images[id].caption = caption
      localStorage.setItem('images', JSON.stringify(images))
    }
  }
  /* END IMAGE UPLOAD */
}) // end of window load event
