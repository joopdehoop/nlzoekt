const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const OpenAI = require('openai');
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
const KEYWORDS_CACHE_FILE = path.join(__dirname, 'trending_keywords_cache.json');

let db = null;

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

async function generateKeywordForArticle(title, content) {
  if (!openai || !process.env.OPENAI_API_KEY) {
    console.log('OpenAI not configured, skipping keyword generation');
    return null;
  }

  try {
    const prompt = `Summarize this Dutch news article in maximum 3 words (preferably 1-2 words). Return only the keyword/phrase, nothing else:

Title: ${title}
Content: ${content}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 10
    });

    const keyword = completion.choices[0].message.content.trim();
    console.log(`Generated keyword "${keyword}" for article: ${title.substring(0, 50)}...`);
    return keyword;
  } catch (error) {
    console.error('Error generating keyword:', error);
    return null;
  }
}

async function init() {
  try {
    await initializeDatabase();
    await cleanupOldArticles();
    console.log('Database initialized with SQLite storage');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

async function addArticle(article) {
  return new Promise(async (resolve, reject) => {
    try {
      // Check if article already exists by URL
      db.get('SELECT id, keyword FROM articles WHERE link = ?', [article.link], async (err, existingArticle) => {
        if (err) {
          console.error('Error checking existing article:', err);
          reject(err);
          return;
        }

        if (existingArticle) {
          // Article already exists, don't add again
          resolve(false);
          return;
        }

        // Generate keyword for new article
        let keyword = null;
        if (openai && process.env.OPENAI_API_KEY) {
          keyword = await generateKeywordForArticle(article.title || '', article.content || article.contentSnippet || '');
        }

        const stmt = db.prepare(`
          INSERT INTO articles (title, content, link, pubDate, medium, region, keyword)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run([
          article.title || '',
          article.content || article.contentSnippet || '',
          article.link,
          article.pubDate,
          article.medium,
          article.region,
          keyword
        ], function(err) {
          if (err) {
            console.error('Error adding article:', err);
            reject(err);
            return;
          }
          
          resolve(true);
        });
        
        stmt.finalize();
      });
    } catch (error) {
      console.error('Error in addArticle:', error);
      reject(error);
    }
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

async function generateTrendingKeywords() {
  if (!openai || !process.env.OPENAI_API_KEY) {
    console.log('OpenAI not configured, cannot get trending keywords');
    return [];
  }

  return new Promise((resolve, reject) => {
    // Get all keywords from articles in the last 24 hours
    db.all('SELECT keyword FROM articles WHERE keyword IS NOT NULL AND pubDate >= datetime(\'now\', \'-1 day\')', async (err, rows) => {
      if (err) {
        console.error('Error getting keywords from last 24h:', err);
        reject(err);
        return;
      }
      
      if (rows.length === 0) {
        console.log('No keywords found from last 24 hours');
        resolve([]);
        return;
      }

      const keywords = rows.map(row => row.keyword);
      console.log(`Found ${keywords.length} keywords from last 24h:`, keywords);

      try {
        // Get prompts from settings
        const currentSettings = settings.getSettings();
        const systemPrompt = currentSettings.openaiPrompts?.systemPrompt || "You are an expert news analyst. You will be given a list of keywords from Dutch news articles published in the last 24 hours. Select the 5 most newsworthy and diverse keywords that represent important trending topics. Return the selected keywords in the required JSON format.";
        const userPromptTemplate = currentSettings.openaiPrompts?.userPrompt || "From this list of keywords from Dutch news in the last 24 hours, select the 5 most newsworthy and diverse keywords that represent important trending topics:\n\n{words}\n\nSelect the most relevant trending keywords.";
        
        // Replace placeholders in user prompt
        const userPrompt = userPromptTemplate
          .replace('{limit}', '5')
          .replace('{words}', keywords.join(', '));

        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user", 
              content: userPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 200,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "trending_keywords",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  keywords: {
                    type: "array",
                    items: {
                      type: "string"
                    },
                    maxItems: 10,
                    minItems: 1
                  }
                },
                required: ["keywords"],
                additionalProperties: false
              }
            }
          }
        });

        const response = completion.choices[0].message.content;
        console.log('OpenAI trending keywords response:', response);
        
        const parsed = JSON.parse(response);
        const selectedKeywords = parsed.keywords;
        
        if (Array.isArray(selectedKeywords)) {
          console.log(`Selected trending keywords: ${selectedKeywords.join(', ')}`);
          resolve(selectedKeywords);
        } else {
          throw new Error('Response keywords is not an array');
        }
      } catch (error) {
        console.error('Error getting trending keywords from OpenAI:', error);
        // Fallback: return first 5 unique keywords
        const uniqueKeywords = [...new Set(keywords)].slice(0, 5);
        resolve(uniqueKeywords);
      }
    });
  });
}

