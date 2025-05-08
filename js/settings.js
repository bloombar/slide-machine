window.addEventListener('load', () => {
  const openSettingsIcon = document.getElementById('open-settings-icon')
  const closeSettingsIcon = document.getElementById('close-settings-icon')

  const settingsScreen = document.getElementById('settings-screen')
  const closeSettings = document.getElementById('close-settings')

  // open settings panel
  openSettingsIcon.addEventListener('click', () => {
    settingsScreen.style.display =
      settingsScreen.style.display === 'none' ? 'block' : 'none'
  })

  // close settings panel
  closeSettings.addEventListener('click', e => {
    settingsScreen.style.display = 'none'
    document.querySelector('.settings-form').submit()
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
})
