const axios = require('axios');

async function searchDuckDuckGo(query) {
  try {
    const response = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        pretty: 1,
        no_html: 1,
        skip_disambig: 1
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    console.log('=== DuckDuckGo Search Results for:', query, '===\n');
    
    if (response.data.AbstractText) {
      console.log('Abstract:', response.data.AbstractText);
      console.log('Source:', response.data.AbstractSource);
      console.log('URL:', response.data.AbstractURL);
      console.log('\n');
    }

    if (response.data.RelatedTopics && response.data.RelatedTopics.length > 0) {
      console.log('Related Topics:');
      response.data.RelatedTopics.slice(0, 5).forEach((topic, index) => {
        if (topic.Text) {
          console.log(`${index + 1}. ${topic.Text}`);
          if (topic.FirstURL) {
            console.log(`   URL: ${topic.FirstURL}`);
          }
        }
      });
    }

    return response.data;
  } catch (error) {
    console.error('Error searching DuckDuckGo:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

searchDuckDuckGo('pizza')
  .then(() => {
    console.log('\n=== Search completed successfully ===');
  })
  .catch((error) => {
    console.error('\n=== Search failed ===');
    process.exit(1);
  });
