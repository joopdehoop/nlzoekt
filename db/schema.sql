CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  content TEXT,
  link TEXT UNIQUE,
  pubDate TEXT,
  medium TEXT,
  region TEXT,
  keyword TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_title ON articles(title);
CREATE INDEX IF NOT EXISTS idx_articles_content ON articles(content);
CREATE INDEX IF NOT EXISTS idx_articles_medium ON articles(medium);
CREATE INDEX IF NOT EXISTS idx_articles_region ON articles(region);
CREATE INDEX IF NOT EXISTS idx_articles_pubdate ON articles(pubDate);
CREATE INDEX IF NOT EXISTS idx_articles_keyword ON articles(keyword);