async function loadKeywordsCache() {
  try {
    if (fs.existsSync(KEYWORDS_CACHE_FILE)) {
      const cacheData = JSON.parse(fs.readFileSync(KEYWORDS_CACHE_FILE, 'utf8'));
      return cacheData;
    }
  } catch (error) {
    console.error('Error loading keywords cache:', error);
  }
  return null;
}

function saveKeywordsCache(keywords, articles) {
  try {
    const cacheData = {
      timestamp: new Date().toISOString(),
      keywords: keywords,
      articles: articles
    };
    fs.writeFileSync(KEYWORDS_CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log('Keywords cache saved successfully');
  } catch (error) {
    console.error('Error saving keywords cache:', error);
  }
}

function isCacheValid(cacheData) {
  if (!cacheData || !cacheData.timestamp) {
    return false;
  }
  
  const currentSettings = settings.getSettings();
  const cacheIntervalMinutes = currentSettings.rssCacheIntervalMinutes || 60;
  const cacheTimestamp = new Date(cacheData.timestamp);
  const now = new Date();
  const diffMinutes = (now - cacheTimestamp) / (1000 * 60);
  
  return diffMinutes < cacheIntervalMinutes;
}

async function getTrendingArticles() {
  console.log('Getting trending articles and keywords');
  
  // Check if we have valid cached data (respecting RSS cache interval)
  const cachedData = await loadKeywordsCache();
  if (cachedData && isCacheValid(cachedData)) {
    console.log('Using cached trending keywords and articles');
    return cachedData.articles || [];
  }
  
  // Generate new trending keywords and articles
  console.log('Generating new trending keywords and articles');
  const trendingKeywords = await generateTrendingKeywords();
  const trendingArticles = [];
  
  for (const keyword of trendingKeywords) {
    await new Promise((resolve) => {
      db.get('SELECT * FROM articles WHERE keyword = ? ORDER BY datetime(pubDate) DESC LIMIT 1', [keyword], (err, row) => {
        if (err) {
          console.error('Error finding article for keyword:', err);
        } else if (row) {
          trendingArticles.push({
            keyword: keyword,
            article: row
          });
        }
        resolve();
      });
    });
  }
  
  // Always save to cache (regardless of keywordCachingEnabled setting)
  saveKeywordsCache(trendingKeywords, trendingArticles);
  
  return trendingArticles;
}

async function getTrendingKeywords() {
  const currentSettings = settings.getSettings();
  console.log('Getting trending keywords');
  
  // Check if we have valid cached data (respecting RSS cache interval)
  const cachedData = await loadKeywordsCache();
  if (cachedData && isCacheValid(cachedData)) {
    console.log('Using cached trending keywords');
    return cachedData.keywords || [];
  }
  
  // Generate new trending keywords
  console.log('Generating new trending keywords');
  const trendingKeywords = await generateTrendingKeywords();
  const trendingArticles = [];
  
  // Also generate articles for caching
  for (const keyword of trendingKeywords) {
    await new Promise((resolve) => {
      db.get('SELECT * FROM articles WHERE keyword = ? ORDER BY datetime(pubDate) DESC LIMIT 1', [keyword], (err, row) => {
        if (err) {
          console.error('Error finding article for keyword:', err);
        } else if (row) {
          trendingArticles.push({
            keyword: keyword,
            article: row
          });
        }
        resolve();
      });
    });
  }
  
  // Always save to cache (regardless of keywordCachingEnabled setting)
  saveKeywordsCache(trendingKeywords, trendingArticles);
  
  return trendingKeywords;
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