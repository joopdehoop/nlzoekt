const fs = require('fs');
const path = require('path');
const natural = require('natural');
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

const DB_FILE = path.join(__dirname, 'articles.json');

let articles = [];
let nextId = 1;
let cachedTrendingKeywords = [];
let lastOpenAICallDate = null;

function saveToFile() {
  try {
    const data = {
      articles: articles,
      nextId: nextId,
      cachedTrendingKeywords: cachedTrendingKeywords,
      lastOpenAICallDate: lastOpenAICallDate
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

function loadFromFile() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      articles = data.articles || [];
      nextId = data.nextId || 1;
      cachedTrendingKeywords = data.cachedTrendingKeywords || [];
      lastOpenAICallDate = data.lastOpenAICallDate || null;
      console.log(`Database loaded: ${articles.length} articles`);
      if (cachedTrendingKeywords.length > 0) {
        console.log(`Cached trending keywords loaded: ${cachedTrendingKeywords.join(', ')}`);
      }
    } else {
      console.log('No existing database file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading database:', error);
    articles = [];
    nextId = 1;
    cachedTrendingKeywords = [];
    lastOpenAICallDate = null;
  }
}

function init() {
  loadFromFile();
  console.log('Database initialized with persistent storage');
}

function addArticle(article) {
  const existingArticle = articles.find(a => 
    a.link === article.link || 
    a.title.trim().toLowerCase() === article.title.trim().toLowerCase()
  );
  if (existingArticle) {
    return false;
  }
  
  const newArticle = {
    id: nextId++,
    title: article.title || '',
    content: article.content || article.contentSnippet || '',
    link: article.link,
    pubDate: article.pubDate,
    medium: article.medium,
    region: article.region
  };
  
  articles.push(newArticle);
  saveToFile();
  return true;
}

function searchArticles(query, filters = {}) {
  let results = articles;
  
  if (query) {
    const searchTerm = query.toLowerCase();
    results = results.filter(article => 
      article.title.toLowerCase().includes(searchTerm) ||
      article.content.toLowerCase().includes(searchTerm)
    );
  }
  
  if (filters.medium) {
    results = results.filter(article => article.medium === filters.medium);
  }
  
  if (filters.region) {
    results = results.filter(article => article.region === filters.region);
  }
  
  if (filters.date_from) {
    results = results.filter(article => new Date(article.pubDate) >= new Date(filters.date_from));
  }
  
  if (filters.date_to) {
    results = results.filter(article => new Date(article.pubDate) <= new Date(filters.date_to));
  }
  
  results = results.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  
  if (!query && !filters.medium && !filters.region && !filters.date_from && !filters.date_to) {
    return results.slice(0, 3);
  }
  
  return results;
}

function getTop100Keywords() {
  // Get articles from today (last 24 hours)
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const todaysArticles = articles.filter(article => {
    const articleDate = new Date(article.pubDate);
    return articleDate >= yesterday;
  });
  
  if (todaysArticles.length === 0) {
    console.log('No articles from today found for trending analysis');
    return [];
  }
  
  console.log(`Analyzing ${todaysArticles.length} articles from today`);
  
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
  
  todaysArticles.forEach(article => {
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
  return Object.entries(wordFreq)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 100)
    .map(([word]) => word);
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
    const top100Words = getTop100Keywords();
    
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
        saveToFile();
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
          saveToFile();
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
        saveToFile();
      }
      
      return fallbackKeywords;
    }
    
  } catch (error) {
    console.error('Error in getTrendingKeywords:', error);
    // Fallback to frequency-based selection
    const top100Words = getTop100Keywords();
    const fallbackKeywords = top100Words.slice(0, limit);
    
    // Cache the fallback keywords only if caching is enabled
    if (settings.isKeywordCachingEnabled()) {
      cachedTrendingKeywords = fallbackKeywords;
      lastOpenAICallDate = new Date().toISOString();
      saveToFile();
    }
    
    return fallbackKeywords;
  }
}

function findMostRelevantArticleForKeyword(keyword) {
  // Get articles from today
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const todaysArticles = articles.filter(article => {
    const articleDate = new Date(article.pubDate);
    return articleDate >= today;
  });
  
  if (todaysArticles.length === 0) {
    return null;
  }
  
  // Find articles that contain the keyword
  const keywordLower = keyword.toLowerCase();
  const relevantArticles = todaysArticles.filter(article => 
    article.title.toLowerCase().includes(keywordLower) ||
    article.content.toLowerCase().includes(keywordLower)
  );
  
  if (relevantArticles.length === 0) {
    return null;
  }
  
  // Sort by relevance: prefer "Landelijk" region, then by keyword frequency in title/content
  const scoredArticles = relevantArticles.map(article => {
    let score = 0;
    
    // Prefer "Landelijk" articles
    if (article.region === 'Landelijk') {
      score += 100;
    }
    
    // Score based on keyword frequency in title (higher weight) and content
    const titleMatches = (article.title.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
    const contentMatches = (article.content.toLowerCase().match(new RegExp(keywordLower, 'g')) || []).length;
    
    score += titleMatches * 10 + contentMatches;
    
    // Prefer more recent articles within today
    const articleTime = new Date(article.pubDate).getTime();
    score += articleTime / 1000000; // Small bonus for recency
    
    return { article, score };
  });
  
  // Sort by score descending and return the most relevant article
  scoredArticles.sort((a, b) => b.score - a.score);
  return scoredArticles[0].article;
}

async function getTrendingArticles() {
  const trendingKeywords = await getTrendingKeywords();
  const trendingArticles = [];
  
  for (const keyword of trendingKeywords) {
    const article = findMostRelevantArticleForKeyword(keyword);
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
  const media = [...new Set(articles.map(a => a.medium))];
  const regions = [...new Set(articles.map(a => a.region))];
  
  const trendingKeywords = await getTrendingKeywords();
  
  return {
    totalArticles: articles.length,
    media: media,
    regions: regions,
    trendingKeywords: trendingKeywords
  };
}

module.exports = {
  init,
  addArticle,
  searchArticles,
  getStats,
  getTrendingArticles
};
