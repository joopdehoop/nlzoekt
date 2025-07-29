const fs = require('fs');
const path = require('path');
const natural = require('natural');
const OpenAI = require('openai');
const sqlite3 = require('sqlite3').verbose();
const settings = require('../settings');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Initialize OpenAI client
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

const DB_FILE = path.join(__dirname, 'articles.db');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

let db = null;
let cachedTrendingKeywords = [];
let lastOpenAICallDate = null;

function saveMetadata() {
  try {
    const metadataFile = path.join(__dirname, 'metadata.json');
    const data = {
      cachedTrendingKeywords: cachedTrendingKeywords,
      lastOpenAICallDate: lastOpenAICallDate
    };
    fs.writeFileSync(metadataFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving metadata:', error);
  }
}

function loadMetadata() {
  try {
    const metadataFile = path.join(__dirname, 'metadata.json');
    if (fs.existsSync(metadataFile)) {
      const data = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
      cachedTrendingKeywords = data.cachedTrendingKeywords || [];
      lastOpenAICallDate = data.lastOpenAICallDate || null;
      if (cachedTrendingKeywords.length > 0) {
        console.log(`Cached trending keywords loaded: ${cachedTrendingKeywords.join(', ')}`);
      }
    }
  } catch (error) {
    console.error('Error loading metadata:', error);
    cachedTrendingKeywords = [];
    lastOpenAICallDate = null;
  }
}

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_FILE, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      
      console.log('Connected to SQLite database');
      
      // Read and execute schema
      try {
        const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
        db.exec(schema, (err) => {
          if (err) {
            console.error('Error creating tables:', err);
            reject(err);
            return;
          }
          
          // Count existing articles
          db.get('SELECT COUNT(*) as count FROM articles', (err, row) => {
            if (err) {
              console.error('Error counting articles:', err);
            } else {
              console.log(`Database initialized: ${row.count} existing articles`);
            }
            resolve();
          });
        });
      } catch (error) {
        console.error('Error reading schema file:', error);
        reject(error);
      }
    });
  });
}

function cleanupOldArticles() {
  return new Promise((resolve, reject) => {
    const thirtyOneDaysAgo = new Date();
    thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
    const cutoffDate = thirtyOneDaysAgo.toISOString();
    
    db.run('DELETE FROM articles WHERE datetime(pubDate) < datetime(?)', [cutoffDate], function(err) {
      if (err) {
        console.error('Error cleaning up old articles:', err);
        reject(err);
        return;
      }
      
      if (this.changes > 0) {
        console.log(`Cleaned up ${this.changes} articles older than 31 days`);
      }
      resolve(this.changes);
    });
  });
}

async function init() {
  try {
    await initializeDatabase();
    loadMetadata();
    await cleanupOldArticles();
    console.log('Database initialized with SQLite storage');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

function addArticle(article) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO articles (title, content, link, pubDate, medium, region)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([
      article.title || '',
      article.content || article.contentSnippet || '',
      article.link,
      article.pubDate,
      article.medium,
      article.region
    ], function(err) {
      if (err) {
        console.error('Error adding article:', err);
        reject(err);
        return;
      }
      
      // Return true if a new row was inserted, false if it already existed
      const wasAdded = this.changes > 0;
      resolve(wasAdded);
    });
    
    stmt.finalize();
  });
}

function searchArticles(query, filters = {}) {
  return new Promise((resolve, reject) => {
    let sql = 'SELECT * FROM articles WHERE 1=1';
    const params = [];
    
    if (query) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      const searchTerm = `%${query}%`;
      params.push(searchTerm, searchTerm);
    }
    
    if (filters.medium) {
      sql += ' AND medium = ?';
      params.push(filters.medium);
    }
    
    if (filters.region) {
      sql += ' AND region = ?';
      params.push(filters.region);
    }
    
    if (filters.date_from) {
      sql += ' AND datetime(pubDate) >= datetime(?)';
      params.push(filters.date_from);
    }
    
    if (filters.date_to) {
      sql += ' AND datetime(pubDate) <= datetime(?)';
      params.push(filters.date_to);
    }
    
    sql += ' ORDER BY datetime(pubDate) DESC';
    
    // If no filters, limit to 3 results
    if (!query && !filters.medium && !filters.region && !filters.date_from && !filters.date_to) {
      sql += ' LIMIT 3';
    }
    
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Error searching articles:', err);
        reject(err);
        return;
      }
      
      resolve(rows || []);
    });
  });
}

