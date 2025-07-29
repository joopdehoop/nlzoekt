const Parser = require('rss-parser');
const fs = require('fs');
const db = require('./db/init');
const settings = require('./settings');

const parser = new Parser();

async function importFeeds(force = false) {
  try {
    let feedsData = JSON.parse(fs.readFileSync('./feeds.json', 'utf8'));
    let totalImported = 0;
    const now = new Date();
    const cacheIntervalMinutes = settings.getRssCacheIntervalMinutes();
    const cacheIntervalAgo = new Date(now.getTime() - (cacheIntervalMinutes * 60 * 1000));
    let feedsToUpdate = [];
    
    console.log(`Starting import of ${feedsData.length} feeds${force ? ' (forced rescrape)' : ''}...`);
    
    for (const [index, feedConfig] of feedsData.entries()) {
      try {
        const lastScraped = feedConfig.lastScraped ? new Date(feedConfig.lastScraped) : null;
        
        if (!force && lastScraped && lastScraped > cacheIntervalAgo) {
          console.log(`Skipping ${feedConfig.medium} (last scraped ${((now - lastScraped) / (1000 * 60)).toFixed(0)} minutes ago, cache interval: ${cacheIntervalMinutes} min)`);
          continue;
        }
        
        console.log(`Importing from ${feedConfig.medium} (${feedConfig.region})...`);
        
        const feed = await parser.parseURL(feedConfig.url);
        let imported = 0;
        
        for (const item of feed.items) {
          const article = {
            title: item.title,
            content: item.contentSnippet || item.content || '',
            link: item.link,
            pubDate: item.pubDate || item.isoDate,
            medium: feedConfig.medium,
            region: feedConfig.region
          };
          
          const wasAdded = await db.addArticle(article);
          if (wasAdded) {
            imported++;
            totalImported++;
          }
        }
        
        feedsData[index].lastScraped = now.toISOString();
        feedsToUpdate.push(index);
        
        console.log(`  ${imported} new articles imported from ${feedConfig.medium}`);
        
      } catch (error) {
        console.error(`Error importing from ${feedConfig.medium}: ${error.message}`);
      }
    }
    
    if (feedsToUpdate.length > 0) {
      fs.writeFileSync('./feeds.json', JSON.stringify(feedsData, null, 2));
      console.log(`Updated lastScraped timestamp for ${feedsToUpdate.length} feeds`);
    }
    
    console.log(`Import completed. Total new articles: ${totalImported}`);
    
    const stats = await db.getStats();
    console.log(`Database now contains ${stats.totalArticles} articles total`);
    
  } catch (error) {
    console.error('Error during import:', error.message);
  }
}

module.exports = importFeeds;