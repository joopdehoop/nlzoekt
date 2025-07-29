const express = require('express');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const db = require('./db/init');
const importFeeds = require('./importer');
const settings = require('./settings');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize database
(async () => {
  await db.init();
})();

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];
  
  if (username === 'admin' && process.env.ADMIN_PASSWORD_HASH && bcrypt.compareSync(password, process.env.ADMIN_PASSWORD_HASH)) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    return res.status(401).send('Invalid credentials');
  }
}

app.get('/admin', requireAuth, (req, res) => {
  try {
    const feeds = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));
    const currentSettings = settings.getSettings();
    res.render('admin', { 
      feeds: feeds, 
      currentSettings: currentSettings 
    });
  } catch (error) {
    res.status(500).send('Error loading feeds: ' + error.message);
  }
});

app.post('/admin/feeds', requireAuth, (req, res) => {
  try {
    const feeds = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));
    const newFeed = {
      medium: req.body.medium,
      region: req.body.region,
      url: req.body.url || null,
      lastScraped: null
    };
    feeds.push(newFeed);
    fs.writeFileSync(path.join(__dirname, 'feeds.json'), JSON.stringify(feeds, null, 2));
    res.redirect('/admin');
  } catch (error) {
    res.status(500).send('Error adding feed: ' + error.message);
  }
});

app.post('/admin/feeds/:index', requireAuth, (req, res) => {
  try {
    const feeds = JSON.parse(fs.readFileSync(path.join(__dirname, 'feeds.json'), 'utf8'));
    const index = parseInt(req.params.index);
    
    if (req.body._method === 'DELETE') {
      feeds.splice(index, 1);
    } else if (req.body._method === 'PUT') {
      feeds[index] = {
        medium: req.body.medium,
        region: req.body.region,
        url: req.body.url || null,
        lastScraped: feeds[index].lastScraped || null
      };
    }
    
    fs.writeFileSync(path.join(__dirname, 'feeds.json'), JSON.stringify(feeds, null, 2));
    res.redirect('/admin');
  } catch (error) {
    res.status(500).send('Error updating feed: ' + error.message);
  }
});

app.post('/admin/settings', requireAuth, (req, res) => {
  try {
    const newSettings = {
      rssCacheIntervalMinutes: parseInt(req.body.rssCacheIntervalMinutes) || 60,
      keywordCachingEnabled: req.body.keywordCachingEnabled === 'on'
    };
    
    settings.updateSettings(newSettings);
    res.redirect('/admin');
  } catch (error) {
    res.status(500).send('Error updating settings: ' + error.message);
  }
});

app.post('/admin/prompts', requireAuth, (req, res) => {
  try {
    const currentSettings = settings.getSettings();
    const newSettings = {
      ...currentSettings,
      openaiPrompts: {
        systemPrompt: req.body.systemPrompt || '',
        userPrompt: req.body.userPrompt || ''
      }
    };
    
    settings.updateSettings(newSettings);
    res.redirect('/admin');
  } catch (error) {
    res.status(500).send('Error updating prompts: ' + error.message);
  }
});


// homepage
app.get('/', async (req, res) => {
  try {
    const query = req.query.q || '';
    const medium = req.query.medium || '';
    const region = req.query.region || '';
    const dateFrom = req.query.date_from || '';
    const dateTo = req.query.date_to || '';
    
    const filters = {};
    if (medium) filters.medium = medium;
    if (region) filters.region = region;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;
    
    let articles;
    let trendingArticles = null;
    console.error('getting trendy articles');
    trendingArticles = await db.getTrendingArticlesForHomepage();
    
	// If no search query (or empty query) and no filters, show trending articles
    if ((!query || query.trim() === '') && !medium && !region && !dateFrom && !dateTo) {
	  articles = trendingArticles.map(ta => ta.article);
    } else {
      articles = await db.searchArticles(query, filters);
    }
    
    const stats = await db.getStats();
    
    res.render('index', {
      articles,
      trendingArticles,
      query,
      filters: { medium, region, dateFrom, dateTo },
      stats,
      results: articles.length
    });
  } catch (error) {
    console.error('Error in search:', error);
    res.status(500).send('Er is een fout opgetreden bij het zoeken');
  }
});

