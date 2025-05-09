const getFlickrPhoto = async (FLICKR_API_KEY, searchTerm) => {
  //   const settings = {
  //     async: true,
  //     crossDomain: true,
  //     url: '&api_key=${FLICKR_API_KEY}&text=SEARCH_TERM&format=json&nojsoncallback=1',
  //     method: 'GET',
  //     headers: {},
  //   }

  const params = {
    // api_key: FLICKR_API_KEY,
    // text: searchTerm,
    tags: searchTerm.split(' ').join(','), // comma-separated list of terms
    tag_mode: 'all', // only exact matches for all tags
    format: 'json',
    nojsoncallback: 1,
    safe_search: 1,
    per_page: 50,
    method: 'GET',
  }

  var url = 'https://api.flickr.com/services/rest/?method=flickr.photos.search'
  url += '?origin=*'
  Object.keys(params).forEach(function (key) {
    url += '&' + key + '=' + encodeURIComponent(params[key])
  })

  // return a random page image, if available
  return await fetch(url)
    .then(response => response.json())
    .then(response => {
      console.log(`Flickr page data: ${JSON.stringify(response, null, 2)}`)
      const photos = response.photos
      photos.forEach(photo => {
        console.log(`Flickr photo data: ${JSON.stringify(photo, null, 2)}`)
        const farmId = photo.farm
        const serverId = photo.server
        const id = photo.id
        const secret = photo.secret
        // Construct the photo URL
        const photoUrl = `https://farm${farmId}.staticflickr.com/${serverId}/${id}_${secret}.jpg`
        console.log(`Flickr photo URL: ${photoUrl}`)
      })
    })
    .catch(error => {
      console.error('Error retrieving Flickr photos:', error)
      return null
    })
}

// getFlickrPhoto('YOUR_FLICKR_API_KEY', 'pink kitten')
