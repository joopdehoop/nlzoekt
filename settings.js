const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const defaultSettings = {
  rssCacheIntervalMinutes: 60,
  keywordCachingEnabled: true
};

let settings = { ...defaultSettings };

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...defaultSettings, ...data };
      console.log('Settings loaded:', settings);
    } else {
      console.log('No settings file found, using defaults');
      saveSettings();
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    settings = { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log('Settings saved:', settings);
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

function getSettings() {
  return { ...settings };
}

function updateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  saveSettings();
  return settings;
}

function getRssCacheIntervalMinutes() {
  return settings.rssCacheIntervalMinutes;
}

function isKeywordCachingEnabled() {
  return settings.keywordCachingEnabled;
}

// Initialize on module load
loadSettings();

module.exports = {
  getSettings,
  updateSettings,
  getRssCacheIntervalMinutes,
  isKeywordCachingEnabled
};