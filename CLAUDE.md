# NL Zoekt - Codebase Summary

NL Zoekt is a Dutch news aggregation and search platform built with Node.js. It collects articles from RSS feeds of Dutch news sources and provides a searchable web interface.

## Current Implementation Status

**✅ IMPLEMENTED:**
- RSS feed importing with scheduled updates (every 30 minutes)
- JSON-based article storage with file persistence
- Full-text search across titles and article content
- Advanced filtering by medium, region, and date range
- Trending keywords analysis using OpenAI GPT-4o-mini
- Web interface with EJS templating
- Manual import endpoint (`/import`)
- Statistics endpoint (`/stats`)
- Admin authentication system (`/admin`)
- Dynamic feed URL management interface (`/admin`)
- Admin page for adding new RSS feeds (`/admin`)

**❌ NOT YET IMPLEMENTED:**
- SQLite database (currently using JSON file storage)

## Core Functionality

## Technology Stack
- **Backend:** Node.js with Express.js
- **Storage:** JSON file-based database (`db/articles.json`)
- **RSS Processing:** `rss-parser` npm package
- **Templating:** EJS views
- **Scheduling:** `node-cron` for automated imports
- **AI Integration:** OpenAI GPT-4o-mini for trending keyword analysis
- **NLP:** Natural.js for text processing
- **Environment:** dotenv for configuration

## Project Structure

```
nlzoekt/
├── index.js              # Main Express server and routes
├── importer.js           # RSS feed import functionality
├── package.json          # Dependencies and scripts
├── feeds.json            # RSS feed configuration (23 Dutch news sources)
├── dutch-stopwords.txt   # Dutch language stopwords for text analysis
├── db/
│   ├── init.js          # Database operations and search logic
│   ├── articles.json    # JSON-based article storage
│   └── schema.sql       # SQLite schema (for future migration)
├── views/
│   └── index.ejs        # Main search interface template
└── public/
    └── style.css        # Frontend styling

## Key Features

### 1. RSS Feed Management
- **Feed Sources:** 23 Dutch news sources configured in `feeds.json`
- **Coverage:** National (Landelijk) and regional news sources
- **Sources include:** NU.nl, De Telegraaf, AD, NRC, Volkskrant, regional papers
- **Automatic Import:** Scheduled every 30 minutes via node-cron
- **Manual Import:** Available via `/import` endpoint

### 2. Article Storage & Deduplication
- **File:** `db/articles.json` with persistent storage
- **Deduplication:** By URL and normalized title comparison
- **Fields:** id, title, content, link, pubDate, medium, region
- **Auto-increment ID system** with persistent state

### 3. Search & Filtering
- **Full-text search:** Across article titles and content
- **Filters:** Medium, region, date range (from/to)
- **Sorting:** By publication date (newest first)
- **Smart defaults:** Shows latest 3 articles when no filters applied

### 4. Trending Keywords Analysis
- **AI-Powered:** Uses OpenAI GPT-4o-mini to identify trending topics
- **Frequency Analysis:** Processes articles from last 24 hours
- **Dutch Language Support:** Custom Dutch stopwords filtering
- **Fallback:** Frequency-based analysis when OpenAI unavailable
- **Display:** Clickable trending keywords on homepage

### 5. Web Interface
- **Template:** EJS-based responsive design
- **Search Form:** Text input with medium/region/date filters
- **Results Display:** Article cards with metadata and content preview
- **Stats:** Article count and available filters
- **Manual Controls:** Import and stats links

## API Endpoints

- **`GET /`** - Main search interface with optional query parameters
  - `q` - Search term
  - `medium` - Filter by news source
  - `region` - Filter by region
  - `date_from` / `date_to` - Date range filters
- **`GET /import`** - Manual RSS feed import
- **`GET /stats`** - JSON statistics and trending keywords

## Configuration

### Environment Variables
- `OPENAI_API_KEY` - Optional, for trending keyword analysis
- `PORT` - Server port (defaults to 3000)

### RSS Feeds Configuration (`feeds.json`)
Each feed entry contains:
```json
{
  "medium": "Source Name",
  "region": "Geographic Region", 
  "url": "RSS Feed URL"
}
```

## Development Commands

```bash
# Install dependencies
npm install

# Start server
npm start
# or
npm run dev

# Manual import
curl http://localhost:3000/import

# View stats
curl http://localhost:3000/stats
```

## Technical Notes

- **Database:** Currently uses JSON file storage instead of SQLite (schema exists for future migration)
- **Performance:** In-memory search with file persistence
- **Error Handling:** Graceful fallbacks for failed RSS imports and AI analysis
- **Dutch Language:** Specialized stopwords and text processing for Dutch content
- **Scheduled Tasks:** Automatic imports every 30 minutes + startup import