function getTop100Keywords() {
  return new Promise((resolve, reject) => {
    // Get articles from today (last 24 hours)
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    db.all('SELECT title, content FROM articles WHERE datetime(pubDate) >= datetime(?)', [yesterday.toISOString()], (err, rows) => {
      if (err) {
        console.error('Error getting today\'s articles:', err);
        reject(err);
        return;
      }
      
      if (rows.length === 0) {
        console.log('No articles from today found for trending analysis');
        resolve([]);
        return;
      }
      
      console.log(`Analyzing ${rows.length} articles from today`);
      
      // Load Dutch stopwords from file
      let dutchStopwords = new Set();
      try {
        const stopwordsPath = path.join(__dirname, '..', 'dutch-stopwords.txt');
        const stopwordsContent = fs.readFileSync(stopwordsPath, 'utf8');
        const stopwordsList = stopwordsContent.split('\n').map(word => word.trim()).filter(word => word.length > 0);
        dutchStopwords = new Set(stopwordsList);
      } catch (error) {
        console.error('Error loading Dutch stopwords file:', error);
        // Fallback to a minimal set of Dutch stopwords
        dutchStopwords = new Set(['de', 'het', 'een', 'en', 'van', 'te', 'dat', 'die', 'in', 'op', 'voor', 'met', 'als', 'aan', 'bij', 'om', 'ook', 'zijn', 'hebben', 'er', 'naar', 'maar', 'over', 'uit', 'dan', 'onder', 'tegen', 'na', 'door', 'worden', 'deze', 'wel', 'nog', 'zou', 'wat', 'waar', 'wie', 'toen', 'dus', 'hier', 'alle', 'geen', 'kan', 'veel', 'meer', 'nu', 'zo', 'dit', 'hij', 'zij', 'zich', 'hun', 'haar', 'hem', 'ons', 'mij', 'ik', 'wij', 'u', 'was', 'waren', 'is', 'ben', 'bent', 'heeft', 'had', 'hadden', 'heb', 'hebt', 'niet']);
      }
      
      // Count word frequencies across all today's articles
      const wordFreq = {};
      
      rows.forEach(article => {
        const text = (article.title + ' ' + (article.content || '')).toLowerCase();
        
        // Tokenize and filter - include all Dutch special characters
        const words = text.match(/\b[a-zA-ZàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāĂăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽž\-]{3,}\b/g) || [];
        
        words.forEach(word => {
          const cleanWord = word.toLowerCase();
          if (!dutchStopwords.has(cleanWord)) {
            wordFreq[cleanWord] = (wordFreq[cleanWord] || 0) + 1;
          }
        });
      });
      
      // Sort by frequency and return top 100
      const result = Object.entries(wordFreq)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 100)
        .map(([word]) => word);
        
      resolve(result);
    });
  });
}

function shouldMakeNewOpenAICall() {
  if (!lastOpenAICallDate) {
    return true;
  }
  
  const now = new Date();
  const lastCallDate = new Date(lastOpenAICallDate);
  
  // Check if last call was made before today's midnight
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return lastCallDate < todayMidnight;
}

