const getThumbnailImage = async topic => {
  var params = {
    action: 'query',
    prop: 'pageimages',
    titles: topic,
    format: 'json',
    pithumbsize: 500, // Set the thumbnail size as needed
  }

  var url = 'https://en.wikipedia.org/w/api.php'
  url += '?origin=*'
  Object.keys(params).forEach(function (key) {
    url += '&' + key + '=' + encodeURIComponent(params[key])
  })

  // return a random page image, if available
  return await fetch(url)
    .then(response => response.json())
    .then(response => {
      const pages = response.query.pages
      //   console.log(`Pages: ${JSON.stringify(pages, null, 2)}`)
      const arrPages = Object.keys(pages).map(key => pages[key])
      arrPages.forEach(page => {
        console.log(`Wikipedia page data: ${JSON.stringify(page, null, 2)}`)
      })

      // select a random page if multiple
      const randomPage = arrPages[Math.floor(Math.random() * arrPages.length)]
      return randomPage.thumbnail ? randomPage.thumbnail.source : null
    })
    .catch(error => {
      console.error('Error retrieving wikipedia page thumbnail image:', error)
      return null
    })
}
