const express = require('express');
const path = require('path');
const cron = require('node-cron');
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
  
  if (username === 'admin' && password === process.env.ADMIN_PASSWORD) {
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
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Feed Admin</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .feed { border: 1px solid #ddd; margin: 10px 0; padding: 10px; }
          .settings-section { border: 2px solid #0066cc; margin: 20px 0; padding: 15px; background: #f8f9fa; }
          .form-group { margin: 10px 0; }
          label { display: inline-block; width: 150px; }
          input, select { width: 300px; padding: 5px; }
          input[type="checkbox"] { width: auto; }
          input[type="number"] { width: 100px; }
          button { padding: 10px 20px; margin: 5px; }
          .delete { background: #ff4444; color: white; }
          .add { background: #44aa44; color: white; }
          .settings { background: #0066cc; color: white; }
          h2 { color: #0066cc; }
        </style>
      </head>
      <body>
        <h1>Feed Management</h1>
        
        <div class="settings-section">
          <h2>⚙️ Settings</h2>
          <form action="/admin/settings" method="post">
            <div class="form-group">
              <label>RSS Cache Interval:</label>
              <input type="number" name="rssCacheIntervalMinutes" value="${currentSettings.rssCacheIntervalMinutes}" min="1" max="1440" required>
              <span style="font-size: 12px; color: #666;">minutes (default: 60)</span>
            </div>
            <div class="form-group">
              <label>Keyword Caching:</label>
              <input type="checkbox" name="keywordCachingEnabled" ${currentSettings.keywordCachingEnabled ? 'checked' : ''}>
              <span style="font-size: 12px; color: #666;">Enable caching of trending keywords (default: enabled)</span>
            </div>
            <button type="submit" class="settings">💾 Update Settings</button>
          </form>
          <div id="settings-status" style="margin-top: 10px; font-weight: bold;"></div>
        </div>
        
        <div class="settings-section">
          <h2>🤖 OpenAI Prompts</h2>
          <form action="/admin/prompts" method="post">
            <div class="form-group">
              <label style="vertical-align: top;">System Prompt:</label>
              <textarea name="systemPrompt" rows="6" style="width: 600px; padding: 8px; font-family: monospace; font-size: 12px;">${currentSettings.openaiPrompts?.systemPrompt || ''}</textarea>
              <div style="font-size: 12px; color: #666; margin-top: 5px;">Instructions for the AI about its role and task</div>
            </div>
            <div class="form-group">
              <label style="vertical-align: top;">User Prompt:</label>
              <textarea name="userPrompt" rows="4" style="width: 600px; padding: 8px; font-family: monospace; font-size: 12px;">${currentSettings.openaiPrompts?.userPrompt || ''}</textarea>
              <div style="font-size: 12px; color: #666; margin-top: 5px;">Template for the user message. Use {limit} for number of keywords, {words} for word list</div>
            </div>
            <button type="submit" class="settings">💾 Update Prompts</button>
          </form>
          <div id="prompts-status" style="margin-top: 10px; font-weight: bold;"></div>
        </div>
        
        <div style="margin: 20px 0;">
          <button onclick="rescrapeFeeds()" style="background: #0066cc; color: white; padding: 10px 20px; border: none; cursor: pointer; border-radius: 4px;">🔄 Rescrape All Feeds</button>
          <div id="rescrape-status" style="margin-top: 10px; font-weight: bold;"></div>
        </div>
        
        <h2>Add New Feed</h2>
        <form action="/admin/feeds" method="post">
          <div class="form-group">
            <label>Medium:</label>
            <input type="text" name="medium" required>
          </div>
          <div class="form-group">
            <label>Region:</label>
            <input type="text" name="region" required>
          </div>
          <div class="form-group">
            <label>URL:</label>
            <input type="url" name="url" placeholder="Leave empty for null">
          </div>
          <button type="submit" class="add">Add Feed</button>
        </form>
        
        <h2>Existing Feeds</h2>
        ${feeds.map((feed, index) => `
          <div class="feed">
            <div style="margin-bottom: 10px; color: #666; font-size: 12px;">
              Last scraped: ${feed.lastScraped ? new Date(feed.lastScraped).toLocaleDateString('nl-NL', {day: 'numeric', month: 'long', year: 'numeric'}) + ' - ' + new Date(feed.lastScraped).toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'}) : 'Never'}
            </div>
            <form action="/admin/feeds/${index}" method="post" style="display: inline-block;">
              <input type="hidden" name="_method" value="PUT">
              <div class="form-group">
                <label>Medium:</label>
                <input type="text" name="medium" value="${feed.medium}" required>
              </div>
              <div class="form-group">
                <label>Region:</label>
                <input type="text" name="region" value="${feed.region}" required>
              </div>
              <div class="form-group">
                <label>URL:</label>
                <input type="url" name="url" value="${feed.url || ''}" placeholder="Leave empty for null">
              </div>
              <button type="submit">Update</button>
            </form>
            <form action="/admin/feeds/${index}" method="post" style="display: inline-block;">
              <input type="hidden" name="_method" value="DELETE">
              <button type="submit" class="delete" onclick="return confirm('Are you sure?')">Delete</button>
            </form>
          </div>
        `).join('')}
        
        <script>
        async function rescrapeFeeds() {
          const button = event.target;
          const status = document.getElementById('rescrape-status');
          
          button.disabled = true;
          button.textContent = '🔄 Rescaping...';
          status.textContent = 'Starting forced rescrape...';
          status.style.color = 'blue';
          
          try {
            const response = await fetch('/import?force=true');
            const result = await response.json();
            
            if (result.success) {
              status.textContent = '✅ ' + result.message;
              status.style.color = 'green';
              // Refresh page to show updated lastScraped timestamps
              setTimeout(() => location.reload(), 2000);
            } else {
              status.textContent = '❌ ' + result.message;
              status.style.color = 'red';
            }
          } catch (error) {
            status.textContent = '❌ Error: ' + error.message;
            status.style.color = 'red';
          }
          
          button.disabled = false;
          button.textContent = '🔄 Rescrape All Feeds';
        }
        </script>
      </body>
      </html>
    `);
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
    trendingArticles = await db.getTrendingArticles();
    
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

// Check if URL is archived in Wayback Machine
app.get('/archive/check/:url', async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    const checkResponse = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
    const checkData = await checkResponse.json();
    
    if (checkData.archived_snapshots?.closest?.available) {
      res.json({ 
        archived: true, 
        archiveUrl: checkData.archived_snapshots.closest.url 
      });
    } else {
      res.json({ archived: false });
    }
  } catch (error) {
    console.error('Archive check error:', error);
    res.status(500).json({ error: 'Failed to check archive status' });
  }
});

// Archive URL using Wayback Machine SavePageNow API
app.post('/archive', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Use SavePageNow API with proper headers
    const archiveResponse = await fetch('https://web.archive.org/save/' + encodeURIComponent(url), {
      method: 'GET',
      headers: {
        'User-Agent': 'NL-Zoekt-Archiver/1.0'
      }
    });

    if (archiveResponse.ok || archiveResponse.status === 302) {
      // Wait a moment then check for the archived version
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const checkResponse = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
      const checkData = await checkResponse.json();
      
      if (checkData.archived_snapshots?.closest?.available) {
        res.json({ 
          success: true, 
          archiveUrl: checkData.archived_snapshots.closest.url 
        });
      } else {
        // Fallback to search URL if specific archive not found
        res.json({ 
          success: true, 
          archiveUrl: `https://web.archive.org/web/*/${url}` 
        });
      }
    } else {
      throw new Error(`Archive request failed with status: ${archiveResponse.status}`);
    }
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