async function getTrendingKeywords(limit = 5) {
  try {
    // Check if keyword caching is disabled
    if (!settings.isKeywordCachingEnabled()) {
      console.log('Keyword caching is disabled, forcing fresh analysis');
      // Skip cache and force fresh analysis
    } else {
      // Check if we have cached keywords and don't need a new OpenAI call
      if (!shouldMakeNewOpenAICall() && cachedTrendingKeywords.length >= limit) {
        console.log('Using cached trending keywords from today');
        return cachedTrendingKeywords.slice(0, limit);
      }
    }
    
    // Get the top 100 most frequent words from today
    const top100Words = await getTop100Keywords();
    
    if (top100Words.length === 0) {
      console.log('No keywords found for today');
      return [];
    }
    
    // If OpenAI is not configured, fall back to simple frequency-based selection
    if (!openai || !process.env.OPENAI_API_KEY) {
      console.log('OpenAI not configured, using frequency-based trending keywords');
      const fallbackKeywords = top100Words.slice(0, limit);
      
      // Cache the fallback keywords only if caching is enabled
      if (settings.isKeywordCachingEnabled()) {
        cachedTrendingKeywords = fallbackKeywords;
        lastOpenAICallDate = new Date().toISOString();
        saveMetadata();
      }
      
      return fallbackKeywords;
    }
    
    console.log(`Making new OpenAI call to select ${limit} most newsworthy nouns from ${top100Words.length} frequent words`);
    
    // Ask GPT-4o-mini to select the most newsworthy nouns
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert news analyst. You will be given a list of the most frequent words from Dutch news articles published today. Your task is to select the 5 most newsworthy NOUNS that are likely to be trending topics or important news subjects. Focus on proper,significant nouns (names, places, organizations, events) that are not mentioned in news every day and are related to current events. Exclude generic words."
        },
        {
          role: "user",
          content: `From this list of the 100 most frequent in Dutch news today, select the ${limit} most newsworthy nouns that represent important trending topics:\n\n${top100Words.join(', ')}\n\nReturn only a JSON array of the selected words, like: ["word1", "word2", "word3", "word4", "word5"], no other context.`
        }
      ],
      temperature: 0.3,
      max_tokens: 200
    });
    
    const response = completion.choices[0].message.content.trim();
    console.log('GPT-4o-mini response:', response);
    
    // Parse the JSON response
    try {
      const selectedWords = JSON.parse(response);
      if (Array.isArray(selectedWords)) {
        console.log(`GPT-4o-mini selected: ${selectedWords.join(', ')}`);
        
        // Cache the successful response only if caching is enabled
        if (settings.isKeywordCachingEnabled()) {
          cachedTrendingKeywords = selectedWords;
          lastOpenAICallDate = new Date().toISOString();
          saveMetadata();
        }
        
        return selectedWords.slice(0, limit);
      } else {
        throw new Error('Response is not an array');
      }
    } catch (parseError) {
      console.error('Error parsing GPT-4o-mini response:', parseError);
      console.log('Falling back to frequency-based selection');
      const fallbackKeywords = top100Words.slice(0, limit);
      
      // Cache the fallback keywords only if caching is enabled
      if (settings.isKeywordCachingEnabled()) {
        cachedTrendingKeywords = fallbackKeywords;
        lastOpenAICallDate = new Date().toISOString();
        saveMetadata();
      }
      
      return fallbackKeywords;
    }
    
  } catch (error) {
    console.error('Error in getTrendingKeywords:', error);
    // Fallback to frequency-based selection
    const top100Words = await getTop100Keywords();
    const fallbackKeywords = top100Words.slice(0, limit);
    
    // Cache the fallback keywords only if caching is enabled
    if (settings.isKeywordCachingEnabled()) {
      cachedTrendingKeywords = fallbackKeywords;
      lastOpenAICallDate = new Date().toISOString();
      saveMetadata();
    }
    
    return fallbackKeywords;
  }
}

function findMostRelevantArticleForKeyword(keyword) {
  return new Promise((resolve, reject) => {
    // Get articles from today
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const sql = `
      SELECT * FROM articles 
      WHERE datetime(pubDate) >= datetime(?) 
      AND (title LIKE ? OR content LIKE ?)
      ORDER BY 
        CASE WHEN region = 'Landelijk' THEN 1 ELSE 0 END DESC,
        datetime(pubDate) DESC
    `;
    
    const keywordPattern = `%${keyword}%`;
    
    db.all(sql, [today.toISOString(), keywordPattern, keywordPattern], (err, rows) => {
      if (err) {
        console.error('Error finding relevant article:', err);
        reject(err);
        return;
      }
      
      if (rows.length === 0) {
        resolve(null);
        return;
      }
      
      // Return the most relevant article (first in the ordered results)
      resolve(rows[0]);
    });
  });
}

async function getTrendingArticles() {
  const trendingKeywords = await getTrendingKeywords();
  const trendingArticles = [];
  
  for (const keyword of trendingKeywords) {
    const article = await findMostRelevantArticleForKeyword(keyword);
    if (article) {
      trendingArticles.push({
        keyword: keyword,
        article: article
      });
    }
  }
  
  return trendingArticles;
}

async function getStats() {
  return new Promise(async (resolve, reject) => {
    try {
      // Get total article count
      db.get('SELECT COUNT(*) as count FROM articles', async (err, countRow) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Get distinct media
        db.all('SELECT DISTINCT medium FROM articles ORDER BY medium', (err, mediaRows) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Get distinct regions
          db.all('SELECT DISTINCT region FROM articles ORDER BY region', async (err, regionRows) => {
            if (err) {
              reject(err);
              return;
            }
            
            try {
              const trendingKeywords = await getTrendingKeywords();
              
              resolve({
                totalArticles: countRow.count,
                media: mediaRows.map(row => row.medium),
                regions: regionRows.map(row => row.region),
                trendingKeywords: trendingKeywords
              });
            } catch (error) {
              reject(error);
            }
          });
        });
      });
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  init,
  addArticle,
  searchArticles,
  getStats,
  getTrendingArticles,
  cleanupOldArticles
};
