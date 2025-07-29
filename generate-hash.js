const bcrypt = require('bcryptjs');

// Get password from command line argument
const password = process.argv[2];

if (!password) {
  console.log('Usage: node generate-hash.js <password>');
  console.log('Example: node generate-hash.js mypassword');
  process.exit(1);
}

// Generate salt and hash the password
const saltRounds = 12;
const hash = bcrypt.hashSync(password, saltRounds);

console.log('Hashed password for .env file:');
console.log(`ADMIN_PASSWORD_HASH=${hash}`);
console.log('\nAdd this line to your .env file and remove any existing ADMIN_PASSWORD entry.');