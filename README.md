# NL Zoekt - Dutch News Aggregator

NL Zoekt is a Dutch news aggregation and search platform that collects articles from RSS feeds of Dutch news sources and provides a searchable web interface.

## Features

- **RSS Feed Aggregation**: Automatically imports from 23 Dutch news sources
- **Full-text Search**: Search across article titles and content
- **Advanced Filtering**: Filter by medium, region, and date range
- **Trending Keywords**: AI-powered trending topic analysis using OpenAI GPT-4o-mini
- **Admin Interface**: Manage RSS feeds and view statistics
- **Scheduled Updates**: Automatic feed imports every 30 minutes

## Technology Stack

- **Backend**: Node.js with Express.js
- **Storage**: JSON file-based database
- **RSS Processing**: `rss-parser` npm package
- **Templating**: EJS views
- **Scheduling**: `node-cron` for automated imports
- **AI Integration**: OpenAI GPT-4o-mini for trending keyword analysis
- **NLP**: Natural.js for text processing

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd nlzoekt
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file (optional):
   ```bash
   cp .env.example .env
   # Add your OpenAI API key for trending keywords feature
   ```

4. Start the server:
   ```bash
   npm start
   ```

The application will be available at `http://localhost:3000`

## Usage

### Web Interface
- Visit `http://localhost:3000` for the main search interface
- Use the search form to find articles by keyword
- Apply filters for medium, region, and date range
- View trending keywords on the homepage

### API Endpoints
- `GET /` - Main search interface with query parameters
- `GET /import` - Manual RSS feed import
- `GET /stats` - JSON statistics and trending keywords
- `GET /admin` - Admin interface for feed management

### Manual Import
```bash
curl http://localhost:3000/import
```

### View Statistics
```bash
curl http://localhost:3000/stats
```

## Configuration

### Environment Variables
- `OPENAI_API_KEY` - Optional, for trending keyword analysis
- `PORT` - Server port (defaults to 3000)

### RSS Feeds
News sources are configured in `feeds.json`. Each feed entry contains:
```json
{
  "medium": "Source Name",
  "region": "Geographic Region", 
  "url": "RSS Feed URL"
}
```

## Project Structure

```
nlzoekt/
├── index.js              # Main Express server and routes
├── importer.js           # RSS feed import functionality
├── package.json          # Dependencies and scripts
├── feeds.json            # RSS feed configuration
├── dutch-stopwords.txt   # Dutch language stopwords
├── db/
│   ├── init.js          # Database operations and search logic
│   ├── articles.json    # JSON-based article storage
│   └── schema.sql       # SQLite schema (for future migration)
├── views/
│   └── index.ejs        # Main search interface template
└── public/
    └── style.css        # Frontend styling
```

## News Sources

The platform aggregates news from 23 Dutch sources including:
- NU.nl
- De Telegraaf
- Algemeen Dagblad (AD)
- NRC Handelsblad
- De Volkskrant
- Regional newspapers
- And more...

## Development

### Running in Development Mode
```bash
npm run dev
```

### Manual Operations
- **Import feeds**: Visit `/import` or use curl
- **View stats**: Visit `/stats` for JSON data
- **Admin panel**: Visit `/admin` for feed management

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions, please open an issue on GitHub.