app.get('/import', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    await importFeeds(force);
    res.json({ success: true, message: force ? 'Forced rescrape voltooid' : 'Import voltooid' });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ success: false, message: 'Import gefaald: ' + error.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

app.get('/trending', async (req, res) => {
  try {
    const path = require('path');
    const TRENDING_CACHE_FILE = path.join(__dirname, 'db', 'trending_keywords_cache.json');
    
    if (fs.existsSync(TRENDING_CACHE_FILE)) {
      const cacheData = JSON.parse(fs.readFileSync(TRENDING_CACHE_FILE, 'utf8'));
      res.json({
        success: true,
        timestamp: cacheData.timestamp,
        keywords: cacheData.keywords || [],
        articles: cacheData.articles || []
      });
    } else {
      res.json({
        success: false,
        error: 'No trending data available',
        keywords: [],
        articles: []
      });
    }
  } catch (error) {
    console.error('Error reading trending cache:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to read trending data',
      keywords: [],
      articles: []
    });
  }
});

// Check if URL is archived in archive.today
app.get('/archive/check/:url', async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    // Try to fetch from archive.today with common domains
    const domains = ['archive.today', 'archive.is', 'archive.vn', 'archive.ph'];
    
    for (const domain of domains) {
      try {
        const checkResponse = await fetch(`https://${domain}/timemap/json/${encodeURIComponent(url)}`, {
          headers: { 'User-Agent': 'NL-Zoekt-Archiver/1.0' },
          timeout: 5000
        });
        
        if (checkResponse.ok) {
          const checkData = await checkResponse.json();
          if (checkData && checkData.length > 1) {
            // Get the most recent archive
            const latest = checkData[checkData.length - 1];
            res.json({ 
              archived: true, 
              archiveUrl: latest[1] // URL is in second position
            });
            return;
          }
        }
      } catch (domainError) {
        continue; // Try next domain
      }
    }
    
    res.json({ archived: false });
  } catch (error) {
    console.error('Archive check error:', error);
    res.status(500).json({ error: 'Failed to check archive status' });
  }
});

// Archive URL using archive.today API
app.post('/archive', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Try archive.today domains for submission
    const domains = ['archive.today', 'archive.is', 'archive.vn', 'archive.ph'];
    
    for (const domain of domains) {
      try {
        const archiveResponse = await fetch(`https://${domain}/submit/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'NL-Zoekt-Archiver/1.0'
          },
          body: `url=${encodeURIComponent(url)}`
        });

        if (archiveResponse.ok || archiveResponse.status === 302) {
          // Wait for archive.today to process
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Check if archived by trying to get timemap
          const checkResponse = await fetch(`https://${domain}/timemap/json/${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'NL-Zoekt-Archiver/1.0' }
          });
          
          if (checkResponse.ok) {
            const checkData = await checkResponse.json();
            if (checkData && checkData.length > 1) {
              const latest = checkData[checkData.length - 1];
              res.json({ 
                success: true, 
                archiveUrl: latest[1]
              });
              return;
            }
          }
          
          // Fallback to search URL
          res.json({ 
            success: true, 
            archiveUrl: `https://${domain}/${url}` 
          });
          return;
        }
      } catch (domainError) {
        continue; // Try next domain
      }
    }
    
    throw new Error('All archive.today domains failed');
  } catch (error) {
    console.error('Archive error:', error);
    res.status(500).json({ error: 'Failed to archive URL' });
  }
});

cron.schedule('*/30 * * * *', () => {
  console.log('Starting scheduled feed import...');
  importFeeds();
});

// Daily cleanup of old articles at 2 AM
cron.schedule('0 2 * * *', async () => {
  console.log('Starting daily cleanup of articles older than 31 days...');
  try {
    const { cleanupOldArticles } = require('./db/init');
    await cleanupOldArticles();
  } catch (error) {
    console.error('Error during daily cleanup:', error);
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`NL Zoekt server draait op http://localhost:${PORT}`);
  console.log('Import feeds handmatig via: http://localhost:' + PORT + '/import');
  
  console.log('Starting initial import...');
  await importFeeds();
  
  console.log('Initializing trending articles...');
  try {
    await db.getTrendingArticles();
    console.log('Trending articles initialized');
  } catch (error) {
    console.error('Error initializing trending articles:', error);
  }
});